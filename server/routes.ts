import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { seedIfEmpty, CANONICAL_SEGMENTS, THESIS_TITLE } from "./seed";
import { computeSignalScore, computeThesisConfidence, confidenceToGauge } from "./scoring";
import {
  insertCompanySchema,
  insertThesisSchema,
  insertThesisAssumptionSchema,
  insertThesisCompanySchema,
  insertSourceSchema,
  insertSignalSchema,
  insertResearchInboxItemSchema,
  insertWatchlistItemSchema,
} from "@shared/schema";
import { z } from "zod";
import {
  syncFinanceQuote,
  syncFinanceProfile,
  syncInsiderTransactions,
  syncAnalystResearch,
  syncSimilarwebSignals,
  createQuoteSignal,
  createInsiderSignal,
  createAnalystSignal,
} from "./ingestion/connectors";
import { syncEdgarFilings } from "./ingestion/edgar";
import { syncPatents, MissingUsptoKeyError } from "./ingestion/patents";

// Shared secret for the /api/admin/ingest push endpoint. Connector calls (external-tool CLI) don't
// work inside a published site's production sandbox, so a scheduled task running outside the site
// fetches connector data itself and pushes already-fetched payloads here over plain HTTPS instead.
// Not meant to guard sensitive data — this is a personal single-user research prototype — just to
// keep the endpoint from being spammed by strangers who find the URL.
// Token must be supplied via the INGEST_ADMIN_TOKEN env var — no hardcoded fallback, to avoid
// shipping a publicly-known default secret in source control / the published bundle.
const INGEST_ADMIN_TOKEN = process.env.INGEST_ADMIN_TOKEN;
if (!INGEST_ADMIN_TOKEN) {
  console.warn(
    "[admin] INGEST_ADMIN_TOKEN is not set — /api/admin/* endpoints will reject all requests until it is configured."
  );
}

