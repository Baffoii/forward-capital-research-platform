/**
 * First-pass constraint tightening, derived from backlog across the companies
 * exposed to a constraint.
 *
 * Pure and dependency-free. This is a WEAK PROXY and the confidence ceiling
 * here says so — the real signal is lead-time language on earnings calls, and
 * this exists so the pipeline produces something honest before transcripts
 * land rather than nothing at all.
 *
 * Why not raw backlog growth, which is the obvious thing to do:
 *
 *   Backlog is a STOCK. Revenue is a FLOW. Backlog rising 20% while revenue
 *   also rises 20% is a company that got bigger, not a queue that got longer.
 *   Raw backlog growth reads those as tightening and would fire on every
 *   growing company in a growing industry.
 *
 * So the measured quantity is COVERAGE: backlog divided by quarterly revenue,
 * in quarters of work in hand. That is the closest thing to a lead time
 * obtainable from a 10-Q, and its change over time is the closest thing to a
 * lead time EXTENDING. A company whose coverage goes 3.0 -> 3.8 quarters is
 * telling you the queue lengthened even if it also grew.
 *
 * The remaining confound, which no amount of arithmetic fixes: coverage also
 * rises when a company simply cannot deliver. Demand-up and delivery-slower
 * look identical here. Only the transcript language separates them, which is
 * exactly why this tops out at low confidence.
 */

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface BacklogObservation {
  companyId: number;
  fiscalPeriod: string;
  /** Total backlog or RPO, in reporting currency. */
  backlogValue: number;
  /** Revenue for the SAME quarter. Needed to turn a stock into a coverage ratio. */
  quarterlyRevenue: number;
  grossMarginPct?: number | null;
  /** Quarter end — when the fact became true. */
  effectiveFrom: Date;
  /** Filing date — the earliest we could have known it. */
  knownAt: Date;
  /** 0..1 — how reliable this extraction was. */
  confidence: number;
}

