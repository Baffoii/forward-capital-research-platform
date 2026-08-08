/**
 * Backtest harness.
 *
 * Until this runs on real data the scoring formula is a well-structured
 * hypothesis with zero evidence, and a ranked board is the most dangerous
 * possible artefact: a table of names with scores FEELS like knowledge. It
 * isn't, until the replay says the ranking had predictive power.
 *
 * Everything in this file is pure. Prices, scores, and recognition series are
 * passed in. That is not architectural tidiness — it is the only way to test
 * a backtest, and an untested backtest is worse than none because it launders
 * a broken model into a number you trust.
 */

import { pearson } from "./opportunity.ts";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface PricePoint {
  companyId: number;
  date: Date;
  /** Split- and dividend-adjusted close. Unadjusted prices manufacture returns. */
  adjustedClose: number;
}

export interface ScoredRow {
  companyId: number;
  constraintId: string | null;
  longScore: number;
  shortScore: number;
  confidence: number;
  recognition: number;
  estimateRevision: number | null;
  asOf: Date;
}

export interface BacktestOptions {
  /** Forward horizons in months. */
  horizons?: number[];
  /** Trading days of slack when matching a price to a date. */
  priceToleranceDays?: number;
  /** Drop a rebalance date with fewer than this many scored names. */
  minUniverse?: number;
}

/* ------------------------------------------------------------------ */
/* Price lookup                                                        */
/* ------------------------------------------------------------------ */

/**
 * Closing price at or immediately before `date`.
 *
 * Never looks forward. Markets close, holidays happen, and a lookup that
 * silently reaches for the next available price after the target date buys at
 * a price that did not exist yet — a small, invisible, systematic edge that
 * makes any model look good.
 */
export function priceAt(
  series: PricePoint[],
  date: Date,
  toleranceDays = 7,
  opts: { allowForward?: boolean } = {},
): number | null {
  let best: PricePoint | null = null;
  let bestGap = Infinity;
  for (const p of series) {
    const gapDays = (date.getTime() - p.date.getTime()) / 864e5;
    // Backward-only unless explicitly allowed. See forwardReturn.
    if (gapDays < 0 && !opts.allowForward) continue;
    const absGap = Math.abs(gapDays);
    if (absGap > toleranceDays) continue;
    if (absGap < bestGap) {
      bestGap = absGap;
      best = p;
    }
  }
  return best?.adjustedClose ?? null;
}

/** Jan 30 + 1 month is Feb 28, not March 2. Naive setMonth skips February. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m + months,
      Math.min(d, lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * Realised return from `from` to `from + months`.
 *
 * The two ends are NOT symmetric, and the asymmetry is the point:
 *
 *   ENTRY is strictly backward-looking. Buying at a price that had not printed
 *   yet is a small, invisible, systematic edge that makes any model look good.
 *
 *   EXIT may take the nearest close on either side within tolerance. Measuring
 *   a three-month return to T+3mo+1day is not an information advantage — the
 *   position was already on — and forbidding it silently drops most periods
 *   whenever the target date lands on a weekend or holiday.
 */
export function forwardReturn(
  series: PricePoint[],
  from: Date,
  months: number,
  toleranceDays = 7,
): number | null {
  const start = priceAt(series, from, toleranceDays);
  if (start === null || start <= 0) return null;
  const end = priceAt(series, addMonths(from, months), toleranceDays, {
    allowForward: true,
  });
  if (end === null || end <= 0) return null;
  return end / start - 1;
}

/* ------------------------------------------------------------------ */
/* Rank statistics                                                     */
/* ------------------------------------------------------------------ */

