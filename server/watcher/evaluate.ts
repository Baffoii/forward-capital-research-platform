/**
 * The watcher: read both logs, match rules against them, queue notifications.
 *
 * Structured as many small per-company jobs rather than one big pass. The
 * existing deployment was unstable doing all companies' work in a single
 * request — that's why the repo already splits sync into per-company calls
 * (see the note in server/routes.ts) — and the same constraint applies here.
 * A GitHub Actions cron fetches the plan, then calls one endpoint per company.
 *
 * Idempotent by construction: every notification carries a dedupe key derived
 * from the rule and what triggered it, and queueNotifications does ON CONFLICT
 * DO NOTHING. A retried run writes nothing. That's what lets the whole thing be
 * re-run freely without teaching anyone to ignore the channel.
 */

import { TEAM_EMAILS } from "@shared/team";
import { listWorldEvents, type WorldEventRow } from "../human-loop/store";
import { evaluate, missingFields, type Context } from "./predicate";
import {
  buildCompanyFacts,
  buildConstraintFacts,
  contextForEvent,
  listOpenPositions,
  type CompanyFacts,
} from "./context";
import { composeRuleNotification, composeUncheckableNotification } from "./compose";
import {
  listArmedKillCriteria,
  listWatcherRules,
  markKillCriterionTriggered,
  queueNotifications,
  type NewNotification,
  type WatcherRuleRow,
} from "./store";
import { appendWorldEvent } from "../human-loop/store";

/**
 * How far back a run looks.
 *
 * Re-evaluating recent history every run costs little and means a run that
 * failed yesterday is silently repaired today rather than leaving a permanent
 * gap. The dedupe key stops the repetition from reaching anyone.
 */
const LOOKBACK_DAYS = 7;

function recipientsFor(rule: WatcherRuleRow): string[] {
  return rule.recipients.length > 0 ? rule.recipients : [...TEAM_EMAILS];
}

export interface WatcherRunResult {
  companyId: number;
  companyName?: string;
  rulesChecked: number;
  eventsChecked: number;
  matched: number;
  /** Rules the data couldn't answer. Reported, never swallowed. */
  uncheckable: string[];
  notificationsQueued: number;
}

/**
 * Check every rule that applies to one company against everything that has
 * happened to it recently.
 */
export async function runWatcherForCompany(
  companyId: number,
  now = new Date(),
): Promise<WatcherRunResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [rules, events, positions, constraintFacts] = await Promise.all([
    listWatcherRules({ companyId }),
    listWorldEvents({ companyId, since, until: now, limit: 200 }),
    listOpenPositions(),
    buildConstraintFacts(now),
  ]);

  const immediate = rules.filter((r) => r.cadence !== "weekly");
  const facts = await buildCompanyFacts(companyId, now, positions);

  const result: WatcherRunResult = {
    companyId,
    companyName: facts?.name,
    rulesChecked: immediate.length,
    eventsChecked: events.length,
    matched: 0,
    uncheckable: [],
    notificationsQueued: 0,
  };

  if (!facts || immediate.length === 0) return result;

  const queued: NewNotification[] = [];

  for (const rule of immediate) {
    // Rules that name no event kind still need something to evaluate against
    // — a standing condition like "backlog below X" is true or false today
    // whether or not anything happened. Evaluate those once against the
    // company as it stands, in addition to per-event.
    const targets: (WorldEventRow | null)[] = events.length > 0 ? [...events, null] : [null];
    let sawUncheckable = false;

    for (const event of targets) {
      const ctx = event
        ? contextForEvent(facts, event, constraintFacts)
        : { ...facts.base };

      const verdict = evaluate(rule.predicate, ctx);

      if (verdict === "unknown") {
        sawUncheckable = true;
        continue;
      }
      if (verdict === false) continue;

      result.matched++;
      const { subject, body } = composeRuleNotification({
        ruleName: rule.name,
        ruleDescription: rule.description,
        predicate: rule.predicate,
        companyName: facts.name,
        ticker: facts.ticker,
        headline: event?.headline,
        detail: event?.detail ?? null,
        context: ctx,
      });

      for (const recipient of recipientsFor(rule)) {
        queued.push({
          kind: rule.kind,
          ruleId: rule.id,
          recipientEmail: recipient,
          subject,
          body,
          payload: {
            ruleSlug: rule.slug,
            worldEventId: event?.id ?? null,
            context: ctx,
          },
          companyId,
          ticker: facts.ticker,
          // Standing conditions dedupe by day, so a condition that stays true
          // reminds you daily rather than once ever or once per run.
          dedupeKey: event
            ? `${rule.slug}:${recipient}:event:${event.id}`
            : `${rule.slug}:${recipient}:day:${now.toISOString().slice(0, 10)}`,
        });
      }
      // One notification per rule per run is enough; the rest of the events
      // would say the same thing.
      break;
    }

    // A rule that matched nothing AND couldn't be fully evaluated is a rule
    // nobody is watching with. Say so — once a week, not every run.
    if (sawUncheckable && result.matched === 0) {
      const missing = missingFields(rule.predicate, facts.base);
      if (missing.length > 0) {
        result.uncheckable.push(`${rule.slug}: missing ${missing.join(", ")}`);
        const { subject, body } = composeUncheckableNotification({
          ruleName: rule.name,
          companyName: facts.name,
          ticker: facts.ticker,
          predicate: rule.predicate,
          missing,
        });
        for (const recipient of recipientsFor(rule)) {
          queued.push({
            kind: rule.kind,
            ruleId: rule.id,
            recipientEmail: recipient,
            subject,
            body,
            payload: { ruleSlug: rule.slug, missing, uncheckable: true },
            companyId,
            ticker: facts.ticker,
            dedupeKey: `${rule.slug}:${recipient}:uncheckable:${isoWeek(now)}`,
          });
        }
      }
    }
  }

  queued.push(...(await checkKillCriteria(facts, constraintFacts, now, result)));
  queued.push(...(await checkPrecommitments(facts, constraintFacts, now, result)));

  const written = await queueNotifications(queued);
  result.notificationsQueued = written.length;
  return result;
}

