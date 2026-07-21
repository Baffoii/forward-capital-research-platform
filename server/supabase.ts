import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set as environment variables.");
}

// Node 20 has no native WebSocket global; the client's realtime module needs
// one even though this app never uses realtime subscriptions.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: WebSocket as any },
});

// ── snake_case <-> camelCase helpers ──────────────────────────────────────
// The app's TS types (from shared/schema.ts) use camelCase field names.
// Postgres columns in Supabase are snake_case. These helpers convert both ways
// so the rest of the codebase (routes, connectors, scoring) never has to care.

function toSnakeCase(s: string): string {
  return s.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
}

function toCamelCase(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

export function objToSnake(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[toSnakeCase(k)] = v;
  }
  return out;
}

export function rowToCamel<T = any>(row: Record<string, any> | null | undefined): T | undefined {
  if (!row) return undefined;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamelCase(k)] = v;
  }
  return out as T;
}

export function rowsToCamel<T = any>(rows: Record<string, any>[] | null | undefined): T[] {
  return (rows ?? []).map((r) => rowToCamel<T>(r) as T);
}

export function throwIfError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`Supabase error in ${context}: ${error.message}`);
  }
}
