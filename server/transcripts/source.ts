/**
 * The transcript seam.
 *
 * Transcripts are the highest-value input to the constraint model and the main
 * practical obstacle to getting them: full call transcripts are a licensed
 * product, the terms vary, and the question of which vendor to sign is a
 * commercial decision, not a code decision.
 *
 * So this file builds the SEAM and exactly two adapters:
 *
 *   1. ResearchInboxTranscriptSource — the operator pastes a transcript into
 *      the Research Inbox that already exists. Zero licensing risk, works
 *      today, scales to however much reading a human will do.
 *
 *   2. LicensedApiTranscriptSource — a stub that throws until configured.
 *      It exists so the shape of the integration is settled and the extractor
 *      is written against an interface rather than against one source.
 *
 * Deliberately NOT here: any scraper. Nothing in this codebase should fetch
 * transcript text from behind a paywall or a terms-of-service gate, and
 * building "just a small one" is how that line gets crossed.
 */

import { storage } from "../storage";
import { parseTranscriptPaste } from "./paste-format.ts";

export { parseTranscriptPaste, type ParsedPaste } from "./paste-format.ts";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TranscriptRef {
  sourceId: string;
  ticker: string;
  fiscalPeriod: string;
  /** When the call happened — the fact became true here. */
  callDate: Date;
  /**
   * When WE could first have had the text. For a pasted transcript this is
   * the paste time, not the call date: if the operator pastes a 2024 call in
   * 2026, it was not knowable in 2024 and backfilling it as though it were is
   * lookahead bias.
   */
  knownAt: Date;
}

export interface Transcript extends TranscriptRef {
  text: string;
  /** Where this came from, for the audit trail. */
  provenance: string;
}

export interface TranscriptSource {
  readonly id: string;
  /**
   * How the text was obtained. Anything other than operator_supplied or
   * licensed_api should not exist.
   */
  readonly licensing: "operator_supplied" | "licensed_api";
  readonly configured: boolean;
  list(opts?: { ticker?: string; since?: Date }): Promise<TranscriptRef[]>;
  fetch(ref: TranscriptRef): Promise<Transcript | null>;
}

/* ------------------------------------------------------------------ */
/* Manual paste, via the existing Research Inbox                       */
/* ------------------------------------------------------------------ */

export class ResearchInboxTranscriptSource implements TranscriptSource {
  readonly id = "research_inbox";
  readonly licensing = "operator_supplied" as const;
  readonly configured = true;

  private cache = new Map<string, Transcript>();

  private async load(): Promise<Transcript[]> {
    const items = await storage.listInboxItems();
    const out: Transcript[] = [];
    for (const item of items) {
      if (!/transcript/i.test(item.sourceContext ?? "")) continue;
      const parsed = parseTranscriptPaste(item.rawText);
      if (!parsed) continue;
      const transcript: Transcript = {
        sourceId: `research_inbox:${item.id}`,
        ticker: parsed.ticker,
        fiscalPeriod: parsed.fiscalPeriod,
        callDate: parsed.callDate,
        // Paste time, not call date. See the note on TranscriptRef.knownAt.
        knownAt: new Date(item.submittedAt),
        text: parsed.text,
        provenance: `Research Inbox item ${item.id} (${item.sourceContext})`,
      };
      this.cache.set(transcript.sourceId, transcript);
      out.push(transcript);
    }
    return out;
  }

  async list(opts?: { ticker?: string; since?: Date }): Promise<TranscriptRef[]> {
    const all = await this.load();
    return all.filter((t) => {
      if (opts?.ticker && t.ticker !== opts.ticker.toUpperCase()) return false;
      if (opts?.since && t.knownAt < opts.since) return false;
      return true;
    });
  }

  async fetch(ref: TranscriptRef): Promise<Transcript | null> {
    if (this.cache.has(ref.sourceId)) return this.cache.get(ref.sourceId)!;
    await this.load();
    return this.cache.get(ref.sourceId) ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* Licensed API — stub                                                 */
/* ------------------------------------------------------------------ */

export class TranscriptSourceNotConfiguredError extends Error {
  constructor(sourceId: string) {
    super(
      `Transcript source "${sourceId}" is not configured. Licensing is unresolved — ` +
        `this is a commercial decision, not a code one. Until a vendor is signed, ` +
        `use the Research Inbox paste path.`,
    );
    this.name = "TranscriptSourceNotConfiguredError";
  }
}

/**
 * Placeholder for a licensed vendor feed.
 *
 * Left unimplemented on purpose. The shape is fixed so the extractor and the
 * runner are written against the interface, and swapping in a real vendor is
 * one class rather than a refactor. It reports configured: false and every
 * method throws, so it can never silently return an empty list and be mistaken
 * for "there are no transcripts".
 */
export class LicensedApiTranscriptSource implements TranscriptSource {
  readonly id: string;
  readonly licensing = "licensed_api" as const;
  readonly configured = false;

  constructor(id = "licensed_api") {
    this.id = id;
  }

  async list(): Promise<TranscriptRef[]> {
    throw new TranscriptSourceNotConfiguredError(this.id);
  }

  async fetch(): Promise<Transcript | null> {
    throw new TranscriptSourceNotConfiguredError(this.id);
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export function availableSources(all: TranscriptSource[]): TranscriptSource[] {
  return all.filter((s) => s.configured);
}

export const transcriptSources: TranscriptSource[] = [
  new ResearchInboxTranscriptSource(),
  new LicensedApiTranscriptSource(),
];
