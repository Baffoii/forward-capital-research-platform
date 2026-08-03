// Forward Capital — seed loader. Idempotent: no-ops if companies table already populated.
// All numbers come verbatim from server/seed-data.json (real values fetched from the
// Perplexity finance connector on 2026-07-20). Nothing here is invented.

import { storage } from "./storage";
import seedData from "./seed-data.json";
import { computeSignalScore, computeThesisConfidence, confidenceToGauge } from "./scoring";

const SEGMENT_NOTE_STRATEGIC_MATERIALS =
  "No companies identified yet — this is the thesis's core unproven bet. Add candidates via Research Inbox.";

function normalizeSegment(rawSegment: string): string {
  // Collapse "Hyperscaler (context, not First Watchlist)" etc. down to a clean segment label.
  if (rawSegment.startsWith("Hyperscaler")) return "Hyperscaler";
  if (rawSegment.startsWith("Memory/Storage")) return "Memory/Storage";
  return rawSegment;
}

// Segments the thesis names but does not bet on. Tracked because the narrative
// references them; excluded from segment scoring.
const CONTEXT_SEGMENTS: Array<{ name: string; note: string }> = [
  {
    name: "Hyperscaler",
    note: "Wave 2 context. Named in the thesis narrative, excluded from segment scoring.",
  },
  {
    name: "Memory/Storage",
    note: "Wave 2 context. Named in the thesis narrative, excluded from segment scoring.",
  },
];

// Which signal categories each stated evidence requirement accumulates from.
// An empty array means the thesis calls for it but the signal taxonomy has no
// category to hold it — a real finding, and the ledger shows it as zero.
// `null` means the assumption is not tracked by category at all.
const SIGNAL_TYPE_CATEGORIES: Record<string, string[] | null> = {
  "X/Twitter posts": [],
  "Web traffic / product usage signals": ["web_traffic_signal"],
  "Government contracts, grants, and policy actions": ["regulatory_filing", "macro_indicator"],
  "Supplier / customer partnership announcements": ["partnership_or_supply_chain"],
  "AI-lab and hyperscaler mentions": null,
  "Patent filings": ["patent_filing"],
};

// What the author says would prove the thesis wrong. Editable rows, not copy
// baked into a component — the falsification conditions are thesis data.
const FALSIFIERS: string[] = [
  "Materials-exposed names re-rate before Jul 2026 — the call is late, not early.",
  "The supply constraint resolves in silicon, not materials — capacity additions clear the bottleneck.",
  "Consensus targets on Power and Networking stay flat through Dec 2026 despite demand.",
];

