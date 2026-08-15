// Alpaca paper-trading + market-data client.
//
// Every call in this file runs server-side only. The API key/secret must never reach the browser,
// so the frontend talks exclusively to our own /api/paper/* routes, which proxy through here.
//
// Feed notes (free "Basic" market-data plan):
//   • Snapshots accept `delayed_sip` — full-market consolidated tape on a 15-minute delay. Much
//     better coverage than IEX, which is only a few percent of volume and skews daily bars/volume.
//   • The bars endpoint rejects `delayed_sip` as an invalid feed, but accepts `sip` as long as the
//     requested window ends at least 15 minutes in the past — hence SIP_DELAY_MS below.
//   • If a symbol/plan still 403s on SIP we fall back to `iex` rather than failing the request.

const TRADING_BASE = normalizeBase(process.env.ALPACA_API_BASE_URL || "https://paper-api.alpaca.markets/v2");
const DATA_BASE = normalizeBase(process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets/v2");
const KEY_ID = process.env.ALPACA_API_KEY_ID;
const SECRET_KEY = process.env.ALPACA_API_SECRET_KEY;

if (!KEY_ID || !SECRET_KEY) {
  console.warn(
    "[alpaca] ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are not set — /api/paper/* endpoints will return 503 until they are configured."
  );
}

/** Historical SIP data is available on the free plan with a 15-minute delay; pad to 16 for clock skew. */
const SIP_DELAY_MS = 16 * 60 * 1000;

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export class AlpacaError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AlpacaError";
  }
}

export function alpacaConfigured(): boolean {
  return Boolean(KEY_ID && SECRET_KEY);
}

async function alpacaFetch<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!KEY_ID || !SECRET_KEY) {
    throw new AlpacaError("Alpaca API credentials are not configured on the server", 503);
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": KEY_ID,
      "APCA-API-SECRET-KEY": SECRET_KEY,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message || parsed.error || text;
    } catch {
      /* non-JSON error body — use the raw text */
    }
    throw new AlpacaError(message || res.statusText, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const trading = <T>(path: string, init?: RequestInit) => alpacaFetch<T>(TRADING_BASE, path, init);
const market = <T>(path: string, init?: RequestInit) => alpacaFetch<T>(DATA_BASE, path, init);

// ── Asset universe (search) ────────────────────────────────────────────────
// The full tradable-equity list is ~14k rows / ~6 MB. Fetch it once and keep it in memory so the
// search box can filter by ticker *or* company name without a round-trip per keystroke.

export interface AlpacaAsset {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  fractionable: boolean;
  shortable: boolean;
  marginable: boolean;
}

const ASSET_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let assetCache: { fetchedAt: number; assets: AlpacaAsset[] } | null = null;
let assetCacheInFlight: Promise<AlpacaAsset[]> | null = null;

export async function loadAssets(): Promise<AlpacaAsset[]> {
  if (assetCache && Date.now() - assetCache.fetchedAt < ASSET_CACHE_TTL_MS) return assetCache.assets;
  // De-dupe concurrent cold-start requests so we don't pull 6 MB several times over.
  if (assetCacheInFlight) return assetCacheInFlight;

  assetCacheInFlight = (async () => {
    const all = await trading<AlpacaAsset[]>("/assets?status=active&asset_class=us_equity");
    const assets = all.filter((a) => a.tradable);
    assetCache = { fetchedAt: Date.now(), assets };
    return assets;
  })();

  try {
    return await assetCacheInFlight;
  } finally {
    assetCacheInFlight = null;
  }
}

export async function getAsset(symbol: string): Promise<AlpacaAsset | undefined> {
  const upper = symbol.toUpperCase();
  const assets = await loadAssets();
  return assets.find((a) => a.symbol === upper);
}

/**
 * Rank matches the way a brokerage search box does: exact ticker, then ticker prefix, then a
 * company name that starts with the query, then a name that starts a word with it, then anything
 * containing it.
 */
export async function searchAssets(query: string, limit = 25): Promise<AlpacaAsset[]> {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const assets = await loadAssets();

  const scored: { asset: AlpacaAsset; rank: number }[] = [];
  for (const asset of assets) {
    const symbol = asset.symbol.toUpperCase();
    const name = (asset.name || "").toUpperCase();
    let rank = -1;

    if (symbol === q) rank = 0;
    else if (symbol.startsWith(q)) rank = 1;
    else if (name.startsWith(q)) rank = 2;
    else if (new RegExp(`\\b${escapeRegExp(q)}`).test(name)) rank = 3;
    else if (symbol.includes(q) || name.includes(q)) rank = 4;

    if (rank >= 0) scored.push({ asset, rank });
  }

  // Within a tier, favour ordinary listed common stock over derivative products: OTC last, then the
  // shortest company name wins. That is what floats "Apple Inc." above "Applied Industrial
  // Technologies, Inc." and the leveraged/ETF wrappers that merely mention the same word.
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const otc = Number(a.asset.exchange === "OTC") - Number(b.asset.exchange === "OTC");
    if (otc !== 0) return otc;
    const nameLength = (a.asset.name || "").length - (b.asset.name || "").length;
    if (nameLength !== 0) return nameLength;
    return a.asset.symbol.length - b.asset.symbol.length || a.asset.symbol.localeCompare(b.asset.symbol);
  });
  return scored.slice(0, limit).map((s) => s.asset);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Snapshots / quotes ─────────────────────────────────────────────────────

export interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
}

export interface AlpacaSnapshot {
  latestTrade?: { p: number; s: number; t: string };
  latestQuote?: { ap: number; as: number; bp: number; bs: number; t: string };
  minuteBar?: AlpacaBar;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

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

/** Snapshots for many symbols at once, chunked to keep URLs a sane length. */
export async function getSnapshots(symbols: string[]): Promise<Record<string, Quote>> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(Boolean);
  if (unique.length === 0) return {};

  const out: Record<string, Quote> = {};
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const data = await market<Record<string, AlpacaSnapshot>>(
      `/stocks/snapshots?symbols=${encodeURIComponent(chunk.join(","))}&feed=delayed_sip`
    );
    // The snapshots endpoint returns symbols at the top level, except when it wraps them under
    // a "snapshots" key — normalize both shapes.
    const snapshots = (data as any).snapshots ?? data;
    for (const [symbol, snapshot] of Object.entries(snapshots as Record<string, AlpacaSnapshot>)) {
      out[symbol] = toQuote(symbol, snapshot);
    }
  }
  return out;
}

export async function getSnapshot(symbol: string): Promise<Quote> {
  const map = await getSnapshots([symbol]);
  return map[symbol.toUpperCase()] ?? toQuote(symbol.toUpperCase(), {});
}

function toQuote(symbol: string, snapshot: AlpacaSnapshot): Quote {
  const daily = snapshot.dailyBar;
  const prev = snapshot.prevDailyBar;
  // Prefer the last trade; fall back to the daily close so pre-open and thinly traded names still
  // show a price instead of a blank row.
  const price = snapshot.latestTrade?.p ?? daily?.c ?? null;
  // On a session that hasn't opened yet the "dailyBar" is still the previous session, in which case
  // the meaningful baseline is prevDailyBar's close only when it differs from the daily bar.
  const prevClose = prev?.c ?? null;
  const change = price != null && prevClose != null ? price - prevClose : null;

  return {
    symbol,
    price,
    prevClose,
    change,
    changePct: change != null && prevClose ? (change / prevClose) * 100 : null,
    open: daily?.o ?? null,
    high: daily?.h ?? null,
    low: daily?.l ?? null,
    volume: daily?.v ?? null,
    vwap: daily?.vw ?? null,
    bid: snapshot.latestQuote?.bp ?? null,
    ask: snapshot.latestQuote?.ap ?? null,
    asOf: snapshot.latestTrade?.t ?? daily?.t ?? null,
  };
}

// ── Bars / charts ──────────────────────────────────────────────────────────

