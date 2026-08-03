import type {
  User, InsertUser, Company, InsertCompany, Thesis, InsertThesis,
  ThesisAssumption, InsertThesisAssumption, ThesisCompany, InsertThesisCompany,
  Source, InsertSource, Signal, InsertSignal, SignalScore, InsertSignalScore,
  ResearchInboxItem, InsertResearchInboxItem, WatchlistItem, InsertWatchlistItem,
  AuditLog, InsertAuditLog, Setting, InsertSetting, EdgarTickerCikCache, InsertEdgarTickerCikCache,
  ThesisFalsifier, InsertThesisFalsifier, ThesisSegment, InsertThesisSegment,
  ThesisMilestone, InsertThesisMilestone, ThesisConfidenceHistory, InsertThesisConfidenceHistory,
  CompanyQuote, InsertCompanyQuote, CompanyAnalystConsensus, InsertCompanyAnalystConsensus,
} from "@shared/schema";
import { supabase, objToSnake, rowToCamel, rowsToCamel, throwIfError } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────
// Storage backed by Supabase Postgres (via the Supabase REST/PostgREST
// client). Table/column names in the DB are snake_case; this layer converts
// to/from the camelCase types used throughout the rest of the app so no
// other file needs to change.
// ─────────────────────────────────────────────────────────────────────────

export interface IStorage {
  // users (template)
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // companies
  listCompanies(): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  getCompanyByTicker(ticker: string): Promise<Company | undefined>;
  createCompany(c: InsertCompany): Promise<Company>;
  updateCompany(id: number, patch: Partial<InsertCompany>): Promise<Company | undefined>;

  // theses
  listTheses(): Promise<Thesis[]>;
  getThesis(id: number): Promise<Thesis | undefined>;
  createThesis(t: InsertThesis): Promise<Thesis>;
  updateThesisConfidence(id: number, confidenceScore: number): Promise<Thesis | undefined>;

  // thesis_assumptions
  listAssumptions(thesisId: number): Promise<ThesisAssumption[]>;
  createAssumption(a: InsertThesisAssumption): Promise<ThesisAssumption>;

  // thesis_falsifiers
  listFalsifiers(thesisId: number): Promise<ThesisFalsifier[]>;
  createFalsifier(f: InsertThesisFalsifier): Promise<ThesisFalsifier>;

  // thesis_segments
  listThesisSegments(thesisId: number): Promise<ThesisSegment[]>;
  createThesisSegment(s: InsertThesisSegment): Promise<ThesisSegment>;

  // thesis_milestones
  listMilestones(thesisId: number): Promise<ThesisMilestone[]>;
  createMilestone(m: InsertThesisMilestone): Promise<ThesisMilestone>;

  // thesis_confidence_history
  listConfidenceHistory(thesisId: number, limit?: number): Promise<ThesisConfidenceHistory[]>;
  createConfidenceHistory(h: InsertThesisConfidenceHistory): Promise<ThesisConfidenceHistory>;

  // company_quotes / company_analyst_consensus
  listCompanyQuotes(): Promise<CompanyQuote[]>;
  getCompanyQuote(companyId: number): Promise<CompanyQuote | undefined>;
  upsertCompanyQuote(q: InsertCompanyQuote): Promise<CompanyQuote>;
  listCompanyConsensus(): Promise<CompanyAnalystConsensus[]>;
  getCompanyConsensus(companyId: number): Promise<CompanyAnalystConsensus | undefined>;
  upsertCompanyConsensus(c: InsertCompanyAnalystConsensus): Promise<CompanyAnalystConsensus>;

  // thesis_companies
  listThesisCompanies(thesisId: number): Promise<ThesisCompany[]>;
  createThesisCompany(tc: InsertThesisCompany): Promise<ThesisCompany>;

  // sources
  listSources(): Promise<Source[]>;
  getSource(id: number): Promise<Source | undefined>;
  getSourceByIdentifier(identifier: string): Promise<Source | undefined>;
  createSource(s: InsertSource): Promise<Source>;
  updateSource(id: number, patch: Partial<InsertSource>): Promise<Source | undefined>;

  // signals
  listSignals(filter?: Partial<{ thesisId: number; companyId: number; category: string; provenanceClass: string; verificationTier: string; direction: string; sourceId: number }>): Promise<Signal[]>;
  getSignal(id: number): Promise<Signal | undefined>;
  createSignal(s: InsertSignal): Promise<Signal>;
  updateSignal(id: number, patch: Partial<InsertSignal>): Promise<Signal | undefined>;

