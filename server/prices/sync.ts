/**
 * The daily price job.
 *
 * Fetches closes for one company, records a material move as a world event,
 * and reports honestly when the symbol isn't covered.
 *
 * Per-company, like everything else scheduled in this repo — the deployment
 * was unstable doing all companies' work in one request, and FMP is rate
 * limited besides. `eod-bulk` would collapse this to one call, but it isn't on
 * our tier; with five servable symbols that costs us nothing.
 */

import { storage } from "../storage";
import { appendWorldEvent } from "../human-loop/store";
import { activePriceSource, latestMaterialMove, MATERIAL_MOVE_PCT } from "./source";

export interface PriceSyncResult {
  companyId: number;
  ticker: string | null;
  source: string;
  status: "ok" | "unavailable" | "error";
  /** Present when status is not "ok" — say why, in words a human reads. */
  reason?: string;
  closesFetched: number;
  moveRecorded: boolean;
  changePct?: number;
}

export async function syncPricesForCompany(companyId: number): Promise<PriceSyncResult> {
  const source = activePriceSource();
  const company = await storage.getCompany(companyId);

  if (!company?.ticker) {
    return {
      companyId,
      ticker: null,
      source: source.name,
      status: "unavailable",
      reason: "Company has no ticker.",
      closesFetched: 0,
      moveRecorded: false,
    };
  }

  const out = await source.dailyCloses(company.ticker);

  if (out.status !== "ok") {
    // Not an error to swallow. Eight of thirteen companies live here
    // permanently on the current FMP plan, and the watcher needs to be able to
    // say "we can't check this" rather than "nothing happened".
    return {
      companyId,
      ticker: company.ticker,
      source: source.name,
      status: out.status === "unavailable" ? "unavailable" : "error",
      reason: out.reason,
      closesFetched: 0,
      moveRecorded: false,
    };
  }

  const move = latestMaterialMove(company.ticker, out.closes);
  if (!move) {
    return {
      companyId,
      ticker: company.ticker,
      source: source.name,
      status: "ok",
      closesFetched: out.closes.length,
      moveRecorded: false,
    };
  }

  const direction = move.changePct > 0 ? "up" : "down";
  const written = await appendWorldEvent({
    kind: "price_move",
    companyId: company.id,
    ticker: company.ticker,
    headline: `${company.name}: shares moved ${direction} ${Math.abs(move.changePct).toFixed(1)}% on ${move.to.date}`,
    detail: `Closed at ${move.to.close} on ${move.to.date}, against ${move.from.close} on ${move.from.date}.`,
    payload: {
      changePct: move.changePct,
      closePrice: move.to.close,
      previousClose: move.from.close,
      companyName: company.name,
      // Provenance, same rule as every other ingested fact.
      source: source.name,
      endpoint: out.source,
      fetchedAt: out.fetchedAt.toISOString(),
    },
    // Daily close only. We cannot trade intraday, so occurredAt is the close
    // date rather than the moment we happened to fetch it.
    occurredAt: new Date(`${move.to.date}T21:00:00Z`),
    knownAt: out.fetchedAt,
    dedupeKey: `price-move:${company.ticker}:${move.to.date}`,
  });

  return {
    companyId,
    ticker: company.ticker,
    source: source.name,
    status: "ok",
    closesFetched: out.closes.length,
    moveRecorded: written !== null,
    changePct: move.changePct,
  };
}

export { MATERIAL_MOVE_PCT };
