/**
 * Reconstructing where one person left off.
 *
 * The normal case for this team is an eleven-day gap, not an overnight one.
 * Three part-time students, never all available, coming back to a system that
 * has been watching without them. So this is written for the long gap first
 * and the short one second, which is the opposite of how a dashboard is
 * usually built.
 *
 * Two decisions shape everything here:
 *
 *   ONE THING AT THE TOP. Not a list of twelve. Somebody returning after a
 *   week and a half needs to know the single thing that most needs them, and
 *   a ranked list of twelve is a way of not answering that question.
 *
 *   THEIRS, NOT THE WORLD'S. This is not "what happened" — the digest already
 *   does that. It's "what were you in the middle of, what has changed that
 *   bears on it, what needs you today".
 *
 * Pure and dependency-free so the ranking can be tested directly.
 */

import type { OpenItem } from "../human-loop/log-queries";

/** Past this, we stop replaying events and start summarising. */
export const LONG_GAP_DAYS = 7;

export interface BriefingInputs {
  now: Date;
  /** End of their previous session. Null on a first-ever visit. */
  lastSessionEnd: Date | null;
  daysAway: number | null;
  /** Their open questions, commitments, handoffs and claims. */
  openItems: OpenItem[];
  /** Handoffs waiting on them. */
  handoffsForMe: Array<{
    id: string;
    ticker: string | null;
    authorName: string;
    needsDecision: string | null;
    rawText: string;
    status: string;
    ageHours: number;
  }>;
  /** Handoffs they wrote that nobody has picked up. */
  myUnacceptedHandoffs: Array<{
    id: string;
    ticker: string | null;
    assigneeName: string | null;
    ageHours: number;
  }>;
  /** Conditions they set in advance that have now been met. */
  metPrecommitments: Array<{
    id: string;
    ticker: string | null;
    conditionText: string;
    actionText: string;
    reasoning: string;
  }>;
  /** Journal entries the system thinks are worth rereading. */
  journalDue: Array<{
    entryId: string;
    ticker: string | null;
    reason: string;
    urgency: number;
  }>;
  /** World events since they last looked, on companies they've touched. */
  changesOnMyThings: Array<{
    id: string;
    kind: string;
    ticker: string | null;
    headline: string;
    materiality: number | null;
    knownAt: Date;
  }>;
}

export interface BriefingCard {
  /** What kind of thing this is, for the UI to route the click. */
  kind:
    | "precommitment_met"
    | "handoff_waiting"
    | "handoff_dropped"
    | "journal_due"
    | "open_item"
    | "change"
    | "nothing";
  /** One sentence. This is the headline when it's the top card. */
  headline: string;
  /** A second sentence at most. */
  detail?: string;
  /** Where clicking goes. */
  href?: string;
  urgency: number;
}

export interface Briefing {
  daysAway: number | null;
  firstEverVisit: boolean;
  /** The one thing. Never null — there's always a card, even if it's "nothing". */
  theOneThing: BriefingCard;
  /** Everything else, ranked. Deliberately separate from the one thing. */
  alsoWaiting: BriefingCard[];
  /**
   * After a long gap this is a count, not a list. Eleven days of events read
   * as a wall of text nobody finishes, and finishing is the point.
   */
  whileYouWereAway: {
    summary: string | null;
    /** Only populated for short gaps. */
    items: BriefingCard[];
  };
}

const hoursLabel = (hours: number): string =>
  hours < 48 ? `${Math.round(hours)} hours` : `${Math.floor(hours / 24)} days`;

/**
 * Build the candidate cards, most pressing first.
 *
 * The ordering is a claim about what actually blocks a three-person fund, in
 * order: a decision you already made that's waiting on you; work handed to you;
 * work you handed over that vanished; reasoning that has gone stale; your own
 * loose ends; and only then things that merely happened.
 */
