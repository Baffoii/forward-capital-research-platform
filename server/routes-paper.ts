// Paper Trading tab API. Everything here proxies Alpaca server-side so the API key/secret never
// ship to the browser, and enriches raw Alpaca payloads with company names, derived statistics and
// SEC-filed fundamentals before the frontend sees them.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  AlpacaError,
  CHART_RANGES,
  type ChartRange,
  addToWatchlist,
  alpacaConfigured,
  cancelOrder,
  getAccount,
  getAsset,
  getBars,
  getClock,
  getOrCreateWatchlist,
  getPortfolioHistory,
  getPositions,
  getSnapshot,
  getSnapshots,
  getSymbolStats,
  type Quote,
  listOrders,
  placeOrder,
  removeFromWatchlist,
  searchAssets,
} from "./alpaca";
import { getFundamentals } from "./fundamentals";

/** Wraps a handler so Alpaca failures surface as their real status instead of a generic 500. */
function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof AlpacaError) {
        return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
      }
      console.error("[paper] unhandled error:", err);
      res.status(500).json({ error: (err as Error).message || "Unexpected error" });
    }
  };
}

const rangeSchema = z.enum(CHART_RANGES as [ChartRange, ...ChartRange[]]);

const orderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit"]).default("market"),
  timeInForce: z.enum(["day", "gtc", "opg", "cls", "ioc", "fok"]).default("day"),
  qty: z.number().positive().optional(),
  notional: z.number().positive().optional(),
  limitPrice: z.number().positive().optional(),
});

