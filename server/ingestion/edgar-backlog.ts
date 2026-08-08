/**
 * 10-Q -> capture metrics -> a first-pass tightening reading per constraint.
 *
 * Point-in-time throughout:
 *   effectiveFrom = quarter end (when the fact became true)
 *   knownAt       = filing date (the earliest we could have known it)
 *
 * XBRL is preferred over narrative parsing wherever a concept is tagged.
 * Backlog has no standard us-gaap tag, so it falls back to prose; RPO, gross
 * profit, and revenue are all tagged and come from company facts.
 */

import { storage } from "../storage";
import { secFetch, resolveCik, fetchFilingHistory, filingUrl, type EdgarFiling } from "./edgar";
import { fetchFilingText } from "./edgar-exposure";
import {
  parseBacklog,
  parseGrossMargin,
  grossMarginFromXbrl,
  parseContractStructure,
} from "./filing-financials";
import {
  toCoverage,
  companyTightening,
  aggregateTightening,
  type BacklogObservation,
  type ExposureWeight,
} from "../scoring/tightening";
import {
  insertCaptureMetrics,
  insertConstraintState,
  listCaptureMetrics,
  listConstraints,
  listExposureEdges,
  type NewCaptureMetric,
} from "../scoring/store";

/* ------------------------------------------------------------------ */
/* XBRL quarterly facts                                                */
/* ------------------------------------------------------------------ */

interface QuarterlyFact {
  value: number;
  fiscalPeriod: string;
  effectiveFrom: Date;
  knownAt: Date;
}

const QUARTERLY_REVENUE_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
];

/**
 * Pull a us-gaap concept's quarterly values.
 *
 * Filters to durations of roughly one quarter, because the same concept also
 * carries year-to-date and annual facts. A nine-month figure mistaken for a
 * quarter would triple the denominator of every coverage ratio and turn a
 * tightening constraint into an easing one.
 */
async function fetchQuarterlyConcept(
  cik: string,
  concepts: string[],
): Promise<QuarterlyFact[]> {
  const res = await secFetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  );
  if (!res.ok) return [];
  const facts = (await res.json())?.facts?.["us-gaap"];
  if (!facts) return [];

  for (const concept of concepts) {
    const units = facts[concept]?.units?.USD;
    if (!Array.isArray(units)) continue;

    const quarterly = units
      .filter((u: any) => {
        if (!u.start || !u.end || !u.filed) return false;
        const days =
          (new Date(u.end).getTime() - new Date(u.start).getTime()) / 864e5;
        return days >= 80 && days <= 100;
      })
      .map((u: any) => ({
        value: Number(u.val),
        fiscalPeriod: `${u.fp ?? "Q"}-${u.fy}`,
        effectiveFrom: new Date(u.end),
        knownAt: new Date(u.filed),
      }))
      .filter((f: QuarterlyFact) => Number.isFinite(f.value));

    if (quarterly.length > 0) return dedupeEarliestKnown(quarterly);
  }
  return [];
}

/** Same period restated in later filings: keep the earliest knownAt. */
function dedupeEarliestKnown(facts: QuarterlyFact[]): QuarterlyFact[] {
  const byPeriod = new Map<string, QuarterlyFact>();
  for (const f of facts) {
    const key = f.effectiveFrom.toISOString().slice(0, 10);
    const prev = byPeriod.get(key);
    if (!prev || f.knownAt < prev.knownAt) byPeriod.set(key, f);
  }
  return Array.from(byPeriod.values()).sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
}

/** Instant-in-time concept (RPO is a balance, not a flow). */
async function fetchInstantConcept(
  cik: string,
  concept: string,
): Promise<QuarterlyFact[]> {
  const res = await secFetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  );
  if (!res.ok) return [];
  const units = (await res.json())?.facts?.["us-gaap"]?.[concept]?.units?.USD;
  if (!Array.isArray(units)) return [];
  return dedupeEarliestKnown(
    units
      .filter((u: any) => u.end && u.filed)
      .map((u: any) => ({
        value: Number(u.val),
        fiscalPeriod: `${u.fp ?? "Q"}-${u.fy}`,
        effectiveFrom: new Date(u.end),
        knownAt: new Date(u.filed),
      }))
      .filter((f: QuarterlyFact) => Number.isFinite(f.value) && f.value > 0),
  );
}

/* ------------------------------------------------------------------ */
/* Per-company ingestion                                               */
/* ------------------------------------------------------------------ */

