// Forward Capital — display vocabulary shared across the redesigned pages.
//
// Everything here is presentation-only: label maps, number/date formatting, and
// safe readers for the JSON blobs the ingestion layer stores on signal.rawPayload.
// No scoring lives here — that's lib/scoring-client.ts.

import type { Signal } from "@shared/schema";

// ── Labels ───────────────────────────────────────────────────────────────

export const TIER_LABELS: Record<string, string> = {
  unverified: "Unverified",
  single_source: "Single source",
  corroborated: "Corroborated",
  primary_source_confirmed: "Primary source confirmed",
};

/** Short form used where the classification column is tight (feed rows). */
export const TIER_LABELS_SHORT: Record<string, string> = {
  unverified: "Unverified",
  single_source: "Single source",
  corroborated: "Corroborated",
  primary_source_confirmed: "Primary confirmed",
};

export const PROVENANCE_LABELS: Record<string, string> = {
  raw_data: "Raw data",
  detected_signal: "Detected signal",
  ai_generated_interpretation: "AI-generated",
  human_authored_research: "Human research",
  investment_hypothesis: "Own hypothesis",
  confirmed_event: "Confirmed event",
  unverified_rumor_or_social_claim: "Unverified claim",
};

export const DIRECTION_LABELS: Record<string, string> = {
  confirming: "Confirming",
  contradicting: "Contradicting",
  neutral: "Neutral",
};

export const EVENT_LABELS: Record<string, string> = {
  ingestion: "Ingestion",
  score_computed: "Score computed",
  signal_created: "Signal created",
  signal_promoted: "Signal promoted",
  source_synced: "Source synced",
};

export const SIGNAL_CATEGORIES = [
  "price_action",
  "insider_activity",
  "analyst_action",
  "institutional_flow",
  "congressional_trading",
  "patent_filing",
  "regulatory_filing",
  "hiring_signal",
  "web_traffic_signal",
  "partnership_or_supply_chain",
  "macro_indicator",
];

export const PROVENANCE_CLASSES = [
  "raw_data",
  "detected_signal",
  "ai_generated_interpretation",
  "human_authored_research",
  "investment_hypothesis",
  "confirmed_event",
  "unverified_rumor_or_social_claim",
];

export const VERIFICATION_TIERS = [
  "unverified",
  "single_source",
  "corroborated",
  "primary_source_confirmed",
];

export const DIRECTIONS = ["confirming", "contradicting", "neutral"] as const;

/** snake_case → readable, for values with no curated label. */
export function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

// ── Numbers ──────────────────────────────────────────────────────────────

/** Unicode minus, so negative scores align with digits in the mono columns. */
const MINUS = "−";

/** Signed score to 2dp: "+0.48" / "−0.62" / "0.00". */
export function fmtScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0.00";
  return rounded > 0 ? `+${rounded.toFixed(2)}` : `${MINUS}${Math.abs(rounded).toFixed(2)}`;
}

/** Signed integer gauge: "+34" / "−12" / "0". */
export function fmtGauge(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${MINUS}${Math.abs(value)}`;
}

/** Signed percentage move: "+2.13%" / "−8.33%". */
export function fmtPctChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return rounded >= 0 ? `+${rounded.toFixed(2)}%` : `${MINUS}${Math.abs(rounded).toFixed(2)}%`;
}

/** Plain percentage, no sign: "68%". */
export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Price with thousands separators: "$1,079.18". */
export function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole-dollar price where cents add noise: "$418". */
export function fmtPriceTerse(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const whole = Math.round(value) === value;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Magnitude with a scale suffix: "4.92T", "487.82B", "89.27M". */
export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${abs.toLocaleString("en-US")}`;
}

/** Same, prefixed with a dollar sign: "$487.82B". */
export function fmtCompactMoney(value: number | null | undefined): string {
  const out = fmtCompact(value);
  return out === "—" ? out : `$${out}`;
}

