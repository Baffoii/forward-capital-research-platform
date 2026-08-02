/**
 * When to put someone's earlier reasoning back in front of them.
 *
 * The point of a decision journal is not that it exists — it's that you read
 * it again at the moment it's uncomfortable. Left to ourselves we reread the
 * reasoning on positions that are working and never look at the ones that
 * aren't, which is exactly backwards.
 *
 * So the system decides when, not the author. Five triggers, in the order they
 * matter:
 *
 *   1. A kill criterion is CLOSE to firing — the most valuable moment to
 *      reread the falsifier is just before it's met, not after.
 *   2. Results came out. The company just told us something.
 *   3. A large price move. The market disagrees with something.
 *   4. The date they said to expect something by has passed.
 *   5. Nothing for a quarter. A thesis nobody has looked at in three months
 *      is a thesis nobody is checking.
 *
 * Pure and dependency-free so the rules can be tested directly. The database
 * work is in ./store.ts.
 */

/** Relative distance from a numeric threshold that counts as "close". */
export const KILL_CRITERION_NEAR_BAND = 0.15;
/** Absolute price move, in percent, that's worth a second look. */
export const LARGE_PRICE_MOVE_PCT = 15;
/** Longest a live thesis goes unread. */
export const STALE_AFTER_DAYS = 90;
/** Nobody gets asked about the same entry twice in this window. */
export const REVIEW_COOLDOWN_DAYS = 7;

export interface JournalEntryLike {
  id: string;
  companyId: number;
  ticker?: string | null;
  authorEmail: string;
  expectBy?: Date | null;
  status: string;
  createdAt: Date;
}

export interface WorldEventLike {
  id: string;
  kind: string;
  companyId?: number | null;
  headline: string;
  payload: Record<string, unknown>;
  knownAt: Date;
}

/** A kill criterion with its current reading, for closeness checks. */
export interface KillCriterionReading {
  id: string;
  statement: string;
  /** "lt" | "lte" | "gt" | "gte" — anything else can't be measured for nearness. */
  op: string;
  threshold: number;
  /** The value right now. Null when we don't hold the data. */
  actual: number | null;
  status: string;
}

export type TriggerKind =
  | "kill_criterion_near"
  | "earnings"
  | "price_move"
  | "expectation_due"
  | "scheduled";

export interface Resurfacing {
  entryId: string;
  triggerKind: TriggerKind;
  /** One plain-language sentence: why you're being asked now. */
  reason: string;
  /** Ranking weight. Higher goes first. */
  urgency: number;
  payload: Record<string, unknown>;
}

/**
 * How close a criterion is to being met, as a fraction of the threshold.
 *
 * Returns null when it can't be measured — no reading, an operator that isn't
 * a numeric comparison, or a zero threshold where "15% away" is meaningless.
 * Null means "don't know", never "not close": a criterion we've stopped being
 * able to measure should surface through the watcher's uncheckable path, not
 * quietly count as fine here.
 */
export function distanceToTrigger(
  criterion: KillCriterionReading,
): number | null {
  if (criterion.actual === null || !Number.isFinite(criterion.actual)) return null;
  if (!Number.isFinite(criterion.threshold) || criterion.threshold === 0) return null;
  if (!["lt", "lte", "gt", "gte"].includes(criterion.op)) return null;

  const gap = criterion.actual - criterion.threshold;
  const relative = gap / Math.abs(criterion.threshold);

  // For "below X" criteria we're close when the value is a little ABOVE the
  // threshold and falling toward it; the mirror holds for "above X". A value
  // already past the threshold has fired, and firing is the watcher's job.
  if (criterion.op === "lt" || criterion.op === "lte") {
    return relative >= 0 ? relative : null;
  }
  return relative <= 0 ? -relative : null;
}

export function isNearTrigger(criterion: KillCriterionReading): boolean {
  const distance = distanceToTrigger(criterion);
  return distance !== null && distance <= KILL_CRITERION_NEAR_BAND;
}

/**
 * Decide whether one entry is due, and why.
 *
 * `lastReviewedAt` is when this entry was last put in front of anyone — null
 * if never. The cooldown applies to every trigger: an entry that surfaced
 * yesterday for a price move should not surface again today for earnings, or
 * the resurfacing becomes noise and gets ignored, which is the one failure
 * mode that makes the whole feature worthless.
 */
