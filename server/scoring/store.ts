/**
 * Data access for the opportunity-scoring tables.
 *
 * Follows the existing repo pattern: PostgREST via server/supabase.ts, with
 * snake_case <-> camelCase conversion. Drizzle is not the runtime query layer
 * here (see the note at the top of shared/schema.constraints.ts).
 *
 * Two things this layer is responsible for and callers are not:
 *
 *  1. HYDRATION. Postgres `numeric` arrives over PostgREST as a string and
 *     `timestamptz` as an ISO string. Every read below converts numerics to
 *     `number` and timestamps to `Date`, so nothing downstream ever does
 *     string arithmetic on a price or a share.
 *
 *  2. POINT-IN-TIME. Reads that feed scoring return the full history and the
 *     caller narrows it with `asKnownAt()`. Nothing here filters on
 *     effectiveFrom. See server/scoring/pit.ts.
 */

import {
  supabase,
  objToSnake,
  rowsToCamel,
  throwIfError,
} from "../supabase";

/* ------------------------------------------------------------------ */
/* Hydrated row types                                                  */
/* ------------------------------------------------------------------ */

export interface ConstraintRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  createdAt: Date;
}

export interface ConstraintStateRow {
  id: string;
  constraintId: string;
  tightening: number;
  direction: "tightening" | "stable" | "easing";
  confidence: number;
  method: string;
  leadTimeWeeks: number | null;
  effectiveFrom: Date;
  knownAt: Date;
}

export interface ExposureEdgeRow {
  id: string;
  companyId: number;
  constraintId: string;
  viaCompanyId: number | null;
  revenueShare: number;
  hops: number;
  confidence: number;
  derivation: string;
  sourceDocumentId: number | null;
  supportingQuote: string | null;
  effectiveFrom: Date;
  knownAt: Date;
  supersededAt: Date | null;
}

export interface RecognitionSnapshotRow {
  id: string;
  companyId: number;
  analystCount: number | null;
  themeMentionDensity: number | null;
  thematicEtfCount: number | null;
  multipleVsOwnHistory: number | null;
  shortInterestPct: number | null;
  recognition: number;
  confidence: number;
  knownAt: Date;
}

export interface EstimateSnapshotRow {
  id: string;
  companyId: number;
  fiscalPeriod: string;
  consensusEps: number | null;
  consensusRevenue: number | null;
  analystCount: number | null;
  knownAt: Date;
}

export interface CaptureMetricRow {
  id: string;
  companyId: number;
  fiscalPeriod: string;
  grossMarginPct: number | null;
  backlogValue: number | null;
  contractStructure: string;
  hasPriceEscalators: string | null;
  utilizationPct: number | null;
  sourceDocumentId: number | null;
  effectiveFrom: Date;
  knownAt: Date;
}

