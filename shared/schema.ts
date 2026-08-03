import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// companies
// ─────────────────────────────────────────────────────────────────────────
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker"),
  name: text("name").notNull(),
  sector: text("sector"),
  industry: text("industry"),
  ceo: text("ceo"),
  employees: integer("employees"),
  website: text("website"),
  ipoDate: text("ipo_date"),
  description: text("description"),
  segment: text("segment").notNull(),
  createdAt: text("created_at").notNull().default(""),
});

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// theses
// ─────────────────────────────────────────────────────────────────────────
export const theses = sqliteTable("theses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  prediction: text("prediction").notNull(),
  author: text("author"),
  // The window the prediction resolves in. Stored rather than parsed out of the
  // prediction sentence, so the countdown tracks a real date the author set.
  predictionWindowStart: text("prediction_window_start"),
  predictionWindowEnd: text("prediction_window_end"),
  status: text("status").notNull().default("active"), // active | archived
  confidenceScore: real("confidence_score"), // computed, not hand-set
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const insertThesisSchema = createInsertSchema(theses).omit({
  id: true,
  confidenceScore: true,
});
export type InsertThesis = z.infer<typeof insertThesisSchema>;
export type Thesis = typeof theses.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// thesis_assumptions
// ─────────────────────────────────────────────────────────────────────────
export const thesisAssumptions = sqliteTable("thesis_assumptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id").notNull(),
  text: text("text").notNull(),
  importance: text("importance").notNull(), // high | medium | low
  // JSON array of signal_category values this assumption accumulates evidence
  // from, e.g. ["patent_filing"]. NULL means the assumption is not tracked by
  // category at all — the ledger says so rather than reporting a false zero.
  // An empty array means it IS tracked but no category exists for it yet.
  signalCategories: text("signal_categories"),
});

export const insertThesisAssumptionSchema = createInsertSchema(thesisAssumptions).omit({ id: true });
export type InsertThesisAssumption = z.infer<typeof insertThesisAssumptionSchema>;
export type ThesisAssumption = typeof thesisAssumptions.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// thesis_falsifiers — what would prove the thesis wrong
// ─────────────────────────────────────────────────────────────────────────
export const thesisFalsifiers = sqliteTable("thesis_falsifiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id").notNull(),
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertThesisFalsifierSchema = createInsertSchema(thesisFalsifiers).omit({ id: true });
export type InsertThesisFalsifier = z.infer<typeof insertThesisFalsifierSchema>;
export type ThesisFalsifier = typeof thesisFalsifiers.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// thesis_segments — the legs the thesis rests on. A leg with no companies is
// a research gap the UI must hold open, not an empty folder to hide.
// ─────────────────────────────────────────────────────────────────────────
export const thesisSegments = sqliteTable("thesis_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id").notNull(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  isThesisLeg: integer("is_thesis_leg", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertThesisSegmentSchema = createInsertSchema(thesisSegments).omit({ id: true });
export type InsertThesisSegment = z.infer<typeof insertThesisSegmentSchema>;
export type ThesisSegment = typeof thesisSegments.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// thesis_milestones — dated (or deliberately undated) checkpoints inside the
// prediction window
// ─────────────────────────────────────────────────────────────────────────
export const thesisMilestones = sqliteTable("thesis_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  dueDate: text("due_date"), // NULL is meaningful: "no date — blocking the core bet"
  status: text("status").notNull().default("scheduled"), // scheduled | blocking | closes | done
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertThesisMilestoneSchema = createInsertSchema(thesisMilestones).omit({ id: true });
export type InsertThesisMilestone = z.infer<typeof insertThesisMilestoneSchema>;
export type ThesisMilestone = typeof thesisMilestones.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// thesis_confidence_history — one row per recompute, so the trend line is a
// record of what the score actually read rather than a reconstruction
// ─────────────────────────────────────────────────────────────────────────
export const thesisConfidenceHistory = sqliteTable("thesis_confidence_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id").notNull(),
  confidence: real("confidence").notNull(),
  gauge: integer("gauge").notNull(),
  signalCount: integer("signal_count").notNull().default(0),
  computedAt: text("computed_at").notNull(),
});

export const insertThesisConfidenceHistorySchema = createInsertSchema(thesisConfidenceHistory).omit({ id: true });
export type InsertThesisConfidenceHistory = z.infer<typeof insertThesisConfidenceHistorySchema>;
export type ThesisConfidenceHistory = typeof thesisConfidenceHistory.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// thesis_companies
// ─────────────────────────────────────────────────────────────────────────
export const thesisCompanies = sqliteTable("thesis_companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id").notNull(),
  companyId: integer("company_id").notNull(),
  segment: text("segment").notNull(),
  rationale: text("rationale"),
});