/** Average ranks for ties, so a block of equal scores does not fabricate order. */
export function rankArray(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation: Pearson on the ranks. */
export function spearman(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  return pearson(rankArray(xs.slice(0, n)), rankArray(ys.slice(0, n)));
}

export interface DecileSpread {
  topDecileMean: number;
  bottomDecileMean: number;
  spread: number;
  decileSize: number;
}

/**
 * Mean forward return of the top decile minus the bottom.
 *
 * Returns null below 10 names. With 8 names a "decile" is one name, and the
 * resulting spread is a single stock's return wearing a statistic's name.
 */
export function decileSpread(
  scores: number[],
  returns: number[],
): DecileSpread | null {
  const n = Math.min(scores.length, returns.length);
  if (n < 10) return null;
  const order = scores
    .slice(0, n)
    .map((s, i) => ({ s, r: returns[i] }))
    .sort((a, b) => b.s - a.s);
  const size = Math.max(1, Math.floor(n / 10));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const top = mean(order.slice(0, size).map((o) => o.r));
  const bottom = mean(order.slice(-size).map((o) => o.r));
  return { topDecileMean: top, bottomDecileMean: bottom, spread: top - bottom, decileSize: size };
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

export interface PeriodResult {
  asOf: Date;
  horizonMonths: number;
  universeSize: number;
  /** Spearman(longScore, forward return). */
  rankCorrelation: number;
  decile: DecileSpread | null;
  /** Equal-weight mean return of the same universe — the honest benchmark. */
  benchmarkReturn: number;
  topDecileExcess: number | null;
}

export interface BacktestResult {
  periods: PeriodResult[];
  byHorizon: Array<{
    horizonMonths: number;
    periods: number;
    meanRankCorrelation: number;
    /** Share of periods with a positive rank correlation. */
    hitRate: number;
    meanDecileSpread: number | null;
    meanBenchmarkReturn: number;
    meanTopDecileExcess: number | null;
  }>;
  recognitionVsRevision: {
    pearson: number;
    n: number;
    verdict: string;
  };
  warnings: string[];
}

export function monthlyDates(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 23, 59, 59, 999),
  );
  while (cursor.getTime() <= end.getTime()) {
    out.push(new Date(cursor.getTime()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Replay the ranking monthly and measure what happened next.
 *
 * The benchmark is an EQUAL-WEIGHT basket of the same universe scored on the
 * same date — not an index. Every name here is a bet on one macro theme, so a
 * broad index would flatter the model enormously in any quarter that theme ran.
 * The only question worth answering is whether the ranking beat picking from
 * the same list at random.
 */
export function runBacktest(
  scores: ScoredRow[],
  prices: Map<number, PricePoint[]>,
  opts: BacktestOptions = {},
): BacktestResult {
  const horizons = opts.horizons ?? [1, 3, 6];
  const tolerance = opts.priceToleranceDays ?? 7;
  const minUniverse = opts.minUniverse ?? 5;
  const warnings: string[] = [];

  const byAsOf = new Map<number, ScoredRow[]>();
  for (const s of scores) {
    const key = s.asOf.getTime();
    byAsOf.set(key, [...(byAsOf.get(key) ?? []), s]);
  }

  const periods: PeriodResult[] = [];
  let droppedForUniverse = 0;
  let droppedForPrices = 0;

  for (const [asOfMs, rows] of Array.from(byAsOf.entries()).sort((a, b) => a[0] - b[0])) {
    const asOf = new Date(asOfMs);

    // One score per company: a company can be scored against several
    // constraints, and letting it appear repeatedly would weight it more
    // heavily in the ranking purely for having broad exposure.
    const bestByCompany = new Map<number, ScoredRow>();
    for (const r of rows) {
      const prev = bestByCompany.get(r.companyId);
      if (!prev || r.longScore > prev.longScore) bestByCompany.set(r.companyId, r);
    }
    const universe = Array.from(bestByCompany.values());

    for (const horizon of horizons) {
      const usable: Array<{ score: number; ret: number }> = [];
      for (const row of universe) {
        const series = prices.get(row.companyId);
        if (!series || series.length === 0) {
          droppedForPrices++;
          continue;
        }
        const ret = forwardReturn(series, asOf, horizon, tolerance);
        if (ret === null) {
          droppedForPrices++;
          continue;
        }
        usable.push({ score: row.longScore, ret });
      }

      if (usable.length < minUniverse) {
        droppedForUniverse++;
        continue;
      }

      const scoreValues = usable.map((u) => u.score);
      const returnValues = usable.map((u) => u.ret);
      const benchmark =
        returnValues.reduce((a, b) => a + b, 0) / returnValues.length;
      const decile = decileSpread(scoreValues, returnValues);

      periods.push({
        asOf,
        horizonMonths: horizon,
        universeSize: usable.length,
        rankCorrelation: spearman(scoreValues, returnValues),
        decile,
        benchmarkReturn: benchmark,
        topDecileExcess: decile === null ? null : decile.topDecileMean - benchmark,
      });
    }
  }

  if (droppedForUniverse > 0) {
    warnings.push(
      `${droppedForUniverse} rebalance/horizon combination(s) dropped: fewer than ${minUniverse} names with usable prices`,
    );
  }
  if (droppedForPrices > 0) {
    warnings.push(
      `${droppedForPrices} (company, date) lookups dropped for missing or stale prices`,
    );
  }

  const byHorizon = horizons.map((h) => {
    const hp = periods.filter((p) => p.horizonMonths === h);
    const corrs = hp.map((p) => p.rankCorrelation).filter(Number.isFinite);
    const spreads = hp.map((p) => p.decile?.spread).filter((s): s is number => s !== undefined);
    const excesses = hp
      .map((p) => p.topDecileExcess)
      .filter((s): s is number => s !== null && Number.isFinite(s));
    const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
    return {
      horizonMonths: h,
      periods: hp.length,
      meanRankCorrelation: mean(corrs),
      hitRate: corrs.length === 0 ? NaN : corrs.filter((c) => c > 0).length / corrs.length,
      meanDecileSpread: spreads.length === 0 ? null : mean(spreads),
      meanBenchmarkReturn: mean(hp.map((p) => p.benchmarkReturn)),
      meanTopDecileExcess: excesses.length === 0 ? null : mean(excesses),
    };
  });

  /* --- the collinearity check ------------------------------------- */

  const paired = scores.filter(
    (s) => s.estimateRevision !== null && Number.isFinite(s.recognition),
  );
  const r = pearson(
    paired.map((s) => s.recognition),
    paired.map((s) => s.estimateRevision!),
  );

  return {
    periods,
    byHorizon,
    recognitionVsRevision: {
      pearson: r,
      n: paired.length,
      verdict: collinearityVerdict(r, paired.length),
    },
    warnings,
  };
}

/**
 * Recognition and estimate revision both measure "has the market noticed".
 * Above roughly 0.7 the score is pricing obscurity twice and the two terms
 * should collapse into one.
 *
 * This reports the number and stops. Collapsing the terms changes the scoring
 * formula, and that is not a decision a backtest gets to make on its own.
 */
export function collinearityVerdict(r: number, n: number): string {
  if (!Number.isFinite(r)) return "not computable — no rows with both recognition and estimate revision";
  if (n < 30) return `n=${n} is too small to act on; treat as indicative only`;
  const a = Math.abs(r);
  if (a > 0.7) {
    return `|r|=${a.toFixed(3)} exceeds 0.7 — recognition and estimate revision are double-counting obscurity. They should collapse into one term. NOT changed automatically: that is a change to the scoring formula.`;
  }
  if (a > 0.5) return `|r|=${a.toFixed(3)} is elevated but below the 0.7 threshold — worth watching`;
  return `|r|=${a.toFixed(3)} is below the 0.7 threshold — the two terms are carrying different information`;
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export function formatBacktest(result: BacktestResult): string {
  const lines: string[] = [];
  const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "n/a");
  const fixed = (x: number | null) =>
    x === null || !Number.isFinite(x) ? "n/a" : x.toFixed(3);

  lines.push("");
  lines.push("backtest");
  lines.push("─".repeat(78));
  if (result.periods.length === 0) {
    lines.push("No usable periods. This is a result, not an error — it means there is");
    lines.push("not yet enough point-in-time score and price history to test anything.");
  } else {
    lines.push(
      "horizon  periods  mean rank corr  hit rate  decile spread  benchmark  top-decile excess",
    );
    for (const h of result.byHorizon) {
      lines.push(
        `${String(h.horizonMonths).padStart(4)}mo  ` +
          `${String(h.periods).padStart(7)}  ` +
          `${fixed(h.meanRankCorrelation).padStart(14)}  ` +
          `${pct(h.hitRate).padStart(8)}  ` +
          `${pct(h.meanDecileSpread ?? NaN).padStart(13)}  ` +
          `${pct(h.meanBenchmarkReturn).padStart(9)}  ` +
          `${pct(h.meanTopDecileExcess ?? NaN).padStart(17)}`,
      );
    }
    lines.push("");
    lines.push("Benchmark is an equal-weight basket of the SAME universe on the same date,");
    lines.push("not an index. Every name here is a bet on one macro theme, so an index");
    lines.push("would flatter the model in any quarter that theme ran. The question is");
    lines.push("whether the ranking beat picking from the same list at random.");
  }

  lines.push("");
  lines.push("recognition vs estimate revision");
  lines.push("─".repeat(78));
  lines.push(`  pearson r = ${fixed(result.recognitionVsRevision.pearson)}  (n=${result.recognitionVsRevision.n})`);
  lines.push(`  ${result.recognitionVsRevision.verdict}`);

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("warnings");
    lines.push("─".repeat(78));
    for (const w of result.warnings) lines.push(`  ${w}`);
  }
  lines.push("");
  return lines.join("\n");
}