export interface BacklogIngestResult {
  ticker: string;
  metricsWritten: number;
  notes: string[];
}

/**
 * Extract capture metrics for one company across its recent 10-Qs.
 *
 * Degrades rather than stalls: if the narrative backlog parse finds nothing,
 * RPO from XBRL is used; if neither is present, the quarter is skipped with a
 * note rather than written as a zero. A zero backlog would read as a queue
 * that collapsed.
 */
export async function ingestBacklogForCompany(
  companyId: number,
  ticker: string,
  quarters = 8,
): Promise<BacklogIngestResult> {
  const notes: string[] = [];
  const cik = await resolveCik(ticker);
  if (!cik) return { ticker, metricsWritten: 0, notes: ["ticker not resolvable to a CIK"] };

  const [revenues, grossProfits, rpos, filings] = await Promise.all([
    fetchQuarterlyConcept(cik, QUARTERLY_REVENUE_CONCEPTS),
    fetchQuarterlyConcept(cik, ["GrossProfit"]),
    fetchInstantConcept(cik, "RevenueRemainingPerformanceObligation"),
    fetchFilingHistory(ticker, quarters, ["10-Q"]),
  ]);

  if (revenues.length === 0) {
    return { ticker, metricsWritten: 0, notes: ["no quarterly revenue tagged in XBRL"] };
  }

  const tenQs = filings;
  const metrics: NewCaptureMetric[] = [];

  for (const filing of tenQs) {
    const knownAt = new Date(filing.filingDate);
    const revenue = nearestByKnownAt(revenues, knownAt);
    if (!revenue) {
      notes.push(`${filing.filingDate}: no revenue period matched this filing`);
      continue;
    }

    let backlogValue: number | null = null;
    let contractStructure = "unknown";
    let hasPriceEscalators = "unknown";
    let grossMarginPct: number | null = null;

    // XBRL first — tagged, audited, exact.
    const rpo = rpos.find(
      (r) => Math.abs(r.effectiveFrom.getTime() - revenue.effectiveFrom.getTime()) < 10 * 864e5,
    );
    if (rpo) backlogValue = rpo.value;

    const gp = grossProfits.find(
      (g) => Math.abs(g.effectiveFrom.getTime() - revenue.effectiveFrom.getTime()) < 10 * 864e5,
    );
    if (gp) grossMarginPct = grossMarginFromXbrl(gp.value, revenue.value)?.grossMarginPct ?? null;

    // The document is always fetched because contract structure has no XBRL
    // concept at all; backlog and margin only fall back to prose when their
    // tags are absent.
    {
      try {
        const html = await fetchFilingText(filing);
        if (backlogValue === null) {
          const parsed = parseBacklog(html);
          const usable = parsed
            .filter((p) => !p.flags.includes("partial_scope"))
            .sort((a, b) => b.confidence - a.confidence)[0];
          if (usable) backlogValue = usable.value;
          else if (parsed.length > 0) {
            notes.push(
              `${filing.filingDate}: only partial-scope backlog figures found; skipped rather than compared against total revenue`,
            );
          }
        }
        if (grossMarginPct === null) {
          grossMarginPct = parseGrossMargin(html)?.grossMarginPct ?? null;
        }
        const structure = parseContractStructure(html);
        contractStructure = structure.contractStructure;
        hasPriceEscalators = structure.hasPriceEscalators;
      } catch (err: any) {
        // Partial coverage with honest confidence beats a stalled pipeline.
        notes.push(`${filing.filingDate}: document fetch/parse failed (${err.message})`);
      }
    }

    if (backlogValue === null && grossMarginPct === null) {
      notes.push(`${filing.filingDate}: nothing extractable, skipped`);
      continue;
    }

    metrics.push({
      companyId,
      fiscalPeriod: revenue.fiscalPeriod,
      grossMarginPct,
      backlogValue,
      contractStructure,
      hasPriceEscalators,
      utilizationPct: null,
      sourceDocumentId: null,
      effectiveFrom: revenue.effectiveFrom,
      knownAt,
    });
  }

  await insertCaptureMetrics(metrics);
  return { ticker, metricsWritten: metrics.length, notes };
}

