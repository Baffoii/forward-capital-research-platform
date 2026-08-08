import {
  stripMarkup,
  splitSentences,
  parseCustomerConcentration,
  parseSegmentRevenue,
  parseEndDemandShare,
  resolveCompanyByName,
} from "./edgar-extract.ts";

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

console.log("\ntext normalisation");

check(
  "strips tags and collapses whitespace",
  stripMarkup("<p>Net   sales<br/> were <b>$1.2</b> billion.</p>") ===
    "Net sales were $1.2 billion.",
  `(got "${stripMarkup("<p>Net   sales<br/> were <b>$1.2</b> billion.</p>")}")`,
);

check(
  "drops script and style bodies entirely",
  !stripMarkup("<style>p{color:red}</style><p>Revenue.</p>").includes("color"),
);

// Filings are full of "Inc." and "10.5%". Splitting on either shreds the
// sentence the quote is supposed to preserve.
const sentences = splitSentences(
  "Sales to Dell Technologies Inc. were 10.5% of revenue. No other customer exceeded 10%.",
);
check("does not split on a corporate suffix", sentences.length === 2, `(got ${sentences.length})`);
check(
  "does not split on a decimal",
  sentences[0] === "Sales to Dell Technologies Inc. were 10.5% of revenue.",
  `(got "${sentences[0]}")`,
);

console.log("\ncustomer concentration");

const named = parseCustomerConcentration(
  "During fiscal 2026, sales to our largest customer, Microsoft Corporation, accounted for 23% of net revenues.",
);
check("extracts a named customer", named.length === 1 && named[0].customerName === "Microsoft Corporation", `(got ${JSON.stringify(named[0]?.customerName)})`);
check("extracts the share as a fraction", named[0]?.revenueShare === 0.23);
check("named disclosure carries high confidence", named[0]?.confidence === 0.9);
check(
  "preserves the sentence verbatim",
  named[0]?.quote.includes("Microsoft Corporation, accounted for 23%"),
);

// The disclosure rule requires the amount, not the name. Most filings look
// like this, and treating it as named would fabricate a graph edge.
const anon = parseCustomerConcentration(
  "One customer accounted for approximately 18% of total revenues in fiscal 2026.",
);
check("extracts an anonymous disclosure", anon.length === 1 && anon[0].customerName === null);
check("records the anonymous label", anon[0]?.anonymousLabel === "One customer");
check(
  "anonymous disclosure is flagged as unresolvable",
  anon[0]?.flags.includes("customer_not_named"),
);
check(
  "anonymous confidence is materially lower than named",
  (anon[0]?.confidence ?? 1) <= 0.5,
);
check("flags an approximate figure", anon[0]?.flags.includes("approximate_figure"));

// The single most damaging false positive available: this sentence contains
// a customer cue, a revenue cue, and "10%".
const negated = parseCustomerConcentration(
  "No customer accounted for more than 10% of our net revenues during fiscal 2026.",
);
check("does not invent an edge from a negative disclosure", negated.length === 0, `(got ${negated.length})`);

const negated2 = parseCustomerConcentration(
  "No single customer represented 10% or more of total sales.",
);
check("handles the 'no single customer' phrasing", negated2.length === 0);

const multiYear = parseCustomerConcentration(
  "Sales to Vertiv Holdings Co accounted for 21%, 14% and 11% of net sales in fiscal 2026, 2025 and 2024, respectively.",
);
check(
  "multi-period sentence is flagged rather than silently taking one",
  multiYear[0]?.flags.includes("multiple_periods_in_sentence"),
);
check(
  "multi-period ambiguity discounts confidence",
  (multiYear[0]?.confidence ?? 1) < 0.9,
  `(got ${multiYear[0]?.confidence})`,
);

const belowThreshold = parseCustomerConcentration(
  "One customer accounted for 4% of net revenues.",
);
check("ignores shares below the disclosure threshold", belowThreshold.length === 0);

// The same disclosure appears in risk factors, MD&A, and the notes.
const repeated = parseCustomerConcentration(
  "One customer accounted for 18% of total revenues. " +
    "As disclosed above, one customer accounted for 18% of total revenues.",
);
check("deduplicates the same fact stated twice", repeated.length === 1, `(got ${repeated.length})`);

const two = parseCustomerConcentration(
  "Customer A accounted for 22% of net sales. Customer B accounted for 13% of net sales.",
);
check("extracts multiple distinct customers", two.length === 2);
check(
  "sorts by share, largest first",
  two[0].revenueShare === 0.22 && two[1].revenueShare === 0.13,
);

console.log("\nsegment revenue");

const seg = parseSegmentRevenue(
  "Revenue from our Electrical Equipment segment was $4,200 million, or 60% of total net sales.",
);
check("extracts a segment name", seg[0]?.segmentName === "Electrical Equipment", `(got ${JSON.stringify(seg[0]?.segmentName)})`);
check("extracts the absolute value with scale", seg[0]?.value === 4.2e9, `(got ${seg[0]?.value})`);
check("extracts the stated share of total", seg[0]?.shareOfTotal === 0.6);
check(
  "narrative segment parsing is capped at low confidence",
  (seg[0]?.confidence ?? 1) <= 0.55,
);

const derived = parseSegmentRevenue(
  "Our Power Systems segment generated revenues of $2,500 million during fiscal 2026.",
  { totalRevenue: 10e9 },
);
check(
  "derives a share from total revenue when none is stated",
  derived[0]?.shareOfTotal === 0.25,
  `(got ${derived[0]?.shareOfTotal})`,
);
check(
  "flags a derived share as derived",
  derived[0]?.flags.includes("share_derived_from_total"),
);

console.log("\nend-demand attribution");

const stated = parseEndDemandShare(
  "Data center customers represented approximately 45% of segment demand in fiscal 2026.",
);
check("finds an end-demand share the filer states", stated?.share === 0.45);
check(
  "a stated end-demand share beats a default but is not a disclosure",
  stated !== null && stated.confidence > 0.3 && stated.confidence < 0.9,
  `(got ${stated?.confidence})`,
);
check("records the basis", stated?.basis === "stated_in_filing");

check(
  "returns null when the filing says nothing about data centre demand",
  parseEndDemandShare("Our products are sold through distributors worldwide.") === null,
);

console.log("\ncounterparty resolution");

const roster = [
  { id: 1, name: "Vertiv Holdings Co" },
  { id: 2, name: "Eaton Corporation plc" },
  { id: 3, name: "Applied Materials, Inc." },
  { id: 4, name: "Applied Digital Corporation" },
];

check(
  "matches across differing legal suffixes",
  resolveCompanyByName(roster, "Vertiv Holdings, Inc.")?.id === 1,
);
check("matches an exact name", resolveCompanyByName(roster, "Eaton Corporation plc")?.id === 2);

// A wrong match silently corrupts every derived exposure downstream, so an
// ambiguous prefix must resolve to nothing rather than to a coin flip.
check(
  "refuses an ambiguous prefix rather than guessing",
  resolveCompanyByName(roster, "Applied") === null,
);
check(
  "still resolves the unambiguous longer name",
  resolveCompanyByName(roster, "Applied Materials")?.id === 3,
);
check("returns null for an unknown counterparty", resolveCompanyByName(roster, "Siemens Energy AG") === null);
check("rejects a name too short to be distinctive", resolveCompanyByName(roster, "AB") === null);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
