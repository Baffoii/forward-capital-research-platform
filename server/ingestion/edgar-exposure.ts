/**
 * EDGAR 10-K -> exposure edges.
 *
 * Extends the existing EDGAR ingestion (edgar.ts) rather than replacing it:
 * the same rate limiter, User-Agent, and CIK resolution are reused.
 *
 * Point-in-time discipline, which is the reason this file is careful:
 *   effectiveFrom = the period the fact describes (fiscal period end)
 *   knownAt       = the filing date, the earliest we could have known it
 * Getting these backwards makes a broken model backtest beautifully.
 */

import { storage } from "../storage";
import { secFetch, resolveCik, fetchFilingHistory, filingUrl, type EdgarFiling } from "./edgar";
import {
  parseCustomerConcentration,
  parseSegmentRevenue,
  parseEndDemandShare,
  resolveCompanyByName,
  type CustomerConcentration,
  type SegmentRevenue,
} from "./edgar-extract";
import {
  composeRevenueShare,
  type ShareFactor,
  type SupplyLink,
} from "../scoring/exposure";
import { matchSegment } from "../scoring/segment-constraint-map";
import {
  getConstraintBySlug,
  insertExposureEdges,
  type NewExposureEdge,
} from "../scoring/store";

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

/** Raw document text for a filing. Filings are HTML; callers strip markup. */
export async function fetchFilingText(filing: EdgarFiling): Promise<string> {
  const res = await secFetch(filingUrl(filing));
  if (!res.ok) throw new Error(`filing fetch failed: ${res.status} ${filingUrl(filing)}`);
  return res.text();
}

export interface RevenueFact {
  value: number;
  fiscalPeriod: string;
  /** Period end — when the fact became true. */
  effectiveFrom: Date;
  /** Filing date — the earliest we could have known it. */
  knownAt: Date;
}

const REVENUE_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
];

/**
 * Annual total revenue from XBRL company facts.
 *
 * Structured and audited, so this is the one high-confidence number in the
 * chain. Tries several concepts because the tag a filer uses varies by
 * industry and by how recently they migrated to ASC 606.
 */