export function rankCards(input: BriefingInputs): BriefingCard[] {
  const cards: BriefingCard[] = [];

  // 1. You already decided this. It's waiting.
  for (const commitment of input.metPrecommitments) {
    cards.push({
      kind: "precommitment_met",
      headline: `You decided in advance: if ${commitment.conditionText}, ${commitment.actionText}. That's happened.`,
      detail: commitment.reasoning,
      href: "/precommitments",
      urgency: 100,
    });
  }

  // 2. Somebody is waiting on you specifically.
  for (const handoff of input.handoffsForMe) {
    if (handoff.status === "open") {
      cards.push({
        kind: "handoff_waiting",
        headline: `${handoff.authorName} handed you${handoff.ticker ? ` ${handoff.ticker}` : " research"} ${hoursLabel(handoff.ageHours)} ago and you haven't said yes or no.`,
        detail: handoff.needsDecision ?? handoff.rawText.slice(0, 200),
        href: `/handoffs/${handoff.id}`,
        // Rises with age: the whole failure mode is silence, and silence gets
        // worse the longer it lasts.
        urgency: 90 + Math.min(8, handoff.ageHours / 12),
      });
    } else {
      cards.push({
        kind: "handoff_waiting",
        headline: `You took on ${handoff.ticker ?? "some research"} from ${handoff.authorName} and haven't closed it.`,
        detail: handoff.needsDecision ?? undefined,
        href: `/handoffs/${handoff.id}`,
        urgency: 60,
      });
    }
  }

  // 3. Work you handed over that nobody picked up. The silent-drop case.
  for (const handoff of input.myUnacceptedHandoffs) {
    cards.push({
      kind: "handoff_dropped",
      headline: `Nobody has picked up the${handoff.ticker ? ` ${handoff.ticker}` : ""} work you handed over ${hoursLabel(handoff.ageHours)} ago.`,
      detail: handoff.assigneeName
        ? `It's addressed to ${handoff.assigneeName}.`
        : "It isn't addressed to anyone in particular, which is probably why.",
      href: `/handoffs/${handoff.id}`,
      urgency: 85 + Math.min(8, handoff.ageHours / 12),
    });
  }

  // 4. Reasoning worth rereading.
  for (const due of input.journalDue) {
    cards.push({
      kind: "journal_due",
      headline: due.reason,
      href: `/journal/${due.entryId}`,
      // Sits below people waiting on you, above your own loose ends.
      urgency: 65 + due.urgency / 10,
    });
  }

  // 5. Your own loose ends, oldest first.
  for (const item of input.openItems) {
    if (item.subjectType === "handoff_packet") continue; // covered above
    cards.push({
      kind: "open_item",
      headline: item.openedBy.summary,
      detail:
        item.ageDays > 0
          ? `Still open after ${item.ageDays} day${item.ageDays === 1 ? "" : "s"}.`
          : undefined,
      urgency: 40 + Math.min(15, item.ageDays / 2),
    });
  }

  // 6. Things that merely happened, on names you've touched.
  for (const change of input.changesOnMyThings) {
    cards.push({
      kind: "change",
      headline: change.headline,
      urgency: 10 + (change.materiality ?? 0.3) * 20,
    });
  }

  return cards.sort((a, b) => b.urgency - a.urgency);
}

export function assembleBriefing(input: BriefingInputs): Briefing {
  const ranked = rankCards(input);
  const longGap = (input.daysAway ?? 0) >= LONG_GAP_DAYS;

  // Cards that are about *you* rather than about the world.
  const needsYou = ranked.filter((card) => card.kind !== "change");
  const changes = ranked.filter((card) => card.kind === "change");

  const theOneThing: BriefingCard = needsYou[0] ??
    changes[0] ?? {
      kind: "nothing",
      headline: "Nothing needs you right now.",
      detail:
        input.daysAway === null
          ? "Nothing has been recorded yet — this fills in as the team uses it."
          : "Nothing is waiting and nothing has gone stale. That's a real state, not an empty screen.",
      urgency: 0,
    };

  // Everything else that needs a person, capped. Twelve items is a way of not
  // answering the question this page exists to answer.
  const alsoWaiting = needsYou.filter((c) => c !== theOneThing).slice(0, 4);

  const whileYouWereAway = longGap
    ? {
        // After eleven days a blow-by-blow is a wall of text nobody finishes.
        summary:
          changes.length === 0
            ? `Nothing was recorded on the names you've worked on in the ${input.daysAway} days you were away.`
            : `${changes.length} thing${changes.length === 1 ? "" : "s"} happened on names you've worked on while you were away. The weekly email has the five that mattered.`,
        items: [] as BriefingCard[],
      }
    : {
        summary: changes.length === 0 ? null : "Since you last looked:",
        items: changes.slice(0, 6),
      };

  return {
    daysAway: input.daysAway,
    firstEverVisit: input.lastSessionEnd === null,
    theOneThing,
    alsoWaiting,
    whileYouWereAway,
  };
}

/**
 * A sentence for the top of the page that acknowledges the gap.
 *
 * Small thing, but coming back after eleven days to an interface that behaves
 * as though you never left is disorienting, and disorientation is what makes
 * people close the tab.
 */
export function gapGreeting(daysAway: number | null, name: string): string {
  if (daysAway === null) return `Welcome, ${name}.`;
  if (daysAway === 0) return `Welcome back, ${name}.`;
  if (daysAway === 1) return `Welcome back, ${name}. You were last here yesterday.`;
  if (daysAway < LONG_GAP_DAYS) {
    return `Welcome back, ${name}. You were last here ${daysAway} days ago.`;
  }
  return `Welcome back, ${name}. It's been ${daysAway} days — here's where things stand.`;
}
