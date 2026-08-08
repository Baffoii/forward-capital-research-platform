/**
 * Parsing for operator-pasted transcripts.
 *
 * Split out from source.ts so it can be tested without a database —
 * server/supabase.ts throws at import time when SUPABASE_URL is unset.
 */

/**
 * Expected paste format. A short header, then the transcript body:
 *
 *   TRANSCRIPT
 *   ticker: ETN
 *   period: Q1-2026
 *   date: 2026-04-30
 *   ---
 *   <transcript text>
 *
 * The header is parsed strictly. A paste missing ticker, period, or date is
 * rejected rather than guessed at — a transcript attributed to the wrong
 * quarter produces a lead-time trend that is wrong in both directions.
 */
export interface ParsedPaste {
  ticker: string;
  fiscalPeriod: string;
  callDate: Date;
  text: string;
}

export function parseTranscriptPaste(raw: string): ParsedPaste | null {
  if (!/^\s*TRANSCRIPT\b/i.test(raw)) return null;
  const separator = raw.indexOf("---");
  if (separator === -1) return null;

  const header = raw.slice(0, separator);
  const text = raw.slice(separator + 3).trim();
  if (text.length < 200) return null; // a header with no call in it

  const field = (name: string): string | null => {
    const m = new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im").exec(header);
    return m ? m[1].trim() : null;
  };

  const ticker = field("ticker");
  const fiscalPeriod = field("period");
  const dateRaw = field("date");
  if (!ticker || !fiscalPeriod || !dateRaw) return null;

  const callDate = new Date(dateRaw);
  if (Number.isNaN(callDate.getTime())) return null;

  return { ticker: ticker.toUpperCase(), fiscalPeriod, callDate, text };
}
