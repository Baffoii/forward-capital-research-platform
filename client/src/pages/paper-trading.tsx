import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Star, X, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PortfolioWidget } from "@/components/paper/portfolio-widget";
import { StockDetailPanel } from "@/components/paper/stock-detail";
import {
  changeClass,
  cleanCompanyName,
  errorText,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQty,
  formatSignedCurrency,
  type AccountSummary,
  type Position,
  type Quote,
  type SearchResult,
  type WatchlistItem,
} from "@/lib/paper";

/** Quotes are 15-minute delayed on Alpaca's free tier, so polling faster than this buys nothing. */
const LIVE_REFETCH_MS = 30_000;

function PriceCells({ quote }: { quote: Quote | null }) {
  return (
    <>
      <TableCell className="text-right font-mono tabular-nums">{quote?.price != null ? formatPrice(quote.price) : "—"}</TableCell>
      <TableCell className={`text-right font-mono tabular-nums ${changeClass(quote?.change)}`}>
        {quote?.change != null ? formatSignedCurrency(quote.change) : "—"}
      </TableCell>
      <TableCell className={`text-right font-mono tabular-nums ${changeClass(quote?.changePct)}`}>
        {quote?.changePct != null ? formatPercent(quote.changePct) : "—"}
      </TableCell>
    </>
  );
}

function SymbolCell({ symbol, name }: { symbol: string; name: string }) {
  return (
    <TableCell>
      <div className="font-mono text-sm font-medium">{symbol}</div>
      <div className="max-w-[220px] truncate text-xs text-muted-foreground">{cleanCompanyName(name)}</div>
    </TableCell>
  );
}

