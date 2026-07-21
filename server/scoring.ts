// Forward Capital — Thesis Scoring Framework v1
// Pure, testable functions. Implements the math from BUILD_SPEC.md §5 exactly.

import type { Signal } from "@shared/schema";

export type TimeHorizon = "days" | "weeks" | "months" | "quarters";
export type Direction = "confirming" | "contradicting" | "neutral";

const HALF_LIFE_DAYS: Record<TimeHorizon, number> = {
  days: 7,
  weeks: 30,
  months: 90,
  quarters: 180,
};

/** direction_multiplier: confirming = +1, contradicting = -1, neutral = 0 */
export function directionMultiplier(direction: Direction): number {
  if (direction === "confirming") return 1;
  if (direction === "contradicting") return -1;
  return 0;
}

/** recency_decay = exp(-days_since_retrieved / halfLifeDays) */
export function recencyDecay(retrievedAt: string, timeHorizon: TimeHorizon, now: Date = new Date()): number {
  const retrieved = new Date(retrievedAt);
  const daysSince = Math.max(0, (now.getTime() - retrieved.getTime()) / (1000 * 60 * 60 * 24));
  const halfLife = HALF_LIFE_DAYS[timeHorizon] ?? HALF_LIFE_DAYS.months;
  return Math.exp(-daysSince / halfLife);
}

/**
 * signal_score = reliability × relevance × direction_multiplier × recency_decay
 */
export function computeSignalScore(
  signal: Pick<Signal, "reliability" | "relevance" | "direction" | "timeHorizon" | "retrievedAt">,
  now: Date = new Date()
): number {
  const reliability = signal.reliability ?? 0.5;
  const relevance = signal.relevance ?? 0.5;
  const dirMult = directionMultiplier(signal.direction as Direction);
  const decay = recencyDecay(signal.retrievedAt, signal.timeHorizon as TimeHorizon, now);
  return reliability * relevance * dirMult * decay;
}

/** clamp helper */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Thesis confidence score = weighted roll-up:
 * confidence = clamp( sum(signal_score for all attached signals) / normalizingFactor, -1, 1 )
 * normalizingFactor = count of attached signals (so more weak signals don't mechanically inflate confidence)
 */
export function computeThesisConfidence(
  signalScores: number[]
): { confidence: number; normalizingFactor: number; sum: number } {
  const normalizingFactor = signalScores.length;
  const sum = signalScores.reduce((acc, s) => acc + s, 0);
  const confidence = normalizingFactor === 0 ? 0 : clamp(sum / normalizingFactor, -1, 1);
  return { confidence, normalizingFactor, sum };
}

/** Convert -1..1 confidence to a -100..+100 gauge value for display. */
export function confidenceToGauge(confidence: number): number {
  return Math.round(clamp(confidence, -1, 1) * 100);
}

/**
 * Auto-suggest a verification tier from independentConfirmations count.
 * The user can always override — this is only a suggestion.
 */
export function suggestVerificationTier(independentConfirmations: number, isPrimarySource: boolean): string {
  if (isPrimarySource) return "primary_source_confirmed";
  if (independentConfirmations >= 2) return "corroborated";
  if (independentConfirmations === 1) return "single_source";
  return "unverified";
}
