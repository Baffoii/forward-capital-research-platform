import {
  scoreOpportunity,
  asKnownAt,
  pearson,
  type Measurement,
  type ScoreInputs,
} from "./opportunity.ts";

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

const m = (value: number, confidence = 0.8): Measurement => ({
  value,
  confidence,
  asOf: new Date("2026-08-01"),
});

const inputs = (o: Partial<ScoreInputs>): ScoreInputs => ({
  exposure: m(0.3),
  tightening: m(0.6),
  recognition: m(0.3),
  estimateRevision: m(0.0),
  capture: m(0.7),
  ...o,
});

console.log("\nscoring behaviour");

// The inversion that justifies the whole build: the obvious mega-cap has
// 4.5x the exposure and must still rank below the obscure mid-cap.
const megacap = scoreOpportunity(
  inputs({ exposure: m(0.9), tightening: m(0.6), recognition: m(0.95) }),
);
const midcap = scoreOpportunity(
  inputs({ exposure: m(0.35), tightening: m(0.7), recognition: m(0.3) }),
);
check(
  "crowded mega-cap ranks below obscure mid-cap",
  midcap.longScore > megacap.longScore,
  `(${midcap.longScore.toFixed(4)} vs ${megacap.longScore.toFixed(4)})`,
);

// Multiplication must collapse on any single dead term.
const noExposure = scoreOpportunity(inputs({ exposure: m(0) }));
check("zero exposure collapses score", noExposure.longScore === 0);

const fullyPriced = scoreOpportunity(inputs({ recognition: m(1.0) }));
check("fully recognised collapses long score", fullyPriced.longScore === 0);

// The sign is what makes it work on both sides.
const easing = scoreOpportunity(
  inputs({ tightening: m(-0.7), recognition: m(0.9) }),
);
check("easing constraint produces zero long", easing.longScore === 0);
check("easing + high recognition produces a short", easing.shortScore > 0);

const tighteningCase = scoreOpportunity(inputs({ tightening: m(0.7) }));
check(
  "tightening constraint produces zero short",
  tighteningCase.shortScore === 0,
);

console.log("\ndivergence term");

const estimatesFlat = scoreOpportunity(
  inputs({ tightening: m(0.8), estimateRevision: m(0.0) }),
);
const estimatesRipping = scoreOpportunity(
  inputs({ tightening: m(0.8), estimateRevision: m(0.9) }),
);
check(
  "tightening with flat estimates beats tightening already in consensus",
  estimatesFlat.longScore > estimatesRipping.longScore,
  `(${estimatesFlat.longScore.toFixed(4)} vs ${estimatesRipping.longScore.toFixed(4)})`,
);
check(
  "flags when estimates lead the physical read",
  estimatesRipping.flags.includes("estimates_ahead_of_physical"),
);

const noCoverage = scoreOpportunity(inputs({ estimateRevision: null }));
check(
  "missing estimate coverage is neutral, not penalised",
  noCoverage.components.divergenceMultiplier === 1.0,
);
check(
  "missing coverage is flagged",
  noCoverage.flags.includes("no_estimate_coverage"),
);

console.log("\ncapture gate");

const cannotReprice = scoreOpportunity(inputs({ capture: m(0.1) }));
const canReprice = scoreOpportunity(inputs({ capture: m(0.9) }));
check(
  "weak capture demotes but does not zero",
  cannotReprice.longScore > 0 && cannotReprice.longScore < canReprice.longScore,
);
check(
  "flags shortage not reaching the P&L",
  cannotReprice.flags.includes("shortage_not_reaching_pnl"),
);

console.log("\nconfidence stays orthogonal to score");

const shaky = scoreOpportunity(
  inputs({
    exposure: m(0.35, 0.2),
    tightening: m(0.7, 0.3),
    recognition: m(0.3, 0.4),
  }),
);
const solid = scoreOpportunity(
  inputs({
    exposure: m(0.35, 0.95),
    tightening: m(0.7, 0.95),
    recognition: m(0.3, 0.95),
  }),
);
check(
  "identical values give identical scores regardless of confidence",
  Math.abs(shaky.longScore - solid.longScore) < 1e-9,
);
check("but confidence differs", shaky.confidence < solid.confidence);
check(
  "low confidence surfaces as a research task",
  shaky.flags.includes("low_confidence_research_task"),
);

// One bad input should drag, not be averaged away.
const oneBadInput = scoreOpportunity(
  inputs({
    exposure: m(0.35, 0.05),
    tightening: m(0.7, 0.95),
    recognition: m(0.3, 0.95),
  }),
);
check(
  "geometric mean lets one weak input drag confidence down",
  oneBadInput.confidence < 0.5,
  `(${oneBadInput.confidence.toFixed(3)})`,
);

console.log("\nobscure-but-immaterial trap");

const trivial = scoreOpportunity(
  inputs({ exposure: m(0.05), recognition: m(0.05) }),
);
check(
  "flags names nobody covers because nobody should",
  trivial.flags.includes("obscure_but_immaterial"),
);

console.log("\npoint-in-time selection");

const rows = [
  { knownAt: new Date("2026-01-15"), v: "q4" },
  { knownAt: new Date("2026-04-20"), v: "q1" },
  { knownAt: new Date("2026-07-22"), v: "q2" },
];
check(
  "picks latest knowable row",
  asKnownAt(rows, new Date("2026-05-01"))?.v === "q1",
);
check(
  "never returns a row from the future",
  asKnownAt(rows, new Date("2026-02-01"))?.v === "q4",
);
check(
  "returns null before any data existed",
  asKnownAt(rows, new Date("2025-12-01")) === null,
);

console.log("\ncorrelation guard");
const a = [0.1, 0.3, 0.5, 0.7, 0.9];
check("detects perfect correlation", Math.abs(pearson(a, a) - 1) < 1e-9);
check(
  "detects inverse correlation",
  Math.abs(pearson(a, [...a].reverse()) + 1) < 1e-9,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