function SectionCard({
  title,
  count,
  children,
  testId,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {title}
          {count != null && (
            <Badge variant="secondary" className="text-[10px]">
              {count}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

export default function PaperTrading() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Keystrokes shouldn't each trigger a snapshot fetch for 20 symbols.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data: account, isLoading: accountLoading, error: accountError } = useQuery<AccountSummary>({
    queryKey: ["/api/paper/account"],
    queryFn: async () => (await apiRequest("GET", "/api/paper/account")).json(),
    refetchInterval: LIVE_REFETCH_MS,
    staleTime: 0,
  });

  const { data: positionsData, isLoading: positionsLoading } = useQuery<{ positions: Position[] }>({
    queryKey: ["/api/paper/positions"],
    queryFn: async () => (await apiRequest("GET", "/api/paper/positions")).json(),
    refetchInterval: LIVE_REFETCH_MS,
    staleTime: 0,
  });

  const { data: watchlistData, isLoading: watchlistLoading } = useQuery<{ items: WatchlistItem[] }>({
    queryKey: ["/api/paper/watchlist"],
    queryFn: async () => (await apiRequest("GET", "/api/paper/watchlist")).json(),
    refetchInterval: LIVE_REFETCH_MS,
    staleTime: 0,
  });

  const { data: searchData, isFetching: searching } = useQuery<{ results: SearchResult[] }>({
    queryKey: ["/api/paper/search", debouncedQuery],
    queryFn: async () => (await apiRequest("GET", `/api/paper/search?q=${encodeURIComponent(debouncedQuery)}`)).json(),
    enabled: debouncedQuery.length > 0,
    staleTime: 15_000,
  });

  const positions = positionsData?.positions ?? [];
  const watchlist = watchlistData?.items ?? [];
  const watchedSymbols = useMemo(() => new Set(watchlist.map((item) => item.symbol)), [watchlist]);

  const toggleWatchlist = useMutation({
    mutationFn: async ({ symbol, add }: { symbol: string; add: boolean }) => {
      if (add) await apiRequest("POST", "/api/paper/watchlist", { symbol });
      else await apiRequest("DELETE", `/api/paper/watchlist/${symbol}`);
      return { symbol, add };
    },
    onSuccess: ({ symbol, add }) => {
      toast({ title: add ? `${symbol} added to watchlist` : `${symbol} removed from watchlist` });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper/stocks", symbol] });
    },
    onError: (err: Error) => toast({ title: "Watchlist update failed", description: errorText(err), variant: "destructive" }),
  });

  const WatchButton = ({ symbol }: { symbol: string }) => {
    const watched = watchedSymbols.has(symbol);
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleWatchlist.mutate({ symbol, add: !watched });
        }}
        title={watched ? "Remove from watchlist" : "Add to watchlist"}
        aria-label={watched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
        data-testid={`button-watch-${symbol}`}
        className={`rounded p-1 transition-colors ${watched ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Star className={`h-4 w-4 ${watched ? "fill-current" : ""}`} />
      </button>
    );
  };

  const credentialsMissing = accountError && (accountError as Error).message.includes("503");

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">
              Paper Trading
            </h1>
            <p className="text-sm text-muted-foreground">
              Simulated trading against an Alpaca paper account. Market data is delayed 15 minutes.
            </p>
          </div>
          {account && (
            <Badge variant={account.marketOpen ? "default" : "secondary"} data-testid="badge-market-status">
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${account.marketOpen ? "bg-status-online" : "bg-status-offline"}`} />
              {account.marketOpen ? "Market open" : "Market closed"}
            </Badge>
          )}
        </div>

        {credentialsMissing && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground" data-testid="text-credentials-missing">
              Alpaca credentials are not configured. Set <code className="font-mono">ALPACA_API_KEY_ID</code> and{" "}
              <code className="font-mono">ALPACA_API_SECRET_KEY</code> in <code className="font-mono">.env</code> and restart the server.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            {selectedSymbol ? (
              <StockDetailPanel symbol={selectedSymbol} marketOpen={account?.marketOpen ?? false} onBack={() => setSelectedSymbol(null)} />
            ) : (
              <>
                {/* ── 1. Search ─────────────────────────────────────────── */}
                <SectionCard title="Search" testId="card-search">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by company name or ticker…"
                      className="pl-9"
                      data-testid="input-search"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        data-testid="button-clear-search"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {debouncedQuery.length === 0 ? (
                    <p className="pt-3 text-sm text-muted-foreground" data-testid="text-search-hint">
                      Start typing a ticker (AAPL) or a company name (Apple) to see live quotes.
                    </p>
                  ) : searching && !searchData ? (
                    <div className="space-y-2 pt-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : (searchData?.results.length ?? 0) === 0 ? (
                    <p className="pt-3 text-sm text-muted-foreground" data-testid="text-search-empty">
                      No tradable stocks match “{debouncedQuery}”.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          <TableHead className="text-right">% Change</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {searchData?.results.map((result) => (
                          <TableRow
                            key={result.symbol}
                            onClick={() => setSelectedSymbol(result.symbol)}
                            className="cursor-pointer"
                            data-testid={`row-search-${result.symbol}`}
                          >
                            <SymbolCell symbol={result.symbol} name={result.name} />
                            <PriceCells quote={result.quote} />
                            <TableCell>
                              <WatchButton symbol={result.symbol} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </SectionCard>

                {/* ── 2. Positions ──────────────────────────────────────── */}
                <SectionCard title="Your positions" count={positions.length} testId="card-positions">
                  {positionsLoading ? (
                    <div className="space-y-2 pt-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : positions.length === 0 ? (
                    <p className="pt-2 text-sm text-muted-foreground" data-testid="text-positions-empty">
                      No open positions. Search for a stock above, open it, and place a paper trade.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Avg cost</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Market value</TableHead>
                          <TableHead className="text-right">Today</TableHead>
                          <TableHead className="text-right">Total P/L</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {positions.map((position) => (
                          <TableRow
                            key={position.symbol}
                            onClick={() => setSelectedSymbol(position.symbol)}
                            className="cursor-pointer"
                            data-testid={`row-position-${position.symbol}`}
                          >
                            <SymbolCell symbol={position.symbol} name={position.name} />
                            <TableCell className="text-right font-mono tabular-nums">{formatQty(position.qty)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatPrice(position.avgEntryPrice)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatPrice(position.currentPrice)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatCurrency(position.marketValue)}</TableCell>
                            <TableCell className={`text-right font-mono tabular-nums ${changeClass(position.changeTodayPct)}`}>
                              {formatPercent(position.changeTodayPct)}
                            </TableCell>
                            <TableCell className={`text-right font-mono tabular-nums ${changeClass(position.unrealizedPl)}`}>
                              <div>{formatSignedCurrency(position.unrealizedPl)}</div>
                              <div className="text-xs">{formatPercent(position.unrealizedPlPct)}</div>
                            </TableCell>
                            <TableCell>
                              <WatchButton symbol={position.symbol} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </SectionCard>

                {/* ── 3. Watchlist ──────────────────────────────────────── */}
                <SectionCard title="Watchlist" count={watchlist.length} testId="card-watchlist">
                  {watchlistLoading ? (
                    <div className="space-y-2 pt-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : watchlist.length === 0 ? (
                    <p className="pt-2 text-sm text-muted-foreground" data-testid="text-watchlist-empty">
                      Nothing on the watchlist yet. Use the ☆ button on any search result to track it here.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          <TableHead className="text-right">% Change</TableHead>
                          <TableHead className="text-right">Day range</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {watchlist.map((item) => (
                          <TableRow
                            key={item.symbol}
                            onClick={() => setSelectedSymbol(item.symbol)}
                            className="cursor-pointer"
                            data-testid={`row-watchlist-${item.symbol}`}
                          >
                            <SymbolCell symbol={item.symbol} name={item.name} />
                            <PriceCells quote={item.quote} />
                            <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                              {item.quote?.low != null && item.quote?.high != null
                                ? `${formatPrice(item.quote.low)} – ${formatPrice(item.quote.high)}`
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleWatchlist.mutate({ symbol: item.symbol, add: false });
                                }}
                                title="Remove from watchlist"
                                aria-label={`Remove ${item.symbol} from watchlist`}
                                data-testid={`button-unwatch-${item.symbol}`}
                                className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                              >
                                {toggleWatchlist.isPending && toggleWatchlist.variables?.symbol === item.symbol ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <X className="h-4 w-4" />
                                )}
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </SectionCard>
              </>
            )}
          </div>

          {/* ── Portfolio widget ────────────────────────────────────────── */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <PortfolioWidget
              account={account}
              positions={positions}
              isLoading={accountLoading}
              onSelectSymbol={(symbol) => setSelectedSymbol(symbol)}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
