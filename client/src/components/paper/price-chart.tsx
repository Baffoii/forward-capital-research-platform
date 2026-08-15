import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, type Bar, type ChartRange } from "@/lib/paper";

interface PriceChartProps {
  bars: Bar[];
  baseline: number | null;
  range: ChartRange;
  isLoading?: boolean;
  height?: number;
}

/** Intraday ranges get a clock, longer ones a calendar — same convention as an exchange chart. */
function tickFormatter(range: ChartRange) {
  return (iso: string) => {
    const date = new Date(iso);
    if (range === "1D") {
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    }
    if (range === "1W" || range === "1M") {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    }
    if (range === "5Y") {
      return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "America/New_York" });
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  };
}

function ChartTooltip({ active, payload, range, baseline }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Bar;
  const changeFromBaseline = baseline ? ((point.c - baseline) / baseline) * 100 : null;

  return (
    <div className="rounded-md border border-card-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-mono text-sm font-semibold text-popover-foreground">${formatPrice(point.c)}</div>
      {changeFromBaseline !== null && (
        <div className={`font-mono ${changeFromBaseline >= 0 ? "text-up" : "text-down"}`}>
          {changeFromBaseline >= 0 ? "+" : ""}
          {changeFromBaseline.toFixed(2)}%
        </div>
      )}
      <div className="mt-1 text-muted-foreground">
        {new Date(point.t).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          ...(range === "1D" || range === "1W" || range === "1M" ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }),
          timeZone: "America/New_York",
        })}
      </div>
      <div className="text-muted-foreground">Vol {point.v.toLocaleString("en-US")}</div>
    </div>
  );
}

export function PriceChart({ bars, baseline, range, isLoading, height = 280 }: PriceChartProps) {
  if (isLoading) return <Skeleton className="w-full" style={{ height }} />;

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground" style={{ height }}>
        No price history available for this range.
      </div>
    );
  }

  const closes = bars.map((b) => b.c);
  const last = closes[closes.length - 1];
  const reference = baseline ?? closes[0];
  const isUp = last >= reference;

  // Pad the domain so the line never touches the frame, and keep the baseline inside it.
  const min = Math.min(...closes, reference);
  const max = Math.max(...closes, reference);
  const pad = (max - min) * 0.08 || max * 0.01;

  return (
    // The Area/gradient/reference line all draw with currentColor, so direction colour is set once
    // here and stays correct across light/dark themes without reading CSS variables in JS.
    <div className={isUp ? "text-up" : "text-down"} data-testid="chart-price">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="text-border" stroke="currentColor" strokeOpacity={0.5} vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={tickFormatter(range)}
            className="text-muted-foreground"
            tick={{ fill: "currentColor", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            orientation="right"
            width={62}
            className="text-muted-foreground"
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickFormatter={(v: number) => formatPrice(v)}
            axisLine={false}
            tickLine={false}
          />
          {reference != null && <ReferenceLine y={reference} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="4 4" />}
          <Tooltip content={<ChartTooltip range={range} baseline={reference} />} cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }} />
          <Area type="linear" dataKey="c" stroke="currentColor" strokeWidth={1.75} fill="url(#priceFill)" isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
