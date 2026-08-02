/**
 * Data access for the decision journal.
 *
 * Entries are written once and never edited — the value of the record is that
 * it says what you thought then. There is no update function for entry text,
 * only a status change when a position closes. Changing your mind is a review
 * row, not an edit.
 */

import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";

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
/* Entries                                                             */
/* ------------------------------------------------------------------ */

export interface JournalEntryRow {
  id: string;
  companyId: number;
  ticker: string | null;
  positionId: string | null;
  authorId: string;
  authorEmail: string;
  belief: string;
  expectation: string;
  expectBy: Date | null;
  falsifier: string;
  rawText: string | null;
  status: string;
  createdAt: Date;
}

function hydrateEntry(r: any): JournalEntryRow {
  return {
    ...r,
    expectBy: dateOrNull(r.expectBy),
    createdAt: date(r.createdAt),
  };
}

export type NewJournalEntry = Omit<JournalEntryRow, "id" | "createdAt" | "status"> & {
  status?: string;
};

export async function createJournalEntry(
  entry: NewJournalEntry,
): Promise<JournalEntryRow> {
  const { data, error } = await supabase
    .from("journal_entries")
    .insert(serialize(entry))
    .select()
    .single();
  throwIfError(error, "createJournalEntry");
  return hydrateEntry(rowsToCamel<any>([data])[0]);
}

export async function getJournalEntry(id: string): Promise<JournalEntryRow | null> {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "getJournalEntry");
  return data ? hydrateEntry(rowsToCamel<any>([data])[0]) : null;
}

export async function listJournalEntries(filter?: {
  companyId?: number;
  status?: string;
}): Promise<JournalEntryRow[]> {
  let q = supabase.from("journal_entries").select("*");
  if (filter?.companyId !== undefined) q = q.eq("company_id", filter.companyId);
  if (filter?.status) q = q.eq("status", filter.status);
  const { data, error } = await q.order("created_at", { ascending: false });
  throwIfError(error, "listJournalEntries");
  return rowsToCamel<any>(data).map(hydrateEntry);
}

/**
 * The only mutation on an entry: marking it closed when the position is out.
 * Nothing that a human wrote is touched.
 */
export async function closeJournalEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("journal_entries")
    .update({ status: "closed" })
    .eq("id", id);
  throwIfError(error, "closeJournalEntry");
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export interface JournalReviewRow {
  id: string;
  entryId: string;
  reviewerId: string;
  reviewerEmail: string;
  triggerKind: string;
  triggerPayload: Record<string, unknown>;
  stillAgree: string;
  note: string | null;
  createdAt: Date;
}

function hydrateReview(r: any): JournalReviewRow {
  return {
    ...r,
    triggerPayload: r.triggerPayload ?? {},
    createdAt: date(r.createdAt),
  };
}

export type NewJournalReview = Omit<JournalReviewRow, "id" | "createdAt">;

export async function createJournalReview(
  review: NewJournalReview,
): Promise<JournalReviewRow> {
  const { data, error } = await supabase
    .from("journal_reviews")
    .insert(serialize(review))
    .select()
    .single();
  throwIfError(error, "createJournalReview");
  return hydrateReview(rowsToCamel<any>([data])[0]);
}

export async function listJournalReviews(
  entryId?: string,
): Promise<JournalReviewRow[]> {
  let q = supabase.from("journal_reviews").select("*");
  if (entryId) q = q.eq("entry_id", entryId);
  const { data, error } = await q.order("created_at", { ascending: false });
  throwIfError(error, "listJournalReviews");
  return rowsToCamel<any>(data).map(hydrateReview);
}

/** When each entry was last put in front of someone. Drives the cooldown. */
export async function lastReviewedByEntry(): Promise<Map<string, Date>> {
  const reviews = await listJournalReviews();
  const out = new Map<string, Date>();
  for (const review of reviews) {
    const current = out.get(review.entryId);
    if (!current || review.createdAt > current) out.set(review.entryId, review.createdAt);
  }
  return out;
}
