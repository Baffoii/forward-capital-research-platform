/**
 * Ranking research by where an hour changes a decision.
 *
 * NOT by how attractive the name is. Those are different questions and
 * conflating them is why research queues fill up with the companies everyone
 * already likes. A name scoring 0.9 with 0.95 confidence is finished — another
 * hour on it produces a slightly better-supported version of a decision that
 * was already made. A name scoring 0.4 with 0.2 confidence might resolve
 * either way, and that hour is worth spending.
 *
 *   value = (potential score movement x intended position size x time sensitivity)
 *           / estimated hours
 *
 * The subtlety is in the first term. Potential movement alone isn't enough:
 * a wildly uncertain score that still couldn't cross the threshold we act on
 * is uncertainty that doesn't matter. What counts is movement that could
 * change what we do.
 *
 * Pure and dependency-free so the ranking can be tested directly.
 */

/** Long score above which we'd actually take a position. */
export const ACTION_THRESHOLD = 0.6;

export interface ScoreState {
  /** 0..1 — our current long score. */
  score: number;
  /** 0..1 — how much we trust it. Deliberately never folded into the score. */
  confidence: number;
}

/**
 * How far the score could still move, given how little we trust it.
 *
 * A confidence of 0.95 means we think the number is nearly settled; 0.2 means
 * it's a guess and could land almost anywhere.
 */
export function potentialMovement(state: ScoreState): number {
  const confidence = Math.min(1, Math.max(0, state.confidence));
  return 1 - confidence;
}

/**
 * Could research plausibly change what we DO, not just what we think?
 *
 * Returns 0..1. Zero means the score can't move far enough to cross the line
 * we act on, so however uncertain it is, the uncertainty is academic.
 *
 * This is the term that separates "we don't know much about this" from "we
 * don't know the thing that would change our mind", and only the second is
 * worth a Saturday.
 */
export function decisionRelevance(
  state: ScoreState,
  threshold = ACTION_THRESHOLD,
): number {
  const movement = potentialMovement(state);
  if (movement <= 0) return 0;

  const distance = Math.abs(state.score - threshold);
  if (distance >= movement) return 0;

  // Closer to the line, and more able to cross it, means more relevant.
  return 1 - distance / movement;
}

export interface ResearchItemInput {
  id: string;
  companyId: number;
  ticker: string | null;
  /** The question an hour would answer. */
  question: string;
  state: ScoreState;
  /** How big a position we'd take if this resolved well, as % of book. */
  intendedPositionPct: number;
  /** 0..1 — does this decay if we wait. Earnings next week is a 1. */
  timeSensitivity: number;
  estimatedHours: number;
}

export interface ScoredResearchItem extends ResearchItemInput {
  potentialMovement: number;
  decisionRelevance: number;
  /** Value of the whole piece of work. */
  value: number;
  /** Value per hour — what the ranking actually uses. */
  valuePerHour: number;
  /** Plain language, so the ranking can be argued with. */
  rationale: string;
}

export function scoreResearchItem(item: ResearchItemInput): ScoredResearchItem {
  const movement = potentialMovement(item.state);
  const relevance = decisionRelevance(item.state);
  const hours = Math.max(0.5, item.estimatedHours);

  const value = movement * relevance * item.intendedPositionPct * item.timeSensitivity;
  const valuePerHour = value / hours;

  let rationale: string;
  if (relevance === 0) {
    rationale =
      item.state.confidence >= 0.8
        ? `We're already confident about this one (${item.state.confidence.toFixed(2)}). More work makes the answer better-supported, not different.`
        : `Even if the score moved as far as it plausibly could, it wouldn't cross the line we act on. The uncertainty here doesn't change anything.`;
  } else {
    rationale =
      `Score ${item.state.score.toFixed(2)} at confidence ${item.state.confidence.toFixed(2)} — this could still land on either side of the line. ` +
      `Worth roughly ${item.intendedPositionPct.toFixed(1)}% of the book if it resolves well.`;
  }

  return {
    ...item,
    potentialMovement: movement,
    decisionRelevance: relevance,
    value,
    valuePerHour,
    rationale,
  };
}

/* ------------------------------------------------------------------ */
/* Cutting to fit                                                      */
/* ------------------------------------------------------------------ */

export interface Suppression {
  item: ScoredResearchItem;
  /** Why this isn't happening, in plain language. */
  why: string;
}

export interface Plan {
  doing: ScoredResearchItem[];
  hoursUsed: number;
  hoursAvailable: number;
  /**
   * What is NOT being done, and why. This list is the point of the feature —
   * a queue that quietly truncates lets you believe you're on top of things.
   * Being told what you're not doing is the deliverable.
   */
  notDoing: Suppression[];
}