export interface OpportunityScoreRow {
  id: string;
  companyId: number;
  constraintId: string | null;
  longScore: number;
  shortScore: number;
  confidence: number;
  components: Record<string, unknown>;
  scorerVersion: string;
  asOf: Date;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/* Hydration helpers                                                   */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number => (v === null || v === undefined ? NaN : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const date = (v: unknown): Date => new Date(String(v));
const dateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(String(v));

function hydrateConstraint(r: any): ConstraintRow {
  return { ...r, createdAt: date(r.createdAt) };
}
function hydrateState(r: any): ConstraintStateRow {
  return {
    ...r,
    tightening: num(r.tightening),
    confidence: num(r.confidence),
    leadTimeWeeks: r.leadTimeWeeks ?? null,
    effectiveFrom: date(r.effectiveFrom),
    knownAt: date(r.knownAt),
  };
}
function hydrateEdge(r: any): ExposureEdgeRow {
  return {
    ...r,
    revenueShare: num(r.revenueShare),
    confidence: num(r.confidence),
    effectiveFrom: date(r.effectiveFrom),
    knownAt: date(r.knownAt),
    supersededAt: dateOrNull(r.supersededAt),
  };
}
function hydrateRecognition(r: any): RecognitionSnapshotRow {
  return {
    ...r,
    themeMentionDensity: numOrNull(r.themeMentionDensity),
    multipleVsOwnHistory: numOrNull(r.multipleVsOwnHistory),
    shortInterestPct: numOrNull(r.shortInterestPct),
    recognition: num(r.recognition),
    confidence: num(r.confidence),
    knownAt: date(r.knownAt),
  };
}
function hydrateEstimate(r: any): EstimateSnapshotRow {
  return {
    ...r,
    consensusEps: numOrNull(r.consensusEps),
    consensusRevenue: numOrNull(r.consensusRevenue),
    knownAt: date(r.knownAt),
  };
}
function hydrateCapture(r: any): CaptureMetricRow {
  return {
    ...r,
    grossMarginPct: numOrNull(r.grossMarginPct),
    backlogValue: numOrNull(r.backlogValue),
    utilizationPct: numOrNull(r.utilizationPct),
    effectiveFrom: date(r.effectiveFrom),
    knownAt: date(r.knownAt),
  };
}
function hydrateScore(r: any): OpportunityScoreRow {
  return {
    ...r,
    longScore: num(r.longScore),
    shortScore: num(r.shortScore),
    confidence: num(r.confidence),
    asOf: date(r.asOf),
    createdAt: date(r.createdAt),
  };
}

/* ------------------------------------------------------------------ */
/* Insert payloads (dates in, ISO strings out)                         */
/* ------------------------------------------------------------------ */

export type NewConstraint = {
  slug: string;
  name: string;
  description?: string | null;
  tier: string;
};

export type NewConstraintState = Omit<ConstraintStateRow, "id">;
export type NewExposureEdge = Omit<ExposureEdgeRow, "id" | "supersededAt"> & {
  supersededAt?: Date | null;
};
export type NewRecognitionSnapshot = Omit<RecognitionSnapshotRow, "id">;
export type NewEstimateSnapshot = Omit<EstimateSnapshotRow, "id">;
export type NewCaptureMetric = Omit<CaptureMetricRow, "id">;
export type NewOpportunityScore = Omit<OpportunityScoreRow, "id" | "createdAt">;

/** Dates -> ISO strings so PostgREST accepts them. */
function serialize(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return objToSnake(out);
}

/* ------------------------------------------------------------------ */
/* Constraints                                                         */
/* ------------------------------------------------------------------ */

export async function listConstraints(): Promise<ConstraintRow[]> {
  const { data, error } = await supabase.from("constraints").select("*");
  throwIfError(error, "listConstraints");
  return rowsToCamel<any>(data).map(hydrateConstraint);
}

export async function getConstraintBySlug(
  slug: string,
): Promise<ConstraintRow | null> {
  const { data, error } = await supabase
    .from("constraints")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  throwIfError(error, "getConstraintBySlug");
  return data ? hydrateConstraint(rowsToCamel<any>([data])[0]) : null;
}

/**
 * Idempotent by slug. The registry is edited by hand and re-seeded often;
 * re-running must not duplicate rows or churn ids that exposure edges point at.
 */
export async function upsertConstraint(
  c: NewConstraint,
): Promise<ConstraintRow> {
  const { data, error } = await supabase
    .from("constraints")
    .upsert(serialize(c), { onConflict: "slug" })
    .select()
    .single();
  throwIfError(error, "upsertConstraint");
  return hydrateConstraint(rowsToCamel<any>([data])[0]);
}

/* ------------------------------------------------------------------ */
/* Constraint states — append-only                                     */
/* ------------------------------------------------------------------ */

export async function insertConstraintState(
  s: NewConstraintState,
): Promise<ConstraintStateRow> {
  const { data, error } = await supabase
    .from("constraint_states")
    .insert(serialize(s))
    .select()
    .single();
  throwIfError(error, "insertConstraintState");
  return hydrateState(rowsToCamel<any>([data])[0]);
}

/** Full history. Narrow with asKnownAt() — never filter on effectiveFrom. */
export async function listConstraintStates(
  constraintId?: string,
): Promise<ConstraintStateRow[]> {
  let q = supabase.from("constraint_states").select("*");
  if (constraintId) q = q.eq("constraint_id", constraintId);
  const { data, error } = await q;
  throwIfError(error, "listConstraintStates");
  return rowsToCamel<any>(data).map(hydrateState);
}

/* ------------------------------------------------------------------ */
/* Exposure edges                                                      */
/* ------------------------------------------------------------------ */

export async function insertExposureEdges(
  edges: NewExposureEdge[],
): Promise<ExposureEdgeRow[]> {
  if (edges.length === 0) return [];
  const { data, error } = await supabase
    .from("exposure_edges")
    .insert(edges.map(serialize))
    .select();
  throwIfError(error, "insertExposureEdges");
  return rowsToCamel<any>(data).map(hydrateEdge);
}

export async function listExposureEdges(filter?: {
  companyId?: number;
  constraintId?: string;
}): Promise<ExposureEdgeRow[]> {
  let q = supabase.from("exposure_edges").select("*");
  if (filter?.companyId !== undefined) q = q.eq("company_id", filter.companyId);
  if (filter?.constraintId) q = q.eq("constraint_id", filter.constraintId);
  const { data, error } = await q;
  throwIfError(error, "listExposureEdges");
  return rowsToCamel<any>(data).map(hydrateEdge);
}

/* ------------------------------------------------------------------ */
/* Recognition / estimates / capture                                   */
/* ------------------------------------------------------------------ */

export async function insertRecognitionSnapshot(
  r: NewRecognitionSnapshot,
): Promise<RecognitionSnapshotRow> {
  const { data, error } = await supabase
    .from("recognition_snapshots")
    .insert(serialize(r))
    .select()
    .single();
  throwIfError(error, "insertRecognitionSnapshot");
  return hydrateRecognition(rowsToCamel<any>([data])[0]);
}

export async function listRecognitionSnapshots(
  companyId?: number,
): Promise<RecognitionSnapshotRow[]> {
  let q = supabase.from("recognition_snapshots").select("*");
  if (companyId !== undefined) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  throwIfError(error, "listRecognitionSnapshots");
  return rowsToCamel<any>(data).map(hydrateRecognition);
}

export async function insertEstimateSnapshot(
  e: NewEstimateSnapshot,
): Promise<EstimateSnapshotRow> {
  const { data, error } = await supabase
    .from("estimate_snapshots")
    .insert(serialize(e))
    .select()
    .single();
  throwIfError(error, "insertEstimateSnapshot");
  return hydrateEstimate(rowsToCamel<any>([data])[0]);
}

export async function listEstimateSnapshots(
  companyId?: number,
): Promise<EstimateSnapshotRow[]> {
  let q = supabase.from("estimate_snapshots").select("*");
  if (companyId !== undefined) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  throwIfError(error, "listEstimateSnapshots");
  return rowsToCamel<any>(data).map(hydrateEstimate);
}

export async function insertCaptureMetrics(
  ms: NewCaptureMetric[],
): Promise<CaptureMetricRow[]> {
  if (ms.length === 0) return [];
  const { data, error } = await supabase
    .from("capture_metrics")
    .insert(ms.map(serialize))
    .select();
  throwIfError(error, "insertCaptureMetrics");
  return rowsToCamel<any>(data).map(hydrateCapture);
}

export async function listCaptureMetrics(
  companyId?: number,
): Promise<CaptureMetricRow[]> {
  let q = supabase.from("capture_metrics").select("*");
  if (companyId !== undefined) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  throwIfError(error, "listCaptureMetrics");
  return rowsToCamel<any>(data).map(hydrateCapture);
}

/* ------------------------------------------------------------------ */
/* Scores — append-only, version-stamped                               */
/* ------------------------------------------------------------------ */

export async function insertOpportunityScores(
  scores: NewOpportunityScore[],
): Promise<OpportunityScoreRow[]> {
  if (scores.length === 0) return [];
  const { data, error } = await supabase
    .from("opportunity_scores")
    .insert(scores.map(serialize))
    .select();
  throwIfError(error, "insertOpportunityScores");
  return rowsToCamel<any>(data).map(hydrateScore);
}

export async function listOpportunityScores(filter?: {
  asOf?: Date;
  scorerVersion?: string;
  companyId?: number;
}): Promise<OpportunityScoreRow[]> {
  let q = supabase.from("opportunity_scores").select("*");
  if (filter?.asOf) q = q.eq("as_of", filter.asOf.toISOString());
  if (filter?.scorerVersion) q = q.eq("scorer_version", filter.scorerVersion);
  if (filter?.companyId !== undefined) q = q.eq("company_id", filter.companyId);
  const { data, error } = await q;
  throwIfError(error, "listOpportunityScores");
  return rowsToCamel<any>(data).map(hydrateScore);
}

/**
 * Which (companyId, constraintId) pairs already have a score for this exact
 * (asOf, scorerVersion). The runner uses this to stay idempotent rather than
 * updating rows — scores are append-only.
 */
export async function existingScoreKeys(
  asOf: Date,
  scorerVersion: string,
): Promise<Set<string>> {
  const rows = await listOpportunityScores({ asOf, scorerVersion });
  return new Set(rows.map((r) => `${r.companyId}::${r.constraintId ?? "null"}`));
}
