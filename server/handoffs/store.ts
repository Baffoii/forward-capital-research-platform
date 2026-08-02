/**
 * Data access for handoff packets.
 *
 * Unlike the two logs, this table IS updated in place — a packet gets
 * accepted, edited, closed. The append-only record of those transitions lives
 * in human_events; this table holds the current state of the thing itself.
 */

import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";

const date = (v: unknown): Date => new Date(String(v));
const dateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(String(v));

export interface HandoffPacketRow {
  id: string;
  authorId: string;
  authorEmail: string;
  assigneeEmail: string | null;
  rawText: string;
  ticker: string | null;
  companyId: number | null;
  found: string | null;
  stillOpen: string | null;
  needsDecision: string | null;
  sources: string[];
  structuringStatus: string;
  followupQuestion: string | null;
  followupAnswer: string | null;
  status: string;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  closingNote: string | null;
  escalatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function hydrate(r: any): HandoffPacketRow {
  return {
    ...r,
    sources: Array.isArray(r.sources) ? r.sources : [],
    acceptedAt: dateOrNull(r.acceptedAt),
    closedAt: dateOrNull(r.closedAt),
    escalatedAt: dateOrNull(r.escalatedAt),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
  };
}

function serialize(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return objToSnake(out);
}

export interface NewHandoffPacket {
  authorId: string;
  authorEmail: string;
  rawText: string;
  assigneeEmail?: string | null;
  ticker?: string | null;
  companyId?: number | null;
  found?: string | null;
  stillOpen?: string | null;
  needsDecision?: string | null;
  sources?: string[];
  structuringStatus?: string;
  followupQuestion?: string | null;
}

export async function createHandoffPacket(
  packet: NewHandoffPacket,
): Promise<HandoffPacketRow> {
  const { data, error } = await supabase
    .from("handoff_packets")
    .insert(serialize({ sources: [], ...packet }))
    .select()
    .single();
  throwIfError(error, "createHandoffPacket");
  return hydrate(rowsToCamel<any>([data])[0]);
}

export async function getHandoffPacket(
  id: string,
): Promise<HandoffPacketRow | null> {
  const { data, error } = await supabase
    .from("handoff_packets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "getHandoffPacket");
  return data ? hydrate(rowsToCamel<any>([data])[0]) : null;
}

/**
 * The derived fields are editable because they will sometimes be wrong.
 * `rawText` is deliberately not in the accepted set — the note as typed is the
 * record, and an edit that could rewrite it would destroy the only thing we
 * know to be true.
 */
export type HandoffPatch = Partial<
  Pick<
    HandoffPacketRow,
    | "assigneeEmail"
    | "ticker"
    | "companyId"
    | "found"
    | "stillOpen"
    | "needsDecision"
    | "sources"
    | "structuringStatus"
    | "followupQuestion"
    | "followupAnswer"
    | "status"
    | "acceptedAt"
    | "acceptedBy"
    | "closedAt"
    | "closedBy"
    | "closingNote"
    | "escalatedAt"
  >
>;

export async function updateHandoffPacket(
  id: string,
  patch: HandoffPatch,
): Promise<HandoffPacketRow | null> {
  const { data, error } = await supabase
    .from("handoff_packets")
    .update(serialize({ ...patch, updatedAt: new Date() }))
    .eq("id", id)
    .select()
    .maybeSingle();
  throwIfError(error, "updateHandoffPacket");
  return data ? hydrate(rowsToCamel<any>([data])[0]) : null;
}

export interface HandoffFilter {
  /** Packets waiting on this person, plus unassigned ones. */
  forEmail?: string;
  status?: string;
  limit?: number;
}

export async function listHandoffPackets(
  filter: HandoffFilter = {},
): Promise<HandoffPacketRow[]> {
  let q = supabase.from("handoff_packets").select("*");
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.forEmail) {
    // Unassigned packets show up for everyone — an unclaimed packet with
    // nobody's name on it is exactly the work that gets silently dropped.
    q = q.or(`assignee_email.eq.${filter.forEmail},assignee_email.is.null`);
  }
  q = q.order("created_at", { ascending: false }).limit(filter.limit ?? 100);
  const { data, error } = await q;
  throwIfError(error, "listHandoffPackets");
  return rowsToCamel<any>(data).map(hydrate);
}

/**
 * Packets nobody has picked up, older than the cutoff, that we haven't already
 * nagged about. Drives the 48-hour escalation.
 */
export async function listUnacceptedSince(
  cutoff: Date,
): Promise<HandoffPacketRow[]> {
  const { data, error } = await supabase
    .from("handoff_packets")
    .select("*")
    .eq("status", "open")
    .is("escalated_at", null)
    .lt("created_at", cutoff.toISOString())
    .order("created_at", { ascending: true });
  throwIfError(error, "listUnacceptedSince");
  return rowsToCamel<any>(data).map(hydrate);
}