export type ChartRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";
export const CHART_RANGES: ChartRange[] = ["1D", "1W", "1M", "3M", "1Y", "5Y"];

const RANGE_CONFIG: Record<ChartRange, { timeframe: string; lookbackDays: number; latestSessionOnly?: boolean; regularHoursOnly?: boolean }> = {
  "1D": { timeframe: "5Min", lookbackDays: 6, latestSessionOnly: true, regularHoursOnly: true },
  "1W": { timeframe: "30Min", lookbackDays: 9, regularHoursOnly: true },
  "1M": { timeframe: "1Hour", lookbackDays: 33, regularHoursOnly: true },
  "3M": { timeframe: "1Day", lookbackDays: 95 },
  "1Y": { timeframe: "1Day", lookbackDays: 370 },
  "5Y": { timeframe: "1Week", lookbackDays: 1835 },
};

async function fetchBars(symbol: string, timeframe: string, start: Date, end: Date, feed: string): Promise<AlpacaBar[]> {
  const bars: AlpacaBar[] = [];
  let pageToken: string | undefined;

  // A few pages is plenty for every range we offer; the cap just stops a runaway loop.
  for (let page = 0; page < 6; page++) {
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe,
      start: start.toISOString(),
      end: end.toISOString(),
      limit: "10000",
      adjustment: "split",
      feed,
    });
    if (pageToken) params.set("page_token", pageToken);

    const data = await market<{ bars: Record<string, AlpacaBar[]>; next_page_token: string | null }>(`/stocks/bars?${params}`);
    bars.push(...(data.bars?.[symbol.toUpperCase()] ?? []));
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }

  return bars;
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Split an ISO timestamp into its New York calendar date and minutes-since-midnight. */
function etParts(iso: string): { date: string; minutes: number } {
  const parts = ET_PARTS.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;

export async function getBars(symbol: string, range: ChartRange): Promise<{ bars: AlpacaBar[]; feed: string }> {
  const config = RANGE_CONFIG[range];
  const end = new Date(Date.now() - SIP_DELAY_MS);
  const start = new Date(end.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000);

  let feed = "sip";
  let bars: AlpacaBar[];
  try {
    bars = await fetchBars(symbol, config.timeframe, start, end, feed);
  } catch (err) {
    // Some plan/symbol combinations still refuse SIP — IEX is thinner but always available.
    if (err instanceof AlpacaError && (err.status === 403 || err.status === 400)) {
      feed = "iex";
      bars = await fetchBars(symbol, config.timeframe, start, end, feed);
    } else {
      throw err;
    }
  }

  if (config.regularHoursOnly) {
    bars = bars.filter((bar) => {
      const { minutes } = etParts(bar.t);
      return minutes >= MARKET_OPEN_MINUTES && minutes < MARKET_CLOSE_MINUTES;
    });
  }

  if (config.latestSessionOnly && bars.length > 0) {
    const lastDate = etParts(bars[bars.length - 1].t).date;
    bars = bars.filter((bar) => etParts(bar.t).date === lastDate);
  }

  return { bars, feed };
}

// ── Derived statistics (Alpaca exposes no fundamentals, so these come from bars) ──

export interface SymbolStats {
  high52w: number | null;
  low52w: number | null;
  avgVolume30d: number | null;
  returns: Record<string, number | null>;
}

/** Trailing returns, 52-week range and average volume, all derived from one year of daily bars. */
export async function getSymbolStats(symbol: string, price: number | null): Promise<SymbolStats> {
  const { bars } = await getBars(symbol, "1Y");
  if (bars.length === 0) {
    return { high52w: null, low52w: null, avgVolume30d: null, returns: {} };
  }

  const last = price ?? bars[bars.length - 1].c;
  const high52w = Math.max(...bars.map((b) => b.h));
  const low52w = Math.min(...bars.map((b) => b.l));
  const recent = bars.slice(-30);
  const avgVolume30d = recent.reduce((sum, b) => sum + b.v, 0) / recent.length;

  // Sessions back, not calendar days — matches how brokerages quote 1W/1M/etc.
  const returnOverSessions = (sessions: number): number | null => {
    const index = bars.length - 1 - sessions;
    if (index < 0) return null;
    const base = bars[index].c;
    return base ? ((last - base) / base) * 100 : null;
  };

  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const firstOfYear = bars.find((b) => b.t >= yearStart);

  return {
    high52w,
    low52w,
    avgVolume30d,
    returns: {
      "1W": returnOverSessions(5),
      "1M": returnOverSessions(21),
      "3M": returnOverSessions(63),
      "6M": returnOverSessions(126),
      YTD: firstOfYear && firstOfYear.c ? ((last - firstOfYear.c) / firstOfYear.c) * 100 : null,
      "1Y": returnOverSessions(bars.length - 1),
    },
  };
}

// ── Account, positions, orders ─────────────────────────────────────────────

export interface AlpacaAccount {
  equity: string;
  last_equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  status: string;
  account_number: string;
  currency: string;
  pattern_day_trader: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  asset_id: string;
  exchange: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  side: string;
  type: string;
  time_in_force: string;
  limit_price: string | null;
  status: string;
  submitted_at: string;
  created_at: string;
}

export interface PortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
}

