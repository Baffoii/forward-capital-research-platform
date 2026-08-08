import {
  priceAt,
  forwardReturn,
  rankArray,
  spearman,
  decileSpread,
  monthlyDates,
  addMonths,
  runBacktest,
  collinearityVerdict,
  formatBacktest,
  type PricePoint,
  type ScoredRow,
} from "./backtest.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  pass  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

const series = (companyId: number, points: Array<[string, number]>): PricePoint[] =>
  points.map(([d, p]) => ({ companyId, date: D(d), adjustedClose: p }));

console.log("\nprice lookup never looks forward");

const p = series(1, [
  ["2026-01-30", 100],
  ["2026-02-27", 110],
  ["2026-03-31", 120],
]);

check("takes the price at or before the date", priceAt(p, D("2026-02-27")) === 110);
check("falls back to the prior close on a market holiday", priceAt(p, D("2026-03-01")) === 110);

// A lookup that reaches forward buys at a price that did not exist yet. It is
// small, invisible, and systematically makes any model look good.
check(
  "never reaches forward for a price",
  priceAt(p, D("2026-01-01")) === null,
  "the only prices available are later than the requested date",
);
// A price from six weeks ago is not this month's price.
check("refuses a stale price beyond tolerance", priceAt(p, D("2026-05-15")) === null);
check("accepts within tolerance", priceAt(p, D("2026-04-03"), 7) === 120);

// Entry and exit are deliberately not symmetric: entry must never peek, exit
// may take the nearest close either side. Measuring to T+2mo+1day is not an
// information advantage; forbidding it drops every period whose target date
// lands on a weekend.
check("computes a forward return", near(forwardReturn(p, D("2026-01-30"), 2)!, 0.2));
check(
  "returns null when the end price is missing",
  forwardReturn(p, D("2026-03-31"), 6) === null,
);
check(
  "exit price may take the nearest close on either side",
  priceAt(p, D("2026-03-30"), 7, { allowForward: true }) === 120,
);
check(
  "entry price still refuses to look forward",
  priceAt(p, D("2026-03-30"), 7) === null,
);

// Jan 30 + 1 month is Feb 28. Naive setMonth rolls to March 2 and skips
// February entirely, which silently shifts every monthly horizon.
check(
  "month arithmetic clamps instead of rolling over",
  addMonths(D("2026-01-30"), 1).toISOString().startsWith("2026-02-28"),
  `(got ${addMonths(D("2026-01-30"), 1).toISOString()})`,
);
check(
  "clamps into a leap February",
  addMonths(D("2028-01-31"), 1).toISOString().startsWith("2028-02-29"),
);
check(
  "ordinary months are untouched",
  addMonths(D("2026-01-15"), 3).toISOString().startsWith("2026-04-15"),
);

console.log("\nrank statistics");

check("ranks ascending", rankArray([30, 10, 20]).join(",") === "3,1,2");
// A block of equal scores has no order; inventing one fabricates signal.
check("averages ranks for ties", rankArray([5, 5, 1]).join(",") === "2.5,2.5,1");

check(
  "detects a perfect monotone relationship",
  near(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1),
);
check(
  "detects a perfect inversion",
  near(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]), -1),
);
// Spearman is the right statistic here because the claim is about ORDER.
check(
  "is unaffected by a monotone transform of the values",
  near(
    spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]),
    spearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]),
  ),
);
check("refuses to report a correlation on two points", Number.isNaN(spearman([1, 2], [1, 2])));

console.log("\ndecile spread");

const scores20 = Array.from({ length: 20 }, (_, i) => i);
const returns20 = Array.from({ length: 20 }, (_, i) => i * 0.01);
const d = decileSpread(scores20, returns20)!;
check("top decile beats bottom when ranking works", d.spread > 0);
check("decile size is n/10", d.decileSize === 2);
check("top decile mean is the mean of the top names", near(d.topDecileMean, 0.185));

// With 8 names a "decile" is one name, and the spread is one stock's return
// wearing a statistic's name.
check(
  "refuses a decile spread below 10 names",
  decileSpread([1, 2, 3], [0.1, 0.2, 0.3]) === null,
);

console.log("\nmonthly replay dates");

const months = monthlyDates(D("2026-01-15"), D("2026-04-20"));
check("walks month by month", months.length === 4, `(got ${months.length})`);
check("never runs past the end", months[months.length - 1] < D("2026-05-01"));

console.log("\nfull replay");

