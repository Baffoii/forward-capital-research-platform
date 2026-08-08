import {
  parseDurationWeeks,
  extractLeadTimeMentions,
  classifyTranscript,
  leadTimeTrend,
} from "./lead-time.ts";
import { parseTranscriptPaste } from "./paste-format.ts";

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

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;
const D = (s: string) => new Date(s);

const reading = (text: string, o: Partial<Parameters<typeof classifyTranscript>[0]> = {}) =>
  classifyTranscript({
    companyId: 1,
    fiscalPeriod: "Q1-2026",
    text,
    effectiveFrom: D("2026-03-31"),
    knownAt: D("2026-04-30"),
    ...o,
  });

console.log("\nduration parsing");

check("parses weeks", parseDurationWeeks("Lead times are now 52 weeks.") === 52);
check("converts months to weeks", near(parseDurationWeeks("about 18 months")!, 78.2));
check("converts years", parseDurationWeeks("two years out") === 104);
check("handles written numbers", parseDurationWeeks("three quarters") === 39);
// A range is a range. Taking the flattering end would bias every trend.
check("takes the midpoint of a stated range", parseDurationWeeks("12 to 16 weeks") === 14);
check("handles a dashed range", parseDurationWeeks("40-60 weeks") === 50);
check("returns null when no duration is stated", parseDurationWeeks("Lead times remain extended.") === null);

console.log("\nmention classification");

const extending = extractLeadTimeMentions(
  "Lead times for large power transformers have extended to roughly 100 weeks.",
);
check("detects lead times extending", extending[0]?.direction === 1);
check("captures the stated number", extending[0]?.leadTimeWeeks === 100);
check("records the cue that fired", extending[0]?.cue === "lead_time_extending");

check(
  "detects sold-out language",
  extractLeadTimeMentions("We are effectively sold out through 2028.")[0]?.direction === 1,
);
check(
  "detects allocation",
  extractLeadTimeMentions("We continue to run the product on allocation.")[0]?.direction === 1,
);
check(
  "detects demand exceeding supply",
  extractLeadTimeMentions("Demand continues to outstrip our available capacity.")[0]?.direction === 1,
);

// The expensive one to miss.
const easing = extractLeadTimeMentions(
  "Lead times have shortened to 30 weeks from 45 weeks a year ago.",
);
check("detects lead times shortening", easing[0]?.direction === -1);
check(
  "detects capacity catching up",
  extractLeadTimeMentions("Our new capacity has come online and supply has caught up.")[0]
    ?.direction === -1,
);
check(
  "detects an explicit end to constraint",
  extractLeadTimeMentions("We are no longer capacity constrained in switchgear.")[0]
    ?.direction === -1,
);

// Sentiment is not evidence about a physical constraint.
check(
  "ignores enthusiasm with no physical content",
  extractLeadTimeMentions("We are excited about the demand environment.").length === 0,
);
check(
  "ignores call mechanics",
  extractLeadTimeMentions("Operator, we will take the next question.").length === 0,
);

// A forecast is a claim about a quarter nobody has lived through.
const forecast = extractLeadTimeMentions(
  "We expect lead times to normalize over the coming year.",
);
check("flags forward-looking statements", forecast[0]?.flags.includes("forward_looking"));
check(
  "discounts a forecast against an observation",
  (forecast[0]?.strength ?? 1) <
    (extractLeadTimeMentions("Lead times have normalized.")[0]?.strength ?? 0),
);

// "We have not seen lead times extend" is the opposite of what the cue matched.
const negated = extractLeadTimeMentions("We have not seen lead times extend this quarter.");
check("detects negation", negated[0]?.flags.includes("negated"));
check("negation flips the direction", negated[0]?.direction === -1);

// The single most useful fact on a call is often stated with no direction
// word at all. Ignoring it throws away the level that the trend is built from.
const bareLevel = extractLeadTimeMentions("Lead times are now 70 weeks.");
check("captures a bare lead-time level", bareLevel[0]?.leadTimeWeeks === 70);
check("a level statement does not vote on direction", bareLevel[0]?.direction === 0);

const levelPlusTight = reading(
  "Lead times have extended significantly. Lead times are now 70 weeks.",
)!;
check(
  "a level statement does not dilute a directional call",
  levelPlusTight.tightening === 1,
  `(got ${levelPlusTight.tightening})`,
);
check("but its number is still carried", levelPlusTight.leadTimeWeeks === 70);

console.log("\ncall-level reading");