export const getAccount = () => trading<AlpacaAccount>("/account");
export const getPositions = () => trading<AlpacaPosition[]>("/positions");
export const getClock = () => trading<{ is_open: boolean; next_open: string; next_close: string; timestamp: string }>("/clock");

export function getPortfolioHistory(period: string, timeframe: string) {
  const params = new URLSearchParams({ period, timeframe, intraday_reporting: "market_hours", pnl_reset: "per_day" });
  return trading<PortfolioHistory>(`/account/portfolio/history?${params}`);
}

export function listOrders(limit = 25) {
  const params = new URLSearchParams({ status: "all", limit: String(limit), direction: "desc" });
  return trading<AlpacaOrder[]>(`/orders?${params}`);
}

export interface PlaceOrderInput {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  time_in_force: string;
  qty?: string;
  notional?: string;
  limit_price?: string;
}

export function placeOrder(order: PlaceOrderInput) {
  return trading<AlpacaOrder>("/orders", { method: "POST", body: JSON.stringify(order) });
}

export function cancelOrder(id: string) {
  return trading<void>(`/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Watchlist ──────────────────────────────────────────────────────────────
// Stored in Alpaca's own watchlist API rather than our Postgres, so it stays attached to the same
// paper account and needs no schema migration.

const WATCHLIST_NAME = "Forward Capital";

export interface AlpacaWatchlist {
  id: string;
  name: string;
  assets?: AlpacaAsset[];
}

export async function getOrCreateWatchlist(): Promise<AlpacaWatchlist> {
  const lists = await trading<AlpacaWatchlist[]>("/watchlists");
  const existing = lists.find((l) => l.name === WATCHLIST_NAME) ?? lists[0];
  if (existing) return trading<AlpacaWatchlist>(`/watchlists/${existing.id}`);
  return trading<AlpacaWatchlist>("/watchlists", {
    method: "POST",
    body: JSON.stringify({ name: WATCHLIST_NAME, symbols: [] }),
  });
}

export async function addToWatchlist(symbol: string): Promise<AlpacaWatchlist> {
  const watchlist = await getOrCreateWatchlist();
  const upper = symbol.toUpperCase();
  if (watchlist.assets?.some((a) => a.symbol === upper)) return watchlist;
  return trading<AlpacaWatchlist>(`/watchlists/${watchlist.id}`, {
    method: "POST",
    body: JSON.stringify({ symbol: upper }),
  });
}

export async function removeFromWatchlist(symbol: string): Promise<AlpacaWatchlist> {
  const watchlist = await getOrCreateWatchlist();
  await trading<void>(`/watchlists/${watchlist.id}/${encodeURIComponent(symbol.toUpperCase())}`, { method: "DELETE" });
  return getOrCreateWatchlist();
}
