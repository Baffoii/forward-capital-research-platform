import {
  toCoverage,
  companyTightening,
  aggregateTightening,
  detectRelease,
  BACKLOG_METHOD_CONFIDENCE_CEILING,
  DIRECTION_THRESHOLD,
  type BacklogObservation,
  type CoveragePoint,
  type CompanyTightening,
  type ExposureWeight,
} from "./tightening.ts";

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

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const D = (s: string) => new Date(s);
const CONSTRAINT = "hv-power-transformers-100mva-plus";

const obs = (o: Partial<BacklogObservation>): BacklogObservation => ({
  companyId: 1,
  fiscalPeriod: "Q1-2026",
  backlogValue: 3000,
  quarterlyRevenue: 1000,
  effectiveFrom: D("2026-03-31"),
  knownAt: D("2026-04-25"),
  confidence: 0.6,
  ...o,
});

const cov = (o: Partial<CoveragePoint>): CoveragePoint => ({
  companyId: 1,
  fiscalPeriod: "Q1-2026",
  coverageQuarters: 3,
  effectiveFrom: D("2026-03-31"),
  knownAt: D("2026-04-25"),
  confidence: 0.6,
  ...o,
});

console.log("\ncoverage ratio");

check(
  "backlog over quarterly revenue is quarters of coverage",
  toCoverage(obs({ backlogValue: 3500, quarterlyRevenue: 1000 }))!.coverageQuarters === 3.5,
);
check("refuses to divide by zero revenue", toCoverage(obs({ quarterlyRevenue: 0 })) === null);
check("rejects negative backlog", toCoverage(obs({ backlogValue: -1 })) === null);

console.log("\ncompany-level tightening");

// The confound this whole design exists to kill: a company that grew 20% with
// backlog also up 20% has a queue exactly as long as before. Raw backlog
// growth would call that tightening. Coverage says nothing happened.
const grewProportionally = companyTightening(
  [
    cov({ coverageQuarters: 3.0, knownAt: D("2026-01-25") }),
    cov({ coverageQuarters: 3.0, knownAt: D("2026-04-25") }),
  ],
  D("2026-06-01"),
)!;
check(
  "proportional growth in backlog and revenue is NOT tightening",
  near(grewProportionally.tightening, 0),
  `(got ${grewProportionally.tightening})`,
);

const queueLengthened = companyTightening(
  [
    cov({ coverageQuarters: 3.0, knownAt: D("2026-01-25") }),
    cov({ coverageQuarters: 3.8, knownAt: D("2026-04-25") }),
  ],
  D("2026-06-01"),
)!;
check("a lengthening queue reads positive", queueLengthened.tightening > 0);
check(
  "half a quarter of extension is meaningful but not saturated",
  queueLengthened.tightening > 0.5 && queueLengthened.tightening < 0.95,
  `(got ${queueLengthened.tightening})`,
);
check("records the raw delta for a human to argue with", near(queueLengthened.deltaQuarters, 0.8));

const queueShortened = companyTightening(
  [
    cov({ coverageQuarters: 4.0, knownAt: D("2026-01-25") }),
    cov({ coverageQuarters: 3.2, knownAt: D("2026-04-25") }),
  ],
  D("2026-06-01"),
)!;
check("a shortening queue reads negative", queueShortened.tightening < 0);

check(
  "reading is bounded to -1..1 no matter how extreme the move",
  Math.abs(
    companyTightening(
      [
        cov({ coverageQuarters: 1, knownAt: D("2026-01-25") }),
        cov({ coverageQuarters: 40, knownAt: D("2026-04-25") }),
      ],
      D("2026-06-01"),
    )!.tightening,
  ) <= 1,
);

check(
  "needs two points to have a direction at all",
  companyTightening([cov({})], D("2026-06-01")) === null,
);

// The most expensive bug available in this codebase, guarded directly.
const notYetFiled = companyTightening(
  [
    cov({ coverageQuarters: 3.0, knownAt: D("2026-01-25") }),
    cov({ coverageQuarters: 3.8, knownAt: D("2026-04-25"), effectiveFrom: D("2026-03-31") }),
  ],
  // After the quarter END but before the 10-Q was FILED.
  D("2026-04-10"),
);
check(
  "a quarter that ended but has not been filed is not knowable",
  notYetFiled === null,
  "selecting on effectiveFrom instead of knownAt is lookahead bias",
);

console.log("\nconstraint-level aggregation");

const ct = (o: Partial<CompanyTightening>): CompanyTightening => ({
  companyId: 1,
  tightening: 0.5,
  coverageNow: 3.5,
  coveragePrior: 3.0,
  deltaQuarters: 0.5,
  confidence: 0.6,
  knownAt: D("2026-04-25"),
  ...o,
});

const w = (companyId: number, revenueShare: number, confidence = 0.8): ExposureWeight => ({
  companyId,
  revenueShare,
  confidence,
});

