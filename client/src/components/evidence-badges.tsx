// Classification chips and the two shapes a signal is read in: a register row
// (briefing / feed) and a compact evidence item (for / against panels).
//
// Every signal shows its direction, how well it is verified, where it came
// from, and what it is worth. None of those is ever hidden behind a hover.

import type { ReactNode } from "react";
import { Chip, directionRailColor, directionTone, scoreToneClass, type Tone } from "@/components/kit";
import {
  DIRECTION_LABELS,
  PROVENANCE_LABELS,
  TIER_LABELS,
  TIER_LABELS_SHORT,
  fmtDayMonthCaps,
  fmtScore,
  fmtTime,
  humanize,
} from "@/lib/design";
import { cn } from "@/lib/utils";
import type { Signal } from "@shared/schema";

const TIER_TONES: Record<string, Tone> = {
  unverified: "neutral",
  single_source: "ochre",
  corroborated: "azure",
  primary_source_confirmed: "confirming",
};

const PROVENANCE_TONES: Record<string, Tone> = {
  ai_generated_interpretation: "iris",
  investment_hypothesis: "iris",
};

export function DirectionBadge({ direction, suffix }: { direction: string; suffix?: string }) {
  return (
    <Chip tone={directionTone(direction)} size="lead" testId={`badge-direction-${direction}`}>
      {DIRECTION_LABELS[direction] ?? direction}
      {suffix ? ` ${suffix}` : ""}
    </Chip>
  );
}

export function VerificationTierBadge({ tier, short = false }: { tier: string; short?: boolean }) {
  const labels = short ? TIER_LABELS_SHORT : TIER_LABELS;
  return (
    <Chip tone={TIER_TONES[tier] ?? "neutral"} testId={`badge-verification-tier-${tier}`}>
      {labels[tier] ?? humanize(tier)}
    </Chip>
  );
}

export function ProvenanceBadge({ provenanceClass }: { provenanceClass: string }) {
  return (
    <Chip tone={PROVENANCE_TONES[provenanceClass] ?? "neutral"} testId={`badge-provenance-${provenanceClass}`}>
      {PROVENANCE_LABELS[provenanceClass] ?? humanize(provenanceClass)}
    </Chip>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <Chip mono testId={`badge-category-${category}`}>
      {category}
    </Chip>
  );
}

/** The standard classification run: direction, tier, provenance, category. */
export function SignalChips({
  signal,
  short = false,
  showProvenance = true,
  showCategory = true,
  className,
}: {
  signal: Signal;
  short?: boolean;
  showProvenance?: boolean;
  showCategory?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <DirectionBadge direction={signal.direction} />
      <VerificationTierBadge tier={signal.verificationTier} short={short} />
      {showProvenance && <ProvenanceBadge provenanceClass={signal.provenanceClass} />}
      {showCategory && <CategoryBadge category={signal.signalCategory} />}
    </div>
  );
}

/**
 * A dated register row. The rail on the left carries the direction, so the
 * shape of a week is legible before any text is read.
 */
export function SignalRow({
  signal,
  score,
  ticker,
  showTime = true,
  last = false,
  scoreCaption,
}: {
  signal: Signal;
  score?: number;
  ticker?: ReactNode;
  showTime?: boolean;
  last?: boolean;
  scoreCaption?: string;
}) {
  const unscored = score == null || Math.abs(score) < 0.005;
  const caption = scoreCaption ?? (unscored ? "unscored" : "score impact");

  return (
    <div
      className={cn("flex gap-3.5 px-5 py-4", !last && "border-b border-fc-rule-soft")}
      data-testid={`row-signal-${signal.id}`}
    >
      <div className="w-11 shrink-0 text-right text-[11px] font-medium leading-[1.45] text-fc-ink-3">
        {fmtDayMonthCaps(signal.retrievedAt)}
        {showTime && (
          <>
            <br />
            {fmtTime(signal.retrievedAt)}
          </>
        )}
      </div>
      <div
        className="w-[3px] shrink-0 rounded-sm"
        style={{ background: directionRailColor(signal.direction) }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          {ticker && <span className="font-mono text-[12.5px] font-semibold text-fc-ink">{ticker}</span>}
          <span
            className="font-display text-[13px] font-semibold leading-[1.35] text-fc-ink"
            data-testid={`text-signal-title-${signal.id}`}
          >
            {signal.title}
          </span>
        </div>
        <p className="text-[12.5px] leading-[1.6] text-fc-ink-3">{signal.description}</p>
        <SignalChips signal={signal} short className="mt-2.5" />
      </div>
      <div className="shrink-0 text-right">
        <div
          className={cn("font-mono text-sm font-semibold leading-none", scoreToneClass(score))}
          data-testid={`text-signal-score-${signal.id}`}
        >
          {fmtScore(score ?? 0)}
        </div>
        <div className="mt-1 text-[10px] leading-tight text-fc-ink-3">{caption}</div>
      </div>
    </div>
  );
}

/** Compact "title — score / one line of why" item for the evidence panels. */
export function EvidenceItem({
  signal,
  score,
  tone = "plain",
  last = false,
}: {
  signal: Signal;
  score: number;
  tone?: "plain" | "alert";
  last?: boolean;
}) {
  return (
    <div
      className={cn("px-5 py-4", !last && (tone === "alert" ? "border-b border-fc-oxide-panel-line" : "border-b border-fc-rule-soft"))}
      data-testid={`item-evidence-${signal.id}`}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-display text-[12.5px] font-semibold leading-[1.35] text-fc-ink">{signal.title}</span>
        <span className={cn("shrink-0 font-mono text-[12.5px] font-semibold leading-none", scoreToneClass(score))}>
          {fmtScore(score)}
        </span>
      </div>
      <p className="text-xs leading-[1.6] text-fc-ink-3">{signal.description}</p>
    </div>
  );
}
