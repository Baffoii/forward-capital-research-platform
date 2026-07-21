import { cn } from "@/lib/utils";

/**
 * Confidence gauge: -100..+100. Always renders the "not a prediction" disclaimer
 * directly beneath it — this is a non-negotiable per the build spec.
 */
export function ConfidenceGauge({ gauge, size = "lg" }: { gauge: number; size?: "sm" | "lg" }) {
  const clamped = Math.max(-100, Math.min(100, gauge));
  const pct = (clamped + 100) / 2; // 0..100
  const color =
    clamped > 20 ? "text-emerald-500" : clamped < -20 ? "text-rose-500" : "text-amber-500";

  return (
    <div className="space-y-2" data-testid="widget-confidence-gauge">
      <div className="flex items-baseline gap-2">
        <span className={cn("font-mono font-semibold", size === "lg" ? "text-3xl" : "text-xl", color)} data-testid="text-confidence-value">
          {clamped > 0 ? "+" : ""}
          {clamped}
        </span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", clamped > 20 ? "bg-emerald-500" : clamped < -20 ? "bg-rose-500" : "bg-amber-500")}
          style={{ width: `${pct}%` }}
          data-testid="bar-confidence-fill"
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
        <span>-100</span>
        <span>0</span>
        <span>+100</span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground" data-testid="text-confidence-disclaimer">
        This score reflects the weight of evidence collected so far. It is not a price prediction, a
        recommendation, or a probability of any return.
      </p>
    </div>
  );
}
