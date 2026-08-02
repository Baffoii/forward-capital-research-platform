/**
 * Lead-time and capacity language classification.
 *
 * Pure: text in, a signed direction and a supporting quote out. No network,
 * no database, no clock.
 *
 * This is the highest-value input in the whole model and the one backlog
 * coverage cannot substitute for. Coverage tells you the queue got longer;
 * it cannot tell you whether that is because demand rose or because the
 * factory slipped. Management saying "lead times extended to 52 weeks" is a
 * direct read on the physical constraint, and the FIRST call where that
 * number stops rising is the release signal that costs the most to miss.
 *
 * What this deliberately does not do: score sentiment. "We are excited about
 * demand" is not evidence. Only statements about delivery time, capacity
 * position, or sold-out status count.
 */

import { stripMarkup, splitSentences } from "../ingestion/edgar-extract.ts";

/* ------------------------------------------------------------------ */
/* Lead-time quantities                                                */
/* ------------------------------------------------------------------ */

const UNIT_WEEKS: Record<string, number> = {
  day: 1 / 7,
  days: 1 / 7,
  week: 1,
  weeks: 1,
  month: 4.345,
  months: 4.345,
  quarter: 13,
  quarters: 13,
  year: 52,
  years: 52,
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eighteen: 18, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/** "52 weeks", "18 months", "two years", "12-16 weeks" -> weeks. */
export function parseDurationWeeks(sentence: string): number | null {
  const re = new RegExp(
    String.raw`\b(\d{1,3}(?:\.\d+)?|${Object.keys(WORD_NUMBERS).join("|")})` +
      String.raw`(?:\s*(?:to|-|–|and)\s*(\d{1,3}(?:\.\d+)?))?` +
      String.raw`[\s-]*(${Object.keys(UNIT_WEEKS).join("|")})\b`,
    "i",
  );
  const m = re.exec(sentence);
  if (!m) return null;

  const toNum = (s: string | undefined): number | null => {
    if (!s) return null;
    const word = WORD_NUMBERS[s.toLowerCase()];
    if (word !== undefined) return word;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const lo = toNum(m[1]);
  const hi = toNum(m[2]);
  if (lo === null) return null;
  const unit = UNIT_WEEKS[m[3].toLowerCase()];
  if (unit === undefined) return null;
  // A stated range is a range; take its midpoint rather than the flattering end.
  const value = hi === null ? lo : (lo + hi) / 2;
  return value * unit;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export interface LeadTimeMention {
  /** +1 constraint tightening, -1 easing, 0 stated but flat. */
  direction: 1 | 0 | -1;
  /** Absolute lead time in weeks, when the speaker gave one. */
  leadTimeWeeks: number | null;
  /** 0..1 — how strong this particular statement is as evidence. */
  strength: number;
  quote: string;
  cue: string;
  flags: string[];
}

/** Statements that the constraint is getting worse. */
const TIGHTENING_CUES: Array<[RegExp, string, number]> = [
  [/\blead times?\b[^.]{0,60}\b(extend|extended|extending|lengthen\w*|stretch\w*|push\w* out|gone out|increased|longer|elongat\w*)\b/i, "lead_time_extending", 1.0],
  [/\b(sold out|fully (?:booked|committed|allocated|subscribed))\b/i, "sold_out", 0.95],
  [/\b(capacity|supply)\b[^.]{0,40}\b(constrain\w*|tight\w*|limit\w*|short(?:age)?)\b/i, "capacity_constrained", 0.8],
  [/\b(allocat\w+|rationing|on allocation)\b/i, "allocation", 0.85],
  [/\b(booking|order)s?\b[^.]{0,40}\b(into|out to|through)\b[^.]{0,20}\b20\d\d\b/i, "booked_into_future_year", 0.9],
  [/\bcustomers? (?:are )?(?:reserv\w+|prepay\w+|placing (?:non-?cancellable|multi-?year))\b/i, "customers_reserving_capacity", 0.8],
  [/\bdemand\b[^.]{0,40}\b(exceed\w*|outstrip\w*|outpac\w*)\b[^.]{0,20}\b(supply|capacity)\b/i, "demand_exceeds_supply", 0.9],
];

/** Statements that the constraint is resolving — the expensive ones to miss. */
const EASING_CUES: Array<[RegExp, string, number]> = [
  [/\blead times?\b[^.]{0,60}\b(short\w*|improv\w*|normaliz\w*|normalis\w*|come? (?:back )?(?:in|down)|declin\w*|reduc\w*|contract\w*)\b/i, "lead_time_shortening", 1.0],
  [/\b(capacity|supply)\b[^.]{0,40}\b(catch\w* up|caught up|expand\w*|added|ramp\w*|com(?:e|ing) online|available)\b/i, "capacity_catching_up", 0.85],
  [/\b(?:no longer|not) (?:capacity )?constrained\b/i, "no_longer_constrained", 0.9],
  [/\b(?:easing|eased|loosen\w*|de-?bottleneck\w*)\b/i, "easing", 0.7],
  [/\b(?:cancellation|de-?booking|push-?out)s?\b[^.]{0,40}\b(increas\w*|rose|higher|elevated)\b/i, "cancellations_rising", 0.8],
];

/** Not evidence about the constraint, whatever else the sentence says. */
const NOT_EVIDENCE =
  /\b(?:we (?:are )?(?:excited|pleased|encouraged|confident)|great quarter|strong execution|thank you|operator|next question)\b/i;

/** Guidance about the future is weaker evidence than an observation. */
const FORWARD_LOOKING =
  /\b(?:we (?:expect|anticipate|believe|think|project|forecast)|should|will likely|going forward|in the (?:coming|next) (?:year|quarters?)|guidance)\b/i;

const NEGATED =
  /\b(?:have not|has not|did not|do not|don't|no)\s+(?:seen|experienced|observed)\b/i;

/** The sentence is about delivery time at all. */
const LEAD_TIME_SUBJECT = /\b(lead times?|delivery times?|backlog coverage)\b/i;

/** An explicit all-clear, which reads as a constraint cue unless excluded. */
const EXPLICIT_RESOLUTION =
  /\b(?:no longer|not)\s+(?:capacity\s+|supply\s+)?constrained\b/i;

/**
 * Pull every lead-time or capacity statement out of a transcript.
 *
 * Both directions are collected from the same pass. A call frequently contains
 * both ("lead times remain extended, though we have added capacity"), and
 * which one dominates is the thing being measured — discarding one side would
 * decide the answer before counting.
 */
export function extractLeadTimeMentions(text: string): LeadTimeMention[] {
  const out: LeadTimeMention[] = [];

  for (const sentence of splitSentences(stripMarkup(text))) {
    if (NOT_EVIDENCE.test(sentence)) continue;

    const flags: string[] = [];
    if (FORWARD_LOOKING.test(sentence)) flags.push("forward_looking");
    if (NEGATED.test(sentence)) flags.push("negated");

    // "We are no longer capacity constrained" contains "capacity constrained"
    // and would otherwise fire the tightening cue as well as the easing one,
    // netting a genuine all-clear to roughly zero. The easing cue already
    // encodes the negation, so the tightening pass is skipped rather than
    // flipped — flipping would double-negate it back to tightening.
    if (!EXPLICIT_RESOLUTION.test(sentence)) {
      for (const [re, cue, weight] of TIGHTENING_CUES) {
        if (!re.test(sentence)) continue;
        out.push(makeMention(1, cue, weight, sentence, flags));
        break;
      }
    }
    let easingFired = false;
    for (const [re, cue, weight] of EASING_CUES) {
      if (!re.test(sentence)) continue;
      out.push(makeMention(-1, cue, weight, sentence, flags));
      easingFired = true;
      break;
    }

    // A bare quantity with no direction word — "lead times are now 70 weeks" —
    // carries the single most useful fact on the call and matches no
    // directional cue. Recorded with direction 0 so it feeds the trend without
    // voting on this quarter's direction: 70 weeks means nothing on its own,
    // but 70 down from 80 is the turn.
    const alreadyMatched = out.some((m) => m.quote === sentence);
    if (!alreadyMatched && !easingFired && LEAD_TIME_SUBJECT.test(sentence)) {
      const weeks = parseDurationWeeks(sentence);
      if (weeks !== null) {
        out.push({
          direction: 0,
          leadTimeWeeks: weeks,
          strength: 0.5,
          quote: sentence,
          cue: "lead_time_level_stated",
          flags,
        });
      }
    }
  }

  return out;
}

function makeMention(
  direction: 1 | -1,
  cue: string,
  weight: number,
  sentence: string,
  flags: string[],
): LeadTimeMention {
  let strength = weight;
  // A forecast is a claim about a quarter nobody has lived through yet.
  if (flags.includes("forward_looking")) strength *= 0.5;
  // "We have not seen lead times extend" is the opposite of what the cue matched.
  const negated = flags.includes("negated");
  return {
    direction: negated ? ((-direction) as 1 | -1) : direction,
    leadTimeWeeks: parseDurationWeeks(sentence),
    strength: negated ? strength * 0.7 : strength,
    quote: sentence,
    cue,
    flags,
  };
}

/* ------------------------------------------------------------------ */
/* Per-call reading                                                    */
/* ------------------------------------------------------------------ */

export interface TranscriptReading {
  companyId: number;
  fiscalPeriod: string;
  /** -1..1 */
  tightening: number;
  direction: "tightening" | "stable" | "easing";
  leadTimeWeeks: number | null;
  confidence: number;
  /** The strongest statement in each direction, for the evidence chain. */
  supportingQuotes: string[];
  mentionCount: number;
  flags: string[];
  effectiveFrom: Date;
  knownAt: Date;
}

export const DIRECTION_THRESHOLD = 0.15;

/**
 * Collapse one call into one reading.
 *
 * Net of strength, not a majority vote. One unambiguous "lead times extended
 * to 52 weeks" outweighs three vague capacity remarks, which is the correct
 * weighting — a specific number is a measurement and a gesture is not.
 */
export function classifyTranscript(input: {
  companyId: number;
  fiscalPeriod: string;
  text: string;
  effectiveFrom: Date;
  knownAt: Date;
}): TranscriptReading | null {
  const mentions = extractLeadTimeMentions(input.text);
  if (mentions.length === 0) return null;

  // Level statements supply the number but do not vote on direction. Letting
  // them into the denominator would dilute a genuinely tight call toward zero
  // just because management also quoted a figure.
  const directional = mentions.filter((m) => m.direction !== 0);
  let net = 0;
  let totalStrength = 0;
  for (const m of directional) {
    net += m.direction * m.strength;
    totalStrength += m.strength;
  }
  const tightening = totalStrength === 0 ? 0 : net / totalStrength;

  const flags: string[] = [];
  const tighteningCount = mentions.filter((m) => m.direction > 0).length;
  const easingCount = mentions.filter((m) => m.direction < 0).length;
  // Management describing both directions on the same call is real and worth
  // surfacing rather than netting into a confident-looking zero.
  if (tighteningCount > 0 && easingCount > 0) flags.push("mixed_signals_on_call");
  if (mentions.every((m) => m.flags.includes("forward_looking"))) {
    flags.push("all_forward_looking");
  }

  // An explicit number is the whole point. Prefer the strongest mention that
  // carried one.
  const withNumber = mentions
    .filter((m) => m.leadTimeWeeks !== null)
    .sort((a, b) => b.strength - a.strength)[0];

  const strongestTightening = mentions
    .filter((m) => m.direction > 0)
    .sort((a, b) => b.strength - a.strength)[0];
  const strongestEasing = mentions
    .filter((m) => m.direction < 0)
    .sort((a, b) => b.strength - a.strength)[0];

  // Management speaking directly about their own lead times is a far better
  // read than any backlog arithmetic, but it is still one company's account of
  // its own market, delivered by people with an interest in the answer.
  let confidence = 0.65;
  if (withNumber) confidence = 0.75; // a stated number beats an adjective
  if (mentions.length === 1) confidence *= 0.8;
  if (flags.includes("mixed_signals_on_call")) confidence *= 0.8;
  if (flags.includes("all_forward_looking")) confidence *= 0.7;

  return {
    companyId: input.companyId,
    fiscalPeriod: input.fiscalPeriod,
    tightening,
    direction:
      tightening > DIRECTION_THRESHOLD
        ? "tightening"
        : tightening < -DIRECTION_THRESHOLD
          ? "easing"
          : "stable",
    leadTimeWeeks: withNumber?.leadTimeWeeks ?? null,
    confidence,
    supportingQuotes: [strongestTightening?.quote, strongestEasing?.quote].filter(
      (q): q is string => typeof q === "string",
    ),
    mentionCount: mentions.length,
    flags,
    effectiveFrom: input.effectiveFrom,
    knownAt: input.knownAt,
  };
}

/**
 * Change in stated lead time across consecutive calls.
 *
 * This is the reading worth the most. An absolute lead time of 52 weeks is a
 * level; 52 down from 60 is a turn, and the turn is what moves the stock.
 * Both readings must be knowable at asOf.
 */
export function leadTimeTrend(
  readings: TranscriptReading[],
  asOf: Date,
): { deltaWeeks: number; from: number; to: number; turned: boolean } | null {
  const withNumbers = readings
    .filter((r) => r.leadTimeWeeks !== null && r.knownAt.getTime() <= asOf.getTime())
    .sort((a, b) => a.knownAt.getTime() - b.knownAt.getTime());
  if (withNumbers.length < 2) return null;

  const to = withNumbers[withNumbers.length - 1].leadTimeWeeks!;
  const from = withNumbers[withNumbers.length - 2].leadTimeWeeks!;
  const peak = Math.max(...withNumbers.map((r) => r.leadTimeWeeks!));
  return {
    deltaWeeks: to - from,
    from,
    to,
    // First decline off the peak: still long, no longer lengthening.
    turned: from >= peak && to < from,
  };
}