/**
 * Check the kill criteria already stored for this company.
 *
 * These come from the pre-existing kill_criteria table, whose predicates are
 * already in the { metric, op, value } shape our evaluator understands — no
 * migration, no rewriting. They're checked every run because a kill criterion
 * is the team writing down in advance what would prove them wrong, and
 * noticing it has happened is the entire value of having written it.
 *
 * A firing criterion also appends a world event, so it shows up in the weekly
 * digest and in everyone's re-entry briefing rather than living only in one
 * person's inbox.
 */
async function checkKillCriteria(
  facts: CompanyFacts,
  constraintFacts: Map<string, Context>,
  now: Date,
  result: WatcherRunResult,
): Promise<NewNotification[]> {
  const criteria = await listArmedKillCriteria(facts.companyId);
  const queued: NewNotification[] = [];

  for (const criterion of criteria) {
    const ctx = { ...facts.base };
    if (criterion.constraintId && constraintFacts.has(criterion.constraintId)) {
      (ctx as any).constraint = constraintFacts.get(criterion.constraintId);
    }

    const verdict = evaluate(criterion.predicate, ctx);
    result.rulesChecked++;

    if (verdict === "unknown") {
      const missing = missingFields(criterion.predicate, ctx);
      result.uncheckable.push(`kill:${criterion.id}: missing ${missing.join(", ")}`);
      const { subject, body } = composeUncheckableNotification({
        ruleName: criterion.statement,
        companyName: facts.name,
        ticker: facts.ticker,
        predicate: criterion.predicate,
        missing,
      });
      for (const recipient of TEAM_EMAILS) {
        queued.push({
          kind: "kill_criterion",
          ruleId: null,
          recipientEmail: recipient,
          subject,
          body,
          payload: { killCriterionId: criterion.id, missing, uncheckable: true },
          companyId: facts.companyId,
          ticker: facts.ticker,
          dedupeKey: `kill-uncheckable:${criterion.id}:${recipient}:${isoWeek(now)}`,
        });
      }
      continue;
    }

    if (verdict === false) continue;

    result.matched++;

    const { subject, body } = composeRuleNotification({
      ruleName: "A kill criterion has fired",
      ruleDescription: `We wrote this down in advance as something that would prove us wrong:\n"${criterion.statement}"`,
      predicate: criterion.predicate,
      companyName: facts.name,
      ticker: facts.ticker,
      context: ctx,
    });

    for (const recipient of TEAM_EMAILS) {
      queued.push({
        kind: "kill_criterion",
        ruleId: null,
        recipientEmail: recipient,
        subject,
        body,
        payload: { killCriterionId: criterion.id, statement: criterion.statement, context: ctx },
        companyId: facts.companyId,
        ticker: facts.ticker,
        dedupeKey: `kill:${criterion.id}:${recipient}`,
      });
    }

    await appendWorldEvent({
      kind: "kill_criterion_fired",
      companyId: facts.companyId,
      ticker: facts.ticker,
      constraintId: criterion.constraintId,
      headline: `${facts.name}: something we said would prove us wrong has happened`,
      detail: criterion.statement,
      payload: {
        killCriterionId: criterion.id,
        statement: criterion.statement,
        companyName: facts.name,
        context: ctx,
      },
      // Top of the scale. If this isn't the most material thing that happened
      // this week, the materiality scale is wrong.
      materiality: 1,
      sourceRef: `kill:${criterion.id}`,
      occurredAt: now,
      knownAt: now,
      dedupeKey: `kill-fired:${criterion.id}`,
    });

    await markKillCriterionTriggered(criterion.id, {
      firedAt: now.toISOString(),
      context: ctx,
    });
  }

  return queued;
}

