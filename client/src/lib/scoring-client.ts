// Client-side mirror of server/scoring.ts.
//
// Duplicated intentionally — the client bundle must not import server code — so
// keep the two in step. The formula is the one printed on the Thesis Workspace:
//
//   signal_score = reliability × relevance × direction_multiplier × recency_decay
//   confidence   = clamp( Σ signal_score / count(signals), −1, 1 )

import type { Signal, ThesisConfidenceHistory } from "@shared/schema";
import { DAY_MS } from "./design";

export type TimeHorizon = "days" | "weeks" | "months" | "quarters";
export type Direction = "confirming" | "contradicting" | "neutral";

const HALF_LIFE_DAYS: Record<TimeHorizon, number> = {
  days: 7,
  weeks: 30,
  months: 90,
  quarters: 180,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** direction_multiplier: confirming = +1, contradicting = −1, neutral = 0 */
export function directionMultiplier(direction: string): number {
  if (direction === "confirming") return 1;
  if (direction === "contradicting") return -1;
  return 0;
}

/** recency_decay = exp(−days_since_retrieved / half_life_days) */
export function recencyDecay(retrievedAt: string, timeHorizon: string, now: Date = new Date()): number {
  const retrieved = new Date(retrievedAt).getTime();
  if (!Number.isFinite(retrieved)) return 0;
  const daysSince = Math.max(0, (now.getTime() - retrieved) / DAY_MS);
  const halfLife = HALF_LIFE_DAYS[timeHorizon as TimeHorizon] ?? HALF_LIFE_DAYS.months;
  return Math.exp(-daysSince / halfLife);
}

export type ScorableSignal = Pick<
  Signal,
  "reliability" | "relevance" | "direction" | "timeHorizon" | "retrievedAt"
>;

export function computeSignalScore(signal: ScorableSignal, now: Date = new Date()): number {
  const reliability = signal.reliability ?? 0.5;
  const relevance = signal.relevance ?? 0.5;
  return (
    reliability * relevance * directionMultiplier(signal.direction) * recencyDecay(signal.retrievedAt, signal.timeHorizon, now)
  );
}

export function computeThesisConfidence(signalScores: number[]): {
  confidence: number;
  normalizingFactor: number;
  sum: number;
} {
  const normalizingFactor = signalScores.length;
  const sum = signalScores.reduce((acc, s) => acc + s, 0);
  const confidence = normalizingFactor === 0 ? 0 : clamp(sum / normalizingFactor, -1, 1);
  return { confidence, normalizingFactor, sum };
}

/** Convert -1..1 confidence to a -100..+100 gauge value for display. */
export function confidenceToGauge(confidence: number): number {
  return Math.round(clamp(confidence, -1, 1) * 100);
}

export interface GaugePoint {
  date: Date;
  gauge: number;
  /** Signals the score was computed over at this checkpoint. */
  count: number;
}

/**
 * The trend line reads thesis_confidence_history — one row per recompute — so
 * it is a record of what the score actually said, not a reconstruction. A
 * thesis with fewer than two recomputes has no trend yet, and the UI says so
 * rather than drawing a line through a single point.
 */
export function toGaugeSeries(
  history: ThesisConfidenceHistory[] | undefined,
  limit = 8
): GaugePoint[] {
  if (!history?.length) return [];
  return history
    .map((row) => ({
      date: new Date(row.computedAt),
      gauge: row.gauge ?? confidenceToGauge(row.confidence),
      count: row.signalCount ?? 0,
    }))
    .filter((p) => !Number.isNaN(p.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-limit);
}

/**
 * Change in the gauge over the trailing week, for the "+6 this week" readout.
 * Compares against the newest reading at least a week old — recomputes can be
 * minutes apart, and the difference between two of those is not a week's move.
 */
export function weeklyGaugeDelta(series: GaugePoint[], now: Date = new Date()): number | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const cutoff = now.getTime() - 7 * DAY_MS;
  const earlier = [...series].reverse().find((p) => p.date.getTime() <= cutoff);
  if (!earlier) return null;
  return latest.gauge - earlier.gauge;
}