export function registerPaperTradingRoutes(app: Express) {
  app.use("/api/paper", (_req, res, next) => {
    if (!alpacaConfigured()) {
      return res.status(503).json({ error: "Alpaca credentials are not configured on the server (set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY)." });
    }
    next();
  });

  // ── Search: match on ticker or company name, with a live quote per hit ───
  app.get(
    "/api/paper/search",
    handle(async (req, res) => {
      const query = String(req.query.q ?? "").trim();
      if (!query) return res.json({ results: [] });

      const assets = await searchAssets(query, 20);
      if (assets.length === 0) return res.json({ results: [] });

      // One snapshot call covers the whole result set.
      const quotes = await getSnapshots(assets.map((a) => a.symbol)).catch((): Record<string, Quote> => ({}));
      res.json({
        results: assets.map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          exchange: asset.exchange,
          fractionable: asset.fractionable,
          quote: quotes[asset.symbol] ?? null,
        })),
      });
    })
  );

  // ── Portfolio ────────────────────────────────────────────────────────────
  app.get(
    "/api/paper/account",
    handle(async (_req, res) => {
      const [account, clock] = await Promise.all([getAccount(), getClock()]);
      const equity = Number(account.equity);
      const lastEquity = Number(account.last_equity);
      const dayChange = equity - lastEquity;

      res.json({
        accountNumber: account.account_number,
        status: account.status,
        equity,
        lastEquity,
        cash: Number(account.cash),
        buyingPower: Number(account.buying_power),
        longMarketValue: Number(account.long_market_value),
        shortMarketValue: Number(account.short_market_value),
        dayChange,
        dayChangePct: lastEquity ? (dayChange / lastEquity) * 100 : 0,
        marketOpen: clock.is_open,
        nextOpen: clock.next_open,
        nextClose: clock.next_close,
      });
    })
  );

  app.get(
    "/api/paper/positions",
    handle(async (_req, res) => {
      const positions = await getPositions();
      const enriched = await Promise.all(
        positions.map(async (p) => {
          const asset = await getAsset(p.symbol).catch(() => undefined);
          return {
            symbol: p.symbol,
            name: asset?.name ?? p.symbol,
            qty: Number(p.qty),
            side: p.side,
            avgEntryPrice: Number(p.avg_entry_price),
            currentPrice: Number(p.current_price),
            marketValue: Number(p.market_value),
            costBasis: Number(p.cost_basis),
            unrealizedPl: Number(p.unrealized_pl),
            unrealizedPlPct: Number(p.unrealized_plpc) * 100,
            intradayPl: Number(p.unrealized_intraday_pl),
            intradayPlPct: Number(p.unrealized_intraday_plpc) * 100,
            changeTodayPct: Number(p.change_today) * 100,
          };
        })
      );
      res.json({ positions: enriched });
    })
  );

  app.get(
    "/api/paper/portfolio-history",
    handle(async (req, res) => {
      const period = String(req.query.period ?? "1M");
      const timeframe = String(req.query.timeframe ?? "1D");
      const history = await getPortfolioHistory(period, timeframe);
      res.json({
        period,
        baseValue: history.base_value,
        points: (history.timestamp ?? []).map((ts, i) => ({
          t: new Date(ts * 1000).toISOString(),
          equity: history.equity?.[i] ?? null,
          profitLoss: history.profit_loss?.[i] ?? null,
          profitLossPct: (history.profit_loss_pct?.[i] ?? 0) * 100,
        })),
      });
    })
  );

  // ── Watchlist (stored in Alpaca, tied to the same paper account) ─────────
  app.get(
    "/api/paper/watchlist",
    handle(async (_req, res) => {
      const watchlist = await getOrCreateWatchlist();
      const assets = watchlist.assets ?? [];
      const quotes: Record<string, Quote> =
        assets.length > 0 ? await getSnapshots(assets.map((a) => a.symbol)).catch(() => ({})) : {};
      res.json({
        name: watchlist.name,
        items: assets.map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          exchange: asset.exchange,
          quote: quotes[asset.symbol] ?? null,
        })),
      });
    })
  );

  app.post(
    "/api/paper/watchlist",
    handle(async (req, res) => {
      const parsed = z.object({ symbol: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      await addToWatchlist(parsed.data.symbol);
      res.json({ ok: true, symbol: parsed.data.symbol.toUpperCase() });
    })
  );

  app.delete(
    "/api/paper/watchlist/:symbol",
    handle(async (req, res) => {
      const symbol = String(req.params.symbol).toUpperCase();
      await removeFromWatchlist(symbol);
      res.json({ ok: true, symbol });
    })
  );

  // ── Single stock: quote, derived stats, fundamentals, holding context ────
  app.get(
    "/api/paper/stocks/:symbol",
    handle(async (req, res) => {
      const symbol = String(req.params.symbol).toUpperCase();
      const [asset, quote] = await Promise.all([getAsset(symbol), getSnapshot(symbol)]);
      if (!asset) return res.status(404).json({ error: `No tradable US equity found for "${symbol}"` });

      // Stats, fundamentals, holding and watchlist state are independent — fetch them together.
      const [stats, fundamentals, positions, watchlist] = await Promise.all([
        getSymbolStats(symbol, quote.price).catch(() => ({ high52w: null, low52w: null, avgVolume30d: null, returns: {} })),
        getFundamentals(symbol, quote.price),
        getPositions().catch(() => []),
        getOrCreateWatchlist().catch(() => ({ id: "", name: "", assets: [] })),
      ]);

      const position = positions.find((p) => p.symbol === symbol);

      res.json({
        symbol,
        name: asset.name,
        exchange: asset.exchange,
        fractionable: asset.fractionable,
        shortable: asset.shortable,
        quote,
        stats,
        fundamentals,
        inWatchlist: (watchlist.assets ?? []).some((a) => a.symbol === symbol),
        position: position
          ? {
              qty: Number(position.qty),
              avgEntryPrice: Number(position.avg_entry_price),
              marketValue: Number(position.market_value),
              unrealizedPl: Number(position.unrealized_pl),
              unrealizedPlPct: Number(position.unrealized_plpc) * 100,
            }
          : null,
      });
    })
  );

  app.get(
    "/api/paper/stocks/:symbol/bars",
    handle(async (req, res) => {
      const parsed = rangeSchema.safeParse(req.query.range ?? "1M");
      if (!parsed.success) return res.status(400).json({ error: `range must be one of ${CHART_RANGES.join(", ")}` });

      const symbol = String(req.params.symbol).toUpperCase();
      const { bars, feed } = await getBars(symbol, parsed.data);
      const quote = await getSnapshot(symbol).catch(() => null);

      // The baseline the chart draws its dashed reference line against: previous close intraday,
      // first bar of the window for longer ranges.
      const baseline = parsed.data === "1D" ? quote?.prevClose ?? bars[0]?.o ?? null : bars[0]?.c ?? null;

      res.json({
        symbol,
        range: parsed.data,
        feed,
        baseline,
        bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
      });
    })
  );

  // ── Orders ───────────────────────────────────────────────────────────────
  app.get(
    "/api/paper/orders",
    handle(async (_req, res) => {
      const orders = await listOrders(25);
      res.json({
        orders: orders.map((o) => ({
          id: o.id,
          symbol: o.symbol,
          qty: o.qty ? Number(o.qty) : null,
          notional: o.notional ? Number(o.notional) : null,
          filledQty: Number(o.filled_qty),
          filledAvgPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
          side: o.side,
          type: o.type,
          limitPrice: o.limit_price ? Number(o.limit_price) : null,
          status: o.status,
          submittedAt: o.submitted_at ?? o.created_at,
        })),
      });
    })
  );

  app.post(
    "/api/paper/orders",
    handle(async (req, res) => {
      const parsed = orderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const input = parsed.data;

      if (!input.qty && !input.notional) {
        return res.status(400).json({ error: "Provide either a share quantity or a dollar amount" });
      }
      if (input.type === "limit" && !input.limitPrice) {
        return res.status(400).json({ error: "Limit orders require a limit price" });
      }

      const order = await placeOrder({
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        type: input.type,
        time_in_force: input.timeInForce,
        ...(input.qty ? { qty: String(input.qty) } : {}),
        ...(input.notional ? { notional: String(input.notional) } : {}),
        ...(input.limitPrice ? { limit_price: String(input.limitPrice) } : {}),
      });

      res.json({ id: order.id, symbol: order.symbol, side: order.side, status: order.status, qty: order.qty, notional: order.notional });
    })
  );

  app.delete(
    "/api/paper/orders/:id",
    handle(async (req, res) => {
      await cancelOrder(String(req.params.id));
      res.json({ ok: true });
    })
  );
}
