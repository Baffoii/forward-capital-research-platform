import {
  evaluate,
  matches,
  resolvePath,
  missingFields,
  referencedFields,
  validatePredicate,
  describePredicate,
  type Predicate,
} from "./predicate.ts";

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

/** A company we own, with a price move and a backlog reading. */
const FULL = {
  event: {
    kind: "price_move",
    companyId: 3,
    payload: { changePct: -11.4, closePrice: 88.2 },
  },
  company: { ticker: "VRT", owned: true, weightPct: 4.5 },
  capture: { backlogValue: "1950000000", grossMarginPct: 31.2, contractStructure: "fixed_price" },
  constraint: { tightening: 0.62, direction: "tightening" },
  score: { long: 0.71, confidence: 0.44 },
  recognition: { analystCount: 9, thematicEtfCount: 0 },
};

/** Same company, but we have no price feed wired up. */
const NO_PRICE = {
  event: { kind: "score_change", companyId: 3, payload: {} },
  company: { ticker: "VRT", owned: true, weightPct: 4.5 },
  score: { long: 0.71, confidence: 0.44 },
};

/* ------------------------------------------------------------------ */
group("paths");

check("resolves a nested path", resolvePath(FULL, "event.payload.changePct") === -11.4);
check("resolves a top-level path", resolvePath(FULL, "company.ticker") === "VRT");
check(
  "a missing path is missing, not undefined-equals-anything",
  evaluate({ field: "company.nonexistent", op: "eq", value: undefined }, FULL) === "unknown",
);
check(
  "walking through a non-object stops cleanly",
  evaluate({ field: "company.ticker.nope", op: "eq", value: 1 }, FULL) === "unknown",
);
check("empty path is unknown", evaluate({ field: "", op: "eq", value: 1 }, FULL) === "unknown");

/* ------------------------------------------------------------------ */
group("comparisons");

check("lte on a negative number", matches({ field: "event.payload.changePct", op: "lte", value: -8 }, FULL));
check("lte does not fire above the threshold", evaluate({ field: "event.payload.changePct", op: "lte", value: -15 }, FULL) === false);
check("gte", matches({ field: "constraint.tightening", op: "gte", value: 0.5 }, FULL));
check("lt", matches({ field: "score.confidence", op: "lt", value: 0.5 }, FULL));
check("eq on a string", matches({ field: "event.kind", op: "eq", value: "price_move" }, FULL));
check("eq on a boolean", matches({ field: "company.owned", op: "eq", value: true }, FULL));
check("ne", matches({ field: "event.kind", op: "ne", value: "filing_published" }, FULL));
check("in", matches({ field: "event.kind", op: "in", value: ["price_move", "score_change"] }, FULL));
check("nin", matches({ field: "event.kind", op: "nin", value: ["filing_published"] }, FULL));
check("contains on a string is case-insensitive", matches({ field: "capture.contractStructure", op: "contains", value: "FIXED" }, FULL));
check("exists", matches({ field: "capture.backlogValue", op: "exists" }, FULL));
check("missing", matches({ field: "capture.utilizationPct", op: "missing" }, FULL));
check("abs_gte catches a move in either direction", matches({ field: "event.payload.changePct", op: "abs_gte", value: 8 }, FULL));
check(
  "abs_gte would also catch the same move upward",
  matches({ field: "x", op: "abs_gte", value: 8 }, { x: 11.4 }),
);
check("between, inclusive at both ends", matches({ field: "score.long", op: "between", value: [0.71, 0.9] }, FULL));
check("between rejects outside the range", evaluate({ field: "score.long", op: "between", value: [0.8, 0.9] }, FULL) === false);

check(
  "a numeric stored as a string still compares as a number",
  // Postgres numeric arrives over PostgREST as a string. Comparing
  // "1950000000" to 2.1e9 as strings would be quietly, expensively wrong.
  matches({ field: "capture.backlogValue", op: "lt", value: 2_100_000_000 }, FULL),
);

check(
  "zero is a real reading, not a missing one",
  evaluate({ field: "recognition.thematicEtfCount", op: "gte", value: 1 }, FULL) === false,
);

check(
  "an explicit null is missing, not zero",
  // The failure this prevents: treating "not disclosed" as "disclosed as
  // nothing", which turns an unknown into a confident trigger.
  evaluate({ field: "x", op: "lt", value: 5 }, { x: null }) === "unknown",
);

check(
  "a non-numeric value on a numeric op is unknown, not false",
  evaluate({ field: "company.ticker", op: "lt", value: 5 }, FULL) === "unknown",
);

check(
  "an op nobody implemented is unknown, not false",
  evaluate({ field: "score.long", op: "approximately", value: 0.7 }, FULL) === "unknown",
);

/* ------------------------------------------------------------------ */
group("three-valued logic — missing data must not silently mean 'no'");

const priceRule: Predicate = {
  all: [
    { field: "company.owned", op: "eq", value: true },
    { field: "event.payload.changePct", op: "lte", value: -8 },
  ],
};

check("all clauses true fires", matches(priceRule, FULL));

