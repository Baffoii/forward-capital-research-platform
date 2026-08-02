/**
 * The vocabulary of the two logs: what kinds of thing happen, and which of
 * them close which.
 *
 * Kept separate from shared/schema.human-loop.ts (which defines the tables)
 * for one practical reason: this file has no imports at all, so the pure
 * reasoning over the logs can be unit-tested on bare node the same way
 * server/scoring/* is. Pulling in drizzle just to read a list of strings
 * would make the tests need a bundler.
 *
 * Labels are plain language because these strings end up in emails and on
 * screen. Nobody on this team is a trained finance professional.
 */

/* ------------------------------------------------------------------ */
/* What the world does                                                 */
/* ------------------------------------------------------------------ */

export const WORLD_EVENT_KINDS = {
  filing_published: "New filing published",
  price_move: "Large price move",
  score_change: "Our score for this company changed",
  analyst_count_change: "Number of analysts covering it changed",
  etf_inclusion: "Added to a themed index fund",
  recognition_change: "The market is noticing this name more",
  estimate_revision: "Analysts changed their forecasts",
  kill_criterion_fired: "Something we said would prove us wrong has happened",
  constraint_state_change: "A supply bottleneck got tighter or looser",
  earnings_reported: "Quarterly results came out",
  signal_recorded: "A new piece of evidence was recorded",
} as const;

export type WorldEventKind = keyof typeof WORLD_EVENT_KINDS;

export function worldEventLabel(kind: string): string {
  return (WORLD_EVENT_KINDS as Record<string, string>)[kind] ?? kind;
}

/* ------------------------------------------------------------------ */
/* What we do                                                          */
/* ------------------------------------------------------------------ */

/**
 * One entry here matters more than the rest: `concluded_not_worth_more_time`.
 *
 * Deciding a name isn't worth another hour IS a result — often the most
 * valuable hour of the week, because it takes something off everyone's list.
 * If the only recorded outcomes were "found something" and "still working",
 * these logs would reward activity, and the research queue reads these logs.
 */
export const HUMAN_EVENT_KINDS = {
  viewed_company: "Looked at a company",
  recorded_conclusion: "Wrote down a conclusion",
  concluded_not_worth_more_time: "Decided this isn't worth more time",
  opened_question: "Opened a question",
  closed_question: "Answered a question",
  committed_to_action: "Committed to doing something later",
  completed_action: "Did the thing they committed to",
  dropped_action: "Decided not to do the thing after all",
  handed_off: "Handed work to a teammate",
  accepted_handoff: "Accepted work from a teammate",
  closed_handoff: "Finished handed-off work",
  claimed_research: "Claimed a research item",
  released_research: "Let go of a research item",
  finished_research: "Finished a research item",
  wrote_journal_entry: "Wrote down the reasoning for a position",
  reviewed_journal_entry: "Revisited earlier reasoning",
  set_precommitment: "Wrote a rule for what to do if X happens",
  clicked_digest_item: "Opened something from the weekly email",
  session_started: "Opened the app",
} as const;

export type HumanEventKind = keyof typeof HUMAN_EVENT_KINDS;

export function humanEventLabel(kind: string): string {
  return (HUMAN_EVENT_KINDS as Record<string, string>)[kind] ?? kind;
}

/**
 * Outcomes that count as finishing a piece of work rather than abandoning it.
 *
 * Deciding something isn't worth more time is in here on purpose. It is a real
 * result and the team-level counts should say so.
 */
export const REAL_RESULT_KINDS: readonly string[] = [
  "recorded_conclusion",
  "concluded_not_worth_more_time",
  "closed_question",
  "completed_action",
  "closed_handoff",
  "finished_research",
];

/**
 * Which kinds close which.
 *
 * An item opens with one kind and closes with another naming the same subject.
 * Closure is always a NEW row — nothing in either log is ever updated — so
 * "still open" is a question you ask the log, not a column someone forgot to
 * set.
 */
export const CLOSES_OPEN_ITEM: Record<string, readonly string[]> = {
  opened_question: ["closed_question", "concluded_not_worth_more_time"],
  committed_to_action: ["completed_action", "dropped_action"],
  // Accepting a handoff does NOT close it. The work is still outstanding; only
  // finishing it closes it. This is the whole point of the escalation rule.
  handed_off: ["closed_handoff"],
  claimed_research: [
    "released_research",
    "finished_research",
    "concluded_not_worth_more_time",
  ],
};

/** Every kind that closes something. */
export const CLOSING_KINDS: readonly string[] = Array.from(
  new Set(Object.values(CLOSES_OPEN_ITEM).flat()),
);

/**
 * A gap longer than this starts a new session. Half an hour is long enough to
 * cover reading a filing in another tab, short enough that yesterday evening
 * and this morning are correctly two separate visits.
 */
export const SESSION_GAP_MINUTES = 30;
