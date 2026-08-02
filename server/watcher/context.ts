/**
 * Assembling the facts a rule gets to look at.
 *
 * A rule like "if backlog comes in below $2.1bn, trim 30%" needs the latest
 * backlog reading, whether we own the name, and how big the position is. This
 * file gathers that into one flat object with dotted paths, which is what
 * server/watcher/predicate.ts evaluates against.
 *
 * Every read is point-in-time via asKnownAt: the newest row we could have
 * known about at the moment being evaluated. Using the newest row outright
 * would mean a rule checked against next week's data, which reads fine and is
 * completely wrong.
 *
 * What a rule can look at:
 *
 *   event.kind, event.companyId, event.materiality, event.payload.*
 *   company.ticker, company.name, company.owned, company.weightPct, company.side
 *   score.long, score.short, score.confidence
 *   constraint.tightening, constraint.direction, constraint.confidence
 *   capture.backlogValue, capture.grossMarginPct, capture.contractStructure,
 *           capture.hasPriceEscalators, capture.utilizationPct
 *   recognition.analystCount, recognition.thematicEtfCount,
 *           recognition.themeMentionDensity, recognition.recognition
 *   attention.daysSinceAnyoneLooked
 *
 * Anything not in the database is simply absent from the context, and the
 * three-valued evaluator reports the rule as uncheckable rather than as "no".
 */

import { supabase, rowsToCamel, throwIfError } from "../supabase";
import { storage } from "../storage";
import { asKnownAt } from "../scoring/opportunity";
import {
  listCaptureMetrics,
  listConstraintStates,
  listOpportunityScores,
  listRecognitionSnapshots,
} from "../scoring/store";
import type { WorldEventRow } from "../human-loop/store";
import type { Context } from "./predicate";

/* ------------------------------------------------------------------ */
/* Positions                                                           */
/* ------------------------------------------------------------------ */

export interface PositionRow {
  id: string;
  companyId: number;
  side: string;
  weightPct: number;
  openedAt: Date;
  closedAt: Date | null;
  thesisNote: string | null;
}

/**
 * Open positions only. "Do we own this" is the single most important input to
 * whether something is worth telling anyone about — a CFO change at a name we
 * don't own is noise; the same change at a name we do own is the whole
 * ballgame.
 */
export async function listOpenPositions(): Promise<PositionRow[]> {
  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .is("closed_at", null);
  throwIfError(error, "listOpenPositions");
  return rowsToCamel<any>(data).map((r) => ({
    ...r,
    weightPct: Number(r.weightPct),
    openedAt: new Date(r.openedAt),
    closedAt: r.closedAt ? new Date(r.closedAt) : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Context assembly                                                    */
/* ------------------------------------------------------------------ */

/**
 * Everything about one company, gathered once and reused across every rule and
 * every event for that company. Building it per-rule would multiply the
 * database round trips by the number of rules for no benefit.
 */
export interface CompanyFacts {
  companyId: number;
  ticker: string | null;
  name: string;
  position: PositionRow | null;
  base: Context;
}

export async function buildCompanyFacts(
  companyId: number,
  asOf: Date,
  positions?: PositionRow[],
): Promise<CompanyFacts | null> {
  const company = await storage.getCompany(companyId);
  if (!company) return null;

  const openPositions = positions ?? (await listOpenPositions());
  const position = openPositions.find((p) => p.companyId === companyId) ?? null;

  const [scores, captures, recognitions] = await Promise.all([
    listOpportunityScores({ companyId }),
    listCaptureMetrics(companyId),
    listRecognitionSnapshots(companyId),
  ]);

  // Scores carry `asOf`, not `knownAt`. They're computed from point-in-time
  // inputs, so the score's own asOf is the moment we could have had it.
  const latestScore = asKnownAt(
    scores.map((s) => ({ ...s, knownAt: s.asOf })),
    asOf,
  );
  const latestCapture = asKnownAt(captures, asOf);
  const latestRecognition = asKnownAt(recognitions, asOf);

  const base: Context = {
    company: {
      id: company.id,
      ticker: company.ticker,
      name: company.name,
      sector: company.sector,
      segment: company.segment,
      owned: position !== null,
      weightPct: position?.weightPct,
      side: position?.side,
    },
  };

  if (latestScore) {
    base.score = {
      long: latestScore.longScore,
      short: latestScore.shortScore,
      confidence: latestScore.confidence,
      scorerVersion: latestScore.scorerVersion,
      constraintId: latestScore.constraintId,
    };
  }

  if (latestCapture) {
    base.capture = {
      backlogValue: latestCapture.backlogValue,
      grossMarginPct: latestCapture.grossMarginPct,
      contractStructure: latestCapture.contractStructure,
      hasPriceEscalators: latestCapture.hasPriceEscalators,
      utilizationPct: latestCapture.utilizationPct,
      fiscalPeriod: latestCapture.fiscalPeriod,
    };
  }

  if (latestRecognition) {
    base.recognition = {
      analystCount: latestRecognition.analystCount,
      thematicEtfCount: latestRecognition.thematicEtfCount,
      themeMentionDensity: latestRecognition.themeMentionDensity,
      recognition: latestRecognition.recognition,
      shortInterestPct: latestRecognition.shortInterestPct,
    };
  }

  return {
    companyId,
    ticker: company.ticker,
    name: company.name,
    position,
    base,
  };
}

/**
 * Constraint facts, keyed by constraint id. Fetched once per run rather than
 * per company, since one bottleneck touches many companies.
 */
export async function buildConstraintFacts(
  asOf: Date,
): Promise<Map<string, Context>> {
  const states = await listConstraintStates();
  const byConstraint = new Map<string, typeof states>();
  for (const state of states) {
    const list = byConstraint.get(state.constraintId) ?? [];
    list.push(state);
    byConstraint.set(state.constraintId, list);
  }

  const out = new Map<string, Context>();
  for (const [constraintId, list] of Array.from(byConstraint.entries())) {
    const latest = asKnownAt(list, asOf);
    if (!latest) continue;
    out.set(constraintId, {
      tightening: latest.tightening,
      direction: latest.direction,
      confidence: latest.confidence,
      leadTimeWeeks: latest.leadTimeWeeks,
      method: latest.method,
    });
  }
  return out;
}

/** Company facts plus the specific event being judged. */
export function contextForEvent(
  facts: CompanyFacts,
  event: WorldEventRow,
  constraintFacts?: Map<string, Context>,
): Context {
  const ctx: Context = {
    ...facts.base,
    event: {
      id: event.id,
      kind: event.kind,
      companyId: event.companyId,
      ticker: event.ticker,
      headline: event.headline,
      materiality: event.materiality,
      payload: event.payload ?? {},
    },
  };

  const constraintId = (event as any).constraintId ?? (ctx.score as any)?.constraintId;
  if (constraintId && constraintFacts?.has(constraintId)) {
    ctx.constraint = constraintFacts.get(constraintId);
  }

  return ctx;
}
