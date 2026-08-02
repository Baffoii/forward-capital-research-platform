/**
 * Reading and writing the two logs.
 *
 * Follows the repo's existing data-access pattern: PostgREST via
 * server/supabase.ts with snake_case <-> camelCase conversion, hydrating
 * `numeric` (which arrives as a string) and `timestamptz` (which arrives as an
 * ISO string) so nothing downstream does arithmetic on a string.
 *
 * The reasoning over what comes back lives in ./log-queries.ts, which is pure
 * and tested. This file is the plumbing.
 *
 * APPEND-ONLY: there is no update function and no delete function in here, and
 * there should never be one. The database enforces it too — see the trigger in
 * the migration. Correcting a mistaken event means appending a correcting
 * event, the same way a ledger works.
 */

import { randomUUID } from "node:crypto";
import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";
import {
  sessionIdForNewEvent,
  previousSessionEnd,
  type HumanEventLike,
  type WorldEventLike,
} from "./log-queries";

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const date = (v: unknown): Date => new Date(String(v));

export interface WorldEventRow extends WorldEventLike {
  constraintId: string | null;
  sourceRef: string | null;
  dedupeKey: string;
  createdAt: Date;
}

export interface HumanEventRow extends HumanEventLike {
  rawText: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

function hydrateWorld(r: any): WorldEventRow {
  return {
    ...r,
    materiality: numOrNull(r.materiality),
    payload: r.payload ?? {},
    occurredAt: date(r.occurredAt),
    knownAt: date(r.knownAt),
    createdAt: date(r.createdAt),
  };
}

function hydrateHuman(r: any): HumanEventRow {
  return {
    ...r,
    payload: r.payload ?? {},
    occurredAt: date(r.occurredAt),
    createdAt: date(r.createdAt),
  };
}

/** Dates -> ISO strings so PostgREST accepts them. */
function serialize(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return objToSnake(out);
}

/* ------------------------------------------------------------------ */
/* world_events                                                        */
/* ------------------------------------------------------------------ */

export interface NewWorldEvent {
  kind: string;
  headline: string;
  payload: Record<string, unknown>;
  /** Format "<source>:<stable id>". Re-running a job must not double an event. */
  dedupeKey: string;
  occurredAt: Date;
  knownAt: Date;
  companyId?: number | null;
  ticker?: string | null;
  constraintId?: string | null;
  detail?: string | null;
  materiality?: number | null;
  sourceUrl?: string | null;
  sourceRef?: string | null;
}

/**
 * Append world events, skipping any whose dedupeKey we already have.
 *
 * ON CONFLICT DO NOTHING rather than an upsert: an existing row is the record
 * of what we knew at the time and must not be rewritten by a later re-run.
 * Returns only the rows that were genuinely new, which is what callers need to
 * decide whether to notify.
 */
export async function appendWorldEvents(
  events: NewWorldEvent[],
): Promise<WorldEventRow[]> {
  if (events.length === 0) return [];
  const { data, error } = await supabase
    .from("world_events")
    .upsert(events.map(serialize), {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
    })
    .select();
  throwIfError(error, "appendWorldEvents");
  return rowsToCamel<any>(data).map(hydrateWorld);
}

export async function appendWorldEvent(
  event: NewWorldEvent,
): Promise<WorldEventRow | null> {
  const rows = await appendWorldEvents([event]);
  return rows[0] ?? null;
}

export interface WorldEventFilter {
  /** Exclusive lower bound on knownAt — pass the previous session end. */
  since?: Date | null;
  /** Inclusive upper bound on knownAt. Defaults to now. */
  until?: Date;
  companyId?: number;
  kinds?: string[];
  limit?: number;
}

/**
 * Always filters on knownAt, never occurredAt. A 10-Q covering last quarter
 * that lands today is today's news; filtering on the quarter end would hide it
 * from the digest that should carry it.
 */
export async function listWorldEvents(
  filter: WorldEventFilter = {},
): Promise<WorldEventRow[]> {
  let q = supabase.from("world_events").select("*");
  if (filter.since) q = q.gt("known_at", filter.since.toISOString());
  if (filter.until) q = q.lte("known_at", filter.until.toISOString());
  if (filter.companyId !== undefined) q = q.eq("company_id", filter.companyId);
  if (filter.kinds?.length) q = q.in("kind", filter.kinds);
  q = q.order("known_at", { ascending: false }).limit(filter.limit ?? 500);
  const { data, error } = await q;
  throwIfError(error, "listWorldEvents");
  return rowsToCamel<any>(data).map(hydrateWorld);
}

/** Which dedupe keys we already hold, so a job can skip work rather than writes. */
export async function existingWorldEventKeys(
  keys: string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { data, error } = await supabase
    .from("world_events")
    .select("dedupe_key")
    .in("dedupe_key", keys);
  throwIfError(error, "existingWorldEventKeys");
  return new Set((data ?? []).map((r: any) => r.dedupe_key));
}

/* ------------------------------------------------------------------ */
/* human_events                                                        */
/* ------------------------------------------------------------------ */

export interface NewHumanEvent {
  kind: string;
  summary: string;
  companyId?: number | null;
  ticker?: string | null;
  rawText?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface ActingUser {
  id: string;
  email: string;
}

/**
 * The session this user is currently in, creating a fresh one if they've been
 * away longer than the gap. Called on every write, so it costs one small
 * indexed read — worth it to keep the session concept honest rather than
 * trusting a client-generated id.
 */
export async function currentSessionId(
  userId: string,
  now: Date,
): Promise<string> {
  const { data, error } = await supabase
    .from("human_events")
    .select("session_id, occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(1);
  throwIfError(error, "currentSessionId");
  const latest = (data ?? [])[0];
  return sessionIdForNewEvent(
    latest
      ? { sessionId: latest.session_id, occurredAt: new Date(latest.occurred_at) }
      : null,
    now,
    randomUUID,
  );
}

/**
 * Record that a person did something.
 *
 * Called deliberately at the point of the action, never as a side effect of
 * authentication or of a page poll — otherwise every background refetch
 * becomes an "event" and the logs turn to noise that the research queue then
 * reads as attention.
 */
export async function appendHumanEvent(
  user: ActingUser,
  event: NewHumanEvent,
): Promise<HumanEventRow> {
  const occurredAt = event.occurredAt ?? new Date();
  const sessionId = await currentSessionId(user.id, occurredAt);

  const { data, error } = await supabase
    .from("human_events")
    .insert(
      serialize({
        userId: user.id,
        userEmail: user.email,
        sessionId,
        kind: event.kind,
        summary: event.summary,
        companyId: event.companyId ?? null,
        ticker: event.ticker ?? null,
        rawText: event.rawText ?? null,
        subjectType: event.subjectType ?? null,
        subjectId: event.subjectId ?? null,
        payload: event.payload ?? {},
        occurredAt,
      }),
    )
    .select()
    .single();
  throwIfError(error, "appendHumanEvent");
  return hydrateHuman(rowsToCamel<any>([data])[0]);
}

export interface HumanEventFilter {
  userId?: string;
  /** Exclusive lower bound on occurredAt. */
  since?: Date | null;
  companyId?: number;
  kinds?: string[];
  subjectType?: string;
  subjectId?: string;
  limit?: number;
}

/** Newest first. */
export async function listHumanEvents(
  filter: HumanEventFilter = {},
): Promise<HumanEventRow[]> {
  let q = supabase.from("human_events").select("*");
  if (filter.userId) q = q.eq("user_id", filter.userId);
  if (filter.since) q = q.gt("occurred_at", filter.since.toISOString());
  if (filter.companyId !== undefined) q = q.eq("company_id", filter.companyId);
  if (filter.kinds?.length) q = q.in("kind", filter.kinds);
  if (filter.subjectType) q = q.eq("subject_type", filter.subjectType);
  if (filter.subjectId) q = q.eq("subject_id", filter.subjectId);
  q = q.order("occurred_at", { ascending: false }).limit(filter.limit ?? 500);
  const { data, error } = await q;
  throwIfError(error, "listHumanEvents");
  return rowsToCamel<any>(data).map(hydrateHuman);
}

/**
 * Where this person left off: their current session, when their previous one
 * ended, and everything they've done recently.
 *
 * The 180-day window bounds the read. Someone returning after longer than that
 * is starting fresh for briefing purposes anyway, and open items older than six
 * months have failed at being reminders.
 */
export async function sessionContext(
  userId: string,
  now: Date,
): Promise<{
  sessionId: string;
  lastSessionEnd: Date | null;
  recentEvents: HumanEventRow[];
}> {
  const since = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const recentEvents = await listHumanEvents({ userId, since, limit: 1000 });
  // `sessionId` may be an id no row carries yet — that's the returning-visitor
  // case, and it's why previousSessionEnd then correctly returns their newest
  // existing event. Mid-session it returns the id they're already in, and the
  // same call skips past it to the visit before. Both branches are covered in
  // log-queries.test.ts.
  const sessionId = await currentSessionId(userId, now);
  return {
    sessionId,
    lastSessionEnd: previousSessionEnd(recentEvents, sessionId),
    recentEvents,
  };
}