export function fmtRatio(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

// ── Dates ────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "20 JUL" — the stacked timestamp used down the left rail of the briefing. */
export function fmtDayMonthCaps(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toUpperCase()}`;
}

/** "20 Jul" — or "20 Jul 25" once the year differs from the reference year. */
export function fmtDayMonth(value: string | Date, referenceYear?: number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  const ref = referenceYear ?? new Date().getFullYear();
  return d.getFullYear() === ref ? base : `${base} ${String(d.getFullYear()).slice(2)}`;
}

/** "20 Jul 2026". */
export function fmtDateMedium(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Mon 20 July 2026" — the date rules in the signal register. */
export function fmtDateFull(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "20:00" in the viewer's locale. */
export function fmtTime(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "2026-07-21 03:00:12" — audit-trail stamps, always UTC. */
export function fmtStampUtc(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** "6h ago", "3d ago", "just now". */
export function fmtRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return "never";
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "never";
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Local midnight key, so day grouping doesn't drift across timezones. */
export function dayKey(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const DAY_MS = 86_400_000;

// ── Windows ──────────────────────────────────────────────────────────────

export interface ActivityWindow {
  from: Date;
  to: Date;
  /** True when the window is genuinely the last `days` days from now. */
  isLive: boolean;
  /** "last 7 days" or "7 days to 20 Jul" when the newest data is older. */
  label: string;
}

/**
 * The "what changed" window. Prefers the real last N days; if the dataset has
 * nothing that recent, it slides back to the N days ending at the newest
 * signal and says so, rather than rendering an empty panel captioned
 * "last 7 days".
 */
export function activityWindow(
  signals: Pick<Signal, "retrievedAt">[] | undefined,
  days = 7,
  now: Date = new Date()
): ActivityWindow {
  const liveFrom = new Date(now.getTime() - days * DAY_MS);
  const hasLive = (signals ?? []).some((s) => {
    const t = new Date(s.retrievedAt).getTime();
    return Number.isFinite(t) && t >= liveFrom.getTime() && t <= now.getTime();
  });
  if (hasLive || !signals?.length) {
    return { from: liveFrom, to: now, isLive: true, label: `last ${days} days` };
  }

  const newest = signals.reduce((max, s) => {
    const t = new Date(s.retrievedAt).getTime();
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  if (!newest) return { from: liveFrom, to: now, isLive: true, label: `last ${days} days` };

  const to = new Date(newest);
  return {
    from: new Date(newest - days * DAY_MS),
    to,
    isLive: false,
    label: `${days} days to ${fmtDayMonth(to)}`,
  };
}

export function withinWindow(value: string, w: ActivityWindow): boolean {
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t >= w.from.getTime() && t <= w.to.getTime();
}

export interface PredictionWindow {
  start: Date;
  end: Date;
  /** "H2 2026" — the phrase lifted out of the prediction text. */
  phrase: string;
  daysTotal: number;
  daysElapsed: number;
  daysLeft: number;
  /** 0..1, clamped. */
  progress: number;
  /** Day number inside the window, 1-based. 0 before it opens. */
  dayNumber: number;
  hasOpened: boolean;
  hasClosed: boolean;
}

/** "2026-07-01" as local midnight — a window is a calendar range, not an instant. */
function parseLocalDate(value: string, endOfDay = false): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) {
    const loose = new Date(value);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  const [, y, mo, d] = m;
  return endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59)
    : new Date(Number(y), Number(mo) - 1, Number(d));
}

function buildWindow(start: Date, end: Date, phrase: string, now: Date): PredictionWindow {
  const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  const elapsedRaw = (now.getTime() - start.getTime()) / DAY_MS;
  const daysElapsed = Math.floor(elapsedRaw);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

  return {
    start,
    end,
    phrase,
    daysTotal,
    daysElapsed,
    daysLeft,
    progress: Math.min(1, Math.max(0, elapsedRaw / daysTotal)),
    dayNumber: daysElapsed >= 0 ? daysElapsed + 1 : 0,
    hasOpened: now.getTime() >= start.getTime(),
    hasClosed: now.getTime() > end.getTime(),
  };
}

/**
 * The window the prediction resolves in.
 *
 * Prefers the dates stored on the thesis — `prediction_window_start` /
 * `prediction_window_end` — which is what the author actually committed to.
 * Falls back to reading a period out of the prediction sentence ("…in H2
 * 2026…") for rows written before those columns existed. Returns null when
 * neither is available, and the countdown is hidden rather than invented.
 */
export function predictionWindow(
  thesis: { prediction?: string | null; predictionWindowStart?: string | null; predictionWindowEnd?: string | null } | null | undefined,
  now: Date = new Date()
): PredictionWindow | null {
  if (!thesis) return null;

  if (thesis.predictionWindowStart && thesis.predictionWindowEnd) {
    const start = parseLocalDate(thesis.predictionWindowStart);
    const end = parseLocalDate(thesis.predictionWindowEnd, true);
    if (start && end && end > start) {
      return buildWindow(start, end, phraseFor(thesis.prediction, start, end), now);
    }
  }

  return parsePredictionWindow(thesis.prediction, now);
}

/** The phrase to ink in the prediction sentence, e.g. "H2 2026". */
function phraseFor(prediction: string | null | undefined, start: Date, end: Date): string {
  const stated = prediction ? /\b(H[12]\s*\d{4}|Q[1-4]\s*\d{4})\b/i.exec(prediction) : null;
  if (stated) return stated[1];
  const year = end.getFullYear();
  if (start.getFullYear() !== year) return `${start.getFullYear()}–${year}`;
  return start.getMonth() < 6 && end.getMonth() >= 6 ? String(year) : `H${start.getMonth() < 6 ? 1 : 2} ${year}`;
}

/**
 * Legacy path: derive the window from the prediction sentence alone. Kept for
 * theses seeded before the window columns were added.
 */
export function parsePredictionWindow(
  prediction: string | null | undefined,
  now: Date = new Date()
): PredictionWindow | null {
  if (!prediction) return null;

  let start: Date;
  let end: Date;
  let phrase: string;

  const half = /\bH([12])\s*[-/ ]?\s*(\d{4})\b/i.exec(prediction);
  const quarter = /\bQ([1-4])\s*[-/ ]?\s*(\d{4})\b/i.exec(prediction);

  if (half) {
    const h = Number(half[1]);
    const year = Number(half[2]);
    start = new Date(year, h === 1 ? 0 : 6, 1);
    end = new Date(year, h === 1 ? 5 : 11, h === 1 ? 30 : 31, 23, 59, 59);
    phrase = `H${h} ${year}`;
  } else if (quarter) {
    const q = Number(quarter[1]);
    const year = Number(quarter[2]);
    const startMonth = (q - 1) * 3;
    start = new Date(year, startMonth, 1);
    end = new Date(year, startMonth + 3, 0, 23, 59, 59);
    phrase = `Q${q} ${year}`;
  } else {
    const bare = /\b(20\d{2})\b/.exec(prediction);
    if (!bare) return null;
    const year = Number(bare[1]);
    start = new Date(year, 0, 1);
    end = new Date(year, 11, 31, 23, 59, 59);
    phrase = String(year);
  }

  return buildWindow(start, end, phrase, now);
}

// ── rawPayload readers ───────────────────────────────────────────────────
//
// Signals carry the connector response verbatim on rawPayload. These are the
// shapes the seed and the finance connector write; every field is optional
// because a payload can predate a schema change.

export interface QuotePayload {
  price?: number;
  change?: number;
  changesPercentage?: number;
  marketCap?: number;
  pe?: number;
  volume?: number;
  yearLow?: number;
  yearHigh?: number;
  as_of?: string;
  note?: string;
}

export interface ConsensusPayload {
  rating?: string;
  total_ratings?: number;
  bullish_pct?: number;
  neutral_pct?: number;
  bearish_pct?: number;
  avg_price_target?: number;
  median_price_target?: number;
  high_price_target?: number;
  low_price_target?: number;
  note?: string;
}

export interface AnalystActionPayload {
  date?: string;
  firm?: string;
  analyst?: string;
  action?: string;
  rating?: string;
  price_target?: number;
  prior_target?: number;
  sentiment?: string;
}

export interface InsiderTxPayload {
  date?: string;
  name?: string;
  type?: string;
  shares?: number;
  price?: number;
  value?: number;
}

export interface FilingPayload {
  form?: string;
  formType?: string;
  filingDate?: string;
  date?: string;
  primaryDocDescription?: string;
  description?: string;
  reportDate?: string;
  url?: string;
}

export function readPayload<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** A consensus signal is the roll-up one, not an individual analyst action. */
export function isConsensusSignal(signal: Signal): boolean {
  return signal.signalCategory === "analyst_action" && /analyst consensus/i.test(signal.title);
}

/** Newest first, by the timestamp the signal was retrieved at. */
export function byRetrievedDesc(a: Pick<Signal, "retrievedAt">, b: Pick<Signal, "retrievedAt">): number {
  return new Date(b.retrievedAt).getTime() - new Date(a.retrievedAt).getTime();
}

/** Groups signals into day buckets, newest day first, newest signal first. */
export function groupByDay<T extends { retrievedAt: string }>(items: T[]): Array<{ key: string; date: Date; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(item.retrievedAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return Array.from(buckets.entries())
    .map(([key, group]) => ({
      key,
      date: new Date(group[0].retrievedAt),
      items: [...group].sort(byRetrievedDesc),
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Percentage split of a for/neutral/against triple, always summing to 100. */
export function balanceSplit(forCount: number, neutralCount: number, againstCount: number) {
  const total = forCount + neutralCount + againstCount;
  if (total === 0) return { for: 0, neutral: 0, against: 0, total: 0 };
  const f = (forCount / total) * 100;
  const n = (neutralCount / total) * 100;
  return { for: f, neutral: n, against: 100 - f - n, total };
}