const tightCall = reading(
  "Lead times for large power transformers have extended to 100 weeks. " +
    "We are effectively sold out through 2028. Demand continues to outstrip capacity.",
)!;
check("a uniformly tight call reads strongly positive", tightCall.tightening > 0.9);
check("direction is tightening", tightCall.direction === "tightening");
check("carries the stated lead time forward", tightCall.leadTimeWeeks === 100);
check("keeps a supporting quote", tightCall.supportingQuotes.length >= 1);
check(
  "a stated number raises confidence above an adjective",
  tightCall.confidence >= 0.75,
  `(got ${tightCall.confidence})`,
);

const easingCall = reading(
  "Lead times have shortened to 30 weeks. Our added capacity has come online.",
)!;
check("a uniformly easing call reads negative", easingCall.tightening < -0.9);
check("direction is easing", easingCall.direction === "easing");

// Management describing both directions is real, and netting it into a
// confident zero would hide the fact that the call was genuinely mixed.
const mixed = reading(
  "Lead times remain extended at 60 weeks. That said, our new capacity has come online and supply is catching up.",
)!;
check("mixed calls are flagged", mixed.flags.includes("mixed_signals_on_call"));
check("mixed calls carry lower confidence", mixed.confidence < tightCall.confidence);
check(
  "both sides are quoted, not just the winner",
  mixed.supportingQuotes.length === 2,
);

// One specific number outweighs three gestures. A measurement beats a mood.
const specificVsVague = reading(
  "Lead times have extended to 90 weeks. " +
    "Supply feels a little easier. Capacity is expanding somewhat.",
)!;
check(
  "one specific statement outweighs several vague ones",
  specificVsVague.tightening > 0,
  `(got ${specificVsVague.tightening})`,
);

const allGuidance = reading(
  "We expect lead times to extend further. We anticipate capacity will remain constrained.",
)!;
check("a call of pure guidance is flagged", allGuidance.flags.includes("all_forward_looking"));
check("pure guidance is discounted", allGuidance.confidence < tightCall.confidence);

check(
  "a call with no lead-time content produces no reading at all",
  reading("Revenue grew 12% and we repurchased $200 million of stock.") === null,
  "silence is not a neutral reading",
);

console.log("\nlead-time trend");

const trend = leadTimeTrend(
  [
    reading("Lead times extended to 60 weeks.", { knownAt: D("2025-10-30") })!,
    reading("Lead times extended to 80 weeks.", { knownAt: D("2026-01-30") })!,
    reading("Lead times are now 70 weeks.", { knownAt: D("2026-04-30") })!,
  ],
  D("2026-06-01"),
)!;
check("computes the change between the last two calls", trend.deltaWeeks === -10);
// Still 70 weeks — long by any standard — but no longer lengthening.
check("detects the turn off the peak", trend.turned);
check("reports both endpoints", trend.from === 80 && trend.to === 70);

check(
  "trend respects knownAt and ignores calls from the future",
  leadTimeTrend(
    [
      reading("Lead times extended to 60 weeks.", { knownAt: D("2026-01-30") })!,
      reading("Lead times are now 30 weeks.", { knownAt: D("2026-07-30") })!,
    ],
    D("2026-03-01"),
  ) === null,
);

console.log("\noperator paste format");

const body = "Lead times have extended to 100 weeks. ".repeat(12);
const pasted = parseTranscriptPaste(
  `TRANSCRIPT\nticker: etn\nperiod: Q1-2026\ndate: 2026-04-30\n---\n${body}`,
)!;
check("parses a well-formed paste", pasted !== null);
check("normalises the ticker", pasted?.ticker === "ETN");
check("keeps the fiscal period", pasted?.fiscalPeriod === "Q1-2026");
check("parses the call date", pasted?.callDate.toISOString().startsWith("2026-04-30"));
check("keeps the body", (pasted?.text.length ?? 0) > 200);

// A transcript attributed to the wrong quarter produces a lead-time trend that
// is wrong in both directions, so a bad header is rejected rather than guessed.
check(
  "rejects a paste with no period",
  parseTranscriptPaste(`TRANSCRIPT\nticker: ETN\ndate: 2026-04-30\n---\n${body}`) === null,
);
check(
  "rejects a paste with an unparseable date",
  parseTranscriptPaste(
    `TRANSCRIPT\nticker: ETN\nperiod: Q1-2026\ndate: sometime in spring\n---\n${body}`,
  ) === null,
);
check(
  "rejects a header with no transcript body",
  parseTranscriptPaste("TRANSCRIPT\nticker: ETN\nperiod: Q1-2026\ndate: 2026-04-30\n---\nshort") === null,
);
check("ignores unrelated inbox text", parseTranscriptPaste("Some notes I took.") === null);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
