/**
 * Transcripts -> constraint states.
 *
 * Runs every CONFIGURED transcript source, classifies each call, and writes a
 * tightening reading per constraint. Written against the TranscriptSource
 * interface, so swapping the manual-paste path for a licensed feed changes
 * nothing here.
 *
 * Transcript-derived readings outrank backlog-derived ones because they can
 * separate the two things backlog coverage cannot: demand rising and delivery
 * slowing look identical in a coverage ratio, and management describing their
 * own lead times is a direct read. Both still get written — the append-only
 * table keeps them side by side with their methods recorded, so a human can
 * see when the two disagree.
 */

import { storage } from "../storage";
import {
  transcriptSources,
  availableSources,
  type Transcript,
  type TranscriptSource,
} from "./source.ts";
import { classifyTranscript, type TranscriptReading } from "./lead-time.ts";
import {
  listConstraints,
  listExposureEdges,
  insertConstraintState,
} from "../scoring/store";

export interface TranscriptIngestResult {
  asOf: Date;
  sourcesRun: string[];
  sourcesSkipped: Array<{ id: string; reason: string }>;
  transcriptsRead: number;
  readingsProduced: number;
  statesWritten: number;
  notes: string[];
}

/**
 * Confidence ceiling for transcript-derived tightening.
 *
 * Higher than the backlog ceiling (0.4) because this is management speaking
 * about their own delivery times rather than an inference from a ratio. Still
 * well below 1: it is one company's account of its own market, given by people
 * with an interest in how it sounds, and a keyword classifier reading it.
 */
export const TRANSCRIPT_METHOD_CONFIDENCE_CEILING = 0.75;

export async function ingestTranscripts(
  asOf: Date,
  sources: TranscriptSource[] = transcriptSources,
): Promise<TranscriptIngestResult> {
  const notes: string[] = [];
  const sourcesRun: string[] = [];
  const sourcesSkipped: TranscriptIngestResult["sourcesSkipped"] = [];

  for (const s of sources) {
    if (!s.configured) {
      sourcesSkipped.push({
        id: s.id,
        reason: "not configured — licensing unresolved, use the Research Inbox paste path",
      });
    }
  }

  const companies = await storage.listCompanies();
  const byTicker = new Map(
    companies.filter((c) => c.ticker).map((c) => [c.ticker!.toUpperCase(), c]),
  );

  const readings: TranscriptReading[] = [];
  let transcriptsRead = 0;

  for (const source of availableSources(sources)) {
    sourcesRun.push(source.id);
    const refs = await source.list();
    for (const ref of refs) {
      // Point-in-time: a transcript pasted after `asOf` was not knowable then,
      // however old the call itself is.
      if (ref.knownAt.getTime() > asOf.getTime()) continue;

      const company = byTicker.get(ref.ticker.toUpperCase());
      if (!company) {
        notes.push(`transcript for ${ref.ticker} has no matching company row`);
        continue;
      }
      const transcript: Transcript | null = await source.fetch(ref);
      if (!transcript) continue;
      transcriptsRead++;

      const reading = classifyTranscript({
        companyId: company.id,
        fiscalPeriod: transcript.fiscalPeriod,
        text: transcript.text,
        effectiveFrom: transcript.callDate,
        knownAt: transcript.knownAt,
      });
      // A call with no lead-time content produces nothing. Silence is not a
      // neutral reading and must not be written as a zero.
      if (reading) readings.push(reading);
    }
  }

  /* --- roll company readings up to constraints ---------------------- */

  const constraints = await listConstraints();
  let statesWritten = 0;

  for (const constraint of constraints) {
    const edges = (await listExposureEdges({ constraintId: constraint.id })).filter(
      (e) => e.knownAt.getTime() <= asOf.getTime() && e.supersededAt === null,
    );
    if (edges.length === 0) continue;

    const weightById = new Map(edges.map((e) => [e.companyId, e]));
    // Most recent knowable reading per company; an older call must not outvote
    // a newer one just because it was more emphatic.
    const latestByCompany = new Map<number, TranscriptReading>();
    for (const r of readings) {
      if (!weightById.has(r.companyId)) continue;
      const prev = latestByCompany.get(r.companyId);
      if (!prev || r.knownAt > prev.knownAt) latestByCompany.set(r.companyId, r);
    }
    const contributors = Array.from(latestByCompany.values());
    if (contributors.length === 0) continue;

    let weightSum = 0;
    let valueSum = 0;
    let confSum = 0;
    let leadTimeWeeks: number | null = null;
    let bestLeadTimeWeight = 0;

    for (const r of contributors) {
      const edge = weightById.get(r.companyId)!;
      const weight = edge.revenueShare * edge.confidence;
      if (weight <= 0) continue;
      weightSum += weight;
      valueSum += r.tightening * weight;
      confSum += Math.min(r.confidence, edge.confidence) * weight;
      // Report the lead time from the most-exposed company that stated one,
      // rather than averaging numbers that describe different products.
      if (r.leadTimeWeeks !== null && weight > bestLeadTimeWeight) {
        leadTimeWeeks = r.leadTimeWeeks;
        bestLeadTimeWeight = weight;
      }
    }
    if (weightSum === 0) continue;

    const tightening = valueSum / weightSum;
    const breadthPenalty = Math.min(1, contributors.length / 3);
    const confidence = Math.min(
      TRANSCRIPT_METHOD_CONFIDENCE_CEILING,
      (confSum / weightSum) * breadthPenalty,
    );

    const quotes = contributors
      .flatMap((c) => c.supportingQuotes.slice(0, 1))
      .slice(0, 3);

    await insertConstraintState({
      constraintId: constraint.id,
      tightening,
      direction:
        tightening > 0.15 ? "tightening" : tightening < -0.15 ? "easing" : "stable",
      confidence,
      method:
        `transcript_lead_time_v1: revenue-share-weighted mean of per-call lead-time and ` +
        `capacity language across ${contributors.length} exposed company(ies). ` +
        `Quotes: ${quotes.map((q) => `"${q}"`).join(" | ")}`,
      leadTimeWeeks: leadTimeWeeks === null ? null : Math.round(leadTimeWeeks),
      effectiveFrom: asOf,
      knownAt: asOf,
    });
    statesWritten++;
  }

  if (sourcesRun.length === 0) {
    notes.push(
      "no configured transcript source produced anything — paste transcripts into the " +
        "Research Inbox with a TRANSCRIPT header (ticker/period/date) to populate this",
    );
  }

  return {
    asOf,
    sourcesRun,
    sourcesSkipped,
    transcriptsRead,
    readingsProduced: readings.length,
    statesWritten,
    notes,
  };
}
