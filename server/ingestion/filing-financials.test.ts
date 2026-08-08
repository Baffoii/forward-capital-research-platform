import {
  parseBacklog,
  parseGrossMargin,
  grossMarginFromXbrl,
  parseContractStructure,
  computeCapture,
} from "./filing-financials.ts";

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

console.log("\nbacklog and RPO");

const backlog = parseBacklog("Total backlog at quarter end was $4.2 billion.");
check("extracts backlog with scale", backlog[0]?.value === 4.2e9, `(got ${backlog[0]?.value})`);
check("labels it as backlog", backlog[0]?.kind === "backlog");

const rpo = parseBacklog(
  "Remaining performance obligations totaled $12,400 million as of March 31, 2026.",
);
check("extracts RPO in millions", rpo[0]?.value === 12.4e9, `(got ${rpo[0]?.value})`);
check("labels it as RPO", rpo[0]?.kind === "remaining_performance_obligation");

// RPO is a defined, audited disclosure. Backlog is a management measure with
// no standard definition that companies redefine between years.
check(
  "RPO outranks backlog on confidence",
  (rpo[0]?.confidence ?? 0) > (backlog[0]?.confidence ?? 1),
  `(${rpo[0]?.confidence} vs ${backlog[0]?.confidence})`,
);

// Comparing a segment figure against total revenue understates coverage and
// reads as a queue shortening when nothing shortened.
const partial = parseBacklog("Backlog in our Americas segment was $800 million.");
check("flags a figure scoped to a subset", partial[0]?.flags.includes("partial_scope"));
check(
  "partial scope is heavily discounted",
  (partial[0]?.confidence ?? 1) < 0.4,
  `(got ${partial[0]?.confidence})`,
);

const window = parseBacklog(
  "We expect to recognize $3,100 million of remaining performance obligations within the next twelve months.",
);
check(
  "a recognition-window figure is flagged as partial",
  window[0]?.flags.includes("partial_scope"),
);

check(
  "does not read an exclusion as a figure",
  parseBacklog("Backlog does not include unexercised options.").length === 0,
);

const both = parseBacklog(
  "Total backlog was $4.2 billion. Remaining performance obligations were $12.4 billion.",
);
check("keeps backlog and RPO as distinct facts", both.length === 2);

const repeated = parseBacklog(
  "Backlog was $4.2 billion. As noted above, backlog was $4.2 billion.",
);
check("collapses the same figure stated twice", repeated.length === 1);

console.log("\ngross margin");

check(
  "extracts a stated gross margin",
  parseGrossMargin("Gross margin was 34.2% compared with 32.1% in the prior year.")
    ?.grossMarginPct === 34.2,
);
check(
  "XBRL-computed margin is exact and outranks narrative",
  near(grossMarginFromXbrl(342, 1000)!.grossMarginPct, 34.2) &&
    grossMarginFromXbrl(342, 1000)!.confidence > 0.9,
);
check("refuses to divide by zero revenue", grossMarginFromXbrl(342, 0) === null);

console.log("\ncontract structure");

const fixedNoEsc = parseContractStructure(
  "Substantially all of our contracts are fixed-price. These contracts do not contain price escalation provisions.",
);
check("detects fixed-price contracts", fixedNoEsc.contractStructure === "fixed_price");
check("detects an explicit absence of escalators", fixedNoEsc.hasPriceEscalators === "no");
check("keeps the supporting sentences", fixedNoEsc.quotes.length >= 2);

const escalated = parseContractStructure(
  "Our long-term agreements include price escalation clauses indexed to copper and steel inputs.",
);
check("detects escalators", escalated.hasPriceEscalators === "yes");

const mixed = parseContractStructure(
  "We enter into both fixed-price and cost-plus arrangements depending on customer requirements.",
);
check("reports mixed when several structures appear", mixed.contractStructure === "mixed");

const silent = parseContractStructure("We manufacture electrical equipment.");
check("returns unknown rather than guessing", silent.contractStructure === "unknown");
check("unknown carries near-zero confidence", silent.confidence < 0.2);
check(
  "keyword counting never claims high confidence",
  fixedNoEsc.confidence <= 0.5,
  `(got ${fixedNoEsc.confidence})`,
);

console.log("\ncapture composition");

// The exact failure the capture gate exists to catch: order book swelling,
// margin flat, nothing reaching the P&L.
const cannotReprice = computeCapture({
  grossMarginPct: 30.0,
  priorGrossMarginPct: 30.1,
  contractStructure: "fixed_price",
  hasPriceEscalators: "no",
})!;
check(
  "flat margin on fixed-price with no escalators scores low",
  cannotReprice.value < 0.4,
  `(got ${cannotReprice.value})`,
);

const repricing = computeCapture({
  grossMarginPct: 34.0,
  priorGrossMarginPct: 31.0,
  contractStructure: "spot",
  hasPriceEscalators: "yes",
})!;
check(
  "expanding margin on spot pricing scores high",
  repricing.value > 0.7,
  `(got ${repricing.value})`,
);
check("repricing beats non-repricing", repricing.value > cannotReprice.value);

check(
  "margin trend outweighs contract keywords",
  computeCapture({
    grossMarginPct: 36,
    priorGrossMarginPct: 30,
    contractStructure: "fixed_price",
    hasPriceEscalators: "no",
  })!.value > 0.5,
  "six points of margin expansion is evidence; a keyword count is a prior",
);

// Not knowing is not the same as knowing it is bad. The scorer treats null as
// capture_unknown (0.85), which demotes far less than a low capture value.
check(
  "returns null when there is nothing to go on",
  computeCapture({
    grossMarginPct: null,
    priorGrossMarginPct: null,
    contractStructure: "unknown",
    hasPriceEscalators: "unknown",
  }) === null,
);

check(
  "structure alone still produces a reading, at low confidence",
  (computeCapture({
    grossMarginPct: null,
    priorGrossMarginPct: null,
    contractStructure: "fixed_price",
    hasPriceEscalators: "no",
  })?.confidence ?? 1) <= 0.3,
);

check(
  "value is always within 0..1",
  [
    computeCapture({ grossMarginPct: 90, priorGrossMarginPct: 10, contractStructure: "spot", hasPriceEscalators: "yes" })!,
    computeCapture({ grossMarginPct: 10, priorGrossMarginPct: 90, contractStructure: "fixed_price", hasPriceEscalators: "no" })!,
  ].every((r) => r.value >= 0 && r.value <= 1),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
