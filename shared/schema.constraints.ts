import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * Additions for the opportunity-scoring branch.
 *
 * Two invariants hold across every table here:
 *
 *  1. NOTHING IS UPDATED IN PLACE. Scores and states are append-only,
 *     dated snapshots. A row is a claim about the world at a moment.
 *
 *  2. `knownAt` != `effectiveFrom`. `effectiveFrom` is when the fact became
 *     true; `knownAt` is the earliest moment we could have known it. A 10-Q
 *     covering Q1 has effectiveFrom = quarter end, knownAt = filing date.
 *     Every backtest filters on knownAt. Filtering on effectiveFrom is
 *     lookahead bias and it will make a broken model look excellent.
 *
 * DIALECT / ID NOTE (deviation from the original draft — see commit message):
 * This file stays pg-core because the live database is Supabase Postgres.
 * `shared/schema.ts` is sqlite-core and is a TYPE-GENERATION ARTIFACT ONLY —
 * the runtime query layer is PostgREST via `server/supabase.ts`, not Drizzle.
 * The two therefore cannot live in one drizzle-kit schema; this file is
 * pushed through `drizzle.config.constraints.ts` (dialect: postgresql).
 *
 * Foreign keys into pre-existing tables (`companies.id`, `sources.id`) are
 * `integer`, not `uuid`, because those tables use integer serial PKs. A uuid
 * `companyId` would never join to a real company and the whole exposure graph
 * would silently return nothing. New tables keep uuid for their OWN PKs.
 * Cross-table `.references()` is omitted for the same reason `signals.companyId`
 * omits it in schema.ts: the target lives in a different drizzle dialect file.
 */

export const directionEnum = pgEnum("constraint_direction", [
  "tightening",
  "stable",
  "easing",
]);

export const derivationEnum = pgEnum("edge_derivation", [
  "customer_concentration", // 10-K >10% customer disclosure
  "segment_disclosure",
  "transcript_mention",
  "trade_data",
  "analyst_estimate",
  "manual",
]);

export const killStatusEnum = pgEnum("kill_status", [
  "armed",
  "triggered",
  "retired",
]);

/* ------------------------------------------------------------------ */
/* Constraint registry — the spine                                     */
/* ------------------------------------------------------------------ */

export const constraints = pgTable(
  "constraints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // What physical thing is scarce. Be specific: "HV transformers >100MVA"
    // beats "power equipment". Vague constraints produce vague exposure.
    description: text("description"),
    // Where in the chain: upstream_material | component | equipment |
    // installation | siting | labor
    tier: text("tier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("constraints_slug_idx").on(t.slug),
  }),
);

/**
 * Append-only readings of how tight a constraint is.
 * `tightening` is SIGNED: +1 demand far outrunning supply, -1 capacity
 * catching up fast. The sign is what lets the same pipeline generate
 * both longs and shorts.
 */