export const insertThesisCompanySchema = createInsertSchema(thesisCompanies).omit({ id: true });
export type InsertThesisCompany = z.infer<typeof insertThesisCompanySchema>;
export type ThesisCompany = typeof thesisCompanies.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// sources
// ─────────────────────────────────────────────────────────────────────────
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // connector | free_api | manual
  sourceIdentifier: text("source_identifier").notNull(), // finance, sec_edgar, uspto_patentsview, manual_research_inbox
  reliabilityScore: real("reliability_score").notNull().default(0.5),
  url: text("url"),
  lastSyncedAt: text("last_synced_at"),
  // Why this source carries the weight it carries — shown next to the weight.
  description: text("description"),
  status: text("status").notNull().default("connected"), // connected | needs_key | not_connected
  requiresKey: integer("requires_key", { mode: "boolean" }).notNull().default(false),
});

export const insertSourceSchema = createInsertSchema(sources).omit({ id: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sources.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// signals
// ─────────────────────────────────────────────────────────────────────────
export const signals = sqliteTable("signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thesisId: integer("thesis_id"), // nullable — can exist before attach
  companyId: integer("company_id"), // nullable
  sourceId: integer("source_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  signalCategory: text("signal_category").notNull(),
  provenanceClass: text("provenance_class").notNull(),
  verificationTier: text("verification_tier").notNull(), // unverified|single_source|corroborated|primary_source_confirmed
  direction: text("direction").notNull(), // confirming|contradicting|neutral — never nullable
  relevance: real("relevance").notNull().default(0.5),
  reliability: real("reliability").notNull().default(0.5),
  novelty: real("novelty").notNull().default(0.5),
  independentConfirmations: integer("independent_confirmations").notNull().default(0),
  expectedMagnitude: text("expected_magnitude").notNull().default("medium"), // low|medium|high
  timeHorizon: text("time_horizon").notNull().default("months"), // days|weeks|months|quarters
  pricedInFlag: integer("priced_in_flag", { mode: "boolean" }).notNull().default(false),
  rawPayload: text("raw_payload"), // JSON text, nullable
  sourceUrl: text("source_url"),
  retrievedAt: text("retrieved_at").notNull(),
  ingestionMethod: text("ingestion_method").notNull(), // live_connector|free_public_api|manual_entry
  createdAt: text("created_at").notNull(),
});

export const insertSignalSchema = createInsertSchema(signals).omit({ id: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signals.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// signal_scores
// ─────────────────────────────────────────────────────────────────────────
export const signalScores = sqliteTable("signal_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  signalId: integer("signal_id").notNull(),
  thesisId: integer("thesis_id").notNull(),
  score: real("score").notNull(),
  computedAt: text("computed_at").notNull(),
});

export const insertSignalScoreSchema = createInsertSchema(signalScores).omit({ id: true });
export type InsertSignalScore = z.infer<typeof insertSignalScoreSchema>;
export type SignalScore = typeof signalScores.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// company_quotes — latest market snapshot per company. Denormalised out of
// signals.raw_payload so the watchlist can read prices without parsing JSON
// on the client. One row per company; refreshed in place on each sync.
// ─────────────────────────────────────────────────────────────────────────
export const companyQuotes = sqliteTable("company_quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().unique(),
  sourceId: integer("source_id"),
  price: real("price"),
  change: real("change"),
  changesPercentage: real("changes_percentage"),
  marketCap: real("market_cap"),
  pe: real("pe"),
  volume: real("volume"),
  yearLow: real("year_low"),
  yearHigh: real("year_high"),
  asOf: text("as_of").notNull(),
});

export const insertCompanyQuoteSchema = createInsertSchema(companyQuotes).omit({ id: true });
export type InsertCompanyQuote = z.infer<typeof insertCompanyQuoteSchema>;
export type CompanyQuote = typeof companyQuotes.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// company_analyst_consensus — latest consensus per company, same rationale
// ─────────────────────────────────────────────────────────────────────────
export const companyAnalystConsensus = sqliteTable("company_analyst_consensus", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().unique(),
  sourceId: integer("source_id"),
  rating: text("rating"), // strong_buy | buy | hold | sell | strong_sell
  totalRatings: integer("total_ratings"),
  bullishPct: real("bullish_pct"),
  neutralPct: real("neutral_pct"),
  bearishPct: real("bearish_pct"),
  avgPriceTarget: real("avg_price_target"),
  medianPriceTarget: real("median_price_target"),
  highPriceTarget: real("high_price_target"),
  lowPriceTarget: real("low_price_target"),
  note: text("note"),
  asOf: text("as_of").notNull(),
});

export const insertCompanyAnalystConsensusSchema = createInsertSchema(companyAnalystConsensus).omit({ id: true });
export type InsertCompanyAnalystConsensus = z.infer<typeof insertCompanyAnalystConsensusSchema>;
export type CompanyAnalystConsensus = typeof companyAnalystConsensus.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// research_inbox_items
// ─────────────────────────────────────────────────────────────────────────
export const researchInboxItems = sqliteTable("research_inbox_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rawText: text("raw_text").notNull(),
  sourceContext: text("source_context").notNull(),
  submittedAt: text("submitted_at").notNull(),
  status: text("status").notNull().default("pending"), // pending|promoted|dismissed
  promotedSignalId: integer("promoted_signal_id"),
});

