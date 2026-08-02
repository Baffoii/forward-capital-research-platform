import {
  assembleBriefing,
  rankCards,
  gapGreeting,
  LONG_GAP_DAYS,
  type BriefingInputs,
} from "./assemble.ts";

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

function inputs(over: Partial<BriefingInputs> = {}): BriefingInputs {
  return {
    now: NOW,
    lastSessionEnd: new Date("2026-07-22T09:00:00Z"),
    daysAway: 11,
    openItems: [],
    handoffsForMe: [],
    myUnacceptedHandoffs: [],
    metPrecommitments: [],
    journalDue: [],
    changesOnMyThings: [],
    ...over,
  };
}

const PRECOMMITMENT = {
  id: "p1",
  ticker: "VRT",
  conditionText: "backlog comes in below $2.1bn",
  actionText: "trim 30%",
  reasoning: "below that the shortage isn't reaching their P&L",
};

const HANDOFF_FOR_ME = {
  id: "h1",
  ticker: "VRT",
  authorName: "rchen23",
  needsDecision: "whether the contracts have escalators",
  rawText: "backlog light, margin flat, can you look",
  status: "open",
  ageHours: 60,
};

const CHANGE = {
  id: "c1",
  kind: "filing_published",
  ticker: "VRT",
  headline: "Vertiv filed a 10-Q",
  materiality: 0.5,
  knownAt: NOW,
};

/* ------------------------------------------------------------------ */
group("one thing at the top, not a list of twelve");

check(
  "always produces exactly one top card",
  Boolean(assembleBriefing(inputs()).theOneThing),
);

check(
  "an empty state is a real answer, not a blank screen",
  assembleBriefing(inputs()).theOneThing.kind === "nothing",
);

check(
  "and says so plainly",
  assembleBriefing(inputs()).theOneThing.headline === "Nothing needs you right now.",
);

check(
  "the rest is capped at four so the page can't become a list of twelve",
  assembleBriefing(
    inputs({
      openItems: Array.from({ length: 20 }, (_, i) => ({
        openedBy: { summary: `loose end ${i}` } as any,
        subjectType: "question",
        subjectId: `q${i}`,
        openedAt: NOW,
        ageDays: i,
      })),
    }),
  ).alsoWaiting.length === 4,
);

check(
  "the top card is not repeated in the list below it",
  (() => {
    const briefing = assembleBriefing(
      inputs({ metPrecommitments: [PRECOMMITMENT], handoffsForMe: [HANDOFF_FOR_ME] }),
    );
    return !briefing.alsoWaiting.includes(briefing.theOneThing);
  })(),
);

/* ------------------------------------------------------------------ */
group("what outranks what");

check(
  "a decision you already made outranks everything",
  // You did the thinking. It's waiting. Nothing beats that.
  assembleBriefing(
    inputs({
      metPrecommitments: [PRECOMMITMENT],
      handoffsForMe: [HANDOFF_FOR_ME],
      journalDue: [{ entryId: "j1", ticker: "VRT", reason: "nearly falsified", urgency: 95 }],
    }),
  ).theOneThing.kind === "precommitment_met",
);

check(
  "and it carries the reasoning, not a link to it",
  assembleBriefing(inputs({ metPrecommitments: [PRECOMMITMENT] })).theOneThing.detail ===
    PRECOMMITMENT.reasoning,
);

check(
  "somebody waiting on you outranks your own loose ends",
  assembleBriefing(
    inputs({
      handoffsForMe: [HANDOFF_FOR_ME],
      openItems: [
        {
          openedBy: { summary: "an old question" } as any,
          subjectType: "question",
          subjectId: "q1",
          openedAt: NOW,
          ageDays: 40,
        },
      ],
    }),
  ).theOneThing.kind === "handoff_waiting",
);

check(
  "work you handed over that nobody picked up outranks a journal reread",
  // This is the exact failure the phase exists to prevent, so it has to beat
  // things that are merely useful.
  assembleBriefing(
    inputs({
      myUnacceptedHandoffs: [{ id: "h2", ticker: "VRT", assigneeName: null, ageHours: 70 }],
      journalDue: [{ entryId: "j1", ticker: "VRT", reason: "nearly falsified", urgency: 95 }],
    }),
  ).theOneThing.kind === "handoff_dropped",
);

check(
  "and it names the likely reason nobody took it",
  assembleBriefing(
    inputs({ myUnacceptedHandoffs: [{ id: "h2", ticker: "VRT", assigneeName: null, ageHours: 70 }] }),
  ).theOneThing.detail?.includes("isn't addressed to anyone") === true,
);