export function resurfacingFor(
  entry: JournalEntryLike,
  context: {
    now: Date;
    lastReviewedAt: Date | null;
    /** World events for this company since the last review. */
    recentEvents: WorldEventLike[];
    /** Armed kill criteria for this company, with current readings. */
    killCriteria: KillCriterionReading[];
  },
): Resurfacing | null {
  if (entry.status !== "open") return null;

  const { now, lastReviewedAt, recentEvents, killCriteria } = context;
  const since = lastReviewedAt ?? entry.createdAt;

  if (lastReviewedAt) {
    const daysSince = (now.getTime() - lastReviewedAt.getTime()) / 86_400_000;
    if (daysSince < REVIEW_COOLDOWN_DAYS) return null;
  }

  const label = entry.ticker ?? "this position";

  // 1. Nearly falsified. The most valuable moment to reread what you said
  //    would change your mind is just before it happens.
  const near = killCriteria
    .filter((c) => c.status === "armed" && isNearTrigger(c))
    .sort((a, b) => (distanceToTrigger(a) ?? 1) - (distanceToTrigger(b) ?? 1))[0];
  if (near) {
    const pct = Math.round((distanceToTrigger(near) ?? 0) * 100);
    return {
      entryId: entry.id,
      triggerKind: "kill_criterion_near",
      reason:
        `${label} is within ${pct}% of something you said would prove you wrong: ` +
        `"${near.statement}"`,
      urgency: 100 - pct,
      payload: {
        killCriterionId: near.id,
        statement: near.statement,
        threshold: near.threshold,
        actual: near.actual,
        distancePct: pct,
      },
    };
  }

  // 2. The company just told us something.
  const earnings = recentEvents.find(
    (e) => e.kind === "earnings_reported" && e.knownAt > since,
  );
  if (earnings) {
    return {
      entryId: entry.id,
      triggerKind: "earnings",
      reason: `${label} reported. ${earnings.headline}`,
      urgency: 70,
      payload: { worldEventId: earnings.id, headline: earnings.headline },
    };
  }

  // 3. The market disagrees with something.
  const move = recentEvents
    .filter((e) => e.kind === "price_move" && e.knownAt > since)
    .map((e) => ({ event: e, pct: Number(e.payload?.changePct) }))
    .filter((m) => Number.isFinite(m.pct) && Math.abs(m.pct) >= LARGE_PRICE_MOVE_PCT)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
  if (move) {
    const direction = move.pct > 0 ? "up" : "down";
    return {
      entryId: entry.id,
      triggerKind: "price_move",
      reason: `${label} moved ${direction} ${Math.abs(move.pct).toFixed(1)}% since you last looked at this.`,
      urgency: 50 + Math.min(20, Math.abs(move.pct) / 2),
      payload: { worldEventId: move.event.id, changePct: move.pct },
    };
  }

  // 4. The date they named has arrived.
  if (entry.expectBy && entry.expectBy <= now) {
    const daysLate = Math.floor((now.getTime() - entry.expectBy.getTime()) / 86_400_000);
    return {
      entryId: entry.id,
      triggerKind: "expectation_due",
      reason:
        daysLate === 0
          ? `You said you'd know about ${label} by today.`
          : `You said you'd know about ${label} ${daysLate} day${daysLate === 1 ? "" : "s"} ago.`,
      urgency: 40 + Math.min(20, daysLate),
      payload: { expectBy: entry.expectBy.toISOString(), daysLate },
    };
  }

  // 5. The floor. A live thesis nobody has reread in a quarter is a thesis
  //    nobody is checking.
  const daysSince = (now.getTime() - since.getTime()) / 86_400_000;
  if (daysSince >= STALE_AFTER_DAYS) {
    return {
      entryId: entry.id,
      triggerKind: "scheduled",
      reason: `Nobody has looked at why we hold ${label} in ${Math.floor(daysSince)} days.`,
      urgency: 10,
      payload: { daysSinceLastLook: Math.floor(daysSince) },
    };
  }

  return null;
}

/** Most urgent first. */
export function rankResurfacings(items: Resurfacing[]): Resurfacing[] {
  return [...items].sort((a, b) => b.urgency - a.urgency);
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

export interface ReviewLike {
  entryId: string;
  stillAgree: string;
  triggerKind: string;
  createdAt: Date;
}

export interface CalibrationSummary {
  reviews: number;
  stillAgree: number;
  changedMind: number;
  partly: number;
  /** 0..1, or null before anyone has reviewed anything. */
  heldUpRate: number | null;
  /** Which triggers most often catch reasoning that has stopped holding. */
  changedMindByTrigger: Record<string, number>;
}

/**
 * Team-level only, on purpose.
 *
 * A per-person "how often were you wrong" number is a scorecard, and a
 * scorecard makes people answer these questions to look good rather than
 * honestly — which would destroy the only dataset here worth having. Changing
 * your mind in the face of evidence is the behaviour this is meant to
 * encourage, so it must never be something you can be ranked on.
 */
export function summarizeCalibration(reviews: ReviewLike[]): CalibrationSummary {
  const changedMindByTrigger: Record<string, number> = {};
  let stillAgree = 0;
  let changedMind = 0;
  let partly = 0;

  for (const review of reviews) {
    if (review.stillAgree === "yes") stillAgree++;
    else if (review.stillAgree === "no") {
      changedMind++;
      changedMindByTrigger[review.triggerKind] =
        (changedMindByTrigger[review.triggerKind] ?? 0) + 1;
    } else if (review.stillAgree === "partly") {
      partly++;
      changedMindByTrigger[review.triggerKind] =
        (changedMindByTrigger[review.triggerKind] ?? 0) + 1;
    }
  }

  const counted = stillAgree + changedMind + partly;
  return {
    reviews: reviews.length,
    stillAgree,
    changedMind,
    partly,
    // "partly" counts as half agreement rather than being dropped — throwing
    // away the middle answer would make the rate look more decisive than the
    // team actually was.
    heldUpRate: counted === 0 ? null : (stillAgree + partly * 0.5) / counted,
    changedMindByTrigger,
  };
}
