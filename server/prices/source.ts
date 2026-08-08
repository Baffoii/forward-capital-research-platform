/**
 * Daily closing prices, behind an interface.
 *
 * Two adapters. The FMP one fetches real closes; the null one returns nothing
 * and says why. Which one you get depends on whether FMP_API_KEY is set — and
 * critically, on whether FMP will serve the symbol at all.
 *
 * ── WHY THIS IS AN INTERFACE AND NOT JUST A FETCH ───────────────────────
 * The free FMP tier serves five of our thirteen companies. The other eight
 * return a permission error, and the two that matter most to the thesis —
 * VRT and GEV — are among them. That is not a transient failure to retry, it
 * is a standing gap, and the system has to represent it as one.
 *
 * So a blocked symbol yields `unavailable` with a reason, never a synthesised
 * or carried-forward price. Every price-based trigger on that name then goes
 * dormant and the watcher reports it as "we can't check this" rather than
 * "nothing happened" — which is the whole point of the three-valued predicate
 * evaluation in server/watcher/predicate.ts.
 *
 * DAILY CLOSE ONLY. Never /quote. We cannot trade intraday, so a trigger that
 * fires on an intraday print is a trigger that fires on something we cannot
 * act on.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { fmpGet, fmpIsConfigured } from "../fmp/client.ts";

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
  volume?: number | null;
}

export type PriceOutcome =
  | { status: "ok"; symbol: string; closes: DailyClose[]; source: string; fetchedAt: Date }
  /** We are not permitted, or not configured, to see this. Not "no data". */
  | { status: "unavailable"; symbol: string; reason: string }
  | { status: "error"; symbol: string; reason: string };

export interface PriceSource {
  readonly name: string;
  /** Is this source able to serve anything at all right now? */
  isLive(): boolean;
  dailyCloses(symbol: string): Promise<PriceOutcome>;
}

/* ------------------------------------------------------------------ */
/* FMP                                                                 */
/* ------------------------------------------------------------------ */

export const fmpPriceSource: PriceSource = {
  name: "fmp",
  isLive: () => fmpIsConfigured(),

  async dailyCloses(symbol: string): Promise<PriceOutcome> {
    const out = await fmpGet<any>(`historical-price-eod/light?symbol=${encodeURIComponent(symbol)}`);

    switch (out.status) {
      case "unconfigured":
        return { status: "unavailable", symbol, reason: out.reason };

      case "symbol_blocked":
        // The distinction that matters. Say so in words a human will read in
        // a notification, because this is the state eight of thirteen of our
        // companies are permanently in on the current plan.
        return {
          status: "unavailable",
          symbol,
          reason: `${symbol} is not covered by our FMP subscription, so we have no price history for it.`,
        };

      case "endpoint_blocked":
        return { status: "unavailable", symbol, reason: out.reason };

      case "rate_limited":
        return { status: "error", symbol, reason: "FMP rate limit hit; try the next scheduled run." };

      case "error":
        return { status: "error", symbol, reason: out.reason };

      case "ok": {
        const rows: DailyClose[] = (Array.isArray(out.data) ? out.data : [])
          .map((r: any) => ({
            date: String(r.date ?? "").slice(0, 10),
            close: Number(r.price ?? r.close),
            volume: r.volume == null ? null : Number(r.volume),
          }))
          .filter((r: DailyClose) => r.date && Number.isFinite(r.close));

        if (rows.length === 0) {
          return { status: "unavailable", symbol, reason: "FMP returned no usable rows." };
        }
        // Oldest first, so callers can diff consecutive closes without sorting.
        rows.sort((a, b) => a.date.localeCompare(b.date));
        return { status: "ok", symbol, closes: rows, source: out.endpoint, fetchedAt: out.fetchedAt };
      }
    }
  },
};

/* ------------------------------------------------------------------ */
/* Null                                                                */
/* ------------------------------------------------------------------ */

/**
 * The honest empty source.
 *
 * Used when nothing is configured. It never invents a price — a fabricated or
 * carried-forward close would flow straight into pre-commitment triggers and
 * journal resurfacing, and a trigger firing on a number nobody measured is
 * strictly worse than a trigger that never fires.
 */
export const nullPriceSource: PriceSource = {
  name: "none",
  isLive: () => false,
  async dailyCloses(symbol: string): Promise<PriceOutcome> {
    return {
      status: "unavailable",
      symbol,
      reason: "No price source is configured, so price-based triggers are dormant.",
    };
  },
};

export function activePriceSource(): PriceSource {
  return fmpIsConfigured() ? fmpPriceSource : nullPriceSource;
}

/* ------------------------------------------------------------------ */
/* Move detection                                                      */
/* ------------------------------------------------------------------ */

/** A move this size is worth a world event. Below it, it's noise. */
export const MATERIAL_MOVE_PCT = 8;

export interface PriceMove {
  symbol: string;
  from: DailyClose;
  to: DailyClose;
  changePct: number;
}

/**
 * The most recent day-over-day move, if there is one worth recording.
 *
 * Pure, so it's testable without a network. Returns null when the series is
 * too short or the move is small — both of which are ordinary, not errors.
 */
export function latestMaterialMove(
  symbol: string,
  closes: DailyClose[],
  thresholdPct = MATERIAL_MOVE_PCT,
): PriceMove | null {
  if (closes.length < 2) return null;

  const to = closes[closes.length - 1];
  const from = closes[closes.length - 2];
  if (!from.close) return null;

  const changePct = ((to.close - from.close) / from.close) * 100;
  if (Math.abs(changePct) < thresholdPct) return null;

  return { symbol, from, to, changePct };
}
