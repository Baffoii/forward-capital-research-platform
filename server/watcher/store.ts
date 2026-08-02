/**
 * Data access for watcher rules and notifications.
 *
 * Same pattern as the rest of the repo: PostgREST via server/supabase.ts,
 * snake_case <-> camelCase, numerics and timestamps hydrated on the way out.
 */

import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";
import type { Predicate } from "./predicate";

const date = (v: unknown): Date => new Date(String(v));
const dateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(String(v));

function serialize(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return objToSnake(out);
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export interface WatcherRuleRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: string;
  cadence: string;
  predicate: Predicate;
  recipients: string[];
  companyId: number | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
}

function hydrateRule(r: any): WatcherRuleRow {
  return {
    ...r,
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
    createdAt: date(r.createdAt),
  };
}

export type NewWatcherRule = Omit<WatcherRuleRow, "id" | "createdAt">;

export async function listWatcherRules(filter?: {
  cadence?: string;
  enabledOnly?: boolean;
  companyId?: number;
}): Promise<WatcherRuleRow[]> {
  let q = supabase.from("watcher_rules").select("*");
  if (filter?.cadence) q = q.eq("cadence", filter.cadence);
  if (filter?.enabledOnly !== false) q = q.eq("enabled", true);
  const { data, error } = await q;
  throwIfError(error, "listWatcherRules");
  const rows = rowsToCamel<any>(data).map(hydrateRule);
  // A null companyId means "every company we follow", so filtering has to
  // happen here rather than in the query.
  if (filter?.companyId === undefined) return rows;
  return rows.filter(
    (r) => r.companyId === null || r.companyId === filter.companyId,
  );
}

/** Idempotent by slug — rules get re-seeded and must not duplicate. */
export async function upsertWatcherRule(
  rule: NewWatcherRule,
): Promise<WatcherRuleRow> {
  const { data, error } = await supabase
    .from("watcher_rules")
    .upsert(serialize(rule), { onConflict: "slug" })
    .select()
    .single();
  throwIfError(error, "upsertWatcherRule");
  return hydrateRule(rowsToCamel<any>([data])[0]);
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export interface NotificationRow {
  id: string;
  kind: string;
  ruleId: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
  payload: Record<string, unknown>;
  companyId: number | null;
  ticker: string | null;
  dedupeKey: string;
  createdAt: Date;
  sentAt: Date | null;
  sendAttempts: number;
  sendError: string | null;
  clickedAt: Date | null;
}

export type NewNotification = Omit<
  NotificationRow,
  "id" | "createdAt" | "sentAt" | "sendAttempts" | "sendError" | "clickedAt"
>;

function hydrateNotification(r: any): NotificationRow {
  return {
    ...r,
    payload: r.payload ?? {},
    createdAt: date(r.createdAt),
    sentAt: dateOrNull(r.sentAt),
    clickedAt: dateOrNull(r.clickedAt),
  };
}

/**
 * Queue notifications, skipping any dedupe key we already hold.
 *
 * ON CONFLICT DO NOTHING is what makes the cron safe to retry. Without it a
 * retried run emails the same alert twice, and a channel that repeats itself
 * gets muted — which costs more than the missed run would have.
 *
 * Returns only the genuinely new rows.
 */
export async function queueNotifications(
  notifications: NewNotification[],
): Promise<NotificationRow[]> {
  if (notifications.length === 0) return [];
  const { data, error } = await supabase
    .from("notifications")
    .upsert(notifications.map(serialize), {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
    })
    .select();
  throwIfError(error, "queueNotifications");
  return rowsToCamel<any>(data).map(hydrateNotification);
}

/** Oldest first — if there's a backlog, the oldest alert is the most overdue. */
export async function listPendingNotifications(
  limit = 20,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .is("sent_at", null)
    // Three strikes then stop retrying, so one permanently broken address
    // can't consume every dispatch run forever.
    .lt("send_attempts", 3)
    .order("created_at", { ascending: true })
    .limit(limit);
  throwIfError(error, "listPendingNotifications");
  return rowsToCamel<any>(data).map(hydrateNotification);
}

export async function listNotificationsFor(
  recipientEmail: string,
  limit = 50,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_email", recipientEmail)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIfError(error, "listNotificationsFor");
  return rowsToCamel<any>(data).map(hydrateNotification);
}

export async function markSent(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ sent_at: new Date().toISOString(), send_error: null })
    .eq("id", id);
  throwIfError(error, "markSent");
}

export async function markSendFailed(
  id: string,
  attempts: number,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ send_attempts: attempts + 1, send_error: message.slice(0, 500) })
    .eq("id", id);
  throwIfError(error, "markSendFailed");
}

/* ------------------------------------------------------------------ */
/* Kill criteria — falsification, already in the database              */
/* ------------------------------------------------------------------ */

/**
 * The kill_criteria table predates this phase (shared/schema.constraints.ts).
 * Its rows are already JSON predicates in the { metric, op, value } shape, and
 * server/watcher/predicate.ts evaluates that shape unchanged — so the watcher
 * checks them without anything being rewritten or migrated.
 *
 * These are the highest-priority thing the watcher does. A kill criterion is
 * the team writing down, in advance, what would prove them wrong; noticing it
 * has happened is the entire value of having written it.
 */
export interface KillCriterionRow {
  id: string;
  companyId: number | null;
  constraintId: string | null;
  statement: string;
  predicate: Predicate;
  status: string;
  triggeredAt: Date | null;
  triggeredBy: Record<string, unknown> | null;
}

export async function listArmedKillCriteria(
  companyId?: number,
): Promise<KillCriterionRow[]> {
  let q = supabase.from("kill_criteria").select("*").eq("status", "armed");
  const { data, error } = await q;
  throwIfError(error, "listArmedKillCriteria");
  const rows = rowsToCamel<any>(data).map((r) => ({
    ...r,
    triggeredAt: dateOrNull(r.triggeredAt),
  })) as KillCriterionRow[];
  if (companyId === undefined) return rows;
  // A null companyId means the criterion is about a constraint, not one name,
  // so it applies to every company exposed to it.
  return rows.filter((r) => r.companyId === null || r.companyId === companyId);
}

export async function markKillCriterionTriggered(
  id: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("kill_criteria")
    .update({
      status: "triggered",
      triggered_at: new Date().toISOString(),
      triggered_by: evidence,
    })
    .eq("id", id)
    // Only fire once. Re-firing would resend the alert every run and would
    // overwrite the timestamp of when we actually first knew.
    .eq("status", "armed");
  throwIfError(error, "markKillCriterionTriggered");
}

export async function markClicked(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ clicked_at: new Date().toISOString() })
    .eq("id", id)
    // Keep the first click. Overwriting it would lose the response time,
    // which is the interesting number when tuning what gets suppressed.
    .is("clicked_at", null);
  throwIfError(error, "markClicked");
}
