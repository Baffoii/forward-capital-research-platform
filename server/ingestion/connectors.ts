// Connector-backed live sync — via the `external-tool` CLI, called only from this backend module.
// Never called from frontend JS. Credential preset: external-tools (auto-refreshes per request once deployed).
//
// NOTE: a company/contact-enrichment connector is intentionally NOT wired in anywhere in this file or
// the codebase. Its tools cost credits per call and require a fresh per-call user confirmation
// that only exists in the main agent's tool-calling loop — a deployed backend cannot provide that
// confirmation, so wiring it in would let the backend silently spend user credits.
// See the Source Management page's Phase 2 note for context.

import { execFile } from "child_process";
import { storage } from "../storage";

function callExternalTool(sourceId: string, toolName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ source_id: sourceId, tool_name: toolName, arguments: args });
    execFile("external-tool", ["call", payload], { maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString() || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout.toString()));
      } catch (e) {
        reject(new Error(`Failed to parse external-tool output: ${stdout}`));
      }
    });
  });
}

async function getFinanceSourceId(): Promise<number> {
  const source = await storage.getSourceByIdentifier("finance");
  if (!source) throw new Error("Finance source row not seeded");
  return source.id;
}

async function getSimilarwebSourceId(): Promise<number> {
  const source = await storage.getSourceByIdentifier("similarweb_premium_data");
  if (!source) throw new Error("Similarweb source row not seeded");
  return source.id;
}

async function markSynced(sourceIdentifier: string) {
  const source = await storage.getSourceByIdentifier(sourceIdentifier);
  if (source) await storage.updateSource(source.id, { lastSyncedAt: new Date().toISOString() });
}

// ── Market-snapshot extraction ───────────────────────────────────────────
// The connector payload is stored verbatim on the signal for provenance, and
// the numbers the UI reads are ALSO written to company_quotes /
// company_analyst_consensus so the watchlist can query them in Postgres
// instead of parsing JSON in the browser. These readers stay deliberately
// forgiving: payload shapes vary by connector version, and a snapshot that
// can't be parsed must never break the signal write that carries the record.

function pick(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

/** Digs the first object carrying `marker` out of a connector response. */
function unwrap(result: any, marker: string): any {
  if (!result || typeof result !== "object") return null;
  if (Array.isArray(result)) {
    for (const entry of result) {
      const found = unwrap(entry, marker);
      if (found) return found;
    }
    return null;
  }
  if (result[marker] !== undefined && result[marker] !== null) return result;
  for (const value of Object.values(result)) {
    if (value && typeof value === "object") {
      const found = unwrap(value, marker);
      if (found) return found;
    }
  }
  return null;
}

function num(value: any): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[$,%\s,]/g, "")) : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function recordQuoteSnapshot(companyId: number, sourceId: number, result: any) {
  const q = unwrap(result, "price") ?? unwrap(result, "marketCap") ?? unwrap(result, "market_cap");
  if (!q) return;
  const price = num(pick(q, "price", "last", "close"));
  if (price === null) return;

  await storage.upsertCompanyQuote({
    companyId,
    sourceId,
    price,
    change: num(pick(q, "change", "priceChange")),
    changesPercentage: num(pick(q, "changesPercentage", "changes_percentage", "changePercent", "percentChange")),
    marketCap: num(pick(q, "marketCap", "market_cap")),
    pe: num(pick(q, "pe", "peRatio", "pe_ratio")),
    volume: num(pick(q, "volume")),
    yearLow: num(pick(q, "yearLow", "year_low", "fiftyTwoWeekLow")),
    yearHigh: num(pick(q, "yearHigh", "year_high", "fiftyTwoWeekHigh")),
    asOf: String(pick(q, "as_of", "asOf", "timestamp") ?? new Date().toISOString()),
  });
}

async function recordConsensusSnapshot(companyId: number, sourceId: number, result: any) {
  const c =
    unwrap(result, "avg_price_target") ??
    unwrap(result, "avgPriceTarget") ??
    unwrap(result, "total_ratings") ??
    unwrap(result, "consensus");
  const consensus = c?.consensus && typeof c.consensus === "object" ? c.consensus : c;
  if (!consensus) return;

  const totalRatings = num(pick(consensus, "total_ratings", "totalRatings", "analystCount"));
  const avgTarget = num(pick(consensus, "avg_price_target", "avgPriceTarget", "averagePriceTarget"));
  if (totalRatings === null && avgTarget === null) return;

  await storage.upsertCompanyConsensus({
    companyId,
    sourceId,
    rating: pick(consensus, "rating", "consensusRating") ?? null,
    totalRatings,
    bullishPct: num(pick(consensus, "bullish_pct", "bullishPct")),
    neutralPct: num(pick(consensus, "neutral_pct", "neutralPct")),
    bearishPct: num(pick(consensus, "bearish_pct", "bearishPct")),
    avgPriceTarget: avgTarget,
    medianPriceTarget: num(pick(consensus, "median_price_target", "medianPriceTarget")),
    highPriceTarget: num(pick(consensus, "high_price_target", "highPriceTarget")),
    lowPriceTarget: num(pick(consensus, "low_price_target", "lowPriceTarget")),
    note: pick(consensus, "note") ?? null,
    asOf: String(pick(consensus, "as_of", "asOf") ?? new Date().toISOString()),
  });
}

