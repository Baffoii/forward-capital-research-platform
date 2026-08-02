import {
  sessionIdForNewEvent,
  previousSessionEnd,
  daysAway,
  openItems,
  lastLookedAtByCompany,
  passedOnByCompany,
  knownBetween,
  SESSION_GAP_MS,
  type HumanEventLike,
} from "./log-queries.ts";

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

const T0 = new Date("2026-07-01T12:00:00Z");
const minutes = (n: number) => n * 60 * 1000;
const days = (n: number) => n * 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

let counter = 0;
const nextId = () => `session-${++counter}`;

function evt(over: Partial<HumanEventLike> & { occurredAt: Date }): HumanEventLike {
  return {
    id: `e${Math.random()}`,
    userId: "user-a",
    userEmail: "maasg@stanford.edu",
    sessionId: "s1",
    kind: "viewed_company",
    summary: "looked at something",
    ...over,
  };
}

/* ------------------------------------------------------------------ */
group("sessions — which visit does this belong to");

check(
  "a person with no history starts a new session",
  sessionIdForNewEvent(null, T0, nextId).startsWith("session-"),
);

check(
  "a click two minutes later is the same session",
  sessionIdForNewEvent(
    { sessionId: "s-existing", occurredAt: at(0) },
    at(minutes(2)),
    nextId,
  ) === "s-existing",
);

check(
  "a click just inside the gap is still the same session",
  sessionIdForNewEvent(
    { sessionId: "s-existing", occurredAt: at(0) },
    at(SESSION_GAP_MS - 1000),
    nextId,
  ) === "s-existing",
);

check(
  "a click just past the gap starts a new session",
  sessionIdForNewEvent(
    { sessionId: "s-existing", occurredAt: at(0) },
    at(SESSION_GAP_MS + 1000),
    nextId,
  ) !== "s-existing",
);

check(
  "coming back eleven days later is a new session",
  sessionIdForNewEvent(
    { sessionId: "s-existing", occurredAt: at(0) },
    at(days(11)),
    nextId,
  ) !== "s-existing",
);

check(
  "an out-of-order write does not merge two visits a week apart",
  // The failure this prevents: clock skew making `now` earlier than the last
  // event, so a naive gap check reads as "0 minutes ago, same session" and
  // silently glues a week-old visit onto today's.
  sessionIdForNewEvent(
    { sessionId: "s-existing", occurredAt: at(days(7)) },
    at(0),
    nextId,
  ) !== "s-existing",
);

/* ------------------------------------------------------------------ */
group("previous session end — the anchor for 'since you last looked'");

const twoVisits = [
  // newest first, as the store returns them
  evt({ sessionId: "s2", occurredAt: at(days(11) + minutes(5)) }),
  evt({ sessionId: "s2", occurredAt: at(days(11)) }),
  evt({ sessionId: "s1", occurredAt: at(minutes(20)) }),
  evt({ sessionId: "s1", occurredAt: at(0) }),
];

check(
  "returns the end of the previous visit, not the start of this one",
  previousSessionEnd(twoVisits, "s2")?.getTime() === at(minutes(20)).getTime(),
  String(previousSessionEnd(twoVisits, "s2")),
);

check(
  "first ever visit has no anchor",
  previousSessionEnd(
    [evt({ sessionId: "s1", occurredAt: at(0) })],
    "s1",
  ) === null,
);

check(
  "clicking twice in one visit does not move the anchor",
  // The failure this prevents: anchoring on "my newest event" means the second
  // click of a session reports nothing changed since the first click, and the
  // briefing goes blank while you're reading it.
  previousSessionEnd(
    [
      evt({ sessionId: "s2", occurredAt: at(days(11) + minutes(9)) }),
      ...twoVisits,
    ],
    "s2",
  )?.getTime() === at(minutes(20)).getTime(),
);

check("days away rounds down to whole days", daysAway(at(0), at(days(11) + minutes(30))) === 11);
check("days away is null when never seen", daysAway(null, T0) === null);
check("days away is never negative", daysAway(at(days(1)), at(0)) === 0);

/* ------------------------------------------------------------------ */
group("open items — what is still hanging");

const handoffOpened = evt({
  kind: "handed_off",
  subjectType: "handoff_packet",
  subjectId: "p1",
  summary: "handed VRT digging to rchen23",
  occurredAt: at(0),
});

check(
  "an unanswered handoff is open",
  openItems([handoffOpened], at(days(3))).length === 1,
);

check(
  "accepting a handoff does NOT close it",
  // This is the failure the whole feature exists to prevent: everyone assumes
  // someone else has it. Accepted work is still outstanding work.
  openItems(
    [
      handoffOpened,
      evt({
        kind: "accepted_handoff",
        subjectType: "handoff_packet",
        subjectId: "p1",
        occurredAt: at(minutes(30)),
      }),
    ],
    at(days(3)),
  ).length === 1,
);

check(
  "finishing a handoff closes it",
  openItems(
    [
      handoffOpened,
      evt({
        kind: "closed_handoff",
        subjectType: "handoff_packet",
        subjectId: "p1",
        occurredAt: at(days(1)),
      }),
    ],
    at(days(3)),
  ).length === 0,
);

