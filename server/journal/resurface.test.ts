import {
  resurfacingFor,
  rankResurfacings,
  distanceToTrigger,
  isNearTrigger,
  summarizeCalibration,
  KILL_CRITERION_NEAR_BAND,
  REVIEW_COOLDOWN_DAYS,
  type JournalEntryLike,
  type KillCriterionReading,
  type WorldEventLike,
} from "./resurface.ts";

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

const NOW = new Date("2026-08-02T12:00:00Z");
const days = (n: number) => n * 86_400_000;
const ago = (n: number) => new Date(NOW.getTime() - days(n));

const ENTRY: JournalEntryLike = {
  id: "entry-1",
  companyId: 3,
  ticker: "VRT",
  authorEmail: "maasg@stanford.edu",
  expectBy: null,
  status: "open",
  createdAt: ago(200),
};

function ctx(over: Partial<Parameters<typeof resurfacingFor>[1]> = {}) {
  return {
    now: NOW,
    lastReviewedAt: ago(30),
    recentEvents: [] as WorldEventLike[],
    killCriteria: [] as KillCriterionReading[],
    ...over,
  };
}

function event(over: Partial<WorldEventLike>): WorldEventLike {
  return {
    id: "we-1",
    kind: "price_move",
    companyId: 3,
    headline: "something happened",
    payload: {},
    knownAt: ago(1),
    ...over,
  };
}

function criterion(over: Partial<KillCriterionReading>): KillCriterionReading {
  return {
    id: "kc-1",
    statement: "Backlog falls below $2.1bn",
    op: "lt",
    threshold: 2_100_000_000,
    actual: 3_000_000_000,
    status: "armed",
    ...over,
  };
}

/* ------------------------------------------------------------------ */
group("how close is a kill criterion to firing");

check(
  "a 'below X' criterion is close when the value is just above X",
  isNearTrigger(criterion({ actual: 2_300_000_000 })), // ~9.5% above
);

check(
  "and not close when it's comfortably above",
  !isNearTrigger(criterion({ actual: 3_000_000_000 })), // ~43% above
);

check(
  "an 'above X' criterion mirrors it",
  isNearTrigger(
    criterion({ op: "gt", threshold: 100, actual: 92 }), // 8% below
  ),
);

check(
  "a criterion that has already fired is not 'near'",
  // Firing is the watcher's job, not resurfacing's. Reporting it here too
  // would mean two notifications about the same fact.
  distanceToTrigger(criterion({ actual: 1_900_000_000 })) === null,
);

check(
  "no reading means unknown, not 'not close'",
  // The failure this prevents: losing the data feed silently downgrades a
  // criterion to "fine" forever.
  distanceToTrigger(criterion({ actual: null })) === null,
);

check(
  "a non-numeric operator can't be measured for nearness",
  distanceToTrigger(criterion({ op: "contains" })) === null,
);

check(
  "a zero threshold can't be measured either",
  // 15% of zero is zero — every value would read as infinitely far away.
  distanceToTrigger(criterion({ threshold: 0, actual: 5 })) === null,
);

check(
  "the band boundary is inclusive",
  isNearTrigger(criterion({ op: "gt", threshold: 100, actual: 100 - KILL_CRITERION_NEAR_BAND * 100 })),
);

/* ------------------------------------------------------------------ */
group("what triggers a resurfacing");

check(
  "nearly-falsified beats everything else",
  // The most valuable moment to reread what you said would change your mind
  // is just before it happens.
  resurfacingFor(ENTRY, ctx({
    killCriteria: [criterion({ actual: 2_200_000_000 })],
    recentEvents: [event({ kind: "earnings_reported" })],
  }))?.triggerKind === "kill_criterion_near",
);

check(
  "the reason quotes what they actually wrote",
  resurfacingFor(ENTRY, ctx({ killCriteria: [criterion({ actual: 2_200_000_000 })] }))
    ?.reason.includes("Backlog falls below $2.1bn") === true,
);

check(
  "earnings resurfaces it",
  resurfacingFor(ENTRY, ctx({ recentEvents: [event({ kind: "earnings_reported" })] }))
    ?.triggerKind === "earnings",
);

check(
  "a large price move resurfaces it",
  resurfacingFor(ENTRY, ctx({
    recentEvents: [event({ kind: "price_move", payload: { changePct: -22 } })],
  }))?.triggerKind === "price_move",
);

check(
  "a small price move does not",
  resurfacingFor(ENTRY, ctx({
    recentEvents: [event({ kind: "price_move", payload: { changePct: -4 } })],
  })) === null,
);

check(
  "a large move upward counts too",
  // Being right for the wrong reason is worth catching as much as being wrong.
  resurfacingFor(ENTRY, ctx({
    recentEvents: [event({ kind: "price_move", payload: { changePct: 30 } })],
  }))?.triggerKind === "price_move",
);