// 12 companies, forward returns deliberately ordered by score.
const N = 12;
const prices = new Map<number, PricePoint[]>();
for (let id = 1; id <= N; id++) {
  const growth = 1 + id * 0.01;
  prices.set(
    id,
    series(id, [
      ["2026-01-30", 100],
      ["2026-02-27", 100 * growth],
      ["2026-03-31", 100 * growth * growth],
      ["2026-04-30", 100 * growth * growth * growth],
    ]),
  );
}

const scored: ScoredRow[] = Array.from({ length: N }, (_, i) => ({
  companyId: i + 1,
  constraintId: "c1",
  longScore: (i + 1) / N,
  shortScore: 0,
  confidence: 0.6,
  recognition: 0.5,
  estimateRevision: 0.1,
  asOf: D("2026-01-30"),
}));

const result = runBacktest(scored, prices, { horizons: [1, 3] });
check("produces one period per horizon", result.periods.length === 2);
check(
  "a ranking that works shows positive rank correlation",
  result.byHorizon[0].meanRankCorrelation > 0.9,
  `(got ${result.byHorizon[0].meanRankCorrelation})`,
);
check("hit rate is reported", result.byHorizon[0].hitRate === 1);
check("decile spread is positive", (result.byHorizon[0].meanDecileSpread ?? -1) > 0);
check(
  "benchmark is the equal-weight mean of the same universe",
  result.periods[0].benchmarkReturn > 0,
);
check(
  "top-decile excess is measured against that benchmark, not zero",
  result.periods[0].topDecileExcess !== null &&
    near(
      result.periods[0].topDecileExcess!,
      result.periods[0].decile!.topDecileMean - result.periods[0].benchmarkReturn,
    ),
);

// A random ranking must not produce a correlation. This is the test that would
// catch a harness quietly reporting success on noise.
const shuffled: ScoredRow[] = scored.map((s, i) => ({
  ...s,
  longScore: [0.5, 0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.05, 0.95, 0.15][i],
}));
const noise = runBacktest(shuffled, prices, { horizons: [1] });
check(
  "a scrambled ranking does not produce a strong correlation",
  Math.abs(noise.byHorizon[0].meanRankCorrelation) < 0.6,
  `(got ${noise.byHorizon[0].meanRankCorrelation})`,
);

// A company scored against several constraints must not get extra weight in
// the ranking purely for having broad exposure.
const duplicated = runBacktest(
  [...scored, { ...scored[0], constraintId: "c2", longScore: 0.99 }],
  prices,
  { horizons: [1] },
);
check(
  "one company counts once regardless of how many constraints it touches",
  duplicated.periods[0].universeSize === N,
  `(got ${duplicated.periods[0].universeSize})`,
);

const sparse = runBacktest(scored.slice(0, 3), prices, { horizons: [1], minUniverse: 5 });
check("drops periods with too few names", sparse.periods.length === 0);
check("and says so rather than silently reporting nothing", sparse.warnings.length > 0);

console.log("\nno data is a result, not an error");

const empty = runBacktest([], new Map(), { horizons: [1] });
check("empty input produces no periods", empty.periods.length === 0);
check("and formats a readable report anyway", formatBacktest(empty).includes("not yet enough"));

console.log("\ncollinearity verdict");

check(
  "flags double counting above 0.7",
  collinearityVerdict(0.85, 100).includes("double-counting"),
);
check(
  "says the formula was not changed automatically",
  collinearityVerdict(0.85, 100).includes("NOT changed automatically"),
);
check("catches a strong negative correlation too", collinearityVerdict(-0.85, 100).includes("double-counting"));
check("is below-threshold at 0.3", collinearityVerdict(0.3, 100).includes("below the 0.7"));
check("flags an elevated but sub-threshold reading", collinearityVerdict(0.6, 100).includes("elevated"));
// A correlation on 12 points is not evidence about anything.
check("refuses to draw conclusions from a small sample", collinearityVerdict(0.9, 12).includes("too small"));
check("handles the no-data case", collinearityVerdict(NaN, 0).includes("not computable"));

const correlated = runBacktest(
  scored.map((s, i) => ({ ...s, recognition: i / N, estimateRevision: i / N })),
  prices,
  { horizons: [1] },
);
check(
  "computes the correlation across the real scored rows",
  near(correlated.recognitionVsRevision.pearson, 1),
);
check("reports n alongside r", correlated.recognitionVsRevision.n === N);
check(
  "the report always prints the correlation, even with no periods",
  formatBacktest(empty).includes("recognition vs estimate revision"),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
