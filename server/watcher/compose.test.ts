import {
  composeRuleNotification,
  composeUncheckableNotification,
  humanFieldName,
} from "./compose.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  pass  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(name: string) {
  console.log(`\n${name}`);
}

const PRECOMMITMENT = composeRuleNotification({
  ruleName: "Trim 30% if backlog comes in light",
  ruleDescription:
    "If orders signed but not delivered drop below $2.1bn, trim 30%. Written when calm: below that level the shortage isn't reaching their P&L and the whole reason we own this is gone.",
  predicate: {
    all: [
      { field: "company.owned", op: "eq", value: true },
      { field: "capture.backlogValue", op: "lt", value: 2_100_000_000 },
    ],
  },
  companyName: "Vertiv Holdings",
  ticker: "VRT",
  headline: "Vertiv Holdings filed a 10-Q",
  detail: "Backlog reported at $1.95bn, down from $2.4bn last quarter.",
  context: {
    company: { owned: true, weightPct: 4.5 },
    capture: { backlogValue: "1950000000", grossMarginPct: 31.2 },
  },
  link: "https://forward-capital.example/#/companies/3",
});

/* ------------------------------------------------------------------ */
group("a notification must be actionable without opening the app");

check(
  "says which company, in the subject",
  PRECOMMITMENT.subject.includes("Vertiv Holdings") && PRECOMMITMENT.subject.includes("VRT"),
  PRECOMMITMENT.subject,
);

check("carries what happened", PRECOMMITMENT.body.includes("filed a 10-Q"));

check(
  "carries the decision already made and the reasoning already written",
  // The whole point of a pre-commitment: the thinking was done when calm, and
  // the alert has to carry it, or you re-decide in the moment — which is the
  // failure the feature exists to prevent.
  PRECOMMITMENT.body.includes("trim 30%") && PRECOMMITMENT.body.includes("Written when calm"),
);

check(
  "carries the numbers behind it",
  PRECOMMITMENT.body.includes("1.95bn"),
  PRECOMMITMENT.body,
);

check(
  "formats a big number readably rather than as raw digits",
  !PRECOMMITMENT.body.includes("1950000000"),
);

check(
  "names the numbers in plain language, not field paths",
  PRECOMMITMENT.body.includes("Orders signed but not yet delivered") &&
    !PRECOMMITMENT.body.includes("capture.backlogValue:"),
);

check(
  "states that nothing was traded",
  // Hard constraint in this repo: the system notifies, a human executes. Every
  // one of these says so, because the one that doesn't is the one that gets
  // misread.
  PRECOMMITMENT.body.includes("Nothing has been traded"),
);

check(
  "the link is extra, not load-bearing",
  PRECOMMITMENT.body.indexOf("More detail") > PRECOMMITMENT.body.indexOf("1.95bn"),
);

check(
  "works with no link at all",
  !composeRuleNotification({
    ruleName: "r",
    ruleDescription: null,
    predicate: { field: "score.long", op: "gt", value: 0.5 },
    companyName: "Acme",
    ticker: null,
    context: { score: { long: 0.8 } },
  }).body.includes("More detail"),
);

check(
  "a company with no ticker still reads properly",
  composeRuleNotification({
    ruleName: "r",
    ruleDescription: null,
    predicate: { field: "score.long", op: "gt", value: 0.5 },
    companyName: "Acme",
    ticker: null,
    context: {},
  }).subject === "Acme — r",
);

/* ------------------------------------------------------------------ */
group("partial data is admitted, not hidden");

const PARTIAL = composeRuleNotification({
  ruleName: "Big price move on a name we own",
  ruleDescription: null,
  predicate: {
    all: [
      { field: "company.owned", op: "eq", value: true },
      { field: "event.payload.changePct", op: "abs_gte", value: 8 },
    ],
  },
  companyName: "Acme",
  ticker: "ACM",
  context: { company: { owned: true } },
});

check(
  "says what it could not check",
  PARTIAL.body.includes("Couldn't check") && PARTIAL.body.includes("Price move"),
  PARTIAL.body,
);

check("tells the reader to treat it as partial", PARTIAL.body.includes("partial"));

check(
  "a missing value reads as 'not recorded', not as zero",
  PARTIAL.body.includes("not recorded"),
);

/* ------------------------------------------------------------------ */
group("a rule that stopped being checkable is louder than silence");

const UNCHECKABLE = composeUncheckableNotification({
  ruleName: "Backlog falls below $2.1bn",
  companyName: "Vertiv Holdings",
  ticker: "VRT",
  predicate: { field: "capture.backlogValue", op: "lt", value: 2_100_000_000 },
  missing: ["capture.backlogValue"],
});

check("subject says it can't be checked", UNCHECKABLE.subject.startsWith("Can't check"));
check(
  "distinguishes 'nobody is watching' from 'nothing happened'",
  UNCHECKABLE.body.includes('not "nothing happened"'),
);
check(
  "asks for a decision rather than just reporting",
  UNCHECKABLE.body.includes("wire up the data or retire the rule"),
);
check(
  "names the missing data in plain language",
  UNCHECKABLE.body.includes("Orders signed but not yet delivered"),
);

/* ------------------------------------------------------------------ */
group("field naming");

check(
  "known fields get a plain-language name",
  humanFieldName("capture.grossMarginPct") === "Gross margin (%)",
);
check(
  "unknown fields fall back to the path rather than blank",
  humanFieldName("something.new") === "something.new",
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