// A pure-play must move the constraint more than a conglomerate with a
// rounding error of exposure. Equal weighting lets the conglomerate outvote
// the company that IS the constraint.
const weighted = aggregateTightening(
  CONSTRAINT,
  [ct({ companyId: 1, tightening: 0.9 }), ct({ companyId: 2, tightening: -0.9 })],
  [w(1, 0.85), w(2, 0.05)],
  D("2026-06-01"),
)!;
check(
  "pure-play outweighs a barely-exposed conglomerate",
  weighted.tightening > 0.6,
  `(got ${weighted.tightening}; equal weighting would give 0)`,
);
check(
  "sign disagreement among contributors is surfaced, not averaged away",
  weighted.flags.includes("contributors_disagree_on_direction"),
);

const solid = aggregateTightening(
  CONSTRAINT,
  [
    ct({ companyId: 1, tightening: 0.6, confidence: 0.95 }),
    ct({ companyId: 2, tightening: 0.5, confidence: 0.95 }),
    ct({ companyId: 3, tightening: 0.55, confidence: 0.95 }),
  ],
  [w(1, 0.8, 0.95), w(2, 0.7, 0.95), w(3, 0.6, 0.95)],
  D("2026-06-01"),
)!;
// Coverage cannot tell demand rising from delivery slowing. A method that
// cannot separate those has no business reporting high confidence, however
// many companies agree.
check(
  "backlog-derived confidence is capped regardless of agreement",
  solid.confidence <= BACKLOG_METHOD_CONFIDENCE_CEILING,
  `(got ${solid.confidence})`,
);
check("method string records how the number was reached", solid.method.includes("backlog_coverage_delta"));
check("method admits the confound in writing", solid.method.includes("delivery slowing"));

const thin = aggregateTightening(
  CONSTRAINT,
  [ct({ companyId: 1, tightening: 0.8 })],
  [w(1, 0.9)],
  D("2026-06-01"),
)!;
check("a single company is flagged as thin coverage", thin.flags.includes("thin_constraint_coverage"));
check(
  "thin coverage is penalised, not just flagged",
  thin.confidence < solid.confidence,
  `(${thin.confidence} vs ${solid.confidence})`,
);

const mostlyMissing = aggregateTightening(
  CONSTRAINT,
  [ct({ companyId: 1 })],
  [w(1, 0.5), w(2, 0.5), w(3, 0.5), w(4, 0.5)],
  D("2026-06-01"),
)!;
check(
  "reports which exposed companies had no usable backlog",
  mostlyMissing.missingCompanyIds.length === 3,
);
check(
  "flags when most of the exposed set is missing",
  mostlyMissing.flags.includes("most_exposed_companies_missing_backlog"),
);

check(
  "direction is stable inside the threshold",
  aggregateTightening(CONSTRAINT, [ct({ tightening: 0.05 })], [w(1, 0.9)], D("2026-06-01"))!
    .direction === "stable",
);
check(
  "direction is easing below the negative threshold",
  aggregateTightening(CONSTRAINT, [ct({ tightening: -0.5 })], [w(1, 0.9)], D("2026-06-01"))!
    .direction === "easing",
);
check(
  "companies with no exposure edge do not contribute",
  aggregateTightening(CONSTRAINT, [ct({ companyId: 99 })], [w(1, 0.9)], D("2026-06-01")) === null,
);
check("DIRECTION_THRESHOLD is exported for retuning", DIRECTION_THRESHOLD === 0.15);

console.log("\nrelease detection");

// Still tight, but no longer tightening. This is the turn that costs money if
// missed, and it is invisible in the level.
const turning = detectRelease(
  [
    { tightening: 0.3, knownAt: D("2025-07-01") },
    { tightening: 0.7, knownAt: D("2025-10-01") },
    { tightening: 0.9, knownAt: D("2026-01-01") },
    { tightening: 0.75, knownAt: D("2026-04-01") },
  ],
  D("2026-06-01"),
)!;
check("detects the first shortening off a peak", turning.firstShortening);
check("reports the peak it turned from", near(turning.peakTightening, 0.9));
check("delta from prior is negative at the turn", turning.deltaFromPrior < 0);

const stillClimbing = detectRelease(
  [
    { tightening: 0.3, knownAt: D("2025-10-01") },
    { tightening: 0.7, knownAt: D("2026-01-01") },
    { tightening: 0.9, knownAt: D("2026-04-01") },
  ],
  D("2026-06-01"),
)!;
check("does not fire while still tightening", !stillClimbing.firstShortening);
check("quarters since peak is zero at the peak", stillClimbing.quartersSincePeak === 0);

check(
  "release detection respects knownAt",
  detectRelease(
    [
      { tightening: 0.9, knownAt: D("2026-01-01") },
      { tightening: 0.4, knownAt: D("2026-07-01") },
    ],
    D("2026-03-01"),
  ) === null,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