// Reliability is a multiplier inside every signal score, so each source says
// why it carries the weight it carries.
const SOURCE_DESCRIPTIONS: Record<string, string> = {
  finance:
    "Quotes, insider transactions and analyst research. Reachable only from an agent session, so a scheduled task pushes it in over HTTPS.",
  sec_edgar: "Primary-source filings. Highest weight in the model — nothing else here is a legal document.",
  uspto_patentsview: "Free to register. Blocking one of the signal types the thesis explicitly calls for.",
  manual_research_inbox:
    "Human-typed notes. Deliberately weighted lowest — a claim you heard is not a filing you read.",
  similarweb_premium_data: "Web-traffic and product-usage signals. Connector-backed, synced per company on request.",
  cbinsights_mcp_cashmere: "Market and company research. Connector-backed, not part of the scheduled refresh.",
  statista_mcp_cashmere: "Market-size and industry statistics. Connector-backed, not part of the scheduled refresh.",
};

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
      description: SOURCE_DESCRIPTIONS.finance,
      status: "connected",
      requiresKey: false,
    });
  }

  // Other source rows referenced elsewhere in the app, seeded up front so Source Management
  // always has full rows to show/edit even before first sync.
  const sourceDefs: Array<{
    name: string;
    kind: string;
    sourceIdentifier: string;
    reliabilityScore: number;
    url: string | null;
    status: string;
    requiresKey: boolean;
  }> = [
    { name: "SEC EDGAR", kind: "free_api", sourceIdentifier: "sec_edgar", reliabilityScore: 0.98, url: "https://www.sec.gov", status: "connected", requiresKey: false },
    { name: "USPTO PatentsView", kind: "free_api", sourceIdentifier: "uspto_patentsview", reliabilityScore: 0.9, url: "https://patentsview.org/apis", status: "needs_key", requiresKey: true },
    { name: "Research Inbox (manual entry)", kind: "manual", sourceIdentifier: "manual_research_inbox", reliabilityScore: 0.4, url: null, status: "connected", requiresKey: false },
    { name: "Similarweb (Sales Signals)", kind: "connector", sourceIdentifier: "similarweb_premium_data", reliabilityScore: 0.7, url: null, status: "not_connected", requiresKey: false },
    { name: "CB Insights", kind: "connector", sourceIdentifier: "cbinsights_mcp_cashmere", reliabilityScore: 0.75, url: null, status: "not_connected", requiresKey: false },
    { name: "Statista", kind: "connector", sourceIdentifier: "statista_mcp_cashmere", reliabilityScore: 0.75, url: null, status: "not_connected", requiresKey: false },
  ];
  for (const def of sourceDefs) {
    const found = await storage.getSourceByIdentifier(def.sourceIdentifier);
    if (!found) {
      await storage.createSource({
        ...def,
        lastSyncedAt: null,
        description: SOURCE_DESCRIPTIONS[def.sourceIdentifier] ?? null,
      });
    }
  }

  // 2. Thesis row
  const thesisData = seedData.thesis;
  // The prediction resolves in H2 2026; storing the window makes the countdown
  // read a date the author set rather than one parsed out of the sentence.
  const windowStart = "2026-07-01";
  const windowEnd = "2026-12-31";
  const thesis = await storage.createThesis({
    title: thesisData.title,
    summary: thesisData.summary,
    prediction: thesisData.prediction,
    author: thesisData.author ?? null,
    predictionWindowStart: windowStart,
    predictionWindowEnd: windowEnd,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  // 3. Assumptions (derived from signal_types_called_for — these are the thesis's stated
  // evidence requirements, treated as "high" importance assumptions the thesis depends on).
  // signalCategories records which categories can actually supply evidence for each one, so
  // the assumption ledger counts real signals instead of inferring from the wording.
  for (const signalType of thesisData.signal_types_called_for) {
    const categories = SIGNAL_TYPE_CATEGORIES[signalType];
    await storage.createAssumption({
      thesisId: thesis.id,
      text: `Thesis depends on tracking: ${signalType}`,
      importance: "high",
      signalCategories: categories == null ? null : JSON.stringify(categories),
    });
  }
  await storage.createAssumption({
    thesisId: thesis.id,
    text: "Market has not yet fully priced in the advanced-material-processing / strategic-materials bottleneck.",
    importance: "high",
    signalCategories: JSON.stringify(["analyst_action", "price_action"]),
  });
  await storage.createAssumption({
    thesisId: thesis.id,
    text: "Wave 1 (NVIDIA, OpenAI, Anthropic) and Wave 2 (hyperscalers, chip/memory/networking suppliers) winners are increasingly priced in, freeing relative attention for Wave 3 names.",
    importance: "medium",
    signalCategories: JSON.stringify(["analyst_action", "price_action"]),
  });

  // 3b. Falsifiers — what would prove the thesis wrong. Rows, not component copy.
  for (let i = 0; i < FALSIFIERS.length; i++) {
    await storage.createFalsifier({ thesisId: thesis.id, text: FALSIFIERS[i], sortOrder: i });
  }

  // 3c. Segments: the legs the thesis rests on, plus the context segments it
  // names but does not bet on. A leg with zero companies is a research gap the
  // UI holds open — it is never filled with placeholder tickers.
  let segmentOrder = 0;
  for (const segment of thesisData.segments) {
    await storage.createThesisSegment({
      thesisId: thesis.id,
      name: segment.name,
      note: segment.companies.length === 0 ? SEGMENT_NOTE_STRATEGIC_MATERIALS : segment.note,
      isThesisLeg: true,
      sortOrder: segmentOrder++,
    });
  }
  for (const segment of CONTEXT_SEGMENTS) {
    await storage.createThesisSegment({
      thesisId: thesis.id,
      name: segment.name,
      note: segment.note,
      isThesisLeg: false,
      sortOrder: segmentOrder++,
    });
  }

  // 3d. Milestones inside the prediction window. A null due date is meaningful:
  // it marks work that is blocking with no date attached to it.
  let milestoneOrder = 0;
  await storage.createMilestone({
    thesisId: thesis.id,
    title: "Window opens",
    detail: "evidence retrieved from here counts inside the window",
    dueDate: windowStart,
    status: "scheduled",
    sortOrder: milestoneOrder++,
  });
  for (const segment of thesisData.segments.filter((s) => s.companies.length === 0)) {
    await storage.createMilestone({
      thesisId: thesis.id,
      title: `${segment.name} names identified`,
      detail: "no date — blocking the core bet",
      dueDate: null,
      status: "blocking",
      sortOrder: milestoneOrder++,
    });
  }
  await storage.createMilestone({
    thesisId: thesis.id,
    title: "Window closes",
    detail: "thesis resolves either way",
    dueDate: windowEnd,
    status: "closes",
    sortOrder: milestoneOrder++,
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

    // --- Market snapshot: the numbers the watchlist reads, in their own rows ---
    const q = w.quote as any;
    await storage.upsertCompanyQuote({
      companyId: company.id,
      sourceId: financeSource.id,
      price: q.price ?? null,
      change: q.change ?? null,
      changesPercentage: q.changesPercentage ?? null,
      marketCap: q.marketCap ?? null,
      pe: q.pe ?? null,
      volume: q.volume ?? null,
      yearLow: q.yearLow ?? null,
      yearHigh: q.yearHigh ?? null,
      asOf: q.as_of,
    });

    const cons = w.analyst_consensus as any;
    if (cons) {
      await storage.upsertCompanyConsensus({
        companyId: company.id,
        sourceId: financeSource.id,
        rating: cons.rating ?? null,
        totalRatings: cons.total_ratings ?? null,
        bullishPct: cons.bullish_pct ?? null,
        neutralPct: cons.neutral_pct ?? null,
        bearishPct: cons.bearish_pct ?? null,
        avgPriceTarget: cons.avg_price_target ?? null,
        medianPriceTarget: cons.median_price_target ?? null,
        highPriceTarget: cons.high_price_target ?? null,
        lowPriceTarget: cons.low_price_target ?? null,
        note: cons.note ?? null,
        asOf: seedData.data_fetch_metadata.fetched_at,
      });
    }

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

  // 6. Score the seeded evidence once, so a fresh database opens on a real
  //    confidence reading with the first point of its history already recorded
  //    rather than a blank gauge.
  const seededSignals = await storage.listSignals({ thesisId: thesis.id });
  const scoredAt = new Date();
  const { confidence, normalizingFactor } = computeThesisConfidence(
    seededSignals.map((s) => computeSignalScore(s, scoredAt))
  );
  await storage.updateThesisConfidence(thesis.id, confidence);
  await storage.createConfidenceHistory({
    thesisId: thesis.id,
    confidence,
    gauge: confidenceToGauge(confidence),
    signalCount: normalizingFactor,
    computedAt: scoredAt.toISOString(),
  });

  await storage.createAuditLog({
    eventType: "score_computed",
    description: `Initial confidence computed over ${normalizingFactor} seeded signals: ${confidence.toFixed(3)} (gauge ${confidenceToGauge(confidence)}).`,
    sourceId: null,
    createdAt: scoredAt.toISOString(),
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
