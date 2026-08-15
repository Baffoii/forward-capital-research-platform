// Shared types and formatters for the Paper Trading tab.
// Shapes mirror what server/routes-paper.ts returns.

export interface Quote {
  symbol: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  vwap: number | null;
  bid: number | null;
  ask: number | null;
  asOf: string | null;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  fractionable: boolean;
  quote: Quote | null;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  exchange: string;
  quote: Quote | null;
}

export interface Position {
  symbol: string;
  name: string;
  qty: number;
  side: string;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
  intradayPl: number;
  intradayPlPct: number;
  changeTodayPct: number;
}

export interface AccountSummary {
  accountNumber: string;
  status: string;
  equity: number;
  lastEquity: number;
  cash: number;
  buyingPower: number;
  longMarketValue: number;
  shortMarketValue: number;
  dayChange: number;
  dayChangePct: number;
  marketOpen: boolean;
  nextOpen: string;
  nextClose: string;
}

export interface StockDetail {
  symbol: string;
  name: string;
  exchange: string;
  fractionable: boolean;
  shortable: boolean;
  quote: Quote;
  stats: {
    high52w: number | null;
    low52w: number | null;
    avgVolume30d: number | null;
    returns: Record<string, number | null>;
  };
  fundamentals: {
    epsTtm: number | null;
    peRatio: number | null;
    sharesOutstanding: number | null;
    marketCap: number | null;
    epsBasis: "ttm" | "annual" | null;
    fiscalPeriodEnd: string | null;
    available: boolean;
  };
  inWatchlist: boolean;
  position: { qty: number; avgEntryPrice: number; marketValue: number; unrealizedPl: number; unrealizedPlPct: number } | null;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BarsResponse {
  symbol: string;
  range: ChartRange;
  feed: string;
  baseline: number | null;
  bars: Bar[];
}

export interface PortfolioPoint {
  t: string;
  equity: number | null;
  profitLoss: number | null;
  profitLossPct: number;
}

export interface Order {
  id: string;
  symbol: string;
  qty: number | null;
  notional: number | null;
  filledQty: number;
  filledAvgPrice: number | null;
  side: string;
  type: string;
  limitPrice: number | null;
  status: string;
  submittedAt: string;
}

export const CHART_RANGES = ["1D", "1W", "1M", "3M", "1Y", "5Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

// ── Formatters ─────────────────────────────────────────────────────────────

const DASH = "—";

export function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  // Sub-dollar names (and fractional share prices) need more precision than round-lot quotes.
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return DASH;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSignedCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

export function formatPercent(value: number | null | undefined, signed = true): string {
  if (value == null || Number.isNaN(value)) return DASH;
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(0);
}

export function formatQty(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Tailwind text colour for a delta: green up, red down, muted flat. */
export function changeClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-up" : "text-down";
}

/** Company names arrive as "Apple Inc. Common Stock" — the suffix is noise in a dense table. */
export function cleanCompanyName(name: string): string {
  return name
    .replace(/\s+(Common Stock|Class [A-Z] Common Stock|Common Shares|Ordinary Shares)$/i, "")
    .replace(/\s+New$/i, "")
    .trim();
}

/**
 * apiRequest throws `Error("422: {\"error\":\"insufficient buying power\"}")`. Pull the human
 * sentence back out so toasts read like a broker message instead of a JSON blob.
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const withoutStatus = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(withoutStatus);
    return parsed.error || parsed.message || withoutStatus;
  } catch {
    return withoutStatus;
  }
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}