check(
  "anything that needs a person outranks something that merely happened",
  assembleBriefing(
    inputs({
      changesOnMyThings: [{ ...CHANGE, materiality: 1 }],
      openItems: [
        {
          openedBy: { summary: "a loose end" } as any,
          subjectType: "question",
          subjectId: "q1",
          openedAt: NOW,
          ageDays: 0,
        },
      ],
    }),
  ).theOneThing.kind === "open_item",
);

check(
  "a change is the top card only when nothing needs a person",
  assembleBriefing(inputs({ changesOnMyThings: [CHANGE] })).theOneThing.kind === "change",
);

check(
  "an older unanswered handoff outranks a newer one",
  (() => {
    const cards = rankCards(
      inputs({
        handoffsForMe: [
          { ...HANDOFF_FOR_ME, id: "new", ageHours: 3 },
          { ...HANDOFF_FOR_ME, id: "old", ageHours: 100 },
        ],
      }),
    );
    return cards[0].href === "/handoffs/old";
  })(),
);

check(
  "accepted-but-unfinished handoffs rank below unanswered ones",
  (() => {
    const cards = rankCards(
      inputs({
        handoffsForMe: [
          { ...HANDOFF_FOR_ME, id: "accepted", status: "accepted", ageHours: 200 },
          { ...HANDOFF_FOR_ME, id: "unanswered", status: "open", ageHours: 1 },
        ],
      }),
    );
    return cards[0].href === "/handoffs/unanswered";
  })(),
);

check(
  "handoff open items aren't double-counted from the log",
  // They're already surfaced from the packets themselves with better wording.
  rankCards(
    inputs({
      openItems: [
        {
          openedBy: { summary: "handed off VRT" } as any,
          subjectType: "handoff_packet",
          subjectId: "h1",
          openedAt: NOW,
          ageDays: 3,
        },
      ],
    }),
  ).length === 0,
);

/* ------------------------------------------------------------------ */
group("the eleven-day gap is the normal case");

check(
  "after a long gap, changes become a count rather than a wall of text",
  (() => {
    const briefing = assembleBriefing(
      inputs({
        daysAway: 11,
        changesOnMyThings: Array.from({ length: 40 }, (_, i) => ({ ...CHANGE, id: `c${i}` })),
      }),
    );
    return briefing.whileYouWereAway.items.length === 0 &&
      briefing.whileYouWereAway.summary?.includes("40 things") === true;
  })(),
  String(assembleBriefing(inputs({ daysAway: 11, changesOnMyThings: [CHANGE] })).whileYouWereAway.summary),
);

check(
  "and it points at the weekly email rather than repeating it",
  assembleBriefing(
    inputs({ daysAway: 11, changesOnMyThings: [CHANGE, { ...CHANGE, id: "c2" }] }),
  ).whileYouWereAway.summary?.includes("weekly email") === true,
);

check(
  "after a short gap, the actual changes are listed",
  assembleBriefing(
    inputs({ daysAway: 2, changesOnMyThings: [CHANGE, { ...CHANGE, id: "c2" }] }),
  ).whileYouWereAway.items.length === 2,
);

check(
  "a quiet eleven days says so rather than showing nothing",
  assembleBriefing(inputs({ daysAway: 11 })).whileYouWereAway.summary?.includes(
    "Nothing was recorded",
  ) === true,
);

check(
  "the long-gap threshold is where it says it is",
  assembleBriefing(inputs({ daysAway: LONG_GAP_DAYS, changesOnMyThings: [CHANGE] }))
    .whileYouWereAway.items.length === 0,
);

check(
  "a first-ever visit is flagged rather than shown as a zero-day gap",
  (() => {
    const b = assembleBriefing(inputs({ lastSessionEnd: null, daysAway: null }));
    return b.firstEverVisit && b.theOneThing.detail?.includes("fills in as the team uses it") === true;
  })(),
);

/* ------------------------------------------------------------------ */
group("acknowledging the gap out loud");

check("first visit", gapGreeting(null, "maasg") === "Welcome, maasg.");
check("same day", gapGreeting(0, "maasg").includes("Welcome back"));
check("yesterday", gapGreeting(1, "maasg").includes("yesterday"));
check("a few days", gapGreeting(3, "maasg").includes("3 days ago"));
check(
  "eleven days gets a different sentence",
  // Coming back after eleven days to an interface that acts as though you
  // never left is disorienting, and disorientation closes tabs.
  gapGreeting(11, "maasg").includes("It's been 11 days"),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
