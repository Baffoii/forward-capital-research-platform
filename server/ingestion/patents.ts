// USPTO PatentSearch API ingestion — optional, requires a free user-supplied API key.
// Base URL: https://search.patentsview.org/api/v1/patent/
// Free registration: https://patentsview.org/apis or https://account.uspto.gov/api-manager/
// Graceful degrade: if no key is set, callers must show a clear inline message, never fail silently.

import { storage } from "../storage";

export class MissingUsptoKeyError extends Error {
  constructor() {
    super("Add a free USPTO PatentSearch API key in Source Management to enable this");
    this.name = "MissingUsptoKeyError";
  }
}

export async function getUsptoApiKey(): Promise<string | null> {
  const setting = await storage.getSetting("uspto_api_key");
  return setting?.value ?? null;
}

interface PatentHit {
  patent_id: string;
  patent_title: string;
  patent_date: string;
}

/** Query by best-effort assignee organization name match for recent patent filings. */
export async function searchPatentsByAssignee(companyName: string): Promise<PatentHit[]> {
  const apiKey = await getUsptoApiKey();
  if (!apiKey) throw new MissingUsptoKeyError();

  const query = {
    q: { _text_any: { "assignees.assignee_organization": companyName } },
    f: ["patent_id", "patent_title", "patent_date"],
    o: { per_page: 25 },
  };
  const url = `https://search.patentsview.org/api/v1/patent/?q=${encodeURIComponent(JSON.stringify(query.q))}&f=${encodeURIComponent(JSON.stringify(query.f))}`;

  const res = await fetch(url, {
    headers: { "X-Api-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`USPTO PatentSearch API error: ${res.status}`);
  }
  const data = await res.json();
  return data.patents ?? [];
}

/**
 * Sync recent patent filings for a company into `signals` rows.
 * signalCategory: patent_filing, provenanceClass: raw_data.
 * Throws MissingUsptoKeyError if no key is configured — caller must surface this, not swallow it.
 */
export async function syncPatents(companyId: number, companyName: string, sourceId: number) {
  const patents = await searchPatentsByAssignee(companyName);
  const created = [];
  for (const p of patents) {
    const signal = await storage.createSignal({
      thesisId: null,
      companyId,
      sourceId,
      title: `Patent: ${p.patent_title}`,
      description: `Patent filing "${p.patent_title}" (patent ${p.patent_id}), dated ${p.patent_date}. Assignee-name best-effort match on "${companyName}".`,
      signalCategory: "patent_filing",
      provenanceClass: "raw_data",
      verificationTier: "single_source",
      direction: "neutral",
      relevance: 0.5,
      reliability: 0.85,
      novelty: 0.6,
      independentConfirmations: 0,
      expectedMagnitude: "low",
      timeHorizon: "quarters",
      pricedInFlag: false,
      rawPayload: JSON.stringify(p),
      sourceUrl: `https://patents.google.com/patent/US${p.patent_id}`,
      retrievedAt: new Date().toISOString(),
      ingestionMethod: "free_public_api",
      createdAt: new Date().toISOString(),
    });
    created.push(signal);
  }
  await storage.createAuditLog({
    eventType: "ingestion",
    description: `Synced ${created.length} USPTO patent filings for ${companyName}`,
    sourceId,
    createdAt: new Date().toISOString(),
  });
  return created;
}
