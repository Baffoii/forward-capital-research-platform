import {
  scoreCandidate,
  buildDigest,
  recognitionShift,
  weekStart,
  DIGEST_CAP,
  type DigestCandidate,
  type CompanyStance,
} from "./materiality.ts";

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

const WHEN = new Date("2026-07-29T12:00:00Z");

function candidate(over: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    id: "e1",
    kind: "filing_published",
    companyId: 1,
    ticker: "VRT",
    headline: "Vertiv filed a 10-Q",
    detail: null,
    payload: {},
    knownAt: WHEN,
    ...over,
  };
}

const OWNED: CompanyStance = { owned: true, weightPct: 4.5 };
const UNOWNED: CompanyStance = { owned: false };
const WATCHED: CompanyStance = { owned: false, watched: true };

/* ------------------------------------------------------------------ */
group("ownership does most of the suppression");

const cfoUnowned = scoreCandidate(
  candidate({ headline: "Acme names a new CFO", kind: "signal_recorded" }),
  UNOWNED,
);
const contractOwned = scoreCandidate(
  candidate({
    headline: "Vertiv filed a 10-Q",
    detail: "Language on price escalators in long-term contracts changed.",
  }),
  OWNED,
);

check(
  "a CFO change at a name we don't own scores near nothing",
  cfoUnowned.materiality < 0.1,
  String(cfoUnowned.materiality),
);

check(
  "a contract-language change at a name we do own scores high",
  // This is the case the whole ranking exists to get right: it reads as a
  // routine filing and it's the thing the investment case turns on.
  contractOwned.materiality > 0.8,
  String(contractOwned.materiality),
);

check(
  "and the second beats the first by a wide margin",
  contractOwned.materiality > cfoUnowned.materiality * 8,
);

check(
  "the same event scores higher at a name we own than one we don't",
  scoreCandidate(candidate(), OWNED).materiality >
    scoreCandidate(candidate(), UNOWNED).materiality,
);

check(
  "a watchlist name sits between the two",
  (() => {
    const watched = scoreCandidate(candidate(), WATCHED).materiality;
    return (
      watched > scoreCandidate(candidate(), UNOWNED).materiality &&
      watched < scoreCandidate(candidate(), OWNED).materiality
    );
  })(),
);

check(
  "a bigger position lifts the score",
  scoreCandidate(candidate(), { owned: true, weightPct: 8 }).materiality >
    scoreCandidate(candidate(), { owned: true, weightPct: 0.5 }).materiality,
);

check(
  "the reason is stated in plain language, not a number",
  scoreCandidate(candidate(), OWNED).reasons.some((r) => r.startsWith("We own it")),
);

/* ------------------------------------------------------------------ */
group("language that means the shortage reaches the P&L");

for (const term of ["fixed-price", "escalator", "backlog", "take-or-pay", "gross margin"]) {
  check(
    `"${term}" lifts a filing`,
    scoreCandidate(candidate({ detail: `Discussion of ${term} terms.` }), OWNED).materiality >
      scoreCandidate(candidate(), OWNED).materiality,
  );
}

check(
  "the match is case-insensitive",
  scoreCandidate(candidate({ detail: "FIXED-PRICE contracts" }), OWNED).materiality >
    scoreCandidate(candidate(), OWNED).materiality,
);

check(
  "it says which phrase it spotted",
  scoreCandidate(candidate({ detail: "escalator clauses removed" }), OWNED).reasons.some(
    (r) => r.includes("escalator"),
  ),
);

check(
  "an excerpt in the payload is searched too",
  scoreCandidate(
    candidate({ payload: { excerpt: "substantially all backlog is fixed price" } }),
    OWNED,
  ).materiality > scoreCandidate(candidate(), OWNED).materiality,
);

/* ------------------------------------------------------------------ */
group("rising recognition — the exit signal nobody instruments");

check(
  "more analysts counts",
  recognitionShift({ analystCount: 4 }, { analystCount: 7 }).rising,
);

check(
  "the FIRST themed fund is the loud one",
  // Somebody built an index that classifies this company as part of the theme.
  // That's the market connecting the dots we connected first.
  recognitionShift({ thematicEtfCount: 0 }, { thematicEtfCount: 1 }).strength >
    recognitionShift({ thematicEtfCount: 3 }, { thematicEtfCount: 4 }).strength,
);

check(
  "the company talking about data centres itself counts",
  recognitionShift({ themeMentionDensity: 1.0 }, { themeMentionDensity: 2.4 }).rising,
);

