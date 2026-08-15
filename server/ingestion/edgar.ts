// SEC EDGAR ingestion — always-on, no API key required.
// Per SEC's fair-use policy, every request MUST include a descriptive User-Agent header.
// Docs: https://www.sec.gov/os/webmaster-faq#developers

import { storage } from "../storage";

const SEC_USER_AGENT = "ForwardCapitalResearch research@example.com";

// Simple client-side rate limiter — SEC guidance is <= 10 req/sec; we cap at 8/sec.
let lastRequestTimestamps: number[] = [];
async function rateLimit() {
  const now = Date.now();
  lastRequestTimestamps = lastRequestTimestamps.filter((t) => now - t < 1000);
  if (lastRequestTimestamps.length >= 8) {
    const waitMs = 1000 - (now - lastRequestTimestamps[0]);
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));
  }
  lastRequestTimestamps.push(Date.now());
}

export async function secFetch(url: string): Promise<Response> {
  await rateLimit();
  return fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      "Accept-Encoding": "gzip, deflate",
    },
  });
}

let tickerCikMapCache: Record<string, string> | null = null;

/** Fetch (once, cached in-memory) the static ticker -> CIK mapping file. */
export async function loadTickerCikMap(): Promise<Record<string, string>> {
  if (tickerCikMapCache) return tickerCikMapCache;
  const res = await secFetch("https://www.sec.gov/files/company_tickers.json");
  if (!res.ok) throw new Error(`SEC company_tickers.json fetch failed: ${res.status}`);
  const data = await res.json();
  const map: Record<string, string> = {};
  for (const entry of Object.values(data) as any[]) {
    map[String(entry.ticker).toUpperCase()] = String(entry.cik_str).padStart(10, "0");
  }
  tickerCikMapCache = map;
  return map;
}

/** Resolve a ticker to its 10-digit zero-padded CIK, using the SQLite cache table first. */
export async function resolveCik(ticker: string): Promise<string | null> {
  const cached = await storage.getCikForTicker(ticker.toUpperCase());
  if (cached) return cached.cik;
  const map = await loadTickerCikMap();
  const cik = map[ticker.toUpperCase()];
  if (!cik) return null;
  await storage.setCikForTicker({ ticker: ticker.toUpperCase(), cik, fetchedAt: new Date().toISOString() });
  return cik;
}

export interface EdgarFiling {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  cik: string;
}

/** GET filing history for a company by ticker. */
export async function fetchFilingHistory(ticker: string, limit = 10): Promise<EdgarFiling[]> {
  const cik = await resolveCik(ticker);
  if (!cik) return [];
  const res = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!res.ok) throw new Error(`SEC submissions fetch failed: ${res.status}`);
  const data = await res.json();
  const recent = data.filings?.recent;
  if (!recent) return [];
  const out: EdgarFiling[] = [];
  for (let i = 0; i < Math.min(limit, recent.form.length); i++) {
    out.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      cik,
    });
  }
  return out;
}

export function filingUrl(filing: EdgarFiling): string {
  const accessionNoDashes = filing.accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(filing.cik, 10)}/${accessionNoDashes}/${filing.primaryDocument}`;
}

/** Full text search for keyword-based signal discovery. */
export async function fullTextSearch(keyword: string, forms = "8-K,10-K,10-Q"): Promise<any[]> {
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${keyword}"`)}&forms=${encodeURIComponent(forms)}`;
  const res = await secFetch(url);
  if (!res.ok) throw new Error(`SEC full text search failed: ${res.status}`);
  const data = await res.json();
  return data.hits?.hits ?? [];
}

/**
 * Sync recent filings for a company into `signals` rows.
 * provenanceClass: confirmed_event (10-K/10-Q/8-K are official filings) or raw_data.
 * signalCategory: regulatory_filing. ingestionMethod: free_public_api.
 */
export async function syncEdgarFilings(companyId: number, ticker: string, sourceId: number) {
  const filings = await fetchFilingHistory(ticker, 10);
  const created = [];
  for (const filing of filings) {
    if (!["10-K", "10-Q", "8-K"].includes(filing.form)) continue;
    const url = filingUrl(filing);
    const signal = await storage.createSignal({
      thesisId: null,
      companyId,
      sourceId,
      title: `${ticker}: ${filing.form} filed ${filing.filingDate}`,
      description: `SEC ${filing.form} filing for ${ticker}, filed on ${filing.filingDate}. Retrieved via SEC EDGAR submissions API.`,
      signalCategory: "regulatory_filing",
      provenanceClass: "confirmed_event",
      verificationTier: "primary_source_confirmed",
      direction: "neutral",
      relevance: 0.6,
      reliability: 1.0,
      novelty: 0.4,
      independentConfirmations: 1,
      expectedMagnitude: "medium",
      timeHorizon: "months",
      pricedInFlag: false,
      rawPayload: JSON.stringify(filing),
      sourceUrl: url,
      retrievedAt: new Date().toISOString(),
      ingestionMethod: "free_public_api",
      createdAt: new Date().toISOString(),
    });
    created.push(signal);
  }
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced ${created.length} SEC EDGAR filings for ${ticker}`,
    sourceId,
    createdAt: new Date().toISOString(),
  });
  return created;
}