export interface AttentionContext {
  /** When anyone last looked at each company. Team-level on purpose. */
  lastLookedAt?: Map<number, Date>;
  /** Companies somebody deliberately passed on, and when. */
  passedOn?: Map<number, Date>;
  /** Company ids someone currently has claimed. */
  claimedBy?: Map<number, string>;
  now?: Date;
}

/** Recently-passed-on names stay off the queue for this long. */
export const PASS_RESPECTED_DAYS = 30;
/** Names looked at this recently are assumed to be in hand. */
export const RECENTLY_LOOKED_DAYS = 3;

/**
 * Rank, apply what the logs already tell us, and cut to the hours we have.
 *
 * Greedy by value-per-hour, which is correct here: the items are roughly
 * comparable in size and the alternative — solving a knapsack — would produce
 * an ordering nobody could argue with by eye, which matters more than the last
 * few percent of efficiency.
 */
export function planResearch(
  items: ScoredResearchItem[],
  hoursAvailable: number,
  context: AttentionContext = {},
): Plan {
  const now = context.now ?? new Date();
  const dayMs = 86_400_000;

  const ranked = [...items].sort((a, b) => b.valuePerHour - a.valuePerHour);
  const doing: ScoredResearchItem[] = [];
  const notDoing: Suppression[] = [];
  let hoursUsed = 0;

  for (const item of ranked) {
    // Somebody already has it. The whole reason claims exist is so two people
    // don't spend the same Saturday on the same name.
    const claimant = context.claimedBy?.get(item.companyId);
    if (claimant) {
      notDoing.push({ item, why: `${claimant} already has this one.` });
      continue;
    }

    // Somebody looked at this and decided it wasn't worth more time. That is a
    // result, and re-proposing it every week would make the decision feel
    // ignored — which is how a queue teaches people to stop recording passes.
    const passed = context.passedOn?.get(item.companyId);
    if (passed) {
      const days = Math.floor((now.getTime() - passed.getTime()) / dayMs);
      if (days < PASS_RESPECTED_DAYS) {
        notDoing.push({
          item,
          why: `Someone looked at this ${days} day${days === 1 ? "" : "s"} ago and concluded it wasn't worth more time.`,
        });
        continue;
      }
    }

    const looked = context.lastLookedAt?.get(item.companyId);
    if (looked) {
      const days = Math.floor((now.getTime() - looked.getTime()) / dayMs);
      if (days < RECENTLY_LOOKED_DAYS) {
        notDoing.push({
          item,
          why: `Somebody was looking at this ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`} — probably already in hand.`,
        });
        continue;
      }
    }

    // An hour that can't change a decision isn't research, it's reassurance.
    if (item.decisionRelevance === 0) {
      notDoing.push({ item, why: item.rationale });
      continue;
    }

    if (hoursUsed + item.estimatedHours > hoursAvailable) {
      notDoing.push({
        item,
        why: `Below the line at ${hoursAvailable} hours. Worth doing — there just isn't time this week.`,
      });
      continue;
    }

    doing.push(item);
    hoursUsed += item.estimatedHours;
  }

  return { doing, hoursUsed, hoursAvailable, notDoing };
}

/**
 * One sentence for the top of the queue.
 *
 * Deliberately leads with what's being dropped rather than what's being done.
 * Everyone already knows what they're working on; what they don't know is what
 * they've implicitly decided to skip.
 */
export function summarizePlan(plan: Plan): string {
  if (plan.doing.length === 0 && plan.notDoing.length === 0) {
    return "Nothing in the queue.";
  }
  if (plan.doing.length === 0) {
    return `Nothing is worth doing with ${plan.hoursAvailable} hours. ${plan.notDoing.length} item${plan.notDoing.length === 1 ? "" : "s"} considered and skipped — the reasons are below.`;
  }

  const outOfTime = plan.notDoing.filter((s) => s.why.startsWith("Below the line")).length;
  const parts = [
    `${plan.doing.length} thing${plan.doing.length === 1 ? "" : "s"} fit in ${plan.hoursAvailable} hours (${plan.hoursUsed.toFixed(1)} used).`,
  ];
  if (outOfTime > 0) {
    parts.push(
      `${outOfTime} worth doing didn't fit — that's the cost of this week's hours, and it's listed below rather than hidden.`,
    );
  }
  const other = plan.notDoing.length - outOfTime;
  if (other > 0) {
    parts.push(`${other} more were skipped for reasons other than time.`);
  }
  return parts.join(" ");
}