export const insertResearchInboxItemSchema = createInsertSchema(researchInboxItems).omit({
  id: true,
  status: true,
  promotedSignalId: true,
  submittedAt: true,
});
export type InsertResearchInboxItem = z.infer<typeof insertResearchInboxItemSchema>;
export type ResearchInboxItem = typeof researchInboxItems.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// watchlist_items
// ─────────────────────────────────────────────────────────────────────────
export const watchlistItems = sqliteTable("watchlist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  addedAt: text("added_at").notNull(),
  notes: text("notes"),
});

export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).omit({ id: true });
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type WatchlistItem = typeof watchlistItems.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// audit_log
// ─────────────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(), // ingestion|score_computed|signal_created|signal_promoted|source_synced
  description: text("description").notNull(),
  sourceId: integer("source_id"),
  createdAt: text("created_at").notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// settings (for USPTO key etc.)
// ─────────────────────────────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const insertSettingSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// edgar_ticker_cik_cache
// ─────────────────────────────────────────────────────────────────────────
export const edgarTickerCikCache = sqliteTable("edgar_ticker_cik_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull().unique(),
  cik: text("cik").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

export const insertEdgarTickerCikCacheSchema = createInsertSchema(edgarTickerCikCache).omit({ id: true });
export type InsertEdgarTickerCikCache = z.infer<typeof insertEdgarTickerCikCacheSchema>;
export type EdgarTickerCikCache = typeof edgarTickerCikCache.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// users (kept from template, unused but harmless)
// ─────────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
