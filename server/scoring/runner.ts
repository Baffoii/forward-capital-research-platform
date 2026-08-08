/**
 * The scoring runner.
 *
 * For a given `asOf`, assembles point-in-time inputs for every (company,
 * constraint) pair that has an exposure edge, calls scoreOpportunity, and
 * appends to opportunity_scores.
 *
 * Two properties this file is responsible for:
 *
 *  1. POINT-IN-TIME. Every read goes through asKnownAt(). Nothing filters on
 *     effectiveFrom. This is the file where a lookahead bug would do the most
 *     damage, because it would make the backtest look excellent.
 *
 *  2. IDEMPOTENCE per (company, constraint, asOf, scorerVersion). Scores are
 *     append-only and never updated in place, so re-running must skip pairs
 *     already scored at this version rather than writing duplicates or
 *     overwriting history.
 */

import { storage } from "../storage";
import {
  scoreOpportunity,
  asKnownAt,
  SCORER_VERSION,
  type Measurement,
  type ScoreInputs,
} from "./opportunity.ts";
import {
  traverseExposure,
  aggregateExposure,
  type ExposureEdgeLike,
  type SupplyLink,
} from "./exposure.ts";
import { estimateRevision } from "./estimates.ts";
import { computeCapture } from "../ingestion/filing-financials.ts";
import {
  listConstraints,
  listConstraintStates,
  listExposureEdges,
  listRecognitionSnapshots,
  listEstimateSnapshots,
  listCaptureMetrics,
  insertOpportunityScores,
  existingScoreKeys,
  type NewOpportunityScore,
} from "./store";

export interface ScoringRunResult {
  asOf: Date;
  scorerVersion: string;
  pairsConsidered: number;
  scoresWritten: number;
  skippedAlreadyScored: number;
  skippedMissingInputs: Array<{ companyId: number; constraintSlug: string; reason: string }>;
}

/**
 * Supply links for traversal.
 *
 * Derived from exposure edges that carry a viaCompanyId — those record "this
 * company's exposure flows through that counterparty", which is the same
 * relationship traversal needs. Edges superseded or not yet knowable at asOf
 * are excluded before anything else happens.
 */
function supplyLinksFromEdges(
  edges: Array<{
    companyId: number;
    viaCompanyId: number | null;
    revenueShare: number;
    confidence: number;
    supportingQuote: string | null;
    sourceDocumentId: number | null;
  }>,
): SupplyLink[] {
  const links: SupplyLink[] = [];
  for (const e of edges) {
    if (e.viaCompanyId === null) continue;
    links.push({
      supplierId: e.companyId,
      customerId: e.viaCompanyId,
      revenueShare: e.revenueShare,
      confidence: e.confidence,
      supportingQuote: e.supportingQuote,
      sourceDocumentId: e.sourceDocumentId,
    });
  }
  return links;
}