/**
 * Pure creation functions — take an ALREADY-FETCHED connector payload and write it to the DB.
 * Split out from the sync* functions below so a remote push (e.g. from a scheduled task running
 * outside this server, since the external-tool bridge is unavailable in published sites) can call
 * these directly via /api/admin/ingest instead of re-fetching through `external-tool` itself.
 */
export async function createQuoteSignal(companyId: number, ticker: string, result: any) {
  const sourceId = await getFinanceSourceId();
  const now = new Date().toISOString();
  const signal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${ticker}: live quote sync`,
    description: `Live quote snapshot for ${ticker} synced from the Perplexity finance connector.`,
    signalCategory: "price_action",
    provenanceClass: "raw_data",
    verificationTier: "primary_source_confirmed",
    direction: "neutral",
    relevance: 0.4,
    reliability: 0.95,
    novelty: 0.2,
    independentConfirmations: 1,
    expectedMagnitude: "low",
    timeHorizon: "days",
    pricedInFlag: true,
    rawPayload: JSON.stringify(result),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  // Provenance stays on the signal; the numbers also land in company_quotes.
  // A malformed payload must not lose the signal that was just written.
  try {
    await recordQuoteSnapshot(companyId, sourceId, result);
  } catch (e: any) {
    console.warn(`[connectors] quote snapshot skipped for ${ticker}: ${e?.message ?? e}`);
  }
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced live quote for ${ticker} via finance connector`,
    sourceId,
    createdAt: now,
  });
  await markSynced("finance");
  return { result, signal };
}

/** finance_quotes → signalCategory: price_action, provenanceClass: raw_data */
export async function syncFinanceQuote(companyId: number, ticker: string) {
  const result = await callExternalTool("finance", "finance_quotes", { ticker_symbols: [ticker] });
  return createQuoteSignal(companyId, ticker, result);
}