check(
  "a small wobble in mention density does not",
  !recognitionShift({ themeMentionDensity: 1.0 }, { themeMentionDensity: 1.1 }).rising,
);

check(
  "going from 3 analysts to 5 is a bigger deal than 30 to 32",
  recognitionShift({ analystCount: 3 }, { analystCount: 5 }).strength >
    recognitionShift({ analystCount: 30 }, { analystCount: 32 }).strength,
);

check(
  "falling coverage is not 'rising'",
  !recognitionShift({ analystCount: 9 }, { analystCount: 6 }).rising,
);

check(
  "missing readings mean no signal, not a false one",
  !recognitionShift(null, { analystCount: 9 }).rising &&
    !recognitionShift({ analystCount: null }, { analystCount: null }).rising,
);

const exitItem = scoreCandidate(
  candidate({
    kind: "recognition_change",
    headline: "Vertiv is getting noticed",
    payload: {
      recognitionShift: recognitionShift(
        { analystCount: 4, thematicEtfCount: 0 },
        { analystCount: 7, thematicEtfCount: 1 },
      ),
    },
  }),
  OWNED,
);

check("rising recognition on an owned name is flagged as an exit signal", exitItem.isExitSignal);

check(
  "and scores high enough to make five slots",
  exitItem.materiality > 0.75,
  String(exitItem.materiality),
);

check(
  "it says out loud that this means trim, not confirm",
  // The whole reason this is in the digest: it reads as good news.
  exitItem.reasons.some((r) => r.includes("thesis completing")),
);

check(
  "rising recognition on a name we DON'T own is not an exit signal",
  !scoreCandidate(
    candidate({
      kind: "recognition_change",
      payload: { recognitionShift: recognitionShift({ analystCount: 4 }, { analystCount: 9 }) },
    }),
    UNOWNED,
  ).isExitSignal,
);

/* ------------------------------------------------------------------ */
group("the cap, and saying what got cut");

const many = Array.from({ length: 12 }, (_, i) =>
  scoreCandidate(
    candidate({ id: `e${i}`, companyId: i, ticker: `T${i}` }),
    i < 3 ? OWNED : UNOWNED,
  ),
);

check("never more than five", buildDigest(many).items.length === DIGEST_CAP);

check(
  "highest materiality first",
  (() => {
    const items = buildDigest(many).items;
    return items.every((item, i) => i === 0 || items[i - 1].materiality >= item.materiality);
  })(),
);

check(
  "one item per company — three filings from one name don't crowd out three names",
  buildDigest([
    scoreCandidate(candidate({ id: "a", companyId: 1 }), OWNED),
    scoreCandidate(candidate({ id: "b", companyId: 1 }), OWNED),
    scoreCandidate(candidate({ id: "c", companyId: 1 }), OWNED),
    scoreCandidate(candidate({ id: "d", companyId: 2 }), OWNED),
  ]).items.length === 2,
);

check(
  "what was cut is counted, not hidden",
  // A digest that silently drops things reads as "nothing else happened",
  // which is a lie.
  buildDigest(many).suppressed === 7,
  String(buildDigest(many).suppressed),
);

check(
  "and summarised in plain language",
  buildDigest(many).suppressedSummary?.includes("names we don't own") === true,
  String(buildDigest(many).suppressedSummary),
);

check(
  "nothing cut means nothing to report",
  buildDigest([scoreCandidate(candidate(), OWNED)]).suppressedSummary === null,
);

check("an empty week produces an empty digest, not a crash", buildDigest([]).items.length === 0);

check(
  "events with no company still rank",
  buildDigest([
    scoreCandidate(candidate({ companyId: null, kind: "constraint_state_change" }), UNOWNED),
  ]).items.length === 1,
);

/* ------------------------------------------------------------------ */
group("the week window");

check(
  "a Wednesday belongs to the Sunday before it",
  weekStart(new Date("2026-07-29T12:00:00Z")).toISOString() === "2026-07-26T00:00:00.000Z",
);

check(
  "a Sunday is its own week start",
  weekStart(new Date("2026-07-26T23:59:00Z")).toISOString() === "2026-07-26T00:00:00.000Z",
);

check(
  "two moments in the same week give the same key",
  // This is what makes a retried Sunday cron not send a second copy.
  weekStart(new Date("2026-07-27T01:00:00Z")).getTime() ===
    weekStart(new Date("2026-08-01T23:00:00Z")).getTime(),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