export async function fetchAnnualRevenue(ticker: string): Promise<RevenueFact[]> {
  const cik = await resolveCik(ticker);
  if (!cik) return [];
  const res = await secFetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  );
  if (!res.ok) return [];
  const facts = (await res.json())?.facts?.["us-gaap"];
  if (!facts) return [];

  for (const concept of REVENUE_CONCEPTS) {
    const units = facts[concept]?.units?.USD;
    if (!Array.isArray(units)) continue;
    const annual = units
      .filter((u: any) => u.form === "10-K" && u.fp === "FY" && u.start && u.end && u.filed)
      .map((u: any) => ({
        value: Number(u.val),
        fiscalPeriod: `FY${u.fy}`,
        effectiveFrom: new Date(u.end),
        knownAt: new Date(u.filed),
      }))
      .filter((r: RevenueFact) => Number.isFinite(r.value) && r.value > 0);
    if (annual.length > 0) {
      // Same period can be reported in several filings; keep the earliest
      // knownAt, since that is when we could first have known it.
      const byPeriod = new Map<string, RevenueFact>();
      for (const r of annual) {
        const prev = byPeriod.get(r.fiscalPeriod);
        if (!prev || r.knownAt < prev.knownAt) byPeriod.set(r.fiscalPeriod, r);
      }
      return Array.from(byPeriod.values()).sort(
        (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
      );
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export interface ExtractedFilingFacts {
  ticker: string;
  filing: EdgarFiling;
  effectiveFrom: Date;
  knownAt: Date;
  totalRevenue: number | null;
  customers: CustomerConcentration[];
  segments: SegmentRevenue[];
  endDemand: ReturnType<typeof parseEndDemandShare>;
}

/**
 * Pull the latest 10-K and extract everything the exposure graph needs.
 *
 * `effectiveFrom` falls back to the filing date when no matching XBRL revenue
 * period is found. That is conservative in the right direction — it can only
 * make a fact look NEWER than it is, never older, so it cannot manufacture
 * lookahead.
 */
export async function extractLatest10K(
  ticker: string,
): Promise<ExtractedFilingFacts | null> {
  const filings = await fetchFilingHistory(ticker, 40);
  const tenK = filings.find((f) => f.form === "10-K");
  if (!tenK) return null;

  const [html, revenues] = await Promise.all([
    fetchFilingText(tenK),
    fetchAnnualRevenue(ticker),
  ]);

  const knownAt = new Date(tenK.filingDate);
  // The revenue period whose filing date matches this 10-K.
  const matching =
    revenues.find(
      (r) => Math.abs(r.knownAt.getTime() - knownAt.getTime()) < 7 * 864e5,
    ) ?? revenues[revenues.length - 1];

  const totalRevenue = matching?.value ?? null;

  return {
    ticker,
    filing: tenK,
    effectiveFrom: matching?.effectiveFrom ?? knownAt,
    knownAt,
    totalRevenue,
    customers: parseCustomerConcentration(html),
    segments: parseSegmentRevenue(html, totalRevenue ? { totalRevenue } : {}),
    endDemand: parseEndDemandShare(html),
  };
}

/* ------------------------------------------------------------------ */
/* Edge construction                                                   */
/* ------------------------------------------------------------------ */

export interface BuiltEdges {
  edges: NewExposureEdge[];
  supplyLinks: SupplyLink[];
  /** Named customers we could not resolve to a row in `companies`. */
  unresolvedCustomers: Array<{ name: string; revenueShare: number; quote: string }>;
  /** Disclosures where the filer gave a number but no counterparty. */
  anonymousDisclosures: Array<{ label: string; revenueShare: number; quote: string }>;
  notes: string[];
}

/**
 * Turn extracted facts into graph rows.
 *
 * Two distinct products come out of one 10-K:
 *
 *  - EXPOSURE EDGES, from segment revenue x end-demand attribution. These say
 *    "this fraction of the company's total revenue rides on this constraint".
 *    Requires an entry in SEGMENT_CONSTRAINT_MAP, because the end-demand share
 *    is a judgement nobody discloses.
 *
 *  - SUPPLY LINKS, from customer concentration. These say "this fraction of
 *    the company's total revenue comes from that company", and the traversal
 *    turns them into indirect exposure at hops 1-3.
 */
export async function buildEdgesFromFacts(
  facts: ExtractedFilingFacts,
  companyId: number,
  sourceDocumentId: number | null,
): Promise<BuiltEdges> {
  const edges: NewExposureEdge[] = [];
  const supplyLinks: SupplyLink[] = [];
  const unresolvedCustomers: BuiltEdges["unresolvedCustomers"] = [];
  const anonymousDisclosures: BuiltEdges["anonymousDisclosures"] = [];
  const notes: string[] = [];

  /* --- segment revenue -> direct exposure edges --------------------- */

  for (const seg of facts.segments) {
    const mapping = matchSegment(facts.ticker, seg.segmentName);
    if (!mapping) {
      notes.push(
        `segment "${seg.segmentName}" has no constraint mapping — add one to SEGMENT_CONSTRAINT_MAP to score it`,
      );
      continue;
    }
    if (seg.shareOfTotal === null) {
      notes.push(`segment "${seg.segmentName}" has no derivable share of total revenue`);
      continue;
    }
    const constraint = await getConstraintBySlug(mapping.constraintSlug);
    if (!constraint) {
      notes.push(`constraint slug "${mapping.constraintSlug}" is not in the registry`);
      continue;
    }

    // Prefer an end-demand share the filer actually stated over the mapping's
    // standing estimate — a stated number is evidence, an estimate is not.
    const stated = facts.endDemand;
    const endDemandFactor: ShareFactor = stated
      ? {
          value: stated.share,
          confidence: stated.confidence,
          label: "data-centre share of segment end demand (stated in filing)",
          quote: stated.quote,
        }
      : {
          value: mapping.endDemandShare,
          confidence: mapping.confidence,
          label: `data-centre share of segment end demand (${mapping.basis})`,
          quote: mapping.quote,
        };

    const composed = composeRevenueShare([
      {
        value: seg.shareOfTotal,
        confidence: seg.confidence,
        label: "segment share of total revenue",
        quote: seg.quote,
      },
      endDemandFactor,
    ]);

    edges.push({
      companyId,
      constraintId: constraint.id,
      viaCompanyId: null,
      revenueShare: composed.revenueShare,
      hops: 0,
      confidence: composed.confidence,
      derivation: "segment_disclosure",
      sourceDocumentId,
      // Both halves of the arithmetic, so the number can be argued with.
      supportingQuote: composed.factors
        .map((f) => `[${f.label}] ${f.quote ?? "(no quote)"}`)
        .join("  ||  "),
      effectiveFrom: facts.effectiveFrom,
      knownAt: facts.knownAt,
    });
  }

  /* --- customer concentration -> supply links ----------------------- */

  const companies = await storage.listCompanies();

  for (const c of facts.customers) {
    if (!c.customerName) {
      anonymousDisclosures.push({
        label: c.anonymousLabel ?? "unnamed customer",
        revenueShare: c.revenueShare,
        quote: c.quote,
      });
      continue;
    }
    const match = resolveCompanyByName(companies, c.customerName);
    if (!match) {
      unresolvedCustomers.push({
        name: c.customerName,
        revenueShare: c.revenueShare,
        quote: c.quote,
      });
      continue;
    }
    supplyLinks.push({
      supplierId: companyId,
      customerId: match.id,
      revenueShare: c.revenueShare,
      confidence: c.confidence,
      supportingQuote: c.quote,
      sourceDocumentId,
    });
  }

  if (anonymousDisclosures.length > 0) {
    notes.push(
      `${anonymousDisclosures.length} customer disclosure(s) gave a share but no name — ` +
        `ASC 280 requires the amount, not the counterparty. Resolve manually to use them.`,
    );
  }
  if (unresolvedCustomers.length > 0) {
    notes.push(
      `${unresolvedCustomers.length} named customer(s) are not in the companies table: ` +
        unresolvedCustomers.map((u) => u.name).join(", "),
    );
  }

  return { edges, supplyLinks, unresolvedCustomers, anonymousDisclosures, notes };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export interface IngestResult {
  ticker: string;
  edgesWritten: number;
  supplyLinks: SupplyLink[];
  notes: string[];
}

/**
 * Full pass for one company. Writes direct exposure edges and returns the
 * supply links for the caller to feed into traverseExposure() alongside every
 * other company's — traversal is a whole-graph operation and cannot be done
 * one company at a time.
 */
export async function ingestExposureForCompany(
  companyId: number,
  ticker: string,
  sourceId: number,
): Promise<IngestResult> {
  const facts = await extractLatest10K(ticker);
  if (!facts) {
    return { ticker, edgesWritten: 0, supplyLinks: [], notes: ["no 10-K found"] };
  }

  const signal = await storage.createSignal({
    thesisId: null,
    companyId,
    sourceId,
    title: `${ticker}: exposure extraction from 10-K filed ${facts.filing.filingDate}`,
    description:
      `Parsed ${facts.customers.length} customer-concentration disclosure(s) and ` +
      `${facts.segments.length} segment revenue statement(s).`,
    signalCategory: "regulatory_filing",
    provenanceClass: "confirmed_event",
    verificationTier: "primary_source_confirmed",
    direction: "neutral",
    relevance: 0.7,
    reliability: 1.0,
    novelty: 0.3,
    independentConfirmations: 1,
    expectedMagnitude: "medium",
    timeHorizon: "months",
    pricedInFlag: false,
    rawPayload: JSON.stringify({
      customers: facts.customers,
      segments: facts.segments,
      endDemand: facts.endDemand,
      totalRevenue: facts.totalRevenue,
    }),
    sourceUrl: filingUrl(facts.filing),
    retrievedAt: new Date().toISOString(),
    ingestionMethod: "free_public_api",
    createdAt: new Date().toISOString(),
  });

  const built = await buildEdgesFromFacts(facts, companyId, signal.id);
  await insertExposureEdges(built.edges);

  return {
    ticker,
    edgesWritten: built.edges.length,
    supplyLinks: built.supplyLinks,
    notes: built.notes,
  };
}
