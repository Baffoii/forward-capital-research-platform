/**
 * Opportunity scoring.
 *
 * Deliberately dependency-free and pure: no db, no io, no clock. Everything
 * it needs is passed in. That makes it testable, and testability is the whole
 * point — an unfalsifiable scorer is astrology with a build step.
 *
 * The core claim:
 *
 *   long  = exposure x max(0, tightening) x (1 - recognition) x divergence x capture
 *   short = exposure x max(0, -tightening) x recognition      x divergence x capture
 *
 * Multiplication, not addition. Any term near zero collapses the score, which
 * is correct: a mispricing needs real exposure AND a real tailwind AND
 * someone not paying attention. Addition would let two strong terms paper
 * over a fatal third.
 */

export const SCORER_VERSION = "0.1.0";

export interface Measurement {
  value: number;
  /** 0..1 — how much we trust this number. Never folded into the score. */
  confidence: number;
  asOf: Date;
  sourceIds?: string[];
}

export interface ScoreInputs {
  /** 0..1 — fraction of TOTAL company revenue riding on the constraint. */
  exposure: Measurement;
  /** -1..1 — signed. Positive = scarcity increasing. */
  tightening: Measurement;
  /** 0..1 — how priced-in the exposure already is. */
  recognition: Measurement;
  /**
   * -1..1 — consensus estimate revision direction over the same window as
   * the tightening reading. Null when we have no estimate coverage, which
   * is common and expected for the obscure names we actually want.
   */
  estimateRevision: Measurement | null;
  /**
   * 0..1 — is the shortage reaching the P&L? Built from gross margin trend
   * and contract structure. Null when undeterminable.
   */
  capture: Measurement | null;
}

export interface ScoreResult {
  longScore: number;
  shortScore: number;
  confidence: number;
  components: {
    exposure: number;
    tightening: number;
    recognition: number;
    divergenceMultiplier: number;
    captureMultiplier: number;
    coverage: number;
  };
  flags: string[];
  scorerVersion: string;
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/**
 * Divergence multiplier.
 *
 * Constraint tightening while consensus estimates sit flat or fall is the
 * tradeable case — the resolution mechanism is the next print. Tightening
 * while estimates already rip is the same physical fact with the trade
 * already taken.
 *
 * Range 0.5 .. 1.5, so it modulates rather than dominates. Missing estimate
 * data returns 1.0 (neutral) rather than penalising obscurity — the names
 * with no analyst coverage are the ones we're hunting.
 */
export function divergenceMultiplier(
  tightening: number,
  estimateRevision: Measurement | null,
): { multiplier: number; flag: string | null } {
  if (estimateRevision === null) {
    return { multiplier: 1.0, flag: "no_estimate_coverage" };
  }
  const rev = clamp(estimateRevision.value, -1, 1);
  const gap = tightening - rev;
  const multiplier = clamp(1 + gap * 0.5, 0.5, 1.5);
  // The case worth flagging isn't "gap is large" — it's "consensus is
  // already moving hard AND running ahead of what we see physically".
  // A large gap with flat estimates is the opposite situation: our setup.
  const flag = rev > 0.4 && gap < 0 ? "estimates_ahead_of_physical" : null;
  return { multiplier, flag };
}

/**
 * Capture multiplier.
 *
 * A shortage that cannot be repriced is a longer queue, not a windfall.
 * Floors at 0.3 rather than 0 — weak capture demotes a name, it doesn't
 * prove the thesis wrong, and zeroing it would hide the row entirely.
 */
export function captureMultiplier(capture: Measurement | null): {
  multiplier: number;
  flag: string | null;
} {
  if (capture === null) return { multiplier: 0.85, flag: "capture_unknown" };
  const c = clamp(capture.value, 0, 1);
  const multiplier = 0.3 + 0.7 * c;
  const flag = c < 0.35 ? "shortage_not_reaching_pnl" : null;
  return { multiplier, flag };
}

/**
 * Confidence is the geometric mean of input confidences, so one unreliable
 * input drags the whole thing down rather than being averaged away.
 * `coverage` separately reports how many optional inputs we actually had.
 */
function aggregateConfidence(inputs: ScoreInputs): {
  confidence: number;
  coverage: number;
} {
  // Weighted geometric mean. The three core terms are multiplied directly
  // into the score, so they carry full weight; the optional modifiers only
  // scale it, so they carry half. Flat averaging let two confident
  // modifiers mask three shaky core inputs.
  const weighted: Array<[number, number]> = [
    [inputs.exposure.confidence, 1],
    [inputs.tightening.confidence, 1],
    [inputs.recognition.confidence, 1],
  ];
  let optional = 0;
  if (inputs.estimateRevision) {
    weighted.push([inputs.estimateRevision.confidence, 0.5]);
    optional++;
  }
  if (inputs.capture) {
    weighted.push([inputs.capture.confidence, 0.5]);
    optional++;
  }
  const totalWeight = weighted.reduce((a, [, w]) => a + w, 0);
  const logSum = weighted.reduce(
    (a, [c, w]) => a + w * Math.log(clamp(c, 0.001, 1)),
    0,
  );
  return {
    confidence: Math.exp(logSum / totalWeight),
    coverage: (3 + optional) / 5,
  };
}

export function scoreOpportunity(inputs: ScoreInputs): ScoreResult {
  const exposure = clamp(inputs.exposure.value, 0, 1);
  const tightening = clamp(inputs.tightening.value, -1, 1);
  const recognition = clamp(inputs.recognition.value, 0, 1);

  const div = divergenceMultiplier(tightening, inputs.estimateRevision);
  const cap = captureMultiplier(inputs.capture);
  const { confidence, coverage } = aggregateConfidence(inputs);

  const flags: string[] = [];
  if (div.flag) flags.push(div.flag);
  if (cap.flag) flags.push(cap.flag);

  // Low recognition can mean "nobody noticed" or "nobody cares, correctly".
  // The scorer cannot tell these apart. Flag it for a human.
  if (recognition < 0.15 && exposure < 0.15) {
    flags.push("obscure_but_immaterial");
  }
  if (confidence < 0.4) flags.push("low_confidence_research_task");

  const base = exposure * div.multiplier * cap.multiplier;
  const longScore = base * Math.max(0, tightening) * (1 - recognition);
  const shortScore = base * Math.max(0, -tightening) * recognition;

  return {
    longScore,
    shortScore,
    confidence,
    components: {
      exposure,
      tightening,
      recognition,
      divergenceMultiplier: div.multiplier,
      captureMultiplier: cap.multiplier,
      coverage,
    },
    flags,
    scorerVersion: SCORER_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* Point-in-time selection                                             */
/* ------------------------------------------------------------------ */

export interface Dated {
  knownAt: Date;
}

/**
 * The most recent row that was KNOWABLE at `asOf`.
 *
 * Every read path into the scorer goes through this. Selecting on
 * effectiveFrom instead is lookahead bias and it will make a broken model
 * backtest beautifully — the single most expensive bug in this codebase's
 * future, so it lives in one function.
 */
export function asKnownAt<T extends Dated>(rows: T[], asOf: Date): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.knownAt.getTime() > asOf.getTime()) continue;
    if (best === null || row.knownAt.getTime() > best.knownAt.getTime()) {
      best = row;
    }
  }
  return best;
}

/**
 * Recognition and estimate-revision both measure "has the market noticed",
 * so they will correlate. Run this on real data before trusting the score:
 * above ~0.7 you are double-counting obscurity and overweighting it.
 */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx,
      b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}
