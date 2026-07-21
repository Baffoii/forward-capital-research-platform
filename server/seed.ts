// Forward Capital — seed loader. Idempotent: no-ops if companies table already populated.
// All numbers come verbatim from server/seed-data.json (real values fetched from the
// Perplexity finance connector on 2026-07-20). Nothing here is invented.

import { storage } from "./storage";
import seedData from "./seed-data.json";

const SEGMENT_NOTE_STRATEGIC_MATERIALS =
  "No companies identified yet — this is the thesis's core unproven bet. Add candidates via Research Inbox.";

function normalizeSegment(rawSegment: string): string {
  // Collapse "Hyperscaler (context, not First Watchlist)" etc. down to a clean segment label.
  if (rawSegment.startsWith("Hyperscaler")) return "Hyperscaler";
  if (rawSegment.startsWith("Memory/Storage")) return "Memory/Storage";
  return rawSegment;
}

export async function seedIfEmpty(): Promise<{ seeded: boolean }> {
  const existing = await storage.listCompanies();
  if (existing.length > 0) {
    return { seeded: false };
  }

  const now = new Date().toISOString();

  // 1. Source row for the finance connector
  let financeSource = await storage.getSourceByIdentifier("finance");
  if (!financeSource) {
    financeSource = await storage.createSource({
      name: "Perplexity Finance Connector",
      kind: "connector",
      sourceIdentifier: "finance",
      reliabilityScore: 0.85,
      url: null,
      lastSyncedAt: seedData.data_fetch_metadata.fetched_at,
    });
  }

  // Other source rows referenced elsewhere in the app, seeded up front so Source Management
  // always has full rows to show/edit even before first sync.
  const sourceDefs: Array<{ name: string; kind: string; sourceIdentifier: string; reliabilityScore: number; url: string | null }> = [
    { name: "SEC EDGAR", kind: "free_api", sourceIdentifier: "sec_edgar", reliabilityScore: 0.98, url: "https://www.sec.gov" },
    { name: "USPTO PatentsView", kind: "free_api", sourceIdentifier: "uspto_patentsview", reliabilityScore: 0.9, url: "https://patentsview.org/apis" },
    { name: "Research Inbox (manual entry)", kind: "manual", sourceIdentifier: "manual_research_inbox", reliabilityScore: 0.4, url: null },
    { name: "Similarweb (Sales Signals)", kind: "connector", sourceIdentifier: "similarweb_premium_data", reliabilityScore: 0.7, url: null },
    { name: "CB Insights", kind: "connector", sourceIdentifier: "cbinsights_mcp_cashmere", reliabilityScore: 0.75, url: null },
    { name: "Statista", kind: "connector", sourceIdentifier: "statista_mcp_cashmere", reliabilityScore: 0.75, url: null },
  ];
  for (const def of sourceDefs) {
    const found = await storage.getSourceByIdentifier(def.sourceIdentifier);
    if (!found) await storage.createSource({ ...def, lastSyncedAt: null });
  }

  // 2. Thesis row
  const thesisData = seedData.thesis;
  const thesis = await storage.createThesis({
    title: thesisData.title,
    summary: thesisData.summary,
    prediction: thesisData.prediction,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  // 3. Assumptions (derived from signal_types_called_for — these are the thesis's stated
  // evidence requirements, treated as "high" importance assumptions the thesis depends on).
  for (const signalType of thesisData.signal_types_called_for) {
    await storage.createAssumption({
      thesisId: thesis.id,
      text: `Thesis depends on tracking: ${signalType}`,
      importance: "high",
    });
  }
  await storage.createAssumption({
    thesisId: thesis.id,
    text: "Market has not yet fully priced in the advanced-material-processing / strategic-materials bottleneck.",
    importance: "high",
  });
  await storage.createAssumption({
    thesisId: thesis.id,
    text: "Wave 1 (NVIDIA, OpenAI, Anthropic) and Wave 2 (hyperscalers, chip/memory/networking suppliers) winners are increasingly priced in, freeing relative attention for Wave 3 names.",
    importance: "medium",
  });

  // 4. Companies + thesis_companies + signals derived from seed watchlist data
  const companyIdByTicker: Record<string, number> = {};

  for (const w of seedData.watchlist_companies) {
    const segment = normalizeSegment(w.segment);
    const company = await storage.createCompany({
      ticker: w.ticker,
      name: w.name,
      sector: w.sector,
      industry: w.industry,
      ceo: w.ceo,
      employees: w.employees,
      website: w.website,
      ipoDate: w.ipo_date,
      description: null,
      segment,
      createdAt: now,
    });
    companyIdByTicker[w.ticker] = company.id;

    await storage.createThesisCompany({
      thesisId: thesis.id,
      companyId: company.id,
      segment,
      rationale: `Seeded from Wave 3 thesis watchlist (${segment} segment).`,
    });

    await storage.createWatchlistItem({
      companyId: company.id,
      addedAt: now,
      notes: w.source,
    });

    // --- Signal: live quote snapshot (price_action) ---
    const quote = w.quote as any;
    await storage.createSignal({
      thesisId: thesis.id,
      companyId: company.id,
      sourceId: financeSource.id,
      title: `${w.ticker}: quote snapshot (${quote.as_of})`,
      description: `Price $${quote.price} (${quote.changesPercentage >= 0 ? "+" : ""}${quote.changesPercentage}%), market cap $${quote.marketCap.toLocaleString()}, P/E ${quote.pe}.${quote.note ? " " + quote.note : ""}`,
      signalCategory: "price_action",
      provenanceClass: "raw_data",
      verificationTier: "primary_source_confirmed",
      direction: "neutral",
      relevance: 0.4,
      reliability: 0.9,
      novelty: 0.2,
      independentConfirmations: 1,
      expectedMagnitude: Math.abs(quote.changesPercentage) > 5 ? "high" : "low",
      timeHorizon: "days",
      pricedInFlag: false,
      rawPayload: JSON.stringify(quote),
      sourceUrl: null,
      retrievedAt: quote.as_of,
      ingestionMethod: "live_connector",
      createdAt: now,
    });

    // --- Signal: analyst consensus (analyst_action) ---
    const consensus = w.analyst_consensus as any;
    if (consensus) {
      // Direction: derive conservatively. If the note explicitly flags this as counter-evidence
      // or a contested/priced-in signal, mark contradicting. Otherwise leave neutral and let the
      // user classify in the Evidence Board — avoids over-interpreting consensus direction.
      let direction: "confirming" | "contradicting" | "neutral" = "neutral";
      if (consensus.note && /contradicting|counter-evidence|priced-in|contested/i.test(consensus.note)) {
        direction = "contradicting";
      }
      await storage.createSignal({
        thesisId: thesis.id,
        companyId: company.id,
        sourceId: financeSource.id,
        title: `${w.ticker}: analyst consensus — ${consensus.rating.replace(/_/g, " ")}`,
        description: `${consensus.total_ratings} analysts: ${consensus.bullish_pct}% bullish / ${consensus.neutral_pct}% neutral / ${consensus.bearish_pct}% bearish. Avg target $${consensus.avg_price_target}, median $${consensus.median_price_target}.${consensus.note ? " " + consensus.note : ""}`,
        signalCategory: "analyst_action",
        provenanceClass: "human_authored_research",
        verificationTier: "corroborated",
        direction,
        relevance: 0.6,
        reliability: 0.8,
        novelty: 0.2,
        independentConfirmations: consensus.total_ratings > 1 ? 2 : 1,
        expectedMagnitude: "medium",
        timeHorizon: "months",
        pricedInFlag: /priced-in/i.test(consensus.note ?? ""),
        rawPayload: JSON.stringify(consensus),
        sourceUrl: null,
        retrievedAt: seedData.data_fetch_metadata.fetched_at,
        ingestionMethod: "live_connector",
        createdAt: now,
      });
    }

    // --- Signals: individual recent analyst actions (analyst_action) ---
    for (const action of (w.recent_analyst_actions as any[]) ?? []) {
      const direction: "confirming" | "contradicting" | "neutral" =
        action.sentiment === "bullish" ? "confirming" : action.sentiment === "bearish" ? "contradicting" : "neutral";
      await storage.createSignal({
        thesisId: thesis.id,
        companyId: company.id,
        sourceId: financeSource.id,
        title: `${w.ticker}: ${action.firm} ${action.action.toLowerCase()} ${action.rating}`,
        description: `${action.analyst} (${action.firm}) ${action.action.toLowerCase()} rating of ${action.rating} with price target $${action.price_target} (prior $${action.prior_target}) on ${action.date}.`,
        signalCategory: "analyst_action",
        provenanceClass: "human_authored_research",
        verificationTier: "single_source",
        direction,
        relevance: 0.5,
        reliability: 0.75,
        novelty: 0.3,
        independentConfirmations: 1,
        expectedMagnitude: "low",
        timeHorizon: "months",
        pricedInFlag: false,
        rawPayload: JSON.stringify(action),
        sourceUrl: null,
        retrievedAt: `${action.date}T00:00:00Z`,
        ingestionMethod: "live_connector",
        createdAt: now,
      });
    }

    // --- Signals: insider transactions (insider_activity) — always default to neutral ---
    for (const tx of (w.recent_insider_transactions as any[]) ?? []) {
      await storage.createSignal({
        thesisId: thesis.id,
        companyId: company.id,
        sourceId: financeSource.id,
        title: `${w.ticker}: insider ${tx.type} — ${tx.name}`,
        description: `${tx.name} filed a ${tx.type} transaction for ${tx.shares.toLocaleString()} shares on ${tx.date}${tx.price ? ` at $${tx.price}` : ""}${tx.value ? ` (value $${Number(tx.value).toLocaleString()})` : ""}. Direction intentionally left neutral — most insider sales are scheduled 10b5-1 plan sales, not bearish signals. Re-classify manually if warranted.`,
        signalCategory: "insider_activity",
        provenanceClass: "raw_data",
        verificationTier: "primary_source_confirmed",
        direction: "neutral",
        relevance: 0.4,
        reliability: 0.9,
        novelty: 0.3,
        independentConfirmations: 1,
        expectedMagnitude: "low",
        timeHorizon: "months",
        pricedInFlag: false,
        rawPayload: JSON.stringify(tx),
        sourceUrl: null,
        retrievedAt: `${tx.date}T00:00:00Z`,
        ingestionMethod: "live_connector",
        createdAt: now,
      });
    }
  }

  // 5. "Strategic materials" segment — explicitly empty. Do not invent companies.
  //    We record it purely as metadata via a dedicated audit_log entry + rely on the frontend's
  //    segment list (derived from thesis.segments in this seed file, hardcoded as the four
  //    canonical segments) to render the gap-state callout when a segment has zero companies.
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Seed complete: Strategic materials segment intentionally left with 0 companies — ${SEGMENT_NOTE_STRATEGIC_MATERIALS}`,
    sourceId: financeSource.id,
    createdAt: now,
  });

  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Seeded ${seedData.watchlist_companies.length} companies, 1 thesis, and derived signals from the Perplexity Finance Connector snapshot fetched ${seedData.data_fetch_metadata.fetched_at}.`,
    sourceId: financeSource.id,
    createdAt: now,
  });

  return { seeded: true };
}

export const CANONICAL_SEGMENTS = seedData.thesis.segments.map((s) => ({
  name: s.name,
  note: s.note,
  tickers: s.companies as string[],
}));

export const THESIS_TITLE = seedData.thesis.title;
