import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import {
  changeClass,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  type AccountSummary,
  type PortfolioPoint,
  type Position,
} from "@/lib/paper";

const HISTORY_PERIODS = [
  { label: "1W", period: "1W", timeframe: "1D" },
  { label: "1M", period: "1M", timeframe: "1D" },
  { label: "3M", period: "3M", timeframe: "1D" },
  { label: "1Y", period: "1A", timeframe: "1D" },
] as const;

function Metric({ label, value, valueClass, testId }: { label: string; value: string; valueClass?: string; testId: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${valueClass ?? "text-foreground"}`} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

export function PortfolioWidget({
  account,
  positions,
  isLoading,
  onSelectSymbol,
}: {
  account?: AccountSummary;
  positions: Position[];
  isLoading: boolean;
  onSelectSymbol: (symbol: string) => void;
}) {
  const [periodIndex, setPeriodIndex] = useState(1);
  const period = HISTORY_PERIODS[periodIndex];

  const { data: history } = useQuery<{ points: PortfolioPoint[]; baseValue: number }>({
    queryKey: ["/api/paper/portfolio-history", period.period],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/paper/portfolio-history?period=${period.period}&timeframe=${period.timeframe}`);
      return res.json();
    },
  });

  // Alpaca back-fills the account's pre-funding days with zeroes; drop them so the equity curve
  // doesn't start with a cliff from $0 to the opening balance.
  const points = (history?.points ?? []).filter((p) => p.equity != null && p.equity > 0);
  const equityStart = points[0]?.equity ?? null;
  const equityNow = account?.equity ?? null;
  const periodChange = equityStart != null && equityNow != null ? equityNow - equityStart : null;
  const periodChangePct = periodChange != null && equityStart ? (periodChange / equityStart) * 100 : null;

  const totalCostBasis = positions.reduce((sum, p) => sum + Math.abs(p.costBasis), 0);
  const totalUnrealized = positions.reduce((sum, p) => sum + p.unrealizedPl, 0);
  const totalUnrealizedPct = totalCostBasis ? (totalUnrealized / totalCostBasis) * 100 : null;
  const invested = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
  const equity = account?.equity ?? 0;

  if (isLoading && !account) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Portfolio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-portfolio">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Portfolio</span>
          <span className="font-mono text-[11px] font-normal text-muted-foreground">{account?.accountNumber}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="font-mono text-2xl font-semibold tabular-nums" data-testid="text-portfolio-value">
            {formatCurrency(account?.equity)}
          </div>
          <div className={`font-mono text-sm ${changeClass(account?.dayChange)}`} data-testid="text-portfolio-day-change">
            {formatSignedCurrency(account?.dayChange)} ({formatPercent(account?.dayChangePct)}) today
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={`font-mono text-xs ${changeClass(periodChange)}`} data-testid="text-portfolio-period-change">
              {periodChange != null ? `${formatSignedCurrency(periodChange)} (${formatPercent(periodChangePct)}) ${period.label}` : " "}
            </span>
            <div className="flex gap-0.5">
              {HISTORY_PERIODS.map((p, i) => (
                <button
                  key={p.label}
                  onClick={() => setPeriodIndex(i)}
                  data-testid={`button-portfolio-period-${p.label}`}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                    i === periodIndex ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className={periodChange != null && periodChange < 0 ? "text-down" : "text-up"}>
            <ResponsiveContainer width="100%" height={72}>
              <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={["dataMin", "dataMax"]} hide />
                <Tooltip
                  content={({ active, payload }: any) =>
                    active && payload?.length ? (
                      <div className="rounded-md border border-card-border bg-popover px-2 py-1 text-xs shadow-md">
                        <div className="font-mono font-medium">{formatCurrency(payload[0].payload.equity)}</div>
                        <div className="text-muted-foreground">
                          {new Date(payload[0].payload.t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                      </div>
                    ) : null
                  }
                />
                <Area type="linear" dataKey="equity" stroke="currentColor" strokeWidth={1.5} fill="url(#equityFill)" isAnimationActive={false} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3">
          <Metric label="Cash" value={formatCurrency(account?.cash)} testId="text-portfolio-cash" />
          <Metric label="Buying power" value={formatCurrency(account?.buyingPower)} testId="text-portfolio-buying-power" />
          <Metric label="Invested" value={formatCurrency(invested)} testId="text-portfolio-invested" />
          <Metric
            label="Unrealized P/L"
            value={positions.length ? `${formatSignedCurrency(totalUnrealized)} (${formatPercent(totalUnrealizedPct)})` : "—"}
            valueClass={changeClass(positions.length ? totalUnrealized : null)}
            testId="text-portfolio-unrealized"
          />
        </div>

        <div className="border-t border-border pt-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Allocation</div>
          {positions.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="text-allocation-empty">
              100% cash — no open positions yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {[...positions]
                .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))
                .map((position) => {
                  const weight = equity ? (Math.abs(position.marketValue) / equity) * 100 : 0;
                  return (
                    <button
                      key={position.symbol}
                      onClick={() => onSelectSymbol(position.symbol)}
                      className="group w-full text-left"
                      data-testid={`button-allocation-${position.symbol}`}
                    >
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-mono font-medium group-hover:text-primary">{position.symbol}</span>
                        <span className="font-mono text-muted-foreground">{weight.toFixed(1)}%</span>
                      </div>
                      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(weight, 100)}%` }} />
                      </div>
                    </button>
                  );
                })}
              <div className="flex items-baseline justify-between pt-1 text-xs">
                <span className="text-muted-foreground">Cash</span>
                <span className="font-mono text-muted-foreground">{equity ? (((account?.cash ?? 0) / equity) * 100).toFixed(1) : "0.0"}%</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
