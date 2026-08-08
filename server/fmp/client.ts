/**
 * The one place this codebase talks to Financial Modeling Prep.
 *
 * Every FMP call goes through here — no scattered fetches across ingestion
 * files. That matters for three reasons that all bit us before we wrote a
 * line: the key is injected once and never lands in a URL, the rate limiter
 * is in one place so it can't be defeated by a second caller, and the cache
 * is in one place so a daily price sync doesn't burn the quota that quarterly
 * fundamentals need.
 *
 * ── WHAT THE FREE TIER ACTUALLY GIVES US ────────────────────────────────
 * Probed against the live account on 2026-08-08. The binding constraint is
 * not endpoint gating, it is a SYMBOL WHITELIST, and it lands on exactly the
 * names this thesis is about:
 *
 *   allowed:  NVDA AMZN MSFT AMD INTC        (megacaps, forty analysts each)
 *   blocked:  GOOG SNDK MU AVGO MRVL VRT BE GEV
 *
 * VRT and GEV are the only two names in the current universe that touch the
 * equipment tier, and both are blocked. `profile` is the sole endpoint that
 * works for all thirteen.
 *
 * Blocked outright (402) regardless of symbol:
 *   earning-call-transcript, earning-call-transcript-dates,
 *   etf/asset-exposure, eod-bulk
 *
 * So: no transcripts (constraint tightening stays on the paste seam), no
 * ETF-inclusion signal, and no bulk price call. Per-symbol pricing is fine
 * because there are only five symbols to fetch.
 *
 * This client reports a blocked symbol as a distinct outcome rather than an
 * error, so callers can record "we are not permitted to see this" instead of
 * silently treating it as "this company has no data".
 * ─────────────────────────────────────────────────────────────────────────
 */

const BASE = "https://financialmodelingprep.com/stable/";
const API_KEY = process.env.FMP_API_KEY;

/** Minimum gap between calls. FMP answers 429 and we never parallelise. */
const MIN_INTERVAL_MS = 600;
/** Fundamentals change quarterly. Re-fetching them daily is how you run out of quota. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export function fmpIsConfigured(): boolean {
  return Boolean(API_KEY);
}

export type FmpOutcome<T> =
  | { status: "ok"; data: T; endpoint: string; fetchedAt: Date }
  /** No key configured. Expected, not an error. */
  | { status: "unconfigured"; reason: string }
  /** This endpoint is not on our subscription. */
  | { status: "endpoint_blocked"; endpoint: string; reason: string }
  /**
   * The endpoint exists on our tier but this SYMBOL doesn't. Distinct from
   * "no data" on purpose — recording a permission gap as an empty result
   * would make a blocked company indistinguishable from one with nothing to
   * report, which is how you end up trusting a hole in the data.
   */
  | { status: "symbol_blocked"; endpoint: string; symbol: string }
  | { status: "rate_limited"; endpoint: string }
  | { status: "error"; endpoint: string; reason: string };

interface CacheEntry {
  body: unknown;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
let lastCallAt = 0;

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/**
 * Fetch one FMP endpoint.
 *
 * `path` is everything after /stable/, including query params but NOT the
 * key — the key goes in a header so it never reaches a log line, a proxy
 * access log, or a URL in an error message.
 */
export async function fmpGet<T = unknown>(
  path: string,
  opts: { ttlMs?: number; force?: boolean } = {},
): Promise<FmpOutcome<T>> {
  if (!API_KEY) {
    return {
      status: "unconfigured",
      reason: "FMP_API_KEY is not set, so FMP-backed data is unavailable.",
    };
  }

  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const cached = cache.get(path);
  if (!opts.force && cached && Date.now() - cached.fetchedAt < ttl) {
    return {
      status: "ok",
      data: cached.body as T,
      endpoint: path,
      fetchedAt: new Date(cached.fetchedAt),
    };
  }

  await throttle();

  let res: Response;
  let text: string;
  try {
    res = await fetch(BASE + path, { headers: { apikey: API_KEY } });
    text = await res.text();
  } catch (err: any) {
    return { status: "error", endpoint: path, reason: err?.message ?? "network error" };
  }

  if (res.status === 429) return { status: "rate_limited", endpoint: path };

  // FMP signals both kinds of gating with prose, sometimes at HTTP 402 and
  // sometimes at 200, so match on the message rather than the status.
  if (text.includes("Premium Query Parameter")) {
    const symbol = /symbol=([A-Z.\-]+)/i.exec(path)?.[1] ?? "unknown";
    return { status: "symbol_blocked", endpoint: path, symbol };
  }
  if (text.includes("Restricted Endpoint") || text.includes("Exclusive Endpoint")) {
    return {
      status: "endpoint_blocked",
      endpoint: path,
      reason: "Not available on the current FMP subscription.",
    };
  }
  if (!res.ok) {
    return { status: "error", endpoint: path, reason: `${res.status} ${text.slice(0, 200)}` };
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    return { status: "error", endpoint: path, reason: `Unparseable response: ${text.slice(0, 120)}` };
  }

  const fetchedAt = Date.now();
  cache.set(path, { body: data, fetchedAt });
  return { status: "ok", data, endpoint: path, fetchedAt: new Date(fetchedAt) };
}

/**
 * Provenance stamp for anything derived from FMP.
 *
 * Same rule as every other ingested fact in this repo: a number without its
 * source is a number nobody can argue with later.
 */
export interface FmpProvenance {
  source: "fmp";
  endpoint: string;
  fetchedAt: string;
}

export function provenanceOf(outcome: Extract<FmpOutcome<unknown>, { status: "ok" }>): FmpProvenance {
  return { source: "fmp", endpoint: outcome.endpoint, fetchedAt: outcome.fetchedAt.toISOString() };
}

/** Test seam. */
export function __clearFmpCache(): void {
  cache.clear();
}
