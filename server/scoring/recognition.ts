/**
 * Recognition: how priced-in a company's exposure already is.
 *
 * Pure. The collector that fetches the inputs lives in recognition-collect.ts.
 *
 * The design decision that matters here, and the reason the obvious component
 * is switched off by default:
 *
 *   `multipleVsOwnHistory` is PRICE-DERIVED. So is estimate revision, which
 *   the scorer already uses in the divergence term. Feeding both in prices
 *   "the market has noticed" twice, and the score cannot tell you it happened
 *   — it just quietly overweights obscurity.
 *
 * So the composite is built from the non-price components only, and the
 * multiple is stored and reported as a diagnostic. Turn it on once
 * pearson(recognition, estimateRevision) has been run on real data and come
 * back below ~0.7. That is the check the backtest harness prints.
 */

/* ------------------------------------------------------------------ */
/* Theme mention density                                               */
/* ------------------------------------------------------------------ */

const THEME_TERMS = [
  /\bAI\b/g,
  /\bartificial intelligence\b/gi,
  /\bdata cent(?:er|re)s?\b/gi,
  /\bhyperscalers?\b/gi,
  /\bcloud (?:capex|providers?|customers?)\b/gi,
  /\bgenerative AI\b/gi,
  /\baccelerated computing\b/gi,
  /\bGPUs?\b/g,
];

/**
 * Theme mentions per 1,000 words in the company's OWN transcripts.
 *
 * A cheap and surprisingly good proxy for whether the market has connected the
 * dots: management talks about AI on calls when investors ask about AI. A
 * company with real data-centre exposure and near-zero mention density is
 * either not yet asked about it or not yet answering — both of which are the
 * condition we are hunting.
 */
export function themeMentionDensity(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  let hits = 0;
  for (const re of THEME_TERMS) {
    hits += (text.match(re) ?? []).length;
  }
  return (hits / words) * 1000;
}

/* ------------------------------------------------------------------ */
/* Component normalisation                                             */
/* ------------------------------------------------------------------ */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Analyst count -> 0..1.
 *
 * Log-shaped because the difference between 0 and 3 analysts is enormous and
 * the difference between 25 and 35 is nothing. Zero coverage maps to zero
 * recognition, which is correct: it is the condition the whole model is
 * hunting for, not a data defect.
 */
export function normalizeAnalystCount(n: number): number {
  if (n <= 0) return 0;
  return clamp01(Math.log10(n + 1) / Math.log10(26));
}

/** Roughly 8 mentions per 1k words is saturation for an industrial. */
export function normalizeThemeDensity(density: number): number {
  return clamp01(density / 8);
}

/** Membership in more than a handful of thematic ETFs means fully discovered. */
export function normalizeEtfCount(n: number): number {
  if (n <= 0) return 0;
  return clamp01(Math.log10(n + 1) / Math.log10(9));
}

/**
 * Forward multiple vs the company's own 5-year median.
 *
 * PRICE-DERIVED — excluded from the composite by default. Kept because it is
 * the most direct statement of "the market has repriced this" available, and
 * once the correlation check clears it is worth switching on.
 */
export function normalizeMultipleVsHistory(ratio: number): number {
  // 1.0 = trading at its own median = neutral. 2.0x its median = fully noticed.
  return clamp01((ratio - 0.7) / 1.3);
}

/* ------------------------------------------------------------------ */
/* Composite                                                           */
/* ------------------------------------------------------------------ */

export interface RecognitionInputs {
  analystCount: number | null;
  themeMentionDensity: number | null;
  thematicEtfCount: number | null;
  /** Stored and reported; excluded from the composite unless explicitly enabled. */
  multipleVsOwnHistory: number | null;
  shortInterestPct?: number | null;
}

export interface RecognitionResult {
  recognition: number;
  confidence: number;
  components: Record<string, number | null>;
  /** What the composite would be WITH the price term, for the correlation check. */
  recognitionWithPrice: number | null;
  coverage: number;
  flags: string[];
}

/**
 * Weights for the non-price components.
 *
 * Analyst count is the heaviest: it is the most direct measure of whether
 * anyone whose job is to notice has noticed. Theme density is next because it
 * is company-specific rather than a sector label. ETF membership is last —
 * index inclusion is mechanical and lags the recognition it supposedly
 * measures.
 */
const WEIGHTS = {
  analystCount: 0.45,
  themeMentionDensity: 0.35,
  thematicEtfCount: 0.2,
} as const;

/** Weight the price term would carry if enabled. */
const PRICE_WEIGHT = 0.3;

export function computeRecognition(
  inputs: RecognitionInputs,
  opts: { includePriceTerm?: boolean } = {},
): RecognitionResult {
  const flags: string[] = [];
  const components: Record<string, number | null> = {
    analystCount: inputs.analystCount === null ? null : normalizeAnalystCount(inputs.analystCount),
    themeMentionDensity:
      inputs.themeMentionDensity === null ? null : normalizeThemeDensity(inputs.themeMentionDensity),
    thematicEtfCount:
      inputs.thematicEtfCount === null ? null : normalizeEtfCount(inputs.thematicEtfCount),
    multipleVsOwnHistory:
      inputs.multipleVsOwnHistory === null
        ? null
        : normalizeMultipleVsHistory(inputs.multipleVsOwnHistory),
  };

  let weighted = 0;
  let weightSum = 0;
  for (const key of ["analystCount", "themeMentionDensity", "thematicEtfCount"] as const) {
    const v = components[key];
    if (v === null) continue;
    weighted += v * WEIGHTS[key];
    weightSum += WEIGHTS[key];
  }

  const present = weightSum === 0 ? 0 : weighted / weightSum;
  const availableCount = (["analystCount", "themeMentionDensity", "thematicEtfCount"] as const)
    .filter((k) => components[k] !== null).length;
  const coverage = availableCount / 3;

  // With no inputs at all, "priced in" is unknowable. 0.5 is the honest
  // placeholder — 0 would assert obscurity and hand every uncovered company a
  // maximum long multiplier on no evidence.
  let recognition = weightSum === 0 ? 0.5 : present;
  if (weightSum === 0) flags.push("no_recognition_inputs");
  if (coverage < 0.7 && weightSum > 0) flags.push("partial_recognition_coverage");

  const priceTerm = components.multipleVsOwnHistory;
  const recognitionWithPrice =
    priceTerm === null
      ? null
      : (weighted + priceTerm * PRICE_WEIGHT) / (weightSum + PRICE_WEIGHT);

  if (opts.includePriceTerm) {
    if (recognitionWithPrice === null) {
      flags.push("price_term_requested_but_missing");
    } else {
      recognition = recognitionWithPrice;
      // The reason this is off by default: estimate revision is also
      // price-derived, and the scorer already uses it in the divergence term.
      flags.push("price_term_included_check_pearson_vs_estimate_revision");
    }
  }

  // Analyst count and theme density are counts, not estimates — the
  // uncertainty is in whether they mean what we think, not in the numbers.
  // Confidence therefore tracks coverage rather than measurement error.
  const confidence = weightSum === 0 ? 0.1 : 0.4 + 0.4 * coverage;

  return {
    recognition: clamp01(recognition),
    confidence,
    components,
    recognitionWithPrice,
    coverage,
    flags,
  };
}
