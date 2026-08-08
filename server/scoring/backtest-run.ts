/**
 * Wires the backtest harness to real data.
 *
 *   npm run backtest
 *   npm run backtest 2024-01-01   -- start date
 *
 * Replays scoring monthly across available history (idempotent per company,
 * constraint, asOf and scorer version), then measures what happened next.
 */

import "dotenv/config";
import { storage } from "../storage";
import { runScoring } from "./runner.ts";
import {
  listOpportunityScores,
  listRecognitionSnapshots,
  listEstimateSnapshots,
} from "./store";
import { estimateRevision } from "./estimates.ts";
import { asKnownAt, SCORER_VERSION } from "./opportunity.ts";
import {
  runBacktest,
  formatBacktest,
  monthlyDates,
  type PricePoint,
  type ScoredRow,
} from "./backtest.ts";

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/**
 * Pull a price out of a quote signal's raw payload.
 *
 * The finance connector's response shape is not under our control, so this
 * tries the plausible keys and gives up rather than guessing. Every failure is
 * counted and reported — a backtest running on a third of the intended
 * universe must say so, not quietly produce a confident-looking number.
 */
export function extractPrice(payload: unknown): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const candidates = [
    "adjustedClose", "adjusted_close", "adjClose", "adj_close",
    "close", "price", "last", "lastPrice", "regularMarketPrice", "currentPrice",
  ];
  const search = (obj: any, depth = 0): number | null => {
    if (depth > 4 || obj === null || typeof obj !== "object") return null;
    for (const key of candidates) {
      const v = obj[key];
      const n = typeof v === "string" ? parseFloat(v) : v;
      if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        const found = search(v, depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return search(payload);
}

export interface PriceLoadResult {
  prices: Map<number, PricePoint[]>;
  signalsSeen: number;
  pricesParsed: number;
  companiesWithPrices: number;
}

/**
 * Build price series from quote signals.
 *
 * `retrievedAt` is the timestamp, not any date inside the payload: a quote is
 * knowable when it was fetched. There is no price-history table in this schema,
 * so history only goes back as far as quote syncing has been running — which
 * is the honest limit of what can be backtested today, and the report says so.
 */
export async function loadPrices(): Promise<PriceLoadResult> {
  const signals = await storage.listSignals({ category: "price_action" });
  const prices = new Map<number, PricePoint[]>();
  let pricesParsed = 0;

  for (const s of signals) {
    if (s.companyId === null || s.companyId === undefined) continue;
    if (!s.rawPayload) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(s.rawPayload);
    } catch {
      continue;
    }
    const price = extractPrice(payload);
    if (price === null) continue;
    const date = new Date(s.retrievedAt ?? s.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    pricesParsed++;
    prices.set(s.companyId, [
      ...(prices.get(s.companyId) ?? []),
      { companyId: s.companyId, date, adjustedClose: price },
    ]);
  }

  for (const [, series] of Array.from(prices.entries())) {
    series.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  return {
    prices,
    signalsSeen: signals.length,
    pricesParsed,
    companiesWithPrices: prices.size,
  };
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

export interface BacktestRunResult {
  report: string;
  monthsReplayed: number;
  scoresWritten: number;
  priceCoverage: PriceLoadResult;
}

export async function runBacktestPipeline(
  start: Date,
  end = new Date(),
): Promise<BacktestRunResult> {
  const dates = monthlyDates(start, end);
  let scoresWritten = 0;

  for (const asOf of dates) {
    // Idempotent per (company, constraint, asOf, scorerVersion), so replaying
    // an already-scored month is a no-op rather than a duplicate.
    const r = await runScoring(asOf);
    scoresWritten += r.scoresWritten;
  }

  const priceCoverage = await loadPrices();
  const allScores = await listOpportunityScores({ scorerVersion: SCORER_VERSION });

  // Recognition and estimate revision are needed per scored row for the
  // collinearity check, both selected point-in-time at that row's asOf.
  const recognitionCache = new Map<number, Awaited<ReturnType<typeof listRecognitionSnapshots>>>();
  const estimateCache = new Map<number, Awaited<ReturnType<typeof listEstimateSnapshots>>>();

  const rows: ScoredRow[] = [];
  for (const s of allScores) {
    if (!recognitionCache.has(s.companyId)) {
      recognitionCache.set(s.companyId, await listRecognitionSnapshots(s.companyId));
    }
    if (!estimateCache.has(s.companyId)) {
      estimateCache.set(s.companyId, await listEstimateSnapshots(s.companyId));
    }
    const rec = asKnownAt(recognitionCache.get(s.companyId)!, s.asOf);
    const rev = estimateRevision(estimateCache.get(s.companyId)!, s.asOf);
    rows.push({
      companyId: s.companyId,
      constraintId: s.constraintId,
      longScore: s.longScore,
      shortScore: s.shortScore,
      confidence: s.confidence,
      recognition: rec?.recognition ?? NaN,
      estimateRevision: rev?.value ?? null,
      asOf: s.asOf,
    });
  }

  const result = runBacktest(rows, priceCoverage.prices);

  const coverageNote =
    `\nprice coverage\n${"─".repeat(78)}\n` +
    `  ${priceCoverage.pricesParsed} price point(s) parsed from ${priceCoverage.signalsSeen} quote signal(s), ` +
    `covering ${priceCoverage.companiesWithPrices} company(ies).\n` +
    `  There is no price-history table in this schema, so history reaches back only as\n` +
    `  far as quote syncing has been running. That is the real limit on what can be\n` +
    `  backtested today, and it is a data problem, not a code one.\n`;

  return {
    report: formatBacktest(result) + coverageNote,
    monthsReplayed: dates.length,
    scoresWritten,
    priceCoverage,
  };
}

const invoked = process.argv[1]?.endsWith("backtest-run.ts") ?? false;
if (invoked) {
  const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const start = arg ? new Date(`${arg}T23:59:59.999Z`) : new Date(Date.now() - 730 * 864e5);
  runBacktestPipeline(start)
    .then((r) => {
      console.log(`\nreplayed ${r.monthsReplayed} month(s), wrote ${r.scoresWritten} new score(s)`);
      console.log(r.report);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\nbacktest failed: ${err.message}`);
      process.exit(1);
    });
}