/** How much of a company's total revenue rides on the constraint. */
export interface ExposureWeight {
  companyId: number;
  revenueShare: number;
  confidence: number;
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

export interface CoveragePoint {
  companyId: number;
  fiscalPeriod: string;
  /** Quarters of revenue sitting in backlog. */
  coverageQuarters: number;
  effectiveFrom: Date;
  knownAt: Date;
  confidence: number;
}

export function toCoverage(obs: BacklogObservation): CoveragePoint | null {
  if (!(obs.quarterlyRevenue > 0)) return null;
  if (!(obs.backlogValue >= 0)) return null;
  return {
    companyId: obs.companyId,
    fiscalPeriod: obs.fiscalPeriod,
    coverageQuarters: obs.backlogValue / obs.quarterlyRevenue,
    effectiveFrom: obs.effectiveFrom,
    knownAt: obs.knownAt,
    confidence: obs.confidence,
  };
}

/**
 * A quarter of coverage change is a large move; half a quarter is meaningful.
 * Dividing by this before squashing puts a +0.5 quarter extension around 0.76
 * rather than saturating the scale at the first observation.
 */
export const COVERAGE_DELTA_SCALE = 0.5;

/** Squash to -1..1 so no single company can saturate the constraint reading. */
const squash = (x: number) => Math.tanh(x / COVERAGE_DELTA_SCALE);

export interface CompanyTightening {
  companyId: number;
  /** -1..1 */
  tightening: number;
  coverageNow: number;
  coveragePrior: number;
  deltaQuarters: number;
  confidence: number;
  knownAt: Date;
}

/**
 * Per-company reading from the two most recent points KNOWABLE at `asOf`.
 *
 * Both points are selected on knownAt, never on effectiveFrom. Selecting on
 * the period the data describes would use a quarter whose 10-Q had not been
 * filed yet, which is the lookahead bug this codebase is built to avoid.
 */
export function companyTightening(
  points: CoveragePoint[],
  asOf: Date,
): CompanyTightening | null {
  const knowable = points
    .filter((p) => p.knownAt.getTime() <= asOf.getTime())
    .sort((a, b) => b.knownAt.getTime() - a.knownAt.getTime());
  if (knowable.length < 2) return null;

  const [now, prior] = knowable;
  const deltaQuarters = now.coverageQuarters - prior.coverageQuarters;
  return {
    companyId: now.companyId,
    tightening: squash(deltaQuarters),
    coverageNow: now.coverageQuarters,
    coveragePrior: prior.coverageQuarters,
    deltaQuarters,
    confidence: Math.min(now.confidence, prior.confidence),
    knownAt: now.knownAt,
  };
}

/* ------------------------------------------------------------------ */
/* Constraint-level aggregation                                        */
/* ------------------------------------------------------------------ */

/**
 * Confidence ceiling for anything derived from backlog alone.
 *
 * Not a tunable. Coverage cannot distinguish demand rising from delivery
 * slowing, and a number that cannot tell those apart has no business
 * presenting itself as better than a proxy. Raise it only when the reading
 * is corroborated by transcript lead-time language.
 */
export const BACKLOG_METHOD_CONFIDENCE_CEILING = 0.4;

export const DIRECTION_THRESHOLD = 0.15;

export interface ConstraintTightening {
  constraintId: string;
  tightening: number;
  direction: "tightening" | "stable" | "easing";
  confidence: number;
  method: string;
  contributors: CompanyTightening[];
  /** Exposed companies that had no usable backlog history. */
  missingCompanyIds: number[];
  knownAt: Date;
  flags: string[];
}

/**
 * Aggregate company readings into one constraint reading.
 *
 * Weighted by revenueShare, so a pure-play whose whole business rides on the
 * constraint moves it more than a conglomerate with 8% exposure. Weighting
 * every company equally would let a diversified industrial with a rounding
 * error of exposure outvote the company that IS the constraint.
 */
export function aggregateTightening(
  constraintId: string,
  readings: CompanyTightening[],
  weights: ExposureWeight[],
  asOf: Date,
): ConstraintTightening | null {
  const weightById = new Map(weights.map((w) => [w.companyId, w]));
  const contributors = readings.filter((r) => weightById.has(r.companyId));

  if (contributors.length === 0) return null;

  let weightSum = 0;
  let valueSum = 0;
  let confSum = 0;
  for (const r of contributors) {
    const w = weightById.get(r.companyId)!;
    const weight = w.revenueShare * w.confidence;
    if (weight <= 0) continue;
    weightSum += weight;
    valueSum += r.tightening * weight;
    confSum += Math.min(r.confidence, w.confidence) * weight;
  }
  if (weightSum === 0) return null;

  const tightening = valueSum / weightSum;
  const rawConfidence = confSum / weightSum;

  const flags: string[] = [];
  const missingCompanyIds = weights
    .filter((w) => !readings.some((r) => r.companyId === w.companyId))
    .map((w) => w.companyId);

  // One company's coverage ratio is a company fact, not a constraint fact.
  const breadthPenalty = Math.min(1, contributors.length / 3);
  if (contributors.length < 3) flags.push("thin_constraint_coverage");
  if (missingCompanyIds.length > contributors.length) {
    flags.push("most_exposed_companies_missing_backlog");
  }

  // Contributors disagreeing in sign means the reading is an average of a
  // fight, not a signal. Worth surfacing rather than averaging away.
  const positives = contributors.filter((c) => c.tightening > DIRECTION_THRESHOLD).length;
  const negatives = contributors.filter((c) => c.tightening < -DIRECTION_THRESHOLD).length;
  if (positives > 0 && negatives > 0) flags.push("contributors_disagree_on_direction");

  const confidence = Math.min(
    BACKLOG_METHOD_CONFIDENCE_CEILING,
    rawConfidence * breadthPenalty,
  );

  const direction =
    tightening > DIRECTION_THRESHOLD
      ? "tightening"
      : tightening < -DIRECTION_THRESHOLD
        ? "easing"
        : "stable";

  return {
    constraintId,
    tightening,
    direction,
    confidence,
    method:
      "backlog_coverage_delta_v1: weighted mean of tanh(d(backlog/quarterly revenue)) " +
      "across exposed companies, weighted by revenueShare x edge confidence. " +
      "Cannot distinguish demand rising from delivery slowing — proxy only.",
    contributors,
    missingCompanyIds,
    knownAt: asOf,
    flags,
  };
}

/* ------------------------------------------------------------------ */
/* Release detection                                                   */
/* ------------------------------------------------------------------ */

/**
 * The trade nobody is instrumented for.
 *
 * A shortage that resolves hits price twice: falling realised prices and a
 * multiple that de-rates from secular back to cyclical. That turn is invisible
 * in the LEVEL of tightening — a constraint reading +0.9 and one reading +0.4
 * are both "tight", but the second may be two quarters into easing.
 *
 * So the level is stored and the derivative is watched separately.
 */
export interface ReleaseSignal {
  firstShortening: boolean;
  deltaFromPrior: number;
  quartersSincePeak: number;
  peakTightening: number;
}

export function detectRelease(
  history: Array<{ tightening: number; knownAt: Date }>,
  asOf: Date,
): ReleaseSignal | null {
  const knowable = history
    .filter((h) => h.knownAt.getTime() <= asOf.getTime())
    .sort((a, b) => a.knownAt.getTime() - b.knownAt.getTime());
  if (knowable.length < 2) return null;

  const current = knowable[knowable.length - 1];
  const prior = knowable[knowable.length - 2];
  const peakValue = Math.max(...knowable.map((h) => h.tightening));
  const peakIndex = knowable.findIndex((h) => h.tightening === peakValue);

  return {
    // Still tight, but no longer tightening: the first reading that turns
    // down from a positive peak is the one worth acting on.
    firstShortening:
      prior.tightening >= peakValue &&
      current.tightening < prior.tightening &&
      peakValue > 0,
    deltaFromPrior: current.tightening - prior.tightening,
    quartersSincePeak: knowable.length - 1 - peakIndex,
    peakTightening: peakValue,
  };
}