function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  if (!INGEST_ADMIN_TOKEN || req.header("x-admin-token") !== INGEST_ADMIN_TOKEN) {
    return res.status(401).json({ error: "Invalid or missing x-admin-token header" });
  }
  next();
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ── Admin / seed ──────────────────────────────────────────────────────
  app.post("/api/admin/seed", requireAdminToken, async (_req, res, next) => {
    try {
      const result = await seedIfEmpty();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/segments", async (_req, res) => {
    res.json({ thesisTitle: THESIS_TITLE, segments: CANONICAL_SEGMENTS });
  });

  // ── Companies ─────────────────────────────────────────────────────────
  app.get("/api/companies", async (_req, res) => {
    res.json(await storage.listCompanies());
  });

  app.get("/api/companies/:id", async (req, res) => {
    const company = await storage.getCompany(Number(req.params.id));
    if (!company) return res.status(404).json({ error: "Company not found" });
    res.json(company);
  });

  app.post("/api/companies", async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(await storage.createCompany(parsed.data));
  });

  app.patch("/api/companies/:id", async (req, res) => {
    const parsed = insertCompanySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateCompany(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ error: "Company not found" });
    res.json(updated);
  });

  // ── Company sync (Sync Now buttons) ─────────────────────────────────────
  const syncSourceParam = z.enum(["quote", "profile", "insiders", "analysts", "patents", "similarweb", "filings"]);

  app.post("/api/companies/:id/sync/:source", async (req, res) => {
    const companyId = Number(req.params.id);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    const sourceParsed = syncSourceParam.safeParse(req.params.source);
    if (!sourceParsed.success) return res.status(400).json({ error: "Unknown sync source" });
    const source = sourceParsed.data;

    try {
      if (source === "quote") {
        if (!company.ticker) return res.status(400).json({ error: "Company has no ticker" });
        const out = await syncFinanceQuote(companyId, company.ticker);
        return res.json(out);
      }
      if (source === "profile") {
        if (!company.ticker) return res.status(400).json({ error: "Company has no ticker" });
        const out = await syncFinanceProfile(companyId, company.ticker);
        return res.json(out);
      }
      if (source === "insiders") {
        if (!company.ticker) return res.status(400).json({ error: "Company has no ticker" });
        const months = Number(req.query.months_lookback) || 6;
        const out = await syncInsiderTransactions(companyId, company.ticker, months);
        return res.json(out);
      }
      if (source === "analysts") {
        if (!company.ticker) return res.status(400).json({ error: "Company has no ticker" });
        const out = await syncAnalystResearch(companyId, company.ticker);
        return res.json(out);
      }
      if (source === "similarweb") {
        const domain = company.website ? company.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
        if (!domain) return res.status(400).json({ error: "Company has no website/domain" });
        const out = await syncSimilarwebSignals(companyId, domain);
        return res.json(out);
      }
      if (source === "filings") {
        if (!company.ticker) return res.status(400).json({ error: "Company has no ticker" });
        const sourceRow = await storage.getSourceByIdentifier("sec_edgar");
        if (!sourceRow) return res.status(500).json({ error: "SEC EDGAR source not seeded" });
        const out = await syncEdgarFilings(companyId, company.ticker, sourceRow.id);
        return res.json(out);
      }
      if (source === "patents") {
        const sourceRow = await storage.getSourceByIdentifier("uspto_patentsview");
        if (!sourceRow) return res.status(500).json({ error: "USPTO source not seeded" });
        const out = await syncPatents(companyId, company.name, sourceRow.id);
        return res.json(out);
      }
    } catch (err: any) {
      if (err instanceof MissingUsptoKeyError) {
        return res.status(412).json({ error: err.message, code: "MISSING_USPTO_KEY" });
      }
      console.error(`sync error [${source}]`, err);
      return res.status(502).json({ error: `Sync failed: ${err.message || "unknown error"}` });
    }
  });

  // ── Bulk sync (used by the scheduled/cron refresh — iterates every company
  // across every free source, then recomputes confidence for every thesis) ──
  app.post("/api/admin/sync-all", requireAdminToken, async (_req, res, next) => {
    try {
    const companies = await storage.listCompanies();
    const companyResults: any[] = [];

    // NOTE: this bulk endpoint intentionally does NOT call the finance/similarweb connector
    // functions (syncFinanceQuote/syncInsiderTransactions/syncAnalystResearch/syncSimilarwebSignals).
    // Those go through `external-tool` (execFile), which is unavailable in a published site's
    // production sandbox (see comment near the top of this file) and, run 13x in a tight loop,
    // was found to destabilize the backend process. That connector data is instead fetched by the
    // scheduled task OUTSIDE this sandbox and pushed here via /api/admin/ingest. This endpoint only
    // does the sync work that's safe to run in-process: SEC EDGAR filings (plain HTTPS fetch) and
    // thesis confidence recomputation.
    for (const company of companies) {
      const result: any = { companyId: company.id, ticker: company.ticker, synced: [], errors: [] };
      if (company.ticker) {
        try {
          const edgarSource = await storage.getSourceByIdentifier("sec_edgar");
          if (edgarSource) {
            await syncEdgarFilings(company.id, company.ticker, edgarSource.id);
            result.synced.push("filings");
          }
        } catch (e: any) {
          result.errors.push({ source: "filings", error: e.message });
        }
      }
      companyResults.push(result);
      // Be polite to SEC EDGAR's rate-limit guidance when looping over many companies.
      await new Promise((r) => setTimeout(r, 200));
    }

    await storage.createAuditLog({
      eventType: "ingestion",
      description: `DIAG: company loop done, ${companies.length} companies processed`,
      sourceId: null,
      createdAt: new Date().toISOString(),
    });

    const theses = await storage.listTheses();
    const thesisResults: any[] = [];
    for (const thesis of theses) {
      const signals = await storage.listSignals({ thesisId: thesis.id });
      await storage.createAuditLog({
        eventType: "ingestion",
        description: `DIAG: thesis ${thesis.id} listSignals ok, ${signals.length} signals`,
        sourceId: null,
        createdAt: new Date().toISOString(),
      });
      const now = new Date();
      const scored = signals.map((s) => ({ signal: s, score: computeSignalScore(s, now) }));
      await storage.createSignalScoresBulk(
        scored.map(({ signal, score }) => ({ signalId: signal.id, thesisId: thesis.id, score, computedAt: now.toISOString() }))
      );
      await storage.createAuditLog({
        eventType: "ingestion",
        description: `DIAG: thesis ${thesis.id} createSignalScoresBulk done, ${scored.length} scored`,
        sourceId: null,
        createdAt: new Date().toISOString(),
      });
      const { confidence, normalizingFactor, sum } = computeThesisConfidence(scored.map((s) => s.score));
      const gauge = confidenceToGauge(confidence);
      await storage.updateThesisConfidence(thesis.id, confidence);
      await storage.createAuditLog({
        eventType: "ingestion",
        description: `DIAG: thesis ${thesis.id} updateThesisConfidence ok, confidence=${confidence}`,
        sourceId: null,
        createdAt: new Date().toISOString(),
      });
      thesisResults.push({ thesisId: thesis.id, confidence, gauge, normalizingFactor, sum });
    }

    await storage.createAuditLog({
      eventType: "ingestion",
      description: `Bulk sync-all run: ${companies.length} companies processed across free sources, ${theses.length} thesis score(s) recomputed.`,
      sourceId: null,
      createdAt: new Date().toISOString(),
    });

    res.json({ companies: companyResults, theses: thesisResults });
    } catch (err) {
      // Any unexpected failure here (e.g. a storage/Supabase error) must not crash the
      // whole backend process — forward to the error middleware instead.
      next(err);
    }
  });

  // ── Remote ingest push (for scheduled/cron refresh of connector-backed data) ──
  // Accepts payloads that were fetched by a scheduled task running OUTSIDE this server
  // (the external-tool connector bridge does not run inside a published site's sandbox).
  const ingestItemSchema = z.object({
    companyId: z.number(),
    ticker: z.string(),
    type: z.enum(["quote", "insiders", "analysts"]),
    result: z.any(),
    monthsLookback: z.number().optional(),
  });

  app.post("/api/admin/ingest", requireAdminToken, async (req, res, next) => {
    try {
    const parsed = z.object({ items: z.array(ingestItemSchema) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const results: any[] = [];
    // Small delay between items — spreads out sequential Supabase round-trips instead of
    // firing them in a tight burst, which was observed to destabilize the production sandbox
    // under back-to-back admin calls (ingest chunk -> ingest chunk -> sync-all).
    for (const item of parsed.data.items) {
      try {
        if (item.type === "quote") {
          results.push(await createQuoteSignal(item.companyId, item.ticker, item.result));
        } else if (item.type === "insiders") {
          results.push(await createInsiderSignal(item.companyId, item.ticker, item.result, item.monthsLookback ?? 6));
        } else if (item.type === "analysts") {
          results.push(await createAnalystSignal(item.companyId, item.ticker, item.result));
        }
      } catch (e: any) {
        results.push({ error: e.message, item: { companyId: item.companyId, ticker: item.ticker, type: item.type } });
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    try {
      await storage.createAuditLog({
        eventType: "ingestion",
        description: `Remote ingest push: ${parsed.data.items.length} item(s) received from an external scheduled task.`,
        sourceId: null,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      // Non-fatal — the items themselves were already written above. Don't let a failed
      // summary audit-log write block the response.
    }

    res.json({ received: parsed.data.items.length, results });
    } catch (err) {
      next(err);
    }
  });

  // Recompute-only endpoint (works standalone in a published site, no connector needed)
  app.post("/api/admin/recompute-all", requireAdminToken, async (_req, res, next) => {
    try {
    const theses = await storage.listTheses();
    const thesisResults: any[] = [];
    for (const thesis of theses) {
      const signals = await storage.listSignals({ thesisId: thesis.id });
      const now = new Date();
      const scored = signals.map((s) => ({ signal: s, score: computeSignalScore(s, now) }));
      await storage.createSignalScoresBulk(
        scored.map(({ signal, score }) => ({ signalId: signal.id, thesisId: thesis.id, score, computedAt: now.toISOString() }))
      );
      const { confidence, normalizingFactor, sum } = computeThesisConfidence(scored.map((s) => s.score));
      const gauge = confidenceToGauge(confidence);
      await storage.updateThesisConfidence(thesis.id, confidence);
      thesisResults.push({ thesisId: thesis.id, confidence, gauge, normalizingFactor, sum });
    }
    res.json({ theses: thesisResults });
    } catch (err) {
      next(err);
    }
  });

  // ── Theses ────────────────────────────────────────────────────────────
  app.get("/api/theses", async (_req, res) => {
    res.json(await storage.listTheses());
  });

  app.get("/api/theses/:id", async (req, res) => {
    const thesis = await storage.getThesis(Number(req.params.id));
    if (!thesis) return res.status(404).json({ error: "Thesis not found" });
    res.json(thesis);
  });

  app.post("/api/theses", async (req, res) => {
    const parsed = insertThesisSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(await storage.createThesis(parsed.data));
  });

  app.get("/api/theses/:id/assumptions", async (req, res) => {
    res.json(await storage.listAssumptions(Number(req.params.id)));
  });

  app.post("/api/theses/:id/assumptions", async (req, res) => {
    const parsed = insertThesisAssumptionSchema.safeParse({ ...req.body, thesisId: Number(req.params.id) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(await storage.createAssumption(parsed.data));
  });

  app.get("/api/theses/:id/companies", async (req, res) => {
    res.json(await storage.listThesisCompanies(Number(req.params.id)));
  });

  app.post("/api/theses/:id/companies", async (req, res) => {
    const parsed = insertThesisCompanySchema.safeParse({ ...req.body, thesisId: Number(req.params.id) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(await storage.createThesisCompany(parsed.data));
  });

  // Recompute confidence score over all signals attached to a thesis
  app.post("/api/thesis/:id/recompute-score", async (req, res, next) => {
    try {
    const thesisId = Number(req.params.id);
    const thesis = await storage.getThesis(thesisId);
    if (!thesis) return res.status(404).json({ error: "Thesis not found" });

    const signals = await storage.listSignals({ thesisId });
    const now = new Date();
    const scored = signals.map((s) => ({ signal: s, score: computeSignalScore(s, now) }));

    await storage.createSignalScoresBulk(
      scored.map(({ signal, score }) => ({ signalId: signal.id, thesisId, score, computedAt: now.toISOString() }))
    );

    const { confidence, normalizingFactor, sum } = computeThesisConfidence(scored.map((s) => s.score));
    const gauge = confidenceToGauge(confidence);
    const updated = await storage.updateThesisConfidence(thesisId, confidence);

    await storage.createAuditLog({
      eventType: "score_computed",
      description: `Recomputed confidence for thesis "${thesis.title}": confidence=${confidence.toFixed(3)} gauge=${gauge} over ${normalizingFactor} signals (sum=${sum.toFixed(3)}).`,
      sourceId: null,
      createdAt: now.toISOString(),
    });

    res.json({ thesis: updated, confidence, gauge, normalizingFactor, sum, signalScores: scored });
    } catch (err) {
      next(err);
    }
  });

  // Evidence board: confirming / contradicting split with per-signal scores, contradicting sorted by |score| desc
  app.get("/api/thesis/:id/evidence", async (req, res) => {
    const thesisId = Number(req.params.id);
    const signals = await storage.listSignals({ thesisId });
    const now = new Date();
    const withScores = signals.map((s) => ({ ...s, score: computeSignalScore(s, now) }));

    const confirming = withScores.filter((s) => s.direction === "confirming").sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const contradicting = withScores.filter((s) => s.direction === "contradicting").sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const neutral = withScores.filter((s) => s.direction === "neutral").sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    res.json({ confirming, contradicting, neutral });
  });

  // ── Sources ───────────────────────────────────────────────────────────
  app.get("/api/sources", async (_req, res) => {
    res.json(await storage.listSources());
  });

  app.post("/api/sources", async (req, res) => {
    const parsed = insertSourceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(await storage.createSource(parsed.data));
  });

  app.patch("/api/sources/:id", async (req, res) => {
    const parsed = insertSourceSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateSource(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ error: "Source not found" });
    res.json(updated);
  });

  app.get("/api/settings/uspto_api_key", async (_req, res) => {
    const setting = await storage.getSetting("uspto_api_key");
    res.json({ hasKey: !!setting?.value });
  });

  app.post("/api/settings/uspto_api_key", async (req, res) => {
    const parsed = z.object({ value: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    await storage.setSetting("uspto_api_key", parsed.data.value);
    res.json({ ok: true });
  });

  // ── Signals ───────────────────────────────────────────────────────────
  app.get("/api/signals", async (req, res) => {
    const filter: any = {};
    if (req.query.thesisId) filter.thesisId = Number(req.query.thesisId);
    if (req.query.companyId) filter.companyId = Number(req.query.companyId);
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.provenanceClass) filter.provenanceClass = String(req.query.provenanceClass);
    if (req.query.verificationTier) filter.verificationTier = String(req.query.verificationTier);
    if (req.query.direction) filter.direction = String(req.query.direction);
    if (req.query.sourceId) filter.sourceId = Number(req.query.sourceId);
    res.json(await storage.listSignals(filter));
  });

  app.get("/api/signals/:id", async (req, res) => {
    const signal = await storage.getSignal(Number(req.params.id));
    if (!signal) return res.status(404).json({ error: "Signal not found" });
    res.json(signal);
  });

  app.post("/api/signals", async (req, res) => {
    const parsed = insertSignalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const signal = await storage.createSignal(parsed.data);
    await storage.createAuditLog({
      eventType: "signal_created",
      description: `Signal created: "${signal.title}"`,
      sourceId: signal.sourceId,
      createdAt: new Date().toISOString(),
    });
    res.json(signal);
  });

  app.patch("/api/signals/:id", async (req, res) => {
    const parsed = insertSignalSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateSignal(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ error: "Signal not found" });
    res.json(updated);
  });

  // ── Research Inbox (manual entry only — no automated ingestion) ─────────
  app.get("/api/inbox", async (_req, res) => {
    res.json(await storage.listInboxItems());
  });

  app.post("/api/inbox", async (req, res) => {
    const parsed = insertResearchInboxItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const item = await storage.createInboxItem({
      ...parsed.data,
      submittedAt: new Date().toISOString(),
    });
    res.json(item);
  });

  const promoteBodySchema = z.object({
    thesisId: z.number().nullable().optional(),
    companyId: z.number().nullable().optional(),
    title: z.string().min(1),
    signalCategory: z.string().min(1),
    provenanceClass: z.string().min(1),
    verificationTier: z.string().min(1),
    direction: z.enum(["confirming", "contradicting", "neutral"]),
    relevance: z.number().min(0).max(1).default(0.5),
    reliability: z.number().min(0).max(1).default(0.4),
    novelty: z.number().min(0).max(1).default(0.5),
    expectedMagnitude: z.enum(["low", "medium", "high"]).default("medium"),
    timeHorizon: z.enum(["days", "weeks", "months", "quarters"]).default("months"),
  });

  app.post("/api/inbox/:id/promote", async (req, res) => {
    const inboxId = Number(req.params.id);
    const item = await storage.getInboxItem(inboxId);
    if (!item) return res.status(404).json({ error: "Inbox item not found" });

    const parsed = promoteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const body = parsed.data;

    const manualSource = await storage.getSourceByIdentifier("manual_research_inbox");
    if (!manualSource) return res.status(500).json({ error: "Manual research inbox source not seeded" });

    const now = new Date().toISOString();
    const signal = await storage.createSignal({
      thesisId: body.thesisId ?? null,
      companyId: body.companyId ?? null,
      sourceId: manualSource.id,
      title: body.title,
      description: item.rawText,
      signalCategory: body.signalCategory,
      provenanceClass: body.provenanceClass,
      verificationTier: body.verificationTier,
      direction: body.direction,
      relevance: body.relevance,
      reliability: body.reliability,
      novelty: body.novelty,
      independentConfirmations: 0,
      expectedMagnitude: body.expectedMagnitude,
      timeHorizon: body.timeHorizon,
      pricedInFlag: false,
      rawPayload: JSON.stringify({ sourceContext: item.sourceContext }),
      sourceUrl: null,
      retrievedAt: item.submittedAt,
      ingestionMethod: "manual_entry",
      createdAt: now,
    });

    const updatedItem = await storage.updateInboxItem(inboxId, { status: "promoted", promotedSignalId: signal.id });

    await storage.createAuditLog({
      eventType: "signal_promoted",
      description: `Research Inbox item #${inboxId} promoted to signal "${signal.title}"`,
      sourceId: manualSource.id,
      createdAt: now,
    });

    res.json({ item: updatedItem, signal });
  });

  app.post("/api/inbox/:id/dismiss", async (req, res) => {
    const updated = await storage.updateInboxItem(Number(req.params.id), { status: "dismissed" });
    if (!updated) return res.status(404).json({ error: "Inbox item not found" });
    res.json(updated);
  });

  // ── Watchlist ─────────────────────────────────────────────────────────
  app.get("/api/watchlist", async (_req, res) => {
    res.json(await storage.listWatchlistItems());
  });

  app.post("/api/watchlist", async (req, res) => {
    const parsed = insertWatchlistItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(await storage.createWatchlistItem({ ...parsed.data, addedAt: new Date().toISOString() }));
  });

  app.delete("/api/watchlist/:id", async (req, res) => {
    await storage.deleteWatchlistItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Audit log (read-only) ────────────────────────────────────────────
  app.get("/api/audit", async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(await storage.listAuditLog(limit, offset));
  });

  return httpServer;
}
