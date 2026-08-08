/**
 * Collects recognition inputs and writes recognitionSnapshots.
 *
 * Where each input comes from, and what it costs:
 *
 *   analystCount           estimate_snapshots (operator- or vendor-supplied)
 *   themeMentionDensity    computed from the company's own transcripts — free,
 *                          and the only component we generate ourselves
 *   thematicEtfCount       operator-supplied; no free API exposes ETF holdings
 *   multipleVsOwnHistory   operator-supplied; excluded from the composite by
 *                          default (see recognition.ts)
 *
 * Nothing here invents a value when the input is absent. A null propagates to
 * the composite, which reports reduced coverage and lower confidence. A
 * fabricated analyst count would be indistinguishable from a real one.
 */

import { storage } from "../storage";
import {
  transcriptSources,
  availableSources,
  type TranscriptSource,
} from "../transcripts/source.ts";
import { themeMentionDensity, computeRecognition } from "./recognition.ts";
import {
  listEstimateSnapshots,
  insertRecognitionSnapshot,
  type RecognitionSnapshotRow,
} from "./store";
import { asKnownAt } from "./opportunity.ts";

/**
 * Operator-supplied inputs that have no free API.
 *
 * Starts empty. An entry is a claim you are making, so it carries the date you
 * made it — a 2026 ETF membership count must not be applied to a 2024 score.
 */
export interface ManualRecognitionInput {
  ticker: string;
  thematicEtfCount?: number;
  multipleVsOwnHistory?: number;
  shortInterestPct?: number;
  knownAt: Date;
}

export const MANUAL_RECOGNITION_INPUTS: ManualRecognitionInput[] = [];

export interface RecognitionRunResult {
  asOf: Date;
  snapshotsWritten: number;
  companiesSkipped: Array<{ companyId: number; reason: string }>;
  notes: string[];
}

export async function collectRecognition(
  asOf: Date,
  sources: TranscriptSource[] = transcriptSources,
): Promise<RecognitionRunResult> {
  const companies = await storage.listCompanies();
  const companiesSkipped: RecognitionRunResult["companiesSkipped"] = [];
  const notes: string[] = [];
  let snapshotsWritten = 0;

  // Theme density needs the company's own transcripts. Gather once.
  const transcriptTextByTicker = new Map<string, string[]>();
  for (const source of availableSources(sources)) {
    for (const ref of await source.list()) {
      if (ref.knownAt.getTime() > asOf.getTime()) continue;
      const t = await source.fetch(ref);
      if (!t) continue;
      const key = t.ticker.toUpperCase();
      transcriptTextByTicker.set(key, [...(transcriptTextByTicker.get(key) ?? []), t.text]);
    }
  }
  if (transcriptTextByTicker.size === 0) {
    notes.push(
      "no transcripts available at this asOf — theme mention density will be null for every company",
    );
  }

  for (const company of companies) {
    const ticker = company.ticker?.toUpperCase() ?? null;

    // Analyst count: latest estimate snapshot KNOWABLE at asOf.
    const estimates = await listEstimateSnapshots(company.id);
    const latestEstimate = asKnownAt(estimates, asOf);
    const analystCount = latestEstimate?.analystCount ?? null;

    // Theme density from the company's own calls.
    const texts = ticker ? (transcriptTextByTicker.get(ticker) ?? []) : [];
    const density = texts.length > 0 ? themeMentionDensity(texts.join("\n")) : null;

    // Manual inputs, point-in-time.
    const manual = ticker
      ? asKnownAt(
          MANUAL_RECOGNITION_INPUTS.filter((m) => m.ticker.toUpperCase() === ticker),
          asOf,
        )
      : null;

    const result = computeRecognition({
      analystCount,
      themeMentionDensity: density,
      thematicEtfCount: manual?.thematicEtfCount ?? null,
      multipleVsOwnHistory: manual?.multipleVsOwnHistory ?? null,
      shortInterestPct: manual?.shortInterestPct ?? null,
    });

    if (result.flags.includes("no_recognition_inputs")) {
      companiesSkipped.push({
        companyId: company.id,
        reason:
          "no analyst count, no transcripts, no manual inputs — writing 0.5 on no evidence would be worse than writing nothing",
      });
      continue;
    }

    const row: Omit<RecognitionSnapshotRow, "id"> = {
      companyId: company.id,
      analystCount,
      themeMentionDensity: density,
      thematicEtfCount: manual?.thematicEtfCount ?? null,
      multipleVsOwnHistory: manual?.multipleVsOwnHistory ?? null,
      shortInterestPct: manual?.shortInterestPct ?? null,
      recognition: result.recognition,
      confidence: result.confidence,
      knownAt: asOf,
    };
    await insertRecognitionSnapshot(row);
    snapshotsWritten++;
  }

  return { asOf, snapshotsWritten, companiesSkipped, notes };
}
