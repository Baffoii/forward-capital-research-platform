import { renderDigestEmail, type RenderableDigest } from "./render.ts";

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

const item = (over: Partial<RenderableDigest["items"][0]> = {}) => ({
  candidate: { id: "e1", ticker: "VRT", headline: "Vertiv filed a 10-Q", detail: null },
  reasons: ["We own it (4.5% of the book)"],
  isExitSignal: false,
  ...over,
});

/* ------------------------------------------------------------------ */
group("an empty week must say WHICH kind of empty");

const nothingArrived: RenderableDigest = { items: [], suppressed: 0, suppressedSummary: null };
const allSuppressed: RenderableDigest = {
  items: [],
  suppressed: 9,
  suppressedSummary: "9 other things happened (9 at names we don't own).",
};

check(
  "no events at all does not claim nothing was ever recorded",
  // The bug this exists to prevent: 71 events in the database, none from this
  // week, and the email said "nothing at all was recorded" — which reads as a
  // broken pipeline to anyone who knows the data is there.
  !renderDigestEmail(nothingArrived).includes("Nothing at all was recorded"),
);

check(
  "it scopes the claim to this week",
  renderDigestEmail(nothingArrived).includes("this week only"),
  renderDigestEmail(nothingArrived),
);

check(
  "and names the likely cause, which is a stalled sync",
  renderDigestEmail(nothingArrived).includes("daily sync may not have run"),
);

check(
  "events that arrived but scored low is a different message",
  renderDigestEmail(allSuppressed).includes("clears the bar") &&
    !renderDigestEmail(allSuppressed).includes("daily sync"),
);

check(
  "and it reports how many were considered",
  renderDigestEmail(allSuppressed).includes("9 other things happened"),
);

check(
  "suppressed count with no summary still reads sensibly",
  renderDigestEmail({ items: [], suppressed: 3, suppressedSummary: null }).includes(
    "scored below the bar",
  ),
);

check(
  "both empty forms still say nothing was traded",
  renderDigestEmail(nothingArrived).includes("Nothing has been traded") &&
    renderDigestEmail(allSuppressed).includes("Nothing has been traded"),
);

/* ------------------------------------------------------------------ */
group("a normal week");

const normal: RenderableDigest = {
  items: [
    item(),
    item({
      candidate: {
        id: "e2",
        ticker: "ETN",
        headline: "Eaton is getting noticed",
        detail: "3 more analysts covering it",
      },
      isExitSignal: true,
      reasons: ["We own it", "The market is starting to notice this one"],
    }),
  ],
  suppressed: 4,
  suppressedSummary: "4 other things happened (4 at names we don't own).",
};

check("counts the items", renderDigestEmail(normal).startsWith("2 things worth your attention"));
check("numbers them", renderDigestEmail(normal).includes("1. VRT — "));
check("carries the ticker", renderDigestEmail(normal).includes("2. ETN — "));

check(
  "flags the exit signal as a trim signal, not confirmation",
  renderDigestEmail(normal).includes("thesis completing, not confirmation"),
);

check(
  "the trim note attaches only to the exit-signal item",
  renderDigestEmail(normal).split("thesis completing").length - 1 === 1,
);

check("shows why each made the list", renderDigestEmail(normal).includes("Why this made the list"));
check("reports what was cut", renderDigestEmail(normal).includes("4 other things happened"));
check("says nothing was traded", renderDigestEmail(normal).includes("Nothing has been traded"));

check(
  "a single item is not pluralised",
  renderDigestEmail({ items: [item()], suppressed: 0, suppressedSummary: null }).startsWith(
    "1 thing worth your attention",
  ),
);

check(
  "an item with no ticker still reads",
  renderDigestEmail({
    items: [item({ candidate: { id: "x", ticker: null, headline: "A bottleneck loosened", detail: null } })],
    suppressed: 0,
    suppressedSummary: null,
  }).includes("1. A bottleneck loosened"),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