/**
 * Check the conditions this team wrote for itself in advance.
 *
 * The notification carries the decision AND the reasoning verbatim, because by
 * the time a condition is met the author is looking at a red number and will
 * reason their way out of it. A link to the reasoning is not the same thing as
 * the reasoning.
 *
 * NOTHING HERE PLACES OR EXPORTS A TRADE. It sends a message and stops.
 */
async function checkPrecommitments(
  facts: CompanyFacts,
  constraintFacts: Map<string, Context>,
  now: Date,
  result: WatcherRunResult,
): Promise<NewNotification[]> {
  const { listPrecommitments, markMet } = await import("../precommitments/store");
  const armed = await listPrecommitments({ companyId: facts.companyId, status: "armed" });
  const queued: NewNotification[] = [];

  for (const commitment of armed) {
    const ctx = { ...facts.base };
    result.rulesChecked++;

    const verdict = evaluate(commitment.predicate, ctx);

    if (verdict === "unknown") {
      const missing = missingFields(commitment.predicate, ctx);
      result.uncheckable.push(`precommitment:${commitment.id}: missing ${missing.join(", ")}`);
      const { subject, body } = composeUncheckableNotification({
        ruleName: commitment.conditionText,
        companyName: facts.name,
        ticker: facts.ticker,
        predicate: commitment.predicate,
        missing,
      });
      queued.push({
        kind: "precommitment",
        ruleId: null,
        recipientEmail: commitment.authorEmail,
        subject,
        body,
        payload: { precommitmentId: commitment.id, missing, uncheckable: true },
        companyId: facts.companyId,
        ticker: facts.ticker,
        dedupeKey: `precommit-uncheckable:${commitment.id}:${isoWeek(now)}`,
      });
      continue;
    }

    if (verdict === false) continue;

    result.matched++;

    const { subject, body } = composeRuleNotification({
      ruleName: commitment.actionText,
      ruleDescription:
        `You wrote this when you were calm:\n` +
        `  If: ${commitment.conditionText}\n` +
        `  Then: ${commitment.actionText}\n` +
        `  Because: ${commitment.reasoning}`,
      predicate: commitment.predicate,
      companyName: facts.name,
      ticker: facts.ticker,
      headline: `${facts.name}: a condition you set has been met.`,
      context: ctx,
    });

    // The author, and only the author. This is their own rule about their own
    // reasoning — copying the team in turns a private commitment device into
    // social pressure, which is a different and worse thing.
    queued.push({
      kind: "precommitment",
      ruleId: null,
      recipientEmail: commitment.authorEmail,
      subject,
      body,
      payload: {
        precommitmentId: commitment.id,
        conditionText: commitment.conditionText,
        actionText: commitment.actionText,
        reasoning: commitment.reasoning,
        context: ctx,
      },
      companyId: facts.companyId,
      ticker: facts.ticker,
      dedupeKey: `precommit:${commitment.id}`,
    });

    await appendWorldEvent({
      kind: "precommitment_met",
      companyId: facts.companyId,
      ticker: facts.ticker,
      headline: `${facts.name}: a condition ${commitment.authorEmail.split("@")[0]} set in advance has been met`,
      detail: `${commitment.conditionText} → ${commitment.actionText}`,
      payload: {
        precommitmentId: commitment.id,
        conditionText: commitment.conditionText,
        actionText: commitment.actionText,
        companyName: facts.name,
      },
      materiality: 0.9,
      sourceRef: `precommitment:${commitment.id}`,
      occurredAt: now,
      knownAt: now,
      dedupeKey: `precommit-met:${commitment.id}`,
    });

    await markMet(commitment.id, ctx as Record<string, unknown>);
  }

  return queued;
}

/**
 * ISO year-week, e.g. "2026-W31". Used to rate-limit the "can't check this"
 * warning to once a week — often enough to stay visible, rare enough not to
 * become the thing people filter out.
 */
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO weeks run Monday-Sunday and belong to the year containing their Thursday.
  const dayNumber = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type { CompanyFacts };