check(
  "a rule that cannot be checked reports unknown, not false",
  // This is the failure the whole three-valued design exists to prevent: with
  // no price feed, a two-valued evaluator reports "no large price move" every
  // day forever, and nobody ever learns the rule stopped working.
  evaluate(priceRule, NO_PRICE) === "unknown",
);

check(
  "a definitely-false clause beats an unknown one in `all`",
  evaluate(
    {
      all: [
        { field: "company.owned", op: "eq", value: false },
        { field: "event.payload.changePct", op: "lte", value: -8 },
      ],
    },
    NO_PRICE,
  ) === false,
);

check(
  "a definitely-true clause beats an unknown one in `any`",
  evaluate(
    {
      any: [
        { field: "company.owned", op: "eq", value: true },
        { field: "event.payload.changePct", op: "lte", value: -8 },
      ],
    },
    NO_PRICE,
  ) === true,
);

check(
  "`any` with only unknowns and falses is unknown",
  evaluate(
    {
      any: [
        { field: "company.owned", op: "eq", value: false },
        { field: "event.payload.changePct", op: "lte", value: -8 },
      ],
    },
    NO_PRICE,
  ) === "unknown",
);

check("not flips true", evaluate({ not: { field: "company.owned", op: "eq", value: true } }, FULL) === false);
check("not flips false", evaluate({ not: { field: "company.owned", op: "eq", value: false } }, FULL) === true);
check(
  "not leaves unknown alone",
  evaluate({ not: { field: "event.payload.changePct", op: "lte", value: -8 } }, NO_PRICE) === "unknown",
);

check(
  "an empty `all` does not fire on everything",
  // Vacuous truth here would mean a half-written rule notifying about every
  // company every day.
  evaluate({ all: [] }, FULL) === "unknown",
);
check("an empty `any` does not fire", evaluate({ any: [] }, FULL) === "unknown");
check("nested combinators work", matches({ all: [{ any: [{ field: "event.kind", op: "eq", value: "nope" }, { field: "event.kind", op: "eq", value: "price_move" }] }, { not: { field: "company.owned", op: "eq", value: false } }] }, FULL));
check("garbage is unknown, not a crash", evaluate(null as any, FULL) === "unknown");
check("an unrecognised shape is unknown", evaluate({ nonsense: true } as any, FULL) === "unknown");

/* ------------------------------------------------------------------ */
group("compatibility with the existing kill_criteria rows");

check(
  "the { metric, op, value } shape already in the database still works",
  // shared/schema.constraints.ts documents kill criteria as
  // { metric: "constraint.tightening", op: "lt", value: 0 }. Those rows must
  // keep evaluating without being rewritten.
  evaluate({ metric: "constraint.tightening", op: "lt", value: 0 }, FULL) === false,
);

check(
  "a kill criterion that has fired evaluates true",
  matches({ metric: "constraint.tightening", op: "lt", value: 0 }, {
    constraint: { tightening: -0.2 },
  }),
);

/* ------------------------------------------------------------------ */
group("saying what could not be checked");

check(
  "reports exactly which fields were missing",
  missingFields(priceRule, NO_PRICE).join(",") === "event.payload.changePct",
  missingFields(priceRule, NO_PRICE).join(","),
);
check("no missing fields when everything resolved", missingFields(priceRule, FULL).length === 0);
check(
  "lists every field a rule reads",
  referencedFields(priceRule).join(",") === "company.owned,event.payload.changePct",
);
check("deduplicates repeated fields", referencedFields({ all: [{ field: "a", op: "gt", value: 1 }, { field: "a", op: "lt", value: 9 }] }).length === 1);

/* ------------------------------------------------------------------ */
group("catching broken rules when they're written, not six months later");

check("a good rule validates clean", validatePredicate(priceRule).length === 0);
check(
  "a typo'd op is caught",
  validatePredicate({ field: "a", op: "less_than", value: 1 })[0].problem.includes("less_than"),
);
check("a missing field is caught", validatePredicate({ op: "lt", value: 1 }).length === 1);
check(
  "a comparison with no value is caught",
  validatePredicate({ field: "a", op: "lt" }).length === 1,
);
check(
  "exists needs no value",
  validatePredicate({ field: "a", op: "exists" }).length === 0,
);
check("an empty all is caught", validatePredicate({ all: [] }).length === 1);
check(
  "between with the wrong shape is caught",
  validatePredicate({ field: "a", op: "between", value: 5 }).length === 1,
);
check(
  "problems point at where they are",
  validatePredicate({ all: [{ field: "a", op: "nope", value: 1 }] })[0].path === "predicate.all[0]",
);

/* ------------------------------------------------------------------ */
group("reading a rule back in plain language");

check(
  "describes a compound rule readably",
  describePredicate(priceRule) === 'company.owned is true and event.payload.changePct is -8 or below',
  describePredicate(priceRule),
);
check(
  "describes an either-way move",
  describePredicate({ field: "x", op: "abs_gte", value: 8 }) === "x moved by 8 or more in either direction",
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