/** finance_company_profile → used to refresh companies row, not a signal */
export async function syncFinanceProfile(companyId: number, ticker: string) {
  const sourceId = await getFinanceSourceId();
  const result = await callExternalTool("finance", "finance_company_profile", {
    ticker_symbols: [ticker],
    query: `company profile for ${ticker}`,
    action: `Fetching company profile for ${ticker}`,
  });
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced company profile for ${ticker} via finance connector`,
    sourceId,
    createdAt: new Date().toISOString(),
  });
  await markSynced("finance");
  return result;
}

/**
 * finance_insider_transactions → signalCategory: insider_activity.
 * Per spec: do NOT pre-judge insider sells as bearish — default new insider-transaction
 * signals to direction "neutral" and let the user re-tag in the Evidence Board.
 */
export async function createInsiderSignal(companyId: number, ticker: string, result: any, monthsLookback = 6) {
  const sourceId = await getFinanceSourceId();
  const now = new Date().toISOString();
  const signal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${ticker}: insider transactions (${monthsLookback}mo lookback)`,
    description: `Insider Form 4 transactions for ${ticker} over the last ${monthsLookback} months, synced from the finance connector. Direction defaults to neutral — most sells are 10b5-1 plan sales, not bearish signals. Re-classify in the Evidence Board if warranted.`,
    signalCategory: "insider_activity",
    provenanceClass: "raw_data",
    verificationTier: "primary_source_confirmed",
    direction: "neutral",
    relevance: 0.5,
    reliability: 0.9,
    novelty: 0.3,
    independentConfirmations: 1,
    expectedMagnitude: "low",
    timeHorizon: "months",
    pricedInFlag: false,
    rawPayload: JSON.stringify(result),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced insider transactions for ${ticker} via finance connector`,
    sourceId,
    createdAt: now,
  });
  await markSynced("finance");
  return { result, signal };
}

export async function syncInsiderTransactions(companyId: number, ticker: string, monthsLookback = 6) {
  const result = await callExternalTool("finance", "finance_insider_transactions", {
    ticker_symbols: [ticker],
    months_lookback: monthsLookback,
  });
  return createInsiderSignal(companyId, ticker, result, monthsLookback);
}

/** finance_analyst_research → signalCategory: analyst_action, direction derived from sentiment but user can re-tag */
export async function createAnalystSignal(companyId: number, ticker: string, result: any) {
  const sourceId = await getFinanceSourceId();
  const now = new Date().toISOString();
  const signal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${ticker}: analyst research sync`,
    description: `Analyst price targets and rating changes for ${ticker}, synced from the finance connector. Direction inferred from consensus sentiment — always re-verify against the thesis leg before treating as confirming or contradicting.`,
    signalCategory: "analyst_action",
    provenanceClass: "human_authored_research",
    verificationTier: "corroborated",
    direction: "neutral",
    relevance: 0.6,
    reliability: 0.8,
    novelty: 0.3,
    independentConfirmations: 2,
    expectedMagnitude: "medium",
    timeHorizon: "months",
    pricedInFlag: false,
    rawPayload: JSON.stringify(result),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  try {
    await recordConsensusSnapshot(companyId, sourceId, result);
  } catch (e: any) {
    console.warn(`[connectors] consensus snapshot skipped for ${ticker}: ${e?.message ?? e}`);
  }
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced analyst research for ${ticker} via finance connector`,
    sourceId,
    createdAt: now,
  });
  await markSynced("finance");
  return { result, signal };
}

export async function syncAnalystResearch(companyId: number, ticker: string) {
  const result = await callExternalTool("finance", "finance_analyst_research", { ticker_symbols: [ticker] });
  return createAnalystSignal(companyId, ticker, result);
}

/** finance_politician_trades → signalCategory: congressional_trading */
export async function syncPoliticianTrades(companyId: number, ticker: string) {
  const sourceId = await getFinanceSourceId();
  const result = await callExternalTool("finance", "finance_politician_trades", {
    ticker_symbol: ticker,
    query: `congressional trades in ${ticker}`,
    action: `Fetching recent politician trades for ${ticker}`,
  });
  const now = new Date().toISOString();
  const signal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${ticker}: congressional trading activity`,
    description: `Recent congressional stock trades in ${ticker}, synced from the finance connector.`,
    signalCategory: "congressional_trading",
    provenanceClass: "raw_data",
    verificationTier: "primary_source_confirmed",
    direction: "neutral",
    relevance: 0.4,
    reliability: 0.85,
    novelty: 0.4,
    independentConfirmations: 1,
    expectedMagnitude: "low",
    timeHorizon: "months",
    pricedInFlag: false,
    rawPayload: JSON.stringify(result),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced congressional trades for ${ticker} via finance connector`,
    sourceId,
    createdAt: now,
  });
  await markSynced("finance");
  return { result, signal };
}

/** finance_macro_snapshot → signalCategory: macro_indicator */
export async function syncMacroSnapshot(keywords: string[]) {
  const sourceId = await getFinanceSourceId();
  const result = await callExternalTool("finance", "finance_macro_snapshot", {
    keywords,
    action: `Fetching macro snapshot for keywords: ${keywords.join(", ")}`,
  });
  const now = new Date().toISOString();
  const signal = await storage.createSignal({
    thesisId: null,
    companyId: null,
    sourceId,
    title: `Macro snapshot: ${keywords.join(", ")}`,
    description: `Macroeconomic indicator snapshot for keywords [${keywords.join(", ")}], synced from the finance connector.`,
    signalCategory: "macro_indicator",
    provenanceClass: "raw_data",
    verificationTier: "primary_source_confirmed",
    direction: "neutral",
    relevance: 0.4,
    reliability: 0.9,
    novelty: 0.3,
    independentConfirmations: 1,
    expectedMagnitude: "medium",
    timeHorizon: "quarters",
    pricedInFlag: false,
    rawPayload: JSON.stringify(result),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced macro snapshot for [${keywords.join(", ")}] via finance connector`,
    sourceId,
    createdAt: now,
  });
  await markSynced("finance");
  return { result, signal };
}