/** Latest fact knowable at or before `knownAt`. */
function nearestByKnownAt(
  facts: QuarterlyFact[],
  knownAt: Date,
): QuarterlyFact | null {
  const knowable = facts
    .filter((f) => f.knownAt.getTime() <= knownAt.getTime() + 3 * 864e5)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return knowable[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Constraint states                                                   */
/* ------------------------------------------------------------------ */

export interface TighteningRunResult {
  asOf: Date;
  statesWritten: number;
  skipped: Array<{ constraintSlug: string; reason: string }>;
}

/**
 * Derive and persist a tightening reading per constraint, as of `asOf`.
 *
 * Everything is selected on knownAt. A constraint with fewer than two knowable
 * quarters for any exposed company produces no state row at all, rather than a
 * zero — "we cannot tell" and "no change" are different claims and conflating
 * them would put a fabricated neutral reading into the score.
 */
export async function deriveConstraintStates(
  asOf: Date,
): Promise<TighteningRunResult> {
  const constraints = await listConstraints();
  const skipped: TighteningRunResult["skipped"] = [];
  let statesWritten = 0;

  for (const constraint of constraints) {
    const edges = (await listExposureEdges({ constraintId: constraint.id })).filter(
      (e) => e.knownAt.getTime() <= asOf.getTime() && e.supersededAt === null,
    );
    if (edges.length === 0) {
      skipped.push({ constraintSlug: constraint.slug, reason: "no exposure edges" });
      continue;
    }

    const weights: ExposureWeight[] = edges.map((e) => ({
      companyId: e.companyId,
      revenueShare: e.revenueShare,
      confidence: e.confidence,
    }));

    const readings = [];
    for (const weight of weights) {
      const metrics = await listCaptureMetrics(weight.companyId);
      // capture_metrics has no revenue column, and adding one is a schema
      // change. Quarterly revenue is re-read from XBRL instead and joined on
      // period end. Same source, same point-in-time discipline, no migration.
      const revenues = await quarterlyRevenueForCompany(weight.companyId);

      const observations: BacklogObservation[] = [];
      for (const m of metrics) {
        if (m.backlogValue === null) continue;
        // Revenue for the same quarter turns the backlog stock into a
        // coverage ratio. Without it the number cannot be compared across
        // companies of different sizes, so the observation is dropped rather
        // than defaulted.
        const revenue = revenues.find(
          (r) => Math.abs(r.effectiveFrom.getTime() - m.effectiveFrom.getTime()) < 10 * 864e5,
        );
        if (!revenue || !(revenue.value > 0)) continue;
        observations.push({
          companyId: weight.companyId,
          fiscalPeriod: m.fiscalPeriod,
          backlogValue: m.backlogValue,
          quarterlyRevenue: revenue.value,
          grossMarginPct: m.grossMarginPct,
          effectiveFrom: m.effectiveFrom,
          knownAt: m.knownAt,
          confidence: 0.6,
        });
      }
      const coverage = observations
        .map(toCoverage)
        .filter((c): c is NonNullable<typeof c> => c !== null);
      const reading = companyTightening(coverage, asOf);
      if (reading) readings.push(reading);
    }

    const aggregate = aggregateTightening(constraint.id, readings, weights, asOf);
    if (!aggregate) {
      skipped.push({
        constraintSlug: constraint.slug,
        reason: "no exposed company had two knowable quarters of backlog",
      });
      continue;
    }

    await insertConstraintState({
      constraintId: constraint.id,
      tightening: aggregate.tightening,
      direction: aggregate.direction,
      confidence: aggregate.confidence,
      method: aggregate.method + ` flags=[${aggregate.flags.join(",")}]`,
      leadTimeWeeks: null,
      // The reading describes the world as of the latest knowable filing.
      effectiveFrom: asOf,
      knownAt: asOf,
    });
    statesWritten++;
  }

  return { asOf, statesWritten, skipped };
}

/**
 * Quarterly revenue for a company, by id, from XBRL.
 *
 * Memoised per run: deriveConstraintStates walks every constraint and the same
 * company is exposed to several, so without this the same company facts
 * document would be fetched a dozen times against a rate-limited API.
 */
const revenueCache = new Map<number, QuarterlyFact[]>();

async function quarterlyRevenueForCompany(
  companyId: number,
): Promise<QuarterlyFact[]> {
  const cached = revenueCache.get(companyId);
  if (cached) return cached;

  const company = await storage.getCompany(companyId);
  if (!company?.ticker) {
    revenueCache.set(companyId, []);
    return [];
  }
  const cik = await resolveCik(company.ticker);
  if (!cik) {
    revenueCache.set(companyId, []);
    return [];
  }
  const facts = await fetchQuarterlyConcept(cik, QUARTERLY_REVENUE_CONCEPTS);
  revenueCache.set(companyId, facts);
  return facts;
}

export { filingUrl, type EdgarFiling };