export const constraintStates = pgTable(
  "constraint_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constraintId: uuid("constraint_id")
      .notNull()
      .references(() => constraints.id, { onDelete: "cascade" }),
    tightening: numeric("tightening", { precision: 4, scale: 3 }).notNull(),
    direction: directionEnum("direction").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    // How the number was reached, so a human can argue with it.
    method: text("method").notNull(),
    leadTimeWeeks: integer("lead_time_weeks"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    knownAt: timestamp("known_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    lookupIdx: index("constraint_states_lookup_idx").on(
      t.constraintId,
      t.knownAt,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/* Exposure graph                                                      */
/* ------------------------------------------------------------------ */

/**
 * A company's economic exposure to a constraint.
 *
 * `revenueShare` is the fraction of TOTAL company revenue riding on this
 * constraint — not segment revenue, not "they're in the space". Multiply
 * down through the chain: 60% of revenue in a segment where data centres
 * are 40% of end demand => 0.24.
 *
 * `hops` records distance from the end customer. Hop 0 is a direct
 * hyperscaler supplier. The interesting rows are usually hops 2-3, where
 * the exposure is real but nothing about the company says "AI".
 */
export const exposureEdges = pgTable(
  "exposure_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    constraintId: uuid("constraint_id")
      .notNull()
      .references(() => constraints.id, { onDelete: "cascade" }),
    // Optional: the intermediate counterparty this exposure flows through.
    viaCompanyId: integer("via_company_id"),
    revenueShare: numeric("revenue_share", { precision: 4, scale: 3 }).notNull(),
    hops: integer("hops").notNull().default(0),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    derivation: derivationEnum("derivation").notNull(),
    sourceDocumentId: integer("source_document_id"),
    // Preserve the sentence the estimate came from. Future-you will not
    // remember why 0.24 seemed right.
    supportingQuote: text("supporting_quote"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    knownAt: timestamp("known_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index("exposure_edges_company_idx").on(t.companyId, t.knownAt),
    constraintIdx: index("exposure_edges_constraint_idx").on(
      t.constraintId,
      t.knownAt,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/* Recognition — how priced-in the exposure already is                 */
/* ------------------------------------------------------------------ */

export const recognitionSnapshots = pgTable(
  "recognition_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    analystCount: integer("analyst_count"),
    // Mentions of AI / data centre / hyperscaler per 1k words in the
    // company's OWN transcripts. Cheap, and a good proxy for whether the
    // market has connected the dots.
    themeMentionDensity: numeric("theme_mention_density", {
      precision: 6,
      scale: 3,
    }),
    thematicEtfCount: integer("thematic_etf_count"),
    // Current fwd multiple / trailing 5y median for the same company.
    multipleVsOwnHistory: numeric("multiple_vs_own_history", {
      precision: 6,
      scale: 3,
    }),
    shortInterestPct: numeric("short_interest_pct", { precision: 5, scale: 2 }),
    recognition: numeric("recognition", { precision: 4, scale: 3 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    knownAt: timestamp("known_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    lookupIdx: index("recognition_lookup_idx").on(t.companyId, t.knownAt),
  }),
);

/* ------------------------------------------------------------------ */
/* Revision divergence — the term that links physics to price          */
/* ------------------------------------------------------------------ */

/**
 * Constraints move over quarters; prices move on estimate revisions.
 * The tradeable signal is DIVERGENCE: constraint tightening while
 * consensus sits flat or falls. Tightening plus estimates already
 * ripping is the same fact with no trade in it.
 */
export const estimateSnapshots = pgTable(
  "estimate_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    fiscalPeriod: text("fiscal_period").notNull(), // "FY2027", "Q3-2026"
    consensusEps: numeric("consensus_eps", { precision: 12, scale: 4 }),
    consensusRevenue: numeric("consensus_revenue", { precision: 18, scale: 2 }),
    analystCount: integer("analyst_count"),
    knownAt: timestamp("known_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    lookupIdx: index("estimate_lookup_idx").on(
      t.companyId,
      t.fiscalPeriod,
      t.knownAt,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/* Capture gate — can the shortage actually reach shareholders?        */
/* ------------------------------------------------------------------ */

/**
 * A shortage only pays if the company can reprice. Fixed-price backlog
 * without escalators converts a shortage into a longer queue and zero
 * incremental margin. Gross margin trend is the validator: backlog up,
 * margin flat => the tightening is not reaching the P&L.
 */
export const captureMetrics = pgTable(
  "capture_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    fiscalPeriod: text("fiscal_period").notNull(),
    grossMarginPct: numeric("gross_margin_pct", { precision: 6, scale: 3 }),
    backlogValue: numeric("backlog_value", { precision: 18, scale: 2 }),
    // fixed_price | cost_plus | spot | mixed | unknown
    contractStructure: text("contract_structure").notNull().default("unknown"),
    hasPriceEscalators: text("has_price_escalators"), // yes | no | unknown
    utilizationPct: numeric("utilization_pct", { precision: 5, scale: 2 }),
    sourceDocumentId: integer("source_document_id"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    knownAt: timestamp("known_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    lookupIdx: index("capture_lookup_idx").on(t.companyId, t.knownAt),
  }),
);

/* ------------------------------------------------------------------ */
/* Scores — append-only, never recomputed in place                     */
/* ------------------------------------------------------------------ */

export const opportunityScores = pgTable(
  "opportunity_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    constraintId: uuid("constraint_id").references(() => constraints.id),
    longScore: numeric("long_score", { precision: 6, scale: 5 }).notNull(),
    shortScore: numeric("short_score", { precision: 6, scale: 5 }).notNull(),
    // Confidence is deliberately NOT folded into the score. A low-confidence
    // high score is a research task; a high-confidence low score is a pass.
    // Multiplying them together makes those two indistinguishable.
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    // Every input value + every source id, so any row can be audited back
    // to the sentence it came from.
    components: jsonb("components").notNull(),
    // Version the formula. When you change scoring, old rows stay comparable
    // only within the same version.
    scorerVersion: text("scorer_version").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    rankIdx: index("scores_rank_idx").on(t.asOf, t.longScore),
    companyIdx: index("scores_company_idx").on(t.companyId, t.asOf),
  }),
);

/* ------------------------------------------------------------------ */
/* Kill criteria — falsification, machine-checked                      */
/* ------------------------------------------------------------------ */

export const killCriteria = pgTable(
  "kill_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id"),
    constraintId: uuid("constraint_id").references(() => constraints.id),
    // Human statement of what would prove the thesis wrong.
    statement: text("statement").notNull(),
    // Machine-evaluable form:
    // { metric: "constraint.tightening", op: "lt", value: 0 }
    // { metric: "capture.grossMarginPct.qoqDelta", op: "lt", value: -0.5 }
    predicate: jsonb("predicate").notNull(),
    status: killStatusEnum("status").notNull().default("armed"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    triggeredBy: jsonb("triggered_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("kill_status_idx").on(t.status),
  }),
);

/* ------------------------------------------------------------------ */
/* Positions — so concentration is visible, not discovered later       */
/* ------------------------------------------------------------------ */

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull(),
  side: text("side").notNull(), // long | short
  weightPct: numeric("weight_pct", { precision: 6, scale: 3 }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  thesisNote: text("thesis_note"),
});