/** similarweb sales signals → web_traffic_signal or partnership_or_supply_chain depending on event type */
export async function syncSimilarwebSignals(companyId: number, companyDomain: string) {
  const sourceId = await getSimilarwebSourceId();
  const now = new Date().toISOString();
  const [news, technology, traffic] = await Promise.all([
    callExternalTool("similarweb_premium_data", "get-sales-signals-news", { company_domain: companyDomain }),
    callExternalTool("similarweb_premium_data", "get-sales-signals-technology", { company_domain: companyDomain }),
    callExternalTool("similarweb_premium_data", "get-sales-signals-traffic", { company_domain: companyDomain }),
  ]);

  const created = [];
  const newsSignal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${companyDomain}: news signals`,
    description: `News signal events (funding, M&A, leadership, partnerships) for ${companyDomain}, synced from Similarweb.`,
    signalCategory: "partnership_or_supply_chain",
    provenanceClass: "detected_signal",
    verificationTier: "single_source",
    direction: "neutral",
    relevance: 0.5,
    reliability: 0.7,
    novelty: 0.5,
    independentConfirmations: 0,
    expectedMagnitude: "medium",
    timeHorizon: "weeks",
    pricedInFlag: false,
    rawPayload: JSON.stringify(news),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  created.push(newsSignal);

  const techSignal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${companyDomain}: technology signals`,
    description: `Technology stack addition/removal/renewal signals for ${companyDomain}, synced from Similarweb.`,
    signalCategory: "web_traffic_signal",
    provenanceClass: "detected_signal",
    verificationTier: "single_source",
    direction: "neutral",
    relevance: 0.4,
    reliability: 0.7,
    novelty: 0.5,
    independentConfirmations: 0,
    expectedMagnitude: "low",
    timeHorizon: "weeks",
    pricedInFlag: false,
    rawPayload: JSON.stringify(technology),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  created.push(techSignal);

  const trafficSignal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${companyDomain}: traffic signals`,
    description: `Web traffic change signals (MoM/QoQ/YoY) for ${companyDomain}, synced from Similarweb.`,
    signalCategory: "web_traffic_signal",
    provenanceClass: "detected_signal",
    verificationTier: "single_source",
    direction: "neutral",
    relevance: 0.4,
    reliability: 0.7,
    novelty: 0.4,
    independentConfirmations: 0,
    expectedMagnitude: "low",
    timeHorizon: "months",
    pricedInFlag: false,
    rawPayload: JSON.stringify(traffic),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  created.push(trafficSignal);

  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced Similarweb sales signals (news/technology/traffic) for ${companyDomain}`,
    sourceId,
    createdAt: now,
  });
  await markSynced("similarweb_premium_data");
  return created;
}

/** search_publications on cbinsights_mcp_cashmere and statista_mcp_cashmere → human_authored_research */
export async function syncResearchPublications(query: string) {
  const now = new Date().toISOString();
  const results = [];

  let cbSource = await storage.getSourceByIdentifier("cbinsights_mcp_cashmere");
  if (!cbSource) {
    cbSource = await storage.createSource({
      name: "CB Insights",
      kind: "connector",
      sourceIdentifier: "cbinsights_mcp_cashmere",
      reliabilityScore: 0.75,
      url: null,
      lastSyncedAt: null,
    });
  }
  let statistaSource = await storage.getSourceByIdentifier("statista_mcp_cashmere");
  if (!statistaSource) {
    statistaSource = await storage.createSource({
      name: "Statista",
      kind: "connector",
      sourceIdentifier: "statista_mcp_cashmere",
      reliabilityScore: 0.75,
      url: null,
      lastSyncedAt: null,
    });
  }

  const cbResult = await callExternalTool("cbinsights_mcp_cashmere", "search_publications", { query });
  const cbSignal = await storage.createSignal({
    thesisId: null,
    companyId: null,
    sourceId: cbSource.id,
    title: `CB Insights research: "${query}"`,
    description: `CB Insights research publications matching query "${query}". Secondary research, not a primary filing.`,
    signalCategory: "partnership_or_supply_chain",
    provenanceClass: "human_authored_research",
    verificationTier: "single_source",
    direction: "neutral",
    relevance: 0.5,
    reliability: 0.7,
    novelty: 0.5,
    independentConfirmations: 0,
    expectedMagnitude: "medium",
    timeHorizon: "quarters",
    pricedInFlag: false,
    rawPayload: JSON.stringify(cbResult),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  results.push(cbSignal);

  const statistaResult = await callExternalTool("statista_mcp_cashmere", "search_publications", { query });
  const statistaSignal = await storage.createSignal({
    thesisId: null,
    companyId: null,
    sourceId: statistaSource.id,
    title: `Statista research: "${query}"`,
    description: `Statista statistics/publications matching query "${query}". Secondary research, not a primary filing.`,
    signalCategory: "macro_indicator",
    provenanceClass: "human_authored_research",
    verificationTier: "single_source",
    direction: "neutral",
    relevance: 0.5,
    reliability: 0.7,
    novelty: 0.5,
    independentConfirmations: 0,
    expectedMagnitude: "medium",
    timeHorizon: "quarters",
    pricedInFlag: false,
    rawPayload: JSON.stringify(statistaResult),
    sourceUrl: null,
    retrievedAt: now,
    ingestionMethod: "live_connector",
    createdAt: now,
  });
  results.push(statistaSignal);

  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced research publications for query "${query}" from CB Insights and Statista`,
    sourceId: cbSource.id,
    createdAt: now,
  });

  return results;
}
