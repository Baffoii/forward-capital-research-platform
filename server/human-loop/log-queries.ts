/**
 * The reasoning over the two logs, separated from the database.
 *
 * Everything in this file is a pure function over arrays of events. That's
 * deliberate: sessionization and open-item resolution are where the subtle
 * bugs live — an off-by-one on a session boundary silently empties someone's
 * re-entry briefing, and a missed closing event leaves a finished handoff
 * nagging forever. Both are cheap to test here and expensive to test through
 * Postgres.
 *
 * server/human-loop/store.ts does the I/O and calls into this.
 */

// Relative, extension-bearing import rather than the @shared alias: this file
// and its test run on bare node with type stripping (see scripts/run-tests.mjs),
// which does no path-alias resolution. shared/human-loop-events.ts has no
// imports of its own for the same reason.
import {
  CLOSES_OPEN_ITEM,
  CLOSING_KINDS,
  SESSION_GAP_MINUTES,
} from "../../shared/human-loop-events.ts";

export const SESSION_GAP_MS = SESSION_GAP_MINUTES * 60 * 1000;

/** The bits of a human event this file reasons about. */
export interface HumanEventLike {
  id: string;
  userId: string;
  userEmail: string;
  sessionId: string;
  kind: string;
  summary: string;
  companyId?: number | null;
  ticker?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  occurredAt: Date;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which session a new event belongs to.
 *
 * `mostRecent` is the user's latest existing event, or null if they have never
 * done anything. `newSessionId` is injected rather than generated here so the
 * function stays pure and testable.
 */
export function sessionIdForNewEvent(
  mostRecent: Pick<HumanEventLike, "sessionId" | "occurredAt"> | null,
  now: Date,
  newSessionId: () => string,
): string {
  if (!mostRecent) return newSessionId();
  const gap = now.getTime() - mostRecent.occurredAt.getTime();
  // A clock skew or an out-of-order write must not silently merge two visits
  // separated by a week, so a negative gap also starts a fresh session.
  if (gap < 0 || gap > SESSION_GAP_MS) return newSessionId();
  return mostRecent.sessionId;
}

/**
 * When this user last stopped looking — the end of the session BEFORE the one
 * they're in now.
 *
 * This is the anchor for "what's changed since you last looked". Using the
 * current session's start would be wrong the moment they click twice, and
 * using the newest event would always return "nothing changed".
 *
 * `events` must be the user's events, newest first. Returns null if this is
 * their first-ever session, which callers should read as "show them the
 * important standing state rather than a diff".
 */
export function previousSessionEnd(
  events: Pick<HumanEventLike, "sessionId" | "occurredAt">[],
  currentSessionId: string,
): Date | null {
  for (const event of events) {
    if (event.sessionId !== currentSessionId) return event.occurredAt;
  }
  return null;
}

/**
 * How long has this person been away, in whole days. Used to decide how much
 * to reconstruct: after eleven days you want the standing state, not a
 * blow-by-blow. Eleven days is the normal case for this team, not the edge.
 */
export function daysAway(lastSeen: Date | null, now: Date): number | null {
  if (!lastSeen) return null;
  const ms = now.getTime() - lastSeen.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/* ------------------------------------------------------------------ */
/* Open items                                                          */
/* ------------------------------------------------------------------ */

export interface OpenItem {
  /** The event that opened it. */
  openedBy: HumanEventLike;
  subjectType: string;
  subjectId: string;
  openedAt: Date;
  /** Whole days it has been open. */
  ageDays: number;
}

function subjectKey(event: HumanEventLike): string | null {
  if (!event.subjectType || !event.subjectId) return null;
  return `${event.subjectType}::${event.subjectId}`;
}

/**
 * What's still open, across a set of events.
 *
 * An item opens with one kind and closes with another naming the same subject.
 * Nothing is updated in place — closing is a new row — so "open" is always a
 * question about the log, never a column someone forgot to set.
 *
 * Pass the events for one person to get that person's open items; pass
 * everyone's to get the team's.
 */
export function openItems(events: HumanEventLike[], now: Date): OpenItem[] {
  const closedKeys = new Set<string>();
  const openers = new Map<string, HumanEventLike>();

  // Sorted oldest-first so that reopening the same subject after closing it
  // (which is legitimate — a question can come back) resolves to open.
  const chronological = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  for (const event of chronological) {
    const key = subjectKey(event);
    if (!key) continue;

    if (CLOSES_OPEN_ITEM[event.kind]) {
      openers.set(key, event);
      closedKeys.delete(key);
      continue;
    }

    if (CLOSING_KINDS.includes(event.kind)) closedKeys.add(key);
  }

  const out: OpenItem[] = [];
  // Array.from rather than iterating the Map directly: tsconfig.json sets no
  // `target`, so tsc defaults to ES5 and rejects Map iteration.
  for (const [key, opener] of Array.from(openers.entries())) {
    if (closedKeys.has(key)) continue;
    out.push({
      openedBy: opener,
      subjectType: opener.subjectType!,
      subjectId: opener.subjectId!,
      openedAt: opener.occurredAt,
      ageDays: Math.max(
        0,
        Math.floor(
          (now.getTime() - opener.occurredAt.getTime()) / (24 * 60 * 60 * 1000),
        ),
      ),
    });
  }

  // Oldest first — the thing that's been hanging longest is the thing most
  // likely to have been silently dropped.
  return out.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
}

/* ------------------------------------------------------------------ */
/* Attention                                                           */
/* ------------------------------------------------------------------ */

/**
 * When did anyone last look at each company.
 *
 * Note "anyone", not "you". The research queue uses this to avoid sending two
 * people at the same name, and framing it at team level is deliberate: a
 * per-person version of this number is a scorecard, and a scorecard makes
 * people log dishonestly. These logs feed the research queue, so dishonest
 * logs would corrupt the thing they're for.
 */
export function lastLookedAtByCompany(
  events: HumanEventLike[],
): Map<number, Date> {
  const out = new Map<number, Date>();
  for (const event of events) {
    if (event.companyId == null) continue;
    const current = out.get(event.companyId);
    if (!current || event.occurredAt > current) {
      out.set(event.companyId, event.occurredAt);
    }
  }
  return out;
}

/**
 * Companies somebody has already decided aren't worth more time, and when.
 *
 * The research queue must not keep proposing a name that was deliberately
 * passed on last week. A pass is a result; treating it as an absence of work
 * is what makes a queue feel like it's ignoring you.
 */
export function passedOnByCompany(events: HumanEventLike[]): Map<number, Date> {
  const out = new Map<number, Date>();
  for (const event of events) {
    if (event.kind !== "concluded_not_worth_more_time") continue;
    if (event.companyId == null) continue;
    const current = out.get(event.companyId);
    if (!current || event.occurredAt > current) {
      out.set(event.companyId, event.occurredAt);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* World events                                                        */
/* ------------------------------------------------------------------ */

export interface WorldEventLike {
  id: string;
  kind: string;
  companyId?: number | null;
  ticker?: string | null;
  headline: string;
  detail?: string | null;
  materiality?: number | null;
  knownAt: Date;
  occurredAt: Date;
  sourceUrl?: string | null;
  payload: Record<string, unknown>;
}

/**
 * World events we could have known about in a window.
 *
 * Filters on knownAt, never occurredAt. A 10-Q covering last quarter that
 * lands today is news today — filtering on when the quarter ended would hide
 * it from the digest that should carry it.
 */
export function knownBetween<T extends { knownAt: Date }>(
  events: T[],
  from: Date | null,
  to: Date,
): T[] {
  return events.filter(
    (e) => e.knownAt <= to && (from === null || e.knownAt > from),
  );
}
