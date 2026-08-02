import {
  potentialMovement,
  decisionRelevance,
  scoreResearchItem,
  planResearch,
  summarizePlan,
  PASS_RESPECTED_DAYS,
  type ResearchItemInput,
} from "./value.ts";

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
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function item(over: Partial<ResearchItemInput> = {}): ResearchItemInput {
  return {
    id: "r1",
    companyId: 1,
    ticker: "VRT",
    question: "do their contracts have escalators",
    state: { score: 0.4, confidence: 0.2 },
    intendedPositionPct: 4,
    timeSensitivity: 0.5,
    estimatedHours: 3,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
group("the two cases the spec names");

const settled = scoreResearchItem(item({ state: { score: 0.9, confidence: 0.95 } }));
const openQuestion = scoreResearchItem(item({ state: { score: 0.4, confidence: 0.2 } }));

check(
  "a name at 0.9 with 0.95 confidence needs no more research",
  settled.valuePerHour === 0,
  String(settled.valuePerHour),
);

check(
  "a name at 0.4 with 0.2 confidence is worth an hour",
  openQuestion.valuePerHour > 0,
  String(openQuestion.valuePerHour),
);

check(
  "and the second beats the first",
  openQuestion.valuePerHour > settled.valuePerHour,
);

check(
  "the settled one says why in plain language",
  settled.rationale.includes("already confident"),
  settled.rationale,
);

/* ------------------------------------------------------------------ */
group("uncertainty only counts if it could change what we do");

check(
  "uncertainty that can't reach the line is worth exactly nothing",
  // The point that separates this from ranking by "how little we know": a
  // score of 0.05 that could be off by 0.4 still can't get to 0.6, so the
  // uncertainty is academic however uncomfortable it feels.
  decisionRelevance({ score: 0.05, confidence: 0.6 }) === 0,
);

check(
  "and the further from the line, the less the same uncertainty is worth",
  decisionRelevance({ score: 0.05, confidence: 0.3 }) <
    decisionRelevance({ score: 0.45, confidence: 0.3 }),
);

check(
  "the same uncertainty near the line is worth a lot",
  decisionRelevance({ score: 0.58, confidence: 0.3 }) > 0.9,
  String(decisionRelevance({ score: 0.58, confidence: 0.3 })),
);

check(
  "perfect confidence means nothing left to learn",
  decisionRelevance({ score: 0.4, confidence: 1 }) === 0,
);

check(
  "sitting exactly on the line is maximally relevant",
  decisionRelevance({ score: 0.6, confidence: 0.5 }) === 1,
);

check(
  "potential movement is just the confidence gap",
  potentialMovement({ score: 0.4, confidence: 0.25 }) === 0.75,
);

check(
  "a confidence outside 0..1 doesn't produce nonsense",
  potentialMovement({ score: 0.4, confidence: 1.5 }) === 0 &&
    potentialMovement({ score: 0.4, confidence: -1 }) === 1,
);

/* ------------------------------------------------------------------ */
group("the formula's other terms");

check(
  "a bigger intended position is worth more research",
  scoreResearchItem(item({ intendedPositionPct: 8 })).valuePerHour >
    scoreResearchItem(item({ intendedPositionPct: 1 })).valuePerHour,
);

check(
  "time-sensitive work outranks work that keeps",
  scoreResearchItem(item({ timeSensitivity: 1 })).valuePerHour >
    scoreResearchItem(item({ timeSensitivity: 0.2 })).valuePerHour,
);

check(
  "a cheaper piece of work ranks higher for the same payoff",
  scoreResearchItem(item({ estimatedHours: 1 })).valuePerHour >
    scoreResearchItem(item({ estimatedHours: 10 })).valuePerHour,
);

check(
  "a zero-hour estimate doesn't divide by zero",
  Number.isFinite(scoreResearchItem(item({ estimatedHours: 0 })).valuePerHour),
);

/* ------------------------------------------------------------------ */
group("cutting to the hours we actually have");

const many = [
  scoreResearchItem(item({ id: "a", companyId: 1, estimatedHours: 3, intendedPositionPct: 6 })),
  scoreResearchItem(item({ id: "b", companyId: 2, estimatedHours: 3, intendedPositionPct: 4 })),
  scoreResearchItem(item({ id: "c", companyId: 3, estimatedHours: 3, intendedPositionPct: 2 })),
  scoreResearchItem(item({ id: "d", companyId: 4, estimatedHours: 3, intendedPositionPct: 1 })),
];

check("fits within the hours given", planResearch(many, 6, { now: NOW }).hoursUsed <= 6);

check(
  "highest value per hour first",
  planResearch(many, 6, { now: NOW }).doing[0].id === "a",
);

check(
  "what's dropped is named, not silently truncated",
  // Being told what you're not doing is the deliverable.
  planResearch(many, 6, { now: NOW }).notDoing.length === 2,
);

check(
  "and each has a reason",
  planResearch(many, 6, { now: NOW }).notDoing.every((s) => s.why.length > 0),
);

check(
  "'no time' is distinguished from 'not worth it'",
  planResearch(many, 6, { now: NOW }).notDoing.every((s) => s.why.startsWith("Below the line")),
);

check(
  "the summary leads with what's being skipped",
  summarizePlan(planResearch(many, 6, { now: NOW })).includes("didn't fit"),
  summarizePlan(planResearch(many, 6, { now: NOW })),
);

check(
  "zero hours available drops everything, with reasons",
  (() => {
    const plan = planResearch(many, 0, { now: NOW });
    return plan.doing.length === 0 && plan.notDoing.length === 4;
  })(),
);

check(
  "an empty queue says so rather than erroring",
  summarizePlan(planResearch([], 6, { now: NOW })) === "Nothing in the queue.",
);

/* ------------------------------------------------------------------ */
group("what the logs already told us");

check(
  "a name somebody has claimed is not proposed to anyone else",
  // The whole reason claims exist: two people, one Saturday, one name.
  planResearch(many, 100, {
    now: NOW,
    claimedBy: new Map([[1, "rchen23"]]),
  }).notDoing[0].why === "rchen23 already has this one.",
);

check(
  "a deliberate pass is respected, not re-proposed",
  // Re-proposing a name someone consciously passed on teaches people to stop
  // recording passes, and the pass is a real result.
  planResearch(many, 100, {
    now: NOW,
    passedOn: new Map([[1, ago(5)]]),
  }).notDoing.some((s) => s.why.includes("wasn't worth more time")),
);

check(
  "a pass expires eventually",
  planResearch(many, 100, {
    now: NOW,
    passedOn: new Map([[1, ago(PASS_RESPECTED_DAYS + 5)]]),
  }).doing.some((d) => d.companyId === 1),
);

check(
  "a name someone was looking at yesterday is assumed in hand",
  planResearch(many, 100, {
    now: NOW,
    lastLookedAt: new Map([[1, ago(1)]]),
  }).notDoing.some((s) => s.why.includes("probably already in hand")),
);

check(
  "a name nobody has touched in a fortnight is fair game",
  planResearch(many, 100, {
    now: NOW,
    lastLookedAt: new Map([[1, ago(14)]]),
  }).doing.some((d) => d.companyId === 1),
);

check(
  "work that can't change a decision is dropped even with hours to spare",
  // An hour that can't change a decision isn't research, it's reassurance.
  planResearch(
    [scoreResearchItem(item({ state: { score: 0.95, confidence: 0.98 } }))],
    100,
    { now: NOW },
  ).doing.length === 0,
);

check(
  "and that reason is distinguished from running out of time",
  !planResearch(
    [scoreResearchItem(item({ state: { score: 0.95, confidence: 0.98 } }))],
    100,
    { now: NOW },
  ).notDoing[0].why.startsWith("Below the line"),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
