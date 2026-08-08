import {
  composeRevenueShare,
  traverseExposure,
  aggregateExposure,
  totalExposureByCompany,
  HOP_CONFIDENCE_DECAY,
  type ShareFactor,
  type ExposureEdgeLike,
  type SupplyLink,
} from "./exposure.ts";

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

const factor = (
  value: number,
  confidence: number,
  label = "f",
): ShareFactor => ({ value, confidence, label });

const CONSTRAINT = "hv-power-transformers-100mva-plus";

const edge = (o: Partial<ExposureEdgeLike>): ExposureEdgeLike => ({
  companyId: 1,
  constraintId: CONSTRAINT,
  viaCompanyId: null,
  revenueShare: 0.5,
  hops: 0,
  confidence: 0.8,
  derivation: "segment_disclosure",
  ...o,
});

const link = (o: Partial<SupplyLink>): SupplyLink => ({
  supplierId: 2,
  customerId: 1,
  revenueShare: 0.2,
  confidence: 0.8,
  ...o,
});

console.log("\nrevenue share composition");

// The exact case from the brief: 60% of revenue in a segment where data
// centres are 40% of end demand is 0.24, not 0.6.
const composed = composeRevenueShare([
  factor(0.6, 0.9, "segment share of total revenue"),
  factor(0.4, 0.35, "data-centre share of segment end demand"),
]);
check(
  "60% of revenue x 40% end demand = 0.24",
  near(composed.revenueShare, 0.24),
  `(got ${composed.revenueShare})`,
);

// The failure this prevents: an estimated end-demand fraction inheriting a
// disclosure's confidence and reading as if it were disclosed.
check(
  "confidence is the weakest factor, not the product",
  near(composed.confidence, 0.35),
  `(got ${composed.confidence})`,
);
check(
  "confidence is not the product of factors",
  !near(composed.confidence, 0.9 * 0.35),
);

const threeSolid = composeRevenueShare([
  factor(0.5, 0.9),
  factor(0.5, 0.9),
  factor(0.5, 0.9),
]);
check(
  "three confident factors do not decay to shaky",
  near(threeSolid.confidence, 0.9),
  `(got ${threeSolid.confidence})`,
);
check("three factors multiply", near(threeSolid.revenueShare, 0.125));

check(
  "factors are preserved for the evidence chain",
  composed.factors.length === 2 &&
    composed.factors[1].label.includes("end demand"),
);

let threwEmpty = false;
try {
  composeRevenueShare([]);
} catch {
  threwEmpty = true;
}
check("refuses to compose zero factors", threwEmpty);

console.log("\nmulti-hop traversal");

// 3 supplies 2 (30% of 3's revenue), 2 supplies 1 (20% of 2's revenue),
// 1 has 50% of revenue on the constraint.
const chain = traverseExposure(
  [edge({ companyId: 1, revenueShare: 0.5 })],
  [
    link({ supplierId: 2, customerId: 1, revenueShare: 0.2 }),
    link({ supplierId: 3, customerId: 2, revenueShare: 0.3 }),
  ],
);

const hop0 = chain.find((c) => c.companyId === 1)!;
const hop1 = chain.find((c) => c.companyId === 2)!;
const hop2 = chain.find((c) => c.companyId === 3)!;

check("direct edge is retained at hop 0", hop0.hops === 0 && near(hop0.revenueShare, 0.5));
check(
  "hop 1 share is link x downstream exposure",
  hop1.hops === 1 && near(hop1.revenueShare, 0.2 * 0.5),
  `(got ${hop1.revenueShare})`,
);
check(
  "hop 2 multiplies all the way down the chain",
  hop2.hops === 2 && near(hop2.revenueShare, 0.3 * 0.2 * 0.5),
  `(got ${hop2.revenueShare})`,
);

check(
  "confidence decays once per hop",
  near(hop1.confidence, 0.8 * HOP_CONFIDENCE_DECAY),
  `(got ${hop1.confidence})`,
);
check(
  "confidence decay compounds across hops",
  near(hop2.confidence, 0.8 * Math.pow(HOP_CONFIDENCE_DECAY, 2)),
  `(got ${hop2.confidence})`,
);

// A confident far hop reached through a shaky near hop must not look solid.
const weakMiddle = traverseExposure(
  [edge({ companyId: 1, revenueShare: 0.9, confidence: 0.9 })],
  [
    link({ supplierId: 2, customerId: 1, revenueShare: 0.9, confidence: 0.2 }),
    link({ supplierId: 3, customerId: 2, revenueShare: 0.9, confidence: 0.95 }),
  ],
);
const throughWeak = weakMiddle.find((c) => c.companyId === 3)!;
check(
  "a weak link floors everything beyond it",
  throughWeak.confidence <= 0.2,
  `(got ${throughWeak.confidence})`,
);

check(
  "viaCompanyId records the immediate counterparty",
  hop1.viaCompanyId === 1 && hop2.viaCompanyId === 2,
);
check("path is recorded outward from the company", hop2.path.join(">") === "3>2>1");

const capped = traverseExposure(
  [edge({ companyId: 1, revenueShare: 1 })],
  [
    link({ supplierId: 2, customerId: 1, revenueShare: 0.9 }),
    link({ supplierId: 3, customerId: 2, revenueShare: 0.9 }),
    link({ supplierId: 4, customerId: 3, revenueShare: 0.9 }),
    link({ supplierId: 5, customerId: 4, revenueShare: 0.9 }),
  ],
  { maxHops: 3 },
);
check(
  "traversal stops at maxHops",
  capped.every((c) => c.hops <= 3) && !capped.some((c) => c.companyId === 5),
);