  // signal_scores
  createSignalScore(s: InsertSignalScore): Promise<SignalScore>;
  createSignalScoresBulk(scores: InsertSignalScore[]): Promise<SignalScore[]>;
  listSignalScoresForThesis(thesisId: number): Promise<SignalScore[]>;

  // research_inbox_items
  listInboxItems(): Promise<ResearchInboxItem[]>;
  getInboxItem(id: number): Promise<ResearchInboxItem | undefined>;
  createInboxItem(i: InsertResearchInboxItem): Promise<ResearchInboxItem>;
  updateInboxItem(id: number, patch: { status?: string; promotedSignalId?: number }): Promise<ResearchInboxItem | undefined>;

  // watchlist_items
  listWatchlistItems(): Promise<WatchlistItem[]>;
  createWatchlistItem(w: InsertWatchlistItem): Promise<WatchlistItem>;
  deleteWatchlistItem(id: number): Promise<void>;

  // audit_log
  listAuditLog(limit?: number, offset?: number): Promise<AuditLog[]>;
  createAuditLog(a: InsertAuditLog): Promise<AuditLog>;

  // settings
  getSetting(key: string): Promise<Setting | undefined>;
  setSetting(key: string, value: string): Promise<Setting>;

  // edgar cache
  getCikForTicker(ticker: string): Promise<EdgarTickerCikCache | undefined>;
  setCikForTicker(entry: InsertEdgarTickerCikCache): Promise<EdgarTickerCikCache>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) {
    const { data, error } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
    throwIfError(error, "getUser");
    return rowToCamel<User>(data);
  }
  async getUserByUsername(username: string) {
    const { data, error } = await supabase.from("users").select("*").eq("username", username).maybeSingle();
    throwIfError(error, "getUserByUsername");
    return rowToCamel<User>(data);
  }
  async createUser(insertUser: InsertUser) {
    const { data, error } = await supabase.from("users").insert(objToSnake(insertUser)).select().single();
    throwIfError(error, "createUser");
    return rowToCamel<User>(data)!;
  }

  async listCompanies() {
    const { data, error } = await supabase.from("companies").select("*");
    throwIfError(error, "listCompanies");
    return rowsToCamel<Company>(data);
  }
  async getCompany(id: number) {
    const { data, error } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
    throwIfError(error, "getCompany");
    return rowToCamel<Company>(data);
  }
  async getCompanyByTicker(ticker: string) {
    const { data, error } = await supabase.from("companies").select("*").eq("ticker", ticker).maybeSingle();
    throwIfError(error, "getCompanyByTicker");
    return rowToCamel<Company>(data);
  }
  async createCompany(c: InsertCompany) {
    const { data, error } = await supabase.from("companies").insert(objToSnake(c)).select().single();
    throwIfError(error, "createCompany");
    return rowToCamel<Company>(data)!;
  }
  async updateCompany(id: number, patch: Partial<InsertCompany>) {
    const { data, error } = await supabase.from("companies").update(objToSnake(patch)).eq("id", id).select().maybeSingle();
    throwIfError(error, "updateCompany");
    return rowToCamel<Company>(data);
  }

  async listTheses() {
    const { data, error } = await supabase.from("theses").select("*");
    throwIfError(error, "listTheses");
    return rowsToCamel<Thesis>(data);
  }
  async getThesis(id: number) {
    const { data, error } = await supabase.from("theses").select("*").eq("id", id).maybeSingle();
    throwIfError(error, "getThesis");
    return rowToCamel<Thesis>(data);
  }
  async createThesis(t: InsertThesis) {
    const { data, error } = await supabase.from("theses").insert(objToSnake(t)).select().single();
    throwIfError(error, "createThesis");
    return rowToCamel<Thesis>(data)!;
  }
  async updateThesisConfidence(id: number, confidenceScore: number) {
    const { data, error } = await supabase
      .from("theses")
      .update({ confidence_score: confidenceScore, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    throwIfError(error, "updateThesisConfidence");
    return rowToCamel<Thesis>(data);
  }

  async listAssumptions(thesisId: number) {
    const { data, error } = await supabase.from("thesis_assumptions").select("*").eq("thesis_id", thesisId);
    throwIfError(error, "listAssumptions");
    return rowsToCamel<ThesisAssumption>(data);
  }
  async createAssumption(a: InsertThesisAssumption) {
    const { data, error } = await supabase.from("thesis_assumptions").insert(objToSnake(a)).select().single();
    throwIfError(error, "createAssumption");
    return rowToCamel<ThesisAssumption>(data)!;
  }

  async listFalsifiers(thesisId: number) {
    const { data, error } = await supabase
      .from("thesis_falsifiers")
      .select("*")
      .eq("thesis_id", thesisId)
      .order("sort_order", { ascending: true });
    throwIfError(error, "listFalsifiers");
    return rowsToCamel<ThesisFalsifier>(data);
  }
  async createFalsifier(f: InsertThesisFalsifier) {
    const { data, error } = await supabase.from("thesis_falsifiers").insert(objToSnake(f)).select().single();
    throwIfError(error, "createFalsifier");
    return rowToCamel<ThesisFalsifier>(data)!;
  }

  async listThesisSegments(thesisId: number) {
    const { data, error } = await supabase
      .from("thesis_segments")
      .select("*")
      .eq("thesis_id", thesisId)
      .order("sort_order", { ascending: true });
    throwIfError(error, "listThesisSegments");
    return rowsToCamel<ThesisSegment>(data);
  }
  async createThesisSegment(s: InsertThesisSegment) {
    const { data, error } = await supabase.from("thesis_segments").insert(objToSnake(s)).select().single();
    throwIfError(error, "createThesisSegment");
    return rowToCamel<ThesisSegment>(data)!;
  }

  async listMilestones(thesisId: number) {
    const { data, error } = await supabase
      .from("thesis_milestones")
      .select("*")
      .eq("thesis_id", thesisId)
      .order("sort_order", { ascending: true });
    throwIfError(error, "listMilestones");
    return rowsToCamel<ThesisMilestone>(data);
  }
  async createMilestone(m: InsertThesisMilestone) {
    const { data, error } = await supabase.from("thesis_milestones").insert(objToSnake(m)).select().single();
    throwIfError(error, "createMilestone");
    return rowToCamel<ThesisMilestone>(data)!;
  }

  async listConfidenceHistory(thesisId: number, limit = 52) {
    // Newest first out of Postgres so the limit takes the most recent rows; the
    // route re-sorts oldest-first for the chart.
    const { data, error } = await supabase
      .from("thesis_confidence_history")
      .select("*")
      .eq("thesis_id", thesisId)
      .order("computed_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "listConfidenceHistory");
    return rowsToCamel<ThesisConfidenceHistory>(data);
  }
  async createConfidenceHistory(h: InsertThesisConfidenceHistory) {
    const { data, error } = await supabase.from("thesis_confidence_history").insert(objToSnake(h)).select().single();
    throwIfError(error, "createConfidenceHistory");
    return rowToCamel<ThesisConfidenceHistory>(data)!;
  }

  async listCompanyQuotes() {
    const { data, error } = await supabase.from("company_quotes").select("*");
    throwIfError(error, "listCompanyQuotes");
    return rowsToCamel<CompanyQuote>(data);
  }
  async getCompanyQuote(companyId: number) {
    const { data, error } = await supabase.from("company_quotes").select("*").eq("company_id", companyId).maybeSingle();
    throwIfError(error, "getCompanyQuote");
    return rowToCamel<CompanyQuote>(data);
  }
  async upsertCompanyQuote(q: InsertCompanyQuote) {
    // company_id carries a UNIQUE constraint, so this refreshes the snapshot in
    // place rather than accumulating one row per sync.
    const { data, error } = await supabase
      .from("company_quotes")
      .upsert(objToSnake(q), { onConflict: "company_id" })
      .select()
      .single();
    throwIfError(error, "upsertCompanyQuote");
    return rowToCamel<CompanyQuote>(data)!;
  }

  async listCompanyConsensus() {
    const { data, error } = await supabase.from("company_analyst_consensus").select("*");
    throwIfError(error, "listCompanyConsensus");
    return rowsToCamel<CompanyAnalystConsensus>(data);
  }
  async getCompanyConsensus(companyId: number) {
    const { data, error } = await supabase
      .from("company_analyst_consensus")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    throwIfError(error, "getCompanyConsensus");
    return rowToCamel<CompanyAnalystConsensus>(data);
  }
  async upsertCompanyConsensus(c: InsertCompanyAnalystConsensus) {
    const { data, error } = await supabase
      .from("company_analyst_consensus")
      .upsert(objToSnake(c), { onConflict: "company_id" })
      .select()
      .single();
    throwIfError(error, "upsertCompanyConsensus");
    return rowToCamel<CompanyAnalystConsensus>(data)!;
  }

  async listThesisCompanies(thesisId: number) {
    const { data, error } = await supabase.from("thesis_companies").select("*").eq("thesis_id", thesisId);
    throwIfError(error, "listThesisCompanies");
    return rowsToCamel<ThesisCompany>(data);
  }
  async createThesisCompany(tc: InsertThesisCompany) {
    const { data, error } = await supabase.from("thesis_companies").insert(objToSnake(tc)).select().single();
    throwIfError(error, "createThesisCompany");
    return rowToCamel<ThesisCompany>(data)!;
  }

  async listSources() {
    const { data, error } = await supabase.from("sources").select("*");
    throwIfError(error, "listSources");
    return rowsToCamel<Source>(data);
  }
  async getSource(id: number) {
    const { data, error } = await supabase.from("sources").select("*").eq("id", id).maybeSingle();
    throwIfError(error, "getSource");
    return rowToCamel<Source>(data);
  }
  async getSourceByIdentifier(identifier: string) {
    const { data, error } = await supabase.from("sources").select("*").eq("source_identifier", identifier).maybeSingle();
    throwIfError(error, "getSourceByIdentifier");
    return rowToCamel<Source>(data);
  }
  async createSource(s: InsertSource) {
    const { data, error } = await supabase.from("sources").insert(objToSnake(s)).select().single();
    throwIfError(error, "createSource");
    return rowToCamel<Source>(data)!;
  }
  async updateSource(id: number, patch: Partial<InsertSource>) {
    const { data, error } = await supabase.from("sources").update(objToSnake(patch)).eq("id", id).select().maybeSingle();
    throwIfError(error, "updateSource");
    return rowToCamel<Source>(data);
  }

  async listSignals(filter?: Partial<{ thesisId: number; companyId: number; category: string; provenanceClass: string; verificationTier: string; direction: string; sourceId: number }>) {
    // Push filters down to Supabase instead of fetching the entire (and growing) signals
    // table and filtering in memory — an unfiltered `select("*")` over the full table was
    // found to destabilize the backend when called from the sync-all bulk-recompute loop.
    let query = supabase.from("signals").select("*").order("created_at", { ascending: false });
    if (filter) {
      if (filter.thesisId !== undefined) query = query.eq("thesis_id", filter.thesisId);
      if (filter.companyId !== undefined) query = query.eq("company_id", filter.companyId);
      if (filter.category) query = query.eq("signal_category", filter.category);
      if (filter.provenanceClass) query = query.eq("provenance_class", filter.provenanceClass);
      if (filter.verificationTier) query = query.eq("verification_tier", filter.verificationTier);
      if (filter.direction) query = query.eq("direction", filter.direction);
      if (filter.sourceId !== undefined) query = query.eq("source_id", filter.sourceId);
    }
    const { data, error } = await query;
    throwIfError(error, "listSignals");
    return rowsToCamel<Signal>(data);
  }
  async getSignal(id: number) {
    const { data, error } = await supabase.from("signals").select("*").eq("id", id).maybeSingle();
    throwIfError(error, "getSignal");
    return rowToCamel<Signal>(data);
  }
  async createSignal(s: InsertSignal) {
    const { data, error } = await supabase.from("signals").insert(objToSnake(s)).select().single();
    throwIfError(error, "createSignal");
    return rowToCamel<Signal>(data)!;
  }
  async updateSignal(id: number, patch: Partial<InsertSignal>) {
    const { data, error } = await supabase.from("signals").update(objToSnake(patch)).eq("id", id).select().maybeSingle();
    throwIfError(error, "updateSignal");
    return rowToCamel<Signal>(data);
  }

  async createSignalScore(s: InsertSignalScore) {
    const { data, error } = await supabase.from("signal_scores").insert(objToSnake(s)).select().single();
    throwIfError(error, "createSignalScore");
    return rowToCamel<SignalScore>(data)!;
  }
  async createSignalScoresBulk(scores: InsertSignalScore[]) {
    if (scores.length === 0) return [];
    const { data, error } = await supabase.from("signal_scores").insert(scores.map(objToSnake)).select();
    throwIfError(error, "createSignalScoresBulk");
    return rowsToCamel<SignalScore>(data);
  }
  async listSignalScoresForThesis(thesisId: number) {
    const { data, error } = await supabase.from("signal_scores").select("*").eq("thesis_id", thesisId);
    throwIfError(error, "listSignalScoresForThesis");
    return rowsToCamel<SignalScore>(data);
  }

  async listInboxItems() {
    const { data, error } = await supabase.from("research_inbox_items").select("*").order("submitted_at", { ascending: false });
    throwIfError(error, "listInboxItems");
    return rowsToCamel<ResearchInboxItem>(data);
  }
  async getInboxItem(id: number) {
    const { data, error } = await supabase.from("research_inbox_items").select("*").eq("id", id).maybeSingle();
    throwIfError(error, "getInboxItem");
    return rowToCamel<ResearchInboxItem>(data);
  }
  async createInboxItem(i: InsertResearchInboxItem) {
    const payload = objToSnake({ ...i, submittedAt: new Date().toISOString() });
    const { data, error } = await supabase.from("research_inbox_items").insert(payload).select().single();
    throwIfError(error, "createInboxItem");
    return rowToCamel<ResearchInboxItem>(data)!;
  }
  async updateInboxItem(id: number, patch: { status?: string; promotedSignalId?: number }) {
    const { data, error } = await supabase.from("research_inbox_items").update(objToSnake(patch)).eq("id", id).select().maybeSingle();
    throwIfError(error, "updateInboxItem");
    return rowToCamel<ResearchInboxItem>(data);
  }

  async listWatchlistItems() {
    const { data, error } = await supabase.from("watchlist_items").select("*");
    throwIfError(error, "listWatchlistItems");
    return rowsToCamel<WatchlistItem>(data);
  }
  async createWatchlistItem(w: InsertWatchlistItem) {
    const { data, error } = await supabase.from("watchlist_items").insert(objToSnake(w)).select().single();
    throwIfError(error, "createWatchlistItem");
    return rowToCamel<WatchlistItem>(data)!;
  }
  async deleteWatchlistItem(id: number) {
    const { error } = await supabase.from("watchlist_items").delete().eq("id", id);
    throwIfError(error, "deleteWatchlistItem");
  }

  async listAuditLog(limit = 100, offset = 0) {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    throwIfError(error, "listAuditLog");
    return rowsToCamel<AuditLog>(data);
  }
  async createAuditLog(a: InsertAuditLog) {
    const { data, error } = await supabase.from("audit_log").insert(objToSnake(a)).select().single();
    throwIfError(error, "createAuditLog");
    return rowToCamel<AuditLog>(data)!;
  }

  async getSetting(key: string) {
    const { data, error } = await supabase.from("settings").select("*").eq("key", key).maybeSingle();
    throwIfError(error, "getSetting");
    return rowToCamel<Setting>(data);
  }
  async setSetting(key: string, value: string) {
    const existing = await this.getSetting(key);
    if (existing) {
      const { data, error } = await supabase.from("settings").update({ value }).eq("key", key).select().single();
      throwIfError(error, "setSetting(update)");
      return rowToCamel<Setting>(data)!;
    }
    const { data, error } = await supabase.from("settings").insert({ key, value }).select().single();
    throwIfError(error, "setSetting(insert)");
    return rowToCamel<Setting>(data)!;
  }

  async getCikForTicker(ticker: string) {
    const { data, error } = await supabase.from("edgar_ticker_cik_cache").select("*").eq("ticker", ticker).maybeSingle();
    throwIfError(error, "getCikForTicker");
    return rowToCamel<EdgarTickerCikCache>(data);
  }
  async setCikForTicker(entry: InsertEdgarTickerCikCache) {
    const existing = await this.getCikForTicker(entry.ticker);
    if (existing) {
      const { data, error } = await supabase.from("edgar_ticker_cik_cache").update(objToSnake(entry)).eq("ticker", entry.ticker).select().single();
      throwIfError(error, "setCikForTicker(update)");
      return rowToCamel<EdgarTickerCikCache>(data)!;
    }
    const { data, error } = await supabase.from("edgar_ticker_cik_cache").insert(objToSnake(entry)).select().single();
    throwIfError(error, "setCikForTicker(insert)");
    return rowToCamel<EdgarTickerCikCache>(data)!;
  }
}

export const storage = new DatabaseStorage();