export async function runScoring(
  asOf: Date,
  opts: { scorerVersion?: string } = {},
): Promise<ScoringRunResult> {
  const scorerVersion = opts.scorerVersion ?? SCORER_VERSION;
  const alreadyScored = await existingScoreKeys(asOf, scorerVersion);
  const skippedMissingInputs: ScoringRunResult["skippedMissingInputs"] = [];

  const constraints = await listConstraints();
  const constraintById = new Map(constraints.map((c) => [c.id, c]));

  const allEdgesRaw = await listExposureEdges();
  // Point-in-time gate, applied once, before any arithmetic.
  const allEdges = allEdgesRaw.filter(
    (e) =>
      e.knownAt.getTime() <= asOf.getTime() &&
      (e.supersededAt === null || e.supersededAt.getTime() > asOf.getTime()),
  );

  const directEdges: ExposureEdgeLike[] = allEdges
    .filter((e) => e.viaCompanyId === null)
    .map((e) => ({
      companyId: e.companyId,
      constraintId: e.constraintId,
      viaCompanyId: null,
      revenueShare: e.revenueShare,
      hops: e.hops,
      confidence: e.confidence,
      derivation: e.derivation,
      supportingQuote: e.supportingQuote,
      sourceDocumentId: e.sourceDocumentId,
    }));

  const aggregated = aggregateExposure(
    traverseExposure(directEdges, supplyLinksFromEdges(allEdges)),
  );

  const scores: NewOpportunityScore[] = [];
  let skippedAlreadyScored = 0;

  for (const exposure of aggregated) {
    const constraint = constraintById.get(exposure.constraintId);
    if (!constraint) continue;

    const key = `${exposure.companyId}::${exposure.constraintId}`;
    if (alreadyScored.has(key)) {
      skippedAlreadyScored++;
      continue;
    }

    /* --- tightening ------------------------------------------------- */

    const states = await listConstraintStates(exposure.constraintId);
    const state = asKnownAt(states, asOf);
    if (!state) {
      // No tightening reading means no score. Defaulting to zero would write a
      // long score of exactly zero for every company and hide the fact that
      // the constraint has never been measured.
      skippedMissingInputs.push({
        companyId: exposure.companyId,
        constraintSlug: constraint.slug,
        reason: "no constraint state knowable at asOf",
      });
      continue;
    }

    /* --- recognition ------------------------------------------------ */

    const recognitionRows = await listRecognitionSnapshots(exposure.companyId);
    const recognitionRow = asKnownAt(recognitionRows, asOf);
    if (!recognitionRow) {
      skippedMissingInputs.push({
        companyId: exposure.companyId,
        constraintSlug: constraint.slug,
        reason: "no recognition snapshot knowable at asOf",
      });
      continue;
    }

    /* --- estimate revision (optional) ------------------------------- */

    const estimates = await listEstimateSnapshots(exposure.companyId);
    const revision = estimateRevision(estimates, asOf);

    /* --- capture (optional) ----------------------------------------- */

    const captureRows = (await listCaptureMetrics(exposure.companyId))
      .filter((m) => m.knownAt.getTime() <= asOf.getTime())
      .sort((a, b) => b.knownAt.getTime() - a.knownAt.getTime());
    const latestCapture = captureRows[0] ?? null;
    const priorCapture = captureRows[1] ?? null;
    const capture = latestCapture
      ? computeCapture({
          grossMarginPct: latestCapture.grossMarginPct,
          priorGrossMarginPct: priorCapture?.grossMarginPct ?? null,
          contractStructure: latestCapture.contractStructure,
          hasPriceEscalators: latestCapture.hasPriceEscalators ?? "unknown",
        })
      : null;

    const captureMeasurement: Measurement | null = capture
      ? { value: capture.value, confidence: capture.confidence, asOf }
      : null;

    /* --- score ------------------------------------------------------ */

    const inputs: ScoreInputs = {
      exposure: {
        value: exposure.revenueShare,
        confidence: exposure.confidence,
        asOf,
      },
      tightening: {
        value: state.tightening,
        confidence: state.confidence,
        asOf,
      },
      recognition: {
        value: recognitionRow.recognition,
        confidence: recognitionRow.confidence,
        asOf,
      },
      estimateRevision: revision,
      capture: captureMeasurement,
    };

    const result = scoreOpportunity(inputs);

    scores.push({
      companyId: exposure.companyId,
      constraintId: exposure.constraintId,
      longScore: result.longScore,
      shortScore: result.shortScore,
      confidence: result.confidence,
      // Every input value and every source, so any row on the board can be
      // walked back to the sentence it came from.
      components: {
        ...result.components,
        flags: [...result.flags, ...exposure.flags],
        constraintSlug: constraint.slug,
        hops: exposure.hops,
        inputs: {
          exposure: { value: exposure.revenueShare, confidence: exposure.confidence },
          tightening: {
            value: state.tightening,
            confidence: state.confidence,
            method: state.method,
            leadTimeWeeks: state.leadTimeWeeks,
            knownAt: state.knownAt.toISOString(),
          },
          recognition: {
            value: recognitionRow.recognition,
            confidence: recognitionRow.confidence,
            analystCount: recognitionRow.analystCount,
            themeMentionDensity: recognitionRow.themeMentionDensity,
            thematicEtfCount: recognitionRow.thematicEtfCount,
            knownAt: recognitionRow.knownAt.toISOString(),
          },
          estimateRevision: revision
            ? { value: revision.value, confidence: revision.confidence }
            : null,
          capture: capture
            ? { value: capture.value, confidence: capture.confidence, basis: capture.basis }
            : null,
        },
        evidence: exposure.contributions.map((c) => ({
          path: c.path,
          hops: c.hops,
          revenueShare: c.revenueShare,
          confidence: c.confidence,
          derivation: c.derivation,
          sourceDocumentId: c.sourceDocumentId ?? null,
          quote: c.supportingQuote ?? null,
        })),
      },
      scorerVersion,
      asOf,
    });
  }

  await insertOpportunityScores(scores);

  await storage.createAuditLog({
    eventType: "scoring",
    description:
      `Scored ${scores.length} (company, constraint) pairs as of ${asOf.toISOString()} ` +
      `at scorer ${scorerVersion}. Skipped ${skippedAlreadyScored} already scored, ` +
      `${skippedMissingInputs.length} for missing inputs.`,
    sourceId: null,
    createdAt: new Date().toISOString(),
  });

  return {
    asOf,
    scorerVersion,
    pairsConsidered: aggregated.length,
    scoresWritten: scores.length,
    skippedAlreadyScored,
    skippedMissingInputs,
  };
}
