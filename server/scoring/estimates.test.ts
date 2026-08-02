import { estimateRevision, type EstimateSnapshotLike } from "./estimates.ts";

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
const D = (s: string) => new Date(s);

const snap = (o: Partial<EstimateSnapshotLike>): EstimateSnapshotLike => ({
  fiscalPeriod: "FY2027",
  consensusEps: 5.0,
  consensusRevenue: null,
  analystCount: 12,
  knownAt: D("2026-01-15"),
  ...o,
});

console.log("\nestimate revision");

const raised = estimateRevision(
  [
    snap({ consensusEps: 5.0, knownAt: D("2026-01-15") }),
    snap({ consensusEps: 5.5, knownAt: D("2026-04-15") }),
  ],
  D("2026-05-01"),
)!;
check("an upward revision is positive", raised.value > 0);
check("revision is a fraction of the prior level", near(raised.value, 0.1), `(got ${raised.value})`);

const cut = estimateRevision(
  [
    snap({ consensusEps: 5.0, knownAt: D("2026-01-15") }),
    snap({ consensusEps: 4.0, knownAt: D("2026-04-15") }),
  ],
  D("2026-05-01"),
)!;
check("a cut is negative", near(cut.value, -0.2), `(got ${cut.value})`);

// A 40% cut and a 300% cut are both "consensus capitulated".
const extreme = estimateRevision(
  [
    snap({ consensusEps: 1.0, knownAt: D("2026-01-15") }),
    snap({ consensusEps: 9.0, knownAt: D("2026-04-15") }),
  ],
  D("2026-05-01"),
)!;
check("clamps to the scorer's -1..1 contract", extreme.value === 1);

// This is the setup the whole model is looking for: physical tightening with
// consensus sitting still. It must read as zero, not as missing.
const flat = estimateRevision(
  [
    snap({ consensusEps: 5.0, knownAt: D("2026-01-15") }),
    snap({ consensusEps: 5.0, knownAt: D("2026-04-15") }),
  ],
  D("2026-05-01"),
)!;
check("flat consensus reads as zero", flat.value === 0);

console.log("\nrefusals");

// Zero is the most bullish reading the divergence term can take. Asserting it
// on the strength of having no data is the wrong failure.
check(
  "a single snapshot produces null, not zero",
  estimateRevision([snap({})], D("2026-05-01")) === null,
);
check("no snapshots produce null", estimateRevision([], D("2026-05-01")) === null);

// A revision measured across two fiscal periods is not a revision, it is a
// growth rate.
check(
  "does not compare across different fiscal periods",
  estimateRevision(
    [
      snap({ fiscalPeriod: "FY2026", consensusEps: 4.0, knownAt: D("2026-01-15") }),
      snap({ fiscalPeriod: "FY2027", consensusEps: 6.0, knownAt: D("2026-04-15") }),
    ],
    D("2026-05-01"),
  ) === null,
);

// -0.10 to +0.05 is not a 150% revision of anything.
check(
  "refuses a sign flip through zero",
  estimateRevision(
    [
      snap({ consensusEps: -0.1, knownAt: D("2026-01-15") }),
      snap({ consensusEps: 0.05, knownAt: D("2026-04-15") }),
    ],
    D("2026-05-01"),
  ) === null,
);

check(
  "never uses a snapshot from the future",
  estimateRevision(
    [
      snap({ consensusEps: 5.0, knownAt: D("2026-01-15") }),
      snap({ consensusEps: 9.0, knownAt: D("2026-08-15") }),
    ],
    D("2026-05-01"),
  ) === null,
  "only one snapshot is knowable at asOf",
);

console.log("\nconfidence tracks how many people the consensus is");

const wellCovered = estimateRevision(
  [
    snap({ consensusEps: 5.0, analystCount: 20, knownAt: D("2026-01-15") }),
    snap({ consensusEps: 5.5, analystCount: 20, knownAt: D("2026-04-15") }),
  ],
  D("2026-05-01"),
)!;
const barelyCovered = estimateRevision(
  [
    snap({ consensusEps: 5.0, analystCount: 1, knownAt: D("2026-01-15") }),
    snap({ consensusEps: 5.5, analystCount: 1, knownAt: D("2026-04-15") }),
  ],
  D("2026-05-01"),
)!;
check(
  "a one-analyst consensus is a weaker claim about the market",
  barelyCovered.confidence < wellCovered.confidence,
  `(${barelyCovered.confidence} vs ${wellCovered.confidence})`,
);
check("identical values regardless of coverage", wellCovered.value === barelyCovered.value);

check(
  "falls back to revenue when EPS is untagged",
  near(
    estimateRevision(
      [
        snap({ consensusEps: null, consensusRevenue: 1000, knownAt: D("2026-01-15") }),
        snap({ consensusEps: null, consensusRevenue: 1100, knownAt: D("2026-04-15") }),
      ],
      D("2026-05-01"),
    )!.value,
    0.1,
  ),
);

console.log("\nsparse coverage still produces a reading");

// Being strict about the lookback window returns null on companies that
// genuinely have two data points — and thin coverage is the condition this
// model hunts for, so that is the wrong place to be strict.
const tightWindow = estimateRevision(
  [
    snap({ consensusEps: 5.0, analystCount: 3, knownAt: D("2026-04-10") }),
    snap({ consensusEps: 5.4, analystCount: 3, knownAt: D("2026-04-25") }),
  ],
  D("2026-05-01"),
);
check("two close snapshots still produce a revision", tightWindow !== null);
check("and the value is right", tightWindow !== null && near(tightWindow.value, 0.08));
check(
  "a short window is discounted, not treated as a full-quarter read",
  tightWindow !== null && tightWindow.confidence < 0.4,
  `(got ${tightWindow?.confidence})`,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