// A supplies B and B supplies A is common and must not loop forever.
const cyclic = traverseExposure(
  [edge({ companyId: 1, revenueShare: 0.5 })],
  [
    link({ supplierId: 2, customerId: 1, revenueShare: 0.4 }),
    link({ supplierId: 1, customerId: 2, revenueShare: 0.4 }),
  ],
);
check(
  "cycles terminate without revisiting a company on the path",
  cyclic.length < 10 && cyclic.every((c) => new Set(c.path).size === c.path.length),
  `(produced ${cyclic.length} rows)`,
);

const tiny = traverseExposure(
  [edge({ companyId: 1, revenueShare: 0.02 })],
  [link({ supplierId: 2, customerId: 1, revenueShare: 0.05 })],
  { minRevenueShare: 0.005 },
);
check(
  "shares below the floor are dropped rather than carried as noise",
  !tiny.some((c) => c.companyId === 2),
);

console.log("\naggregation and double counting");

// Company 9 earns 20% from customer 1 and 15% from customer 4. Both are fully
// exposed. These are DISJOINT revenue streams — the answer is 0.35, not 0.20.
const disjoint = aggregateExposure(
  traverseExposure(
    [
      edge({ companyId: 1, revenueShare: 1.0 }),
      edge({ companyId: 4, revenueShare: 1.0 }),
    ],
    [
      link({ supplierId: 9, customerId: 1, revenueShare: 0.2 }),
      link({ supplierId: 9, customerId: 4, revenueShare: 0.15 }),
    ],
  ),
).find((a) => a.companyId === 9)!;
check(
  "distinct counterparties sum — disjoint revenue streams",
  near(disjoint.revenueShare, 0.35),
  `(got ${disjoint.revenueShare})`,
);
check("multi-path exposure is flagged", disjoint.flags.includes("multi_path_exposure"));

// Two readings of the SAME counterparty relationship are two measurements of
// one revenue stream. Summing them counts the same dollar twice.
const sameVia = aggregateExposure([
  {
    companyId: 9,
    constraintId: CONSTRAINT,
    viaCompanyId: 1,
    revenueShare: 0.2,
    hops: 1,
    confidence: 0.8,
    derivation: "customer_concentration",
    path: [9, 1],
  },
  {
    companyId: 9,
    constraintId: CONSTRAINT,
    viaCompanyId: 1,
    revenueShare: 0.25,
    hops: 1,
    confidence: 0.6,
    derivation: "transcript_mention",
    path: [9, 1],
  },
]).find((a) => a.companyId === 9)!;
check(
  "same counterparty takes the max, never the sum",
  near(sameVia.revenueShare, 0.25),
  `(got ${sameVia.revenueShare} — 0.45 means double counting)`,
);

// The invariant that catches a broken graph: no company can have more than
// 100% of its revenue riding on a single constraint.
const overflowing = aggregateExposure([
  {
    companyId: 9, constraintId: CONSTRAINT, viaCompanyId: 1,
    revenueShare: 0.7, hops: 1, confidence: 0.8, derivation: "manual", path: [9, 1],
  },
  {
    companyId: 9, constraintId: CONSTRAINT, viaCompanyId: 2,
    revenueShare: 0.6, hops: 1, confidence: 0.8, derivation: "manual", path: [9, 2],
  },
]).find((a) => a.companyId === 9)!;
check(
  "exposure to one constraint never exceeds 1.0",
  overflowing.revenueShare <= 1.0,
  `(got ${overflowing.revenueShare})`,
);
check(
  "clamping is flagged rather than silent",
  overflowing.flags.includes("exposure_clamped_check_double_counting"),
);

check(
  "aggregation keeps every contributing path for the evidence chain",
  overflowing.contributions.length === 2,
);
check(
  "hops reports the shortest contributing path",
  aggregateExposure([
    {
      companyId: 9, constraintId: CONSTRAINT, viaCompanyId: 1,
      revenueShare: 0.1, hops: 3, confidence: 0.5, derivation: "manual", path: [9, 5, 6, 1],
    },
    {
      companyId: 9, constraintId: CONSTRAINT, viaCompanyId: 2,
      revenueShare: 0.1, hops: 1, confidence: 0.5, derivation: "manual", path: [9, 2],
    },
  ])[0].hops === 1,
);

// A big well-sourced stream should not be dragged down by a small guess.
const weighted = aggregateExposure([
  {
    companyId: 9, constraintId: CONSTRAINT, viaCompanyId: 1,
    revenueShare: 0.4, hops: 1, confidence: 0.9, derivation: "manual", path: [9, 1],
  },
  {
    companyId: 9, constraintId: CONSTRAINT, viaCompanyId: 2,
    revenueShare: 0.02, hops: 1, confidence: 0.1, derivation: "manual", path: [9, 2],
  },
])[0];
check(
  "confidence is contribution-weighted, not a flat mean",
  weighted.confidence > 0.8,
  `(got ${weighted.confidence}; flat mean would be 0.5)`,
);

console.log("\ncross-constraint totals are a diagnostic, not an invariant");

// The same revenue can legitimately ride on two constraints at once: a
// transformer maker is exposed to core steel on the input side and to
// transformer demand on the output side. Summing above 1.0 is not an error.
const twoConstraints = totalExposureByCompany([
  {
    companyId: 9, constraintId: "grain-oriented-electrical-steel",
    revenueShare: 0.8, confidence: 0.8, hops: 0, contributions: [], flags: [],
  },
  {
    companyId: 9, constraintId: CONSTRAINT,
    revenueShare: 0.8, confidence: 0.8, hops: 0, contributions: [], flags: [],
  },
]);
check(
  "cross-constraint total may exceed 1.0 without being wrong",
  near(twoConstraints.get(9)!, 1.6),
  `(got ${twoConstraints.get(9)})`,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
