/**
 * Data access for pre-commitments.
 *
 * There is no function in this file that places, exports, or formats a trade,
 * and there must never be one. The system notifies; a human acts. See the
 * comment on the table in shared/schema.human-loop.ts.
 */

import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";
import type { Predicate } from "../watcher/predicate";

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

export interface PrecommitmentRow {
  id: string;
  companyId: number;
  ticker: string | null;
  authorId: string;
  authorEmail: string;
  conditionText: string;
  actionText: string;
  reasoning: string;
  predicate: Predicate;
  status: string;
  metAt: Date | null;
  metContext: Record<string, unknown> | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  createdAt: Date;
}

function hydrate(r: any): PrecommitmentRow {
  return {
    ...r,
    metAt: dateOrNull(r.metAt),
    acknowledgedAt: dateOrNull(r.acknowledgedAt),
    createdAt: date(r.createdAt),
  };
}

export type NewPrecommitment = Omit<
  PrecommitmentRow,
  | "id"
  | "createdAt"
  | "status"
  | "metAt"
  | "metContext"
  | "acknowledgedAt"
  | "acknowledgedBy"
  | "outcome"
  | "outcomeNote"
>;

export async function createPrecommitment(
  p: NewPrecommitment,
): Promise<PrecommitmentRow> {
  const { data, error } = await supabase
    .from("precommitments")
    .insert(serialize(p))
    .select()
    .single();
  throwIfError(error, "createPrecommitment");
  return hydrate(rowsToCamel<any>([data])[0]);
}

export async function getPrecommitment(
  id: string,
): Promise<PrecommitmentRow | null> {
  const { data, error } = await supabase
    .from("precommitments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "getPrecommitment");
  return data ? hydrate(rowsToCamel<any>([data])[0]) : null;
}

export async function listPrecommitments(filter?: {
  companyId?: number;
  status?: string;
}): Promise<PrecommitmentRow[]> {
  let q = supabase.from("precommitments").select("*");
  if (filter?.companyId !== undefined) q = q.eq("company_id", filter.companyId);
  if (filter?.status) q = q.eq("status", filter.status);
  const { data, error } = await q.order("created_at", { ascending: false });
  throwIfError(error, "listPrecommitments");
  return rowsToCamel<any>(data).map(hydrate);
}

/**
 * Mark a condition met.
 *
 * Guarded on status so it fires once. Re-firing would resend the alert every
 * run and overwrite the timestamp of when the condition was actually first
 * met, which is the number you'd want if you ever asked how quickly the team
 * acted on its own rules.
 */
export async function markMet(
  id: string,
  context: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("precommitments")
    .update({
      status: "met",
      met_at: new Date().toISOString(),
      met_context: context,
    })
    .eq("id", id)
    .eq("status", "armed");
  throwIfError(error, "markMet");
}

/**
 * Record what the human actually did.
 *
 * `outcome` is one of followed | ignored | changed_mind. "Ignored" is a real,
 * recordable answer on purpose — the gap between what people decide when calm
 * and what they do when it happens is the most interesting thing this table
 * holds, and it only shows up if not following through is easy to admit.
 */
export async function acknowledge(
  id: string,
  by: string,
  outcome: string,
  note: string | null,
): Promise<PrecommitmentRow | null> {
  const { data, error } = await supabase
    .from("precommitments")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: by,
      outcome,
      outcome_note: note,
      status: "retired",
    })
    .eq("id", id)
    .select()
    .maybeSingle();
  throwIfError(error, "acknowledge");
  return data ? hydrate(rowsToCamel<any>([data])[0]) : null;
}

export async function retirePrecommitment(id: string): Promise<void> {
  const { error } = await supabase
    .from("precommitments")
    .update({ status: "retired" })
    .eq("id", id);
  throwIfError(error, "retirePrecommitment");
}