check(
  "a price move with no percentage in the payload is ignored, not crashed on",
  resurfacingFor(ENTRY, ctx({ recentEvents: [event({ kind: "price_move" })] })) === null,
);

check(
  "the biggest move wins when several arrive",
  (resurfacingFor(ENTRY, ctx({
    recentEvents: [
      event({ id: "a", kind: "price_move", payload: { changePct: -16 } }),
      event({ id: "b", kind: "price_move", payload: { changePct: 31 } }),
    ],
  }))?.payload as any)?.changePct === 31,
);

check(
  "a passed expectation date resurfaces it",
  resurfacingFor({ ...ENTRY, expectBy: ago(3) }, ctx())?.triggerKind === "expectation_due",
);

check(
  "a future expectation date does not",
  resurfacingFor(
    { ...ENTRY, expectBy: new Date(NOW.getTime() + days(30)) },
    ctx(),
  ) === null,
);

check(
  "an entry nobody has read in a quarter resurfaces on its own",
  resurfacingFor(ENTRY, ctx({ lastReviewedAt: ago(120) }))?.triggerKind === "scheduled",
);

check(
  "a never-reviewed entry ages from when it was written",
  resurfacingFor({ ...ENTRY, createdAt: ago(120) }, ctx({ lastReviewedAt: null }))
    ?.triggerKind === "scheduled",
);

check(
  "a recently written, never-reviewed entry is left alone",
  resurfacingFor({ ...ENTRY, createdAt: ago(5) }, ctx({ lastReviewedAt: null })) === null,
);

/* ------------------------------------------------------------------ */
group("not becoming noise");

check(
  "an entry reviewed two days ago is not asked about again",
  // The one failure mode that makes this whole feature worthless is becoming
  // something people click past.
  resurfacingFor(ENTRY, ctx({
    lastReviewedAt: ago(2),
    recentEvents: [event({ kind: "earnings_reported" })],
    killCriteria: [criterion({ actual: 2_200_000_000 })],
  })) === null,
);

check(
  "the cooldown expires",
  resurfacingFor(ENTRY, ctx({
    lastReviewedAt: ago(REVIEW_COOLDOWN_DAYS + 1),
    recentEvents: [event({ kind: "earnings_reported" })],
  })) !== null,
);

check(
  "a closed position is never resurfaced",
  resurfacingFor({ ...ENTRY, status: "closed" }, ctx({
    killCriteria: [criterion({ actual: 2_200_000_000 })],
  })) === null,
);

check(
  "events from before the last review don't re-trigger",
  // Otherwise the same earnings report resurfaces the entry every week
  // forever.
  resurfacingFor(ENTRY, ctx({
    lastReviewedAt: ago(10),
    recentEvents: [event({ kind: "earnings_reported", knownAt: ago(40) })],
  })) === null,
);

check(
  "a retired kill criterion doesn't trigger",
  resurfacingFor(ENTRY, ctx({
    killCriteria: [criterion({ actual: 2_200_000_000, status: "retired" })],
  })) === null,
);

check(
  "most urgent first",
  rankResurfacings([
    { entryId: "a", triggerKind: "scheduled", reason: "", urgency: 10, payload: {} },
    { entryId: "b", triggerKind: "kill_criterion_near", reason: "", urgency: 95, payload: {} },
  ])[0].entryId === "b",
);

/* ------------------------------------------------------------------ */
group("calibration — team level, never individual");

const REVIEWS = [
  { entryId: "1", stillAgree: "yes", triggerKind: "earnings", createdAt: NOW },
  { entryId: "2", stillAgree: "no", triggerKind: "kill_criterion_near", createdAt: NOW },
  { entryId: "3", stillAgree: "partly", triggerKind: "price_move", createdAt: NOW },
  { entryId: "4", stillAgree: "yes", triggerKind: "earnings", createdAt: NOW },
];

check("counts each answer", (() => {
  const s = summarizeCalibration(REVIEWS);
  return s.stillAgree === 2 && s.changedMind === 1 && s.partly === 1;
})());

check(
  "'partly' counts as half rather than being thrown away",
  // Dropping the middle answer would make the team look more decisive than
  // it actually was.
  summarizeCalibration(REVIEWS).heldUpRate === 0.625,
  String(summarizeCalibration(REVIEWS).heldUpRate),
);

check(
  "no reviews means no rate, not a rate of zero",
  summarizeCalibration([]).heldUpRate === null,
);

check(
  "records which trigger caught the changed minds",
  // The interesting question isn't how often we were wrong — it's which
  // signal notices first.
  summarizeCalibration(REVIEWS).changedMindByTrigger["kill_criterion_near"] === 1,
);

check(
  "an unrecognised answer is counted but not scored",
  summarizeCalibration([
    { entryId: "1", stillAgree: "shrug", triggerKind: "earnings", createdAt: NOW },
  ]).heldUpRate === null,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
