// Fundamentals for the Paper Trading tab, sourced from SEC XBRL company facts.
//
// Alpaca's market-data API is price/volume only — it publishes no EPS, no share count, no P/E. The
// SEC's XBRL "companyconcept" API is free, keyless, and already half-wired into this app (the
// ticker→CIK cache and rate-limited fetcher live in ingestion/edgar.ts), so P/E and market cap are
// derived from filed figures rather than a paid fundamentals vendor.
//
// Caveat worth knowing when reading these numbers: values come from the last filed 10-Q/10-K, so
// they lag the tape by up to a quarter, and companies that don't file with the SEC (most ADRs,
// some funds) simply have no data here.

import { loadTickerCikMap, resolveCik, secFetch } from "./ingestion/edgar";

/**
 * resolveCik() writes through a Postgres-backed cache table. The Paper Trading tab otherwise needs
 * no database at all, so fall back to SEC's in-memory ticker map when storage is unreachable rather
 * than dropping fundamentals for every symbol.
 */
async function cikFor(symbol: string): Promise<string | null> {
  try {
    return await resolveCik(symbol);
  } catch (err) {
    const map = await loadTickerCikMap();
    return map[symbol.toUpperCase()] ?? null;
  }
}

interface ConceptFact {
  start?: string;
  end: string;
  val: number;
  form: string;
  fy?: number;
  fp?: string;
  frame?: string;
  filed: string;
}

export interface Fundamentals {
  symbol: string;
  epsTtm: number | null;
  peRatio: number | null;
  sharesOutstanding: number | null;
  marketCap: number | null;
  epsBasis: "ttm" | "annual" | null;
  fiscalPeriodEnd: string | null;
  available: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; data: Omit<Fundamentals, "peRatio" | "marketCap"> }>();

async function fetchConcept(cik: string, taxonomy: string, tag: string): Promise<ConceptFact[] | null> {
  const res = await secFetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`);
  if (!res.ok) return null; // 404 simply means this filer doesn't report the tag
  const data = (await res.json()) as { units?: Record<string, ConceptFact[]> };
  const units = data.units;
  if (!units) return null;
  // EPS lives under "USD/shares", share counts under "shares" — take whichever unit is present.
  return Object.values(units).flat();
}

function durationDays(fact: ConceptFact): number | null {
  if (!fact.start) return null;
  return (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000;
}

/** Latest fact per period end, preferring the most recently filed restatement. */
function dedupeByPeriodEnd(facts: ConceptFact[]): ConceptFact[] {
  const byEnd = new Map<string, ConceptFact>();
  for (const fact of facts) {
    const existing = byEnd.get(fact.end);
    if (!existing || fact.filed > existing.filed) byEnd.set(fact.end, fact);
  }
  return Array.from(byEnd.values()).sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Trailing-twelve-month EPS: sum the last four quarterly figures. Companies that only tag annual
 * EPS fall back to the most recent fiscal year.
 */
function computeEps(facts: ConceptFact[]): { eps: number | null; basis: "ttm" | "annual" | null; periodEnd: string | null } {
  const quarterly = dedupeByPeriodEnd(
    facts.filter((f) => {
      const days = durationDays(f);
      return days !== null && days >= 60 && days <= 120;
    })
  );

  if (quarterly.length >= 4) {
    const lastFour = quarterly.slice(-4);
    const eps = lastFour.reduce((sum, f) => sum + f.val, 0);
    return { eps, basis: "ttm", periodEnd: lastFour[lastFour.length - 1].end };
  }

  const annual = dedupeByPeriodEnd(
    facts.filter((f) => {
      const days = durationDays(f);
      return days !== null && days >= 330 && days <= 400;
    })
  );

  if (annual.length > 0) {
    const latest = annual[annual.length - 1];
    return { eps: latest.val, basis: "annual", periodEnd: latest.end };
  }

  return { eps: null, basis: null, periodEnd: null };
}

async function loadFilings(symbol: string): Promise<Omit<Fundamentals, "peRatio" | "marketCap">> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const empty = { symbol, epsTtm: null, sharesOutstanding: null, epsBasis: null, fiscalPeriodEnd: null, available: false } as const;

  const cik = await cikFor(symbol);
  if (!cik) {
    cache.set(symbol, { fetchedAt: Date.now(), data: { ...empty } });
    return { ...empty };
  }

  const [dilutedFacts, sharesFacts] = await Promise.all([
    fetchConcept(cik, "us-gaap", "EarningsPerShareDiluted"),
    fetchConcept(cik, "dei", "EntityCommonStockSharesOutstanding"),
  ]);

  // Smaller filers often tag only basic EPS.
  const epsFacts = dilutedFacts ?? (await fetchConcept(cik, "us-gaap", "EarningsPerShareBasic"));
  const { eps, basis, periodEnd } = epsFacts ? computeEps(epsFacts) : { eps: null, basis: null, periodEnd: null };

  const sharesSorted = sharesFacts ? dedupeByPeriodEnd(sharesFacts) : [];
  const sharesOutstanding = sharesSorted.length > 0 ? sharesSorted[sharesSorted.length - 1].val : null;

  const data = {
    symbol,
    epsTtm: eps,
    sharesOutstanding,
    epsBasis: basis,
    fiscalPeriodEnd: periodEnd,
    available: eps !== null || sharesOutstanding !== null,
  };
  cache.set(symbol, { fetchedAt: Date.now(), data });
  return data;
}

export async function getFundamentals(symbol: string, price: number | null): Promise<Fundamentals> {
  const upper = symbol.toUpperCase();
  try {
    const filed = await loadFilings(upper);
    return {
      ...filed,
      // A negative or zero EPS has no meaningful P/E — brokerages show a dash there too.
      peRatio: price != null && filed.epsTtm != null && filed.epsTtm > 0 ? price / filed.epsTtm : null,
      marketCap: price != null && filed.sharesOutstanding != null ? price * filed.sharesOutstanding : null,
    };
  } catch (err) {
    // Fundamentals are a nice-to-have garnish on the quote panel — never fail the page over them.
    console.warn(`[fundamentals] lookup failed for ${upper}:`, err);
    return {
      symbol: upper,
      epsTtm: null,
      peRatio: null,
      sharesOutstanding: null,
      marketCap: null,
      epsBasis: null,
      fiscalPeriodEnd: null,
      available: false,
    };
  }
}
