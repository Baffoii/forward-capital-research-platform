// Confidence gauge: −100 disproved … 0 … +100 proved.
//
// The scale is signed and centred, because the question is which way the
// evidence leans, not how full a bar is. The disclaimer directly beneath is
// non-negotiable per the build spec and renders in every variant.

import { SectionLabel, Sparkline } from "@/components/kit";
import { fmtDayMonth, fmtGauge } from "@/lib/design";
import type { GaugePoint } from "@/lib/scoring-client";
import { cn } from "@/lib/utils";

export const CONFIDENCE_DISCLAIMER =
  "This score reflects the weight of evidence collected so far. It is not a price prediction, a recommendation, or a probability of any return.";

function toneFor(gauge: number) {
  if (gauge > 20) return { text: "text-fc-forest", color: "var(--fc-forest)", from: "var(--fc-forest-bright)" };
  if (gauge < -20) return { text: "text-fc-oxide", color: "var(--fc-oxide)", from: "var(--fc-oxide-bright)" };
  return { text: "text-fc-ochre-deep", color: "var(--fc-amber)", from: "var(--fc-amber)" };
}

export function ConfidenceGauge({
  gauge,
  delta,
  series,
  size = "lg",
  showDisclaimer = true,
  className,
}: {
  /** −100..+100 */
  gauge: number;
  /** Change over the trailing week, if it can be reconstructed. */
  delta?: number | null;
  /** Weekly replay of the same formula, for the trend line. */
  series?: GaugePoint[];
  size?: "sm" | "lg";
  showDisclaimer?: boolean;
  className?: string;
}) {
  const clamped = Math.max(-100, Math.min(100, Math.round(gauge)));
  const tone = toneFor(clamped);
  const magnitude = Math.abs(clamped) / 2; // half-width of the bar, in %

  return (
    <div className={className} data-testid="widget-confidence-gauge">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <SectionLabel className="text-fc-ink-2">Thesis confidence</SectionLabel>
        {delta != null && (
          <span
            className={cn(
              "font-mono text-[10.5px] font-medium leading-none",
              delta > 0 ? "text-fc-forest" : delta < 0 ? "text-fc-oxide" : "text-fc-ink-3"
            )}
            data-testid="text-confidence-delta"
          >
            {fmtGauge(delta)} this week
          </span>
        )}
      </div>

      <div className="mb-4 flex items-end gap-2">
        <span
          className={cn(
            "font-mono font-semibold leading-[0.85] tracking-[-0.03em]",
            size === "lg" ? "text-[46px]" : "text-[28px]",
            tone.text
          )}
          data-testid="text-confidence-value"
        >
          {fmtGauge(clamped)}
        </span>
        <span className="pb-1 text-[13px] leading-none text-fc-ink-3">/ 100</span>
      </div>

      <div
        className="relative mb-[7px] h-2.5 overflow-hidden rounded-full bg-fc-rule-soft"
        role="img"
        aria-label={`Confidence ${clamped} on a scale from −100 disproved to +100 proved`}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-fc-ink-4" />
        <div
          className="absolute inset-y-0"
          style={{
            left: clamped >= 0 ? "50%" : `${50 - magnitude}%`,
            width: `${magnitude}%`,
            borderRadius: clamped >= 0 ? "0 999px 999px 0" : "999px 0 0 999px",
            background:
              clamped >= 0
                ? `linear-gradient(90deg, ${tone.from}, ${tone.color})`
                : `linear-gradient(90deg, ${tone.color}, ${tone.from})`,
          }}
          data-testid="bar-confidence-fill"
        />
      </div>
      <div className="flex justify-between font-mono text-[9.5px] leading-none text-fc-ink-3">
        <span>−100 disproved</span>
        <span>0</span>
        <span>+100 proved</span>
      </div>

      {series && (
        <div className="mt-[18px]">
          <SectionLabel className="mb-2.5 text-fc-ink-2">Recorded history</SectionLabel>
          {series.length > 1 ? (
            <>
              <Sparkline points={series.map((p) => p.gauge)} color={tone.color} testId="chart-confidence-series" />
              <div className="mt-0.5 flex justify-between font-mono text-[9.5px] leading-none text-fc-ink-3">
                <span>{fmtDayMonth(series[0].date)}</span>
                <span>{fmtDayMonth(series[series.length - 1].date)}</span>
              </div>
            </>
          ) : (
            // One reading is a point, not a trend. Nothing is drawn through it.
            <p className="text-[10.5px] leading-[1.55] text-fc-ink-3" data-testid="text-no-confidence-history">
              {series.length === 1
                ? `One reading recorded, on ${fmtDayMonth(series[0].date)}. The trend line appears after the next recompute.`
                : "No confidence history recorded yet. Recompute to take the first reading."}
            </p>
          )}
        </div>
      )}

      {showDisclaimer && (
        <p
          className="mt-4 border-t border-fc-rule-soft pt-3.5 text-[10.5px] leading-[1.55] text-fc-ink-2"
          data-testid="text-confidence-disclaimer"
        >
          {CONFIDENCE_DISCLAIMER}
        </p>
      )}
    </div>
  );
}