check(
  "deciding it isn't worth more time closes a question",
  openItems(
    [
      evt({
        kind: "opened_question",
        subjectType: "question",
        subjectId: "q1",
        occurredAt: at(0),
      }),
      evt({
        kind: "concluded_not_worth_more_time",
        subjectType: "question",
        subjectId: "q1",
        occurredAt: at(days(1)),
      }),
    ],
    at(days(3)),
  ).length === 0,
);

check(
  "a closing event only closes its own subject",
  // The failure this prevents: closing one packet marking every packet done.
  openItems(
    [
      handoffOpened,
      evt({
        kind: "handed_off",
        subjectType: "handoff_packet",
        subjectId: "p2",
        occurredAt: at(minutes(1)),
      }),
      evt({
        kind: "closed_handoff",
        subjectType: "handoff_packet",
        subjectId: "p2",
        occurredAt: at(days(1)),
      }),
    ],
    at(days(3)),
  ).map((i) => i.subjectId).join(",") === "p1",
);

check(
  "reopening after closing counts as open again",
  openItems(
    [
      evt({
        kind: "opened_question",
        subjectType: "question",
        subjectId: "q1",
        occurredAt: at(0),
      }),
      evt({
        kind: "closed_question",
        subjectType: "question",
        subjectId: "q1",
        occurredAt: at(days(1)),
      }),
      evt({
        kind: "opened_question",
        subjectType: "question",
        subjectId: "q1",
        occurredAt: at(days(2)),
      }),
    ],
    at(days(3)),
  ).length === 1,
);

check(
  "events given out of order still resolve correctly",
  // The store returns newest-first; a naive single pass would see the close
  // before the open and report the item as open.
  openItems(
    [
      evt({
        kind: "closed_handoff",
        subjectType: "handoff_packet",
        subjectId: "p1",
        occurredAt: at(days(1)),
      }),
      handoffOpened,
    ],
    at(days(3)),
  ).length === 0,
);

check(
  "events without a subject are ignored, not crashed on",
  openItems([evt({ kind: "viewed_company", occurredAt: at(0) })], at(days(1)))
    .length === 0,
);

check(
  "oldest open item comes first",
  openItems(
    [
      evt({
        kind: "handed_off",
        subjectType: "handoff_packet",
        subjectId: "new",
        occurredAt: at(days(2)),
      }),
      evt({
        kind: "handed_off",
        subjectType: "handoff_packet",
        subjectId: "old",
        occurredAt: at(0),
      }),
    ],
    at(days(3)),
  )[0].subjectId === "old",
);

check(
  "age is reported in whole days",
  openItems([handoffOpened], at(days(3) + minutes(30)))[0].ageDays === 3,
);

/* ------------------------------------------------------------------ */
group("attention — what has and hasn't been looked at");

const attention = [
  evt({ companyId: 1, occurredAt: at(0) }),
  evt({ companyId: 1, occurredAt: at(days(2)) }),
  evt({ companyId: 2, occurredAt: at(days(1)), userId: "user-b" }),
  evt({ companyId: null, occurredAt: at(days(5)) }),
];

check(
  "keeps the most recent look per company",
  lastLookedAtByCompany(attention).get(1)?.getTime() === at(days(2)).getTime(),
);

check(
  "counts every teammate's looks, not just one person's",
  // Team-level on purpose. A per-person version of this number is a scorecard,
  // and a scorecard makes people log dishonestly.
  lastLookedAtByCompany(attention).get(2)?.getTime() === at(days(1)).getTime(),
);

check(
  "events with no company are skipped",
  lastLookedAtByCompany(attention).size === 2,
);

check(
  "a deliberate pass is recorded per company",
  passedOnByCompany([
    evt({ kind: "concluded_not_worth_more_time", companyId: 7, occurredAt: at(days(1)) }),
    evt({ kind: "viewed_company", companyId: 8, occurredAt: at(days(1)) }),
  ]).get(7)?.getTime() === at(days(1)).getTime(),
);

check(
  "merely looking is not a pass",
  passedOnByCompany([evt({ kind: "viewed_company", companyId: 8, occurredAt: at(0) })])
    .size === 0,
);

/* ------------------------------------------------------------------ */
group("world events — windowing on knownAt");

const world = [
  { knownAt: at(0), occurredAt: at(-days(90)) },
  { knownAt: at(days(2)), occurredAt: at(days(2)) },
  { knownAt: at(days(9)), occurredAt: at(days(9)) },
];

check(
  "an open-ended window returns everything up to now",
  knownBetween(world, null, at(days(10))).length === 3,
);

check(
  "the window is exclusive at the start and inclusive at the end",
  // Exclusive start matters: the anchor timestamp is itself an event we've
  // already shown, and re-showing it every session is how a briefing loses
  // trust.
  knownBetween(world, at(0), at(days(9))).length === 2,
);

check(
  "a filing about last quarter that lands today counts as today's news",
  // Filtering on occurredAt instead of knownAt would hide it from the digest
  // that should carry it.
  knownBetween(world, at(-minutes(1)), at(days(1))).length === 1,
);

check(
  "nothing from the future leaks in",
  knownBetween(world, null, at(days(1))).length === 1,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
