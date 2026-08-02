/**
 * Turn the history we already have into world_events.
 *
 * Without this, every feature built on the logs starts empty and stays empty
 * until something new happens — the first weekly digest would be blank even
 * though the database holds months of filings and score history.
 *
 * Two sources, both already in the database:
 *
 *   signals            — every filing, price reading, insider transaction and
 *                        analyst note the app has ingested.
 *   opportunity_scores — our own scoring history, from which we derive
 *                        "the score for this company changed" events.
 *
 * Safe to re-run. Every event carries a dedupe key derived from the row it
 * came from, and appendWorldEvents does ON CONFLICT DO NOTHING, so a second
 * run writes nothing and reports zero new.
 *
 * Deliberately does NOT invent human_events. Nobody used this system before it
 * existed; a fabricated history of who looked at what would corrupt the exact
 * thing the research queue reads. An empty human log is the correct starting
 * state.
 */

import { storage } from "../storage";
import { listOpportunityScores } from "../scoring/store";
import { appendWorldEvents, type NewWorldEvent } from "./store";
import type { Signal } from "@shared/schema";

/**
 * Plain-language headline for a signal, ready to paste into an email.
 *
 * The signal's own title is written for the signal feed and is often a bare
 * fragment ("10-Q"); a notification needs a sentence.
 */
const CATEGORY_TO_KIND: Record<string, string> = {
  regulatory_filing: "filing_published",
  price_action: "price_move",
  analyst_action: "estimate_revision",
  insider_activity: "signal_recorded",
  patent_filing: "signal_recorded",
  partnership_or_supply_chain: "signal_recorded",
  congressional_trading: "signal_recorded",
  macro_indicator: "signal_recorded",
  web_traffic_signal: "signal_recorded",
};

function signalToWorldEvent(
  signal: Signal,
  tickerById: Map<number, string | null>,
  nameById: Map<number, string>,
): NewWorldEvent {
  const company =
    signal.companyId != null ? nameById.get(signal.companyId) : undefined;
  const subject = company ?? "A company we follow";

  // knownAt is when WE could first have known — the moment it was retrieved.
  // occurredAt is when it happened out there. Where a signal only records one
  // timestamp, both fall back to it rather than guessing.
  const retrieved = new Date(signal.retrievedAt || signal.createdAt);
  const created = new Date(signal.createdAt || signal.retrievedAt);

  return {
    kind: CATEGORY_TO_KIND[signal.signalCategory] ?? "signal_recorded",
    companyId: signal.companyId ?? null,
    ticker: signal.companyId != null ? tickerById.get(signal.companyId) ?? null : null,
    headline: `${subject}: ${signal.title}`,
    detail: signal.description,
    payload: {
      signalId: signal.id,
      signalCategory: signal.signalCategory,
      direction: signal.direction,
      verificationTier: signal.verificationTier,
      relevance: signal.relevance,
      reliability: signal.reliability,
      // Copied, not joined. In two years this event must still read correctly
      // even if the company row was renamed or the signal was re-tagged.
      companyName: company ?? null,
      backfilled: true,
    },
    // No materiality yet. Judging how much something matters to our thesis is
    // the digest's job (task 7), and guessing a number here would look like a
    // judgement nobody made.
    materiality: null,
    sourceUrl: signal.sourceUrl ?? null,
    sourceRef: `signal:${signal.id}`,
    occurredAt: created,
    knownAt: retrieved,
    dedupeKey: `signal:${signal.id}`,
  };
}

export interface BackfillResult {
  signalsRead: number;
  scoresRead: number;
  eventsWritten: number;
  /** Already present from an earlier run — expected, not an error. */
  skippedAsDuplicate: number;
}

/**
 * Backfill for ONE company.
 *
 * Per-company on purpose. The existing deployment was unstable doing every
 * company's work in a single request, which is why this repo already splits
 * sync into small per-company calls (see the note in server/routes.ts). Same
 * pattern here: many small jobs, not one large one.
 */
export async function backfillCompany(companyId: number): Promise<BackfillResult> {
  const company = await storage.getCompany(companyId);
  if (!company) {
    return { signalsRead: 0, scoresRead: 0, eventsWritten: 0, skippedAsDuplicate: 0 };
  }

  const tickerById = new Map<number, string | null>([[company.id, company.ticker]]);
  const nameById = new Map<number, string>([[company.id, company.name]]);

  const signals = await storage.listSignals({ companyId });
  const events: NewWorldEvent[] = signals.map((s) =>
    signalToWorldEvent(s, tickerById, nameById),
  );

  const scores = await listOpportunityScores({ companyId });
  events.push(...scoreChangeEvents(scores, company.name, company.ticker));

  const written = await appendWorldEvents(events);
  return {
    signalsRead: signals.length,
    scoresRead: scores.length,
    eventsWritten: written.length,
    skippedAsDuplicate: events.length - written.length,
  };
}

/**
 * Consecutive scores for one company become "the score changed" events.
 *
 * The first score is not an event — nothing changed, we simply started
 * measuring. Only movements worth noticing are emitted; a score wobbling in
 * the third decimal place is not news and would drown the digest.
 */
const SCORE_MOVE_THRESHOLD = 0.05;

function scoreChangeEvents(
  scores: Awaited<ReturnType<typeof listOpportunityScores>>,
  companyName: string,
  ticker: string | null,
): NewWorldEvent[] {
  const ordered = [...scores].sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
  const out: NewWorldEvent[] = [];

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    // Scores are only comparable within one formula version.
    if (prev.scorerVersion !== curr.scorerVersion) continue;

    const delta = curr.longScore - prev.longScore;
    if (Math.abs(delta) < SCORE_MOVE_THRESHOLD) continue;

    const direction = delta > 0 ? "up" : "down";
    out.push({
      kind: "score_change",
      companyId: curr.companyId,
      ticker,
      constraintId: curr.constraintId,
      headline: `${companyName}: our score moved ${direction} from ${prev.longScore.toFixed(2)} to ${curr.longScore.toFixed(2)}`,
      detail:
        `Confidence in that number is ${curr.confidence.toFixed(2)} out of 1. ` +
        `A low-confidence score is a research task, not a conclusion.`,
      payload: {
        previousScore: prev.longScore,
        currentScore: curr.longScore,
        delta,
        confidence: curr.confidence,
        scorerVersion: curr.scorerVersion,
        companyName,
        backfilled: true,
      },
      materiality: null,
      sourceRef: `score:${curr.id}`,
      occurredAt: curr.asOf,
      knownAt: curr.asOf,
      dedupeKey: `score-change:${curr.id}`,
    });
  }

  return out;
}
