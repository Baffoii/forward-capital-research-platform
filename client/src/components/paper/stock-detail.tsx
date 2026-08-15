import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Star, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PriceChart } from "./price-chart";
import {
  CHART_RANGES,
  changeClass,
  cleanCompanyName,
  errorText,
  formatCompact,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQty,
  formatSignedCurrency,
  formatTimestamp,
  type BarsResponse,
  type ChartRange,
  type StockDetail as StockDetailData,
} from "@/lib/paper";

const RETURN_PERIODS = ["1W", "1M", "3M", "6M", "YTD", "1Y"];

function MetricCell({ label, value, valueClass, testId }: { label: string; value: string; valueClass?: string; testId: string }) {
  return (
    <div className="border-b border-border/60 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${valueClass ?? "text-foreground"}`} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/** Where the last trade sits inside the 52-week range — the bar every quote page draws. */
function RangeBar({ low, high, price }: { low: number; high: number; price: number }) {
  const pct = high > low ? ((price - low) / (high - low)) * 100 : 50;
  return (
    <div className="py-2">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">52-week range</div>
      <div className="relative h-1.5 w-full rounded-full bg-secondary">
        <div className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-foreground" style={{ left: `${Math.min(Math.max(pct, 0), 100)}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span data-testid="text-52w-low">{formatPrice(low)}</span>
        <span data-testid="text-52w-high">{formatPrice(high)}</span>
      </div>
    </div>
  );
}

function OrderTicket({ detail, marketOpen }: { detail: StockDetailData; marketOpen: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amountMode, setAmountMode] = useState<"shares" | "dollars">("shares");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");

  const price = detail.quote.price ?? 0;
  const numericAmount = Number(amount);
  const referencePrice = orderType === "limit" && Number(limitPrice) > 0 ? Number(limitPrice) : price;
  const estimate = !numericAmount
    ? null
    : amountMode === "shares"
      ? numericAmount * referencePrice
      : numericAmount;
  const estimatedShares = amountMode === "dollars" && referencePrice ? numericAmount / referencePrice : numericAmount;

  const placeOrder = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/paper/orders", {
        symbol: detail.symbol,
        side,
        type: orderType,
        timeInForce: "day",
        ...(amountMode === "shares" ? { qty: numericAmount } : { notional: numericAmount }),
        ...(orderType === "limit" ? { limitPrice: Number(limitPrice) } : {}),
      });
      return res.json();
    },
    onSuccess: (order: { status: string }) => {
      toast({
        title: `${side === "buy" ? "Buy" : "Sell"} order submitted`,
        description: `${formatQty(estimatedShares)} ${detail.symbol} · ${order.status.replace(/_/g, " ")}${
          marketOpen ? "" : " — queued until the market opens"
        }`,
      });
      setAmount("");
      setLimitPrice("");
      queryClient.invalidateQueries({ queryKey: ["/api/paper/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/portfolio-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/stocks", detail.symbol] });
    },
    onError: (err: Error) => {
      toast({ title: "Order rejected", description: errorText(err), variant: "destructive" });
    },
  });

  const disabled = !numericAmount || numericAmount <= 0 || (orderType === "limit" && !(Number(limitPrice) > 0)) || placeOrder.isPending;

  return (
    <Card data-testid="card-order-ticket">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Paper trade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(["buy", "sell"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={side === option ? "default" : "outline"}
              onClick={() => setSide(option)}
              data-testid={`button-side-${option}`}
              className="capitalize"
            >
              {option}
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          {(["market", "limit"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setOrderType(option)}
              data-testid={`button-order-type-${option}`}
              className={`flex-1 rounded-md border px-2 py-1.5 text-xs capitalize transition-colors ${
                orderType === option ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {orderType === "limit" && (
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Limit price</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={formatPrice(price)}
              className="font-mono"
              data-testid="input-limit-price"
            />
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount</label>
            <div className="flex gap-0.5">
              {(["shares", "dollars"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAmountMode(mode)}
                  disabled={mode === "dollars" && !detail.fractionable}
                  data-testid={`button-amount-mode-${mode}`}
                  className={`rounded px-1.5 py-0.5 text-[11px] capitalize transition-colors disabled:opacity-40 ${
                    amountMode === mode ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <Input
            type="number"
            step={amountMode === "shares" ? "1" : "0.01"}
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={amountMode === "shares" ? "0" : "$0.00"}
            className="font-mono"
            data-testid="input-order-amount"
          />
        </div>

        <div className="space-y-1 border-t border-border pt-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{amountMode === "shares" ? "Estimated cost" : "Estimated shares"}</span>
            <span className="font-mono" data-testid="text-order-estimate">
              {estimate == null ? "—" : amountMode === "shares" ? formatCurrency(estimate) : formatQty(estimatedShares)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{side === "buy" ? "Buying power" : "Shares held"}</span>
            <span className="font-mono">{side === "buy" ? "see portfolio" : formatQty(detail.position?.qty ?? 0)}</span>
          </div>
        </div>

        <Button className="w-full" disabled={disabled} onClick={() => placeOrder.mutate()} data-testid="button-submit-order">
          {placeOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {side === "buy" ? "Buy" : "Sell"} {detail.symbol}
        </Button>

        <p className="text-[11px] leading-snug text-muted-foreground">
          {marketOpen
            ? "Simulated order against your Alpaca paper account. No real money moves."
            : "Market is closed — day orders queue until the next open. No real money moves."}
        </p>
      </CardContent>
    </Card>
  );
}

export function StockDetailPanel({ symbol, marketOpen, onBack }: { symbol: string; marketOpen: boolean; onBack: () => void }) {
  const [range, setRange] = useState<ChartRange>("1M");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: detail, isLoading, error } = useQuery<StockDetailData>({
    queryKey: ["/api/paper/stocks", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/paper/stocks/${symbol}`)).json(),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const { data: barsData, isLoading: barsLoading } = useQuery<BarsResponse>({
    queryKey: ["/api/paper/stocks", symbol, "bars", range],
    queryFn: async () => (await apiRequest("GET", `/api/paper/stocks/${symbol}/bars?range=${range}`)).json(),
    refetchInterval: range === "1D" ? 60_000 : false,
    staleTime: 0,
  });

  const toggleWatchlist = useMutation({
    mutationFn: async (add: boolean) => {
      if (add) await apiRequest("POST", "/api/paper/watchlist", { symbol });
      else await apiRequest("DELETE", `/api/paper/watchlist/${symbol}`);
    },
    onSuccess: (_data, add) => {
      toast({ title: add ? `${symbol} added to watchlist` : `${symbol} removed from watchlist` });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/stocks", symbol] });
    },
    onError: (err: Error) => toast({ title: "Watchlist update failed", description: errorText(err), variant: "destructive" }),
  });

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-detail-error">
            {errorText(error)}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !detail) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const { quote, stats, fundamentals } = detail;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button
          variant={detail.inWatchlist ? "secondary" : "outline"}
          size="sm"
          onClick={() => toggleWatchlist.mutate(!detail.inWatchlist)}
          disabled={toggleWatchlist.isPending}
          data-testid="button-toggle-watchlist"
        >
          <Star className={`mr-1.5 h-4 w-4 ${detail.inWatchlist ? "fill-current" : ""}`} />
          {detail.inWatchlist ? "In watchlist" : "Add to watchlist"}
        </Button>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-mono text-xl font-semibold" data-testid="text-detail-symbol">
            {detail.symbol}
          </h2>
          <span className="text-sm text-muted-foreground" data-testid="text-detail-name">
            {cleanCompanyName(detail.name)}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {detail.exchange}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold tabular-nums" data-testid="text-detail-price">
            ${formatPrice(quote.price)}
          </span>
          <span className={`font-mono text-sm tabular-nums ${changeClass(quote.change)}`} data-testid="text-detail-change">
            {formatSignedCurrency(quote.change)} ({formatPercent(quote.changePct)})
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="text-detail-asof">
          {marketOpen ? "Delayed 15 min" : "At close"} · {formatTimestamp(quote.asOf)}
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="mb-2 flex flex-wrap gap-1">
            {CHART_RANGES.map((option) => (
              <button
                key={option}
                onClick={() => setRange(option)}
                data-testid={`button-range-${option}`}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  range === option ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <PriceChart bars={barsData?.bars ?? []} baseline={barsData?.baseline ?? null} range={range} isLoading={barsLoading} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Key statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                <MetricCell label="Open" value={formatPrice(quote.open)} testId="text-metric-open" />
                <MetricCell label="Prev close" value={formatPrice(quote.prevClose)} testId="text-metric-prev-close" />
                <MetricCell label="Day range" value={`${formatPrice(quote.low)} – ${formatPrice(quote.high)}`} testId="text-metric-day-range" />
                <MetricCell label="Volume" value={formatCompact(quote.volume)} testId="text-metric-volume" />
                <MetricCell label="Avg vol (30d)" value={formatCompact(stats.avgVolume30d)} testId="text-metric-avg-volume" />
                <MetricCell label="VWAP" value={formatPrice(quote.vwap)} testId="text-metric-vwap" />
                <MetricCell label="Market cap" value={fundamentals.marketCap ? `$${formatCompact(fundamentals.marketCap)}` : "—"} testId="text-metric-market-cap" />
                <MetricCell
                  label={`P/E ${fundamentals.epsBasis === "annual" ? "(annual)" : "(TTM)"}`}
                  value={fundamentals.peRatio ? fundamentals.peRatio.toFixed(2) : "—"}
                  testId="text-metric-pe"
                />
                <MetricCell label="EPS" value={fundamentals.epsTtm != null ? formatPrice(fundamentals.epsTtm) : "—"} testId="text-metric-eps" />
                <MetricCell label="Bid" value={quote.bid ? formatPrice(quote.bid) : "—"} testId="text-metric-bid" />
                <MetricCell label="Ask" value={quote.ask ? formatPrice(quote.ask) : "—"} testId="text-metric-ask" />
                <MetricCell label="Shares out" value={formatCompact(fundamentals.sharesOutstanding)} testId="text-metric-shares" />
              </div>

              {stats.high52w != null && stats.low52w != null && quote.price != null && (
                <RangeBar low={stats.low52w} high={stats.high52w} price={quote.price} />
              )}

              <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
                {fundamentals.available
                  ? `Fundamentals from SEC XBRL filings${fundamentals.fiscalPeriodEnd ? `, period ending ${fundamentals.fiscalPeriodEnd}` : ""}.`
                  : "No SEC-filed fundamentals available for this security."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {RETURN_PERIODS.map((period) => {
                  const value = stats.returns?.[period] ?? null;
                  return (
                    <div key={period}>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{period}</div>
                      <div className={`font-mono text-sm tabular-nums ${changeClass(value)}`} data-testid={`text-return-${period}`}>
                        {formatPercent(value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {detail.position && (
            <Card data-testid="card-your-position">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Your position</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shares</span>
                  <span className="font-mono">{formatQty(detail.position.qty)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg cost</span>
                  <span className="font-mono">{formatPrice(detail.position.avgEntryPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Market value</span>
                  <span className="font-mono">{formatCurrency(detail.position.marketValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unrealized P/L</span>
                  <span className={`font-mono ${changeClass(detail.position.unrealizedPl)}`}>
                    {formatSignedCurrency(detail.position.unrealizedPl)} ({formatPercent(detail.position.unrealizedPlPct)})
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <OrderTicket detail={detail} marketOpen={marketOpen} />
        </div>
      </div>
    </div>
  );
}
