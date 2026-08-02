/**
 * Turning a messy handoff note into structured fields.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS OPTIONAL AND OFF BY DEFAULT.
 *
 * Without ANTHROPIC_API_KEY set, `structureHandoff` returns
 * { status: "unavailable" } and the packet saves with its raw text intact and
 * nothing derived. The whole feature works in that state: someone reads the
 * note, fills in the fields by hand if they want to, and assigns it. The
 * structuring is a convenience, never a dependency.
 *
 * TWO NOTES ON HOW THIS IS WRITTEN:
 *
 * 1. It calls the API over plain `fetch` rather than through the official
 *    @anthropic-ai/sdk. That is a deliberate tradeoff, not a preference: the
 *    SDK is the better choice and should be used once someone approves adding
 *    the dependency. Until then this keeps the feature working with zero new
 *    packages. Swapping it is a small, contained change — the request body
 *    below maps field-for-field onto client.messages.create().
 *
 * 2. Thinking is left ON at low effort rather than disabled. On this model,
 *    disabling thinking can make a structured response arrive as plain text
 *    instead — which would silently produce an unstructured packet with no
 *    error anywhere. Low effort gets the cost saving without that failure.
 * ─────────────────────────────────────────────────────────────────────────
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

export interface StructuredHandoff {
  ticker: string | null;
  /** What I found. */
  found: string | null;
  /** What's still open. */
  stillOpen: string | null;
  /** What you need to decide. */
  needsDecision: string | null;
  sources: string[];
  /**
   * At most one question, and only when something essential is missing.
   * Asking eight questions turns this back into a form, which is the thing
   * the single-textarea input exists to avoid.
   */
  followupQuestion: string | null;
}

export type StructureResult =
  | { status: "structured"; data: StructuredHandoff }
  /** No API key configured. Expected, not an error. */
  | { status: "unavailable"; reason: string }
  /** The call was made and didn't work. The packet still saves. */
  | { status: "failed"; reason: string };

export function structuringIsAvailable(): boolean {
  return Boolean(API_KEY);
}

/**
 * The shape we want back. Constraining the response to this schema is what
 * makes the result safe to write into columns without parsing prose.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticker: {
      type: ["string", "null"],
      description:
        "Stock ticker symbol if one company is clearly the subject, else null.",
    },
    found: {
      type: ["string", "null"],
      description: "What the author found out. Their words, tidied, not summarised away.",
    },
    stillOpen: {
      type: ["string", "null"],
      description: "Questions the author did not resolve.",
    },
    needsDecision: {
      type: ["string", "null"],
      description: "What the person receiving this has to decide or do.",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "Links, filing names, page numbers, transcript dates — as written.",
    },
    followupQuestion: {
      type: ["string", "null"],
      description:
        "One short question, only if something essential is missing. Otherwise null.",
    },
  },
  required: ["ticker", "found", "stillOpen", "needsDecision", "sources", "followupQuestion"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are sorting a research note one teammate wrote for another at a small investment fund. Three people, all part-time, none of them trained finance professionals.

The note was typed quickly, probably on a phone, in whatever order things came out. Your job is to sort what is already there into four buckets — what they found, what is still open, what the reader has to decide, and any sources they cited.

Rules:
- Use the author's own words wherever you can. Tidy grammar; do not rewrite their meaning or summarise their findings away.
- Never invent a finding, a number, or a source. If a bucket is empty in the note, return null for it.
- Do not add analysis, caveats, or advice of your own.
- Write in plain language. If the note uses jargon, keep it but add a short gloss in brackets the first time.
- Ask a follow-up question ONLY if something essential is missing and the note is not usable without it — most notes need no question. One question at most, short, answerable in a sentence.`;

/**
 * Best effort. Every failure path returns a value rather than throwing,
 * because a packet must save whether or not this worked.
 */
export async function structureHandoff(
  rawText: string,
): Promise<StructureResult> {
  if (!API_KEY) {
    return {
      status: "unavailable",
      reason: "ANTHROPIC_API_KEY is not set, so notes are saved as written.",
    };
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        // Server-side fallback: if a safety classifier declines the request,
        // the API retries on another model in the same call rather than
        // handing back a refusal.
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        // Low effort: this is sorting text into four buckets, not reasoning.
        // Thinking stays on — see the note at the top of this file.
        thinking: { type: "adaptive" },
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        fallbacks: "default",
        messages: [{ role: "user", content: rawText }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return {
        status: "failed",
        reason: `${res.status} ${detail.slice(0, 200)}`,
      };
    }

    const body: any = await res.json();

    // Check why generation stopped before touching content — on a refusal the
    // content array is empty, and indexing into it would throw.
    if (body.stop_reason === "refusal") {
      return {
        status: "failed",
        reason: "The model declined to process this note. It is saved as written.",
      };
    }
    if (body.stop_reason === "max_tokens") {
      return {
        status: "failed",
        reason: "The note was too long to sort in one go. It is saved as written.",
      };
    }

    const text = (body.content ?? [])
      .filter((block: any) => block?.type === "text")
      .map((block: any) => block.text)
      .join("");

    if (!text.trim()) {
      return { status: "failed", reason: "Empty response." };
    }

    return { status: "structured", data: normalize(JSON.parse(text)) };
  } catch (err: any) {
    return { status: "failed", reason: err?.message ?? "unknown error" };
  }
}

/**
 * Never trust the shape, even with a schema on the request. A malformed field
 * here would write nonsense into a column that a human then has to untangle.
 */
function normalize(raw: any): StructuredHandoff {
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };

  return {
    ticker: str(raw?.ticker)?.toUpperCase() ?? null,
    found: str(raw?.found),
    stillOpen: str(raw?.stillOpen),
    needsDecision: str(raw?.needsDecision),
    sources: Array.isArray(raw?.sources)
      ? raw.sources.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
      : [],
    followupQuestion: str(raw?.followupQuestion),
  };
}
