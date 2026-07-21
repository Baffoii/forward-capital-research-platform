import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Signal } from "@shared/schema";

const TIER_STYLES: Record<string, string> = {
  unverified: "bg-muted text-muted-foreground border-border",
  single_source: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  corroborated: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  primary_source_confirmed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

const TIER_LABELS: Record<string, string> = {
  unverified: "Unverified",
  single_source: "Single source",
  corroborated: "Corroborated",
  primary_source_confirmed: "Primary source confirmed",
};

export function VerificationTierBadge({ tier }: { tier: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wide", TIER_STYLES[tier] ?? TIER_STYLES.unverified)}
      data-testid={`badge-verification-tier-${tier}`}
    >
      {TIER_LABELS[tier] ?? tier}
    </Badge>
  );
}

const PROVENANCE_LABELS: Record<string, string> = {
  raw_data: "Raw data",
  detected_signal: "Detected signal",
  ai_generated_interpretation: "AI-generated",
  human_authored_research: "Human research",
  investment_hypothesis: "Investment hypothesis",
  confirmed_event: "Confirmed event",
  unverified_rumor_or_social_claim: "Unverified rumor/social",
};

export function ProvenanceBadge({ provenanceClass }: { provenanceClass: string }) {
  const isAi = provenanceClass === "ai_generated_interpretation";
  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px]", isAi && "bg-violet-500/10 text-violet-600 dark:text-violet-400")}
      data-testid={`badge-provenance-${provenanceClass}`}
    >
      {PROVENANCE_LABELS[provenanceClass] ?? provenanceClass}
    </Badge>
  );
}

const DIRECTION_STYLES: Record<string, string> = {
  confirming: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  contradicting: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function DirectionBadge({ direction }: { direction: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] capitalize", DIRECTION_STYLES[direction] ?? DIRECTION_STYLES.neutral)}
      data-testid={`badge-direction-${direction}`}
    >
      {direction}
    </Badge>
  );
}

export function SignalCard({ signal, score }: { signal: Signal; score?: number }) {
  return (
    <div
      className="rounded-md border border-border bg-card p-3 space-y-2"
      data-testid={`card-signal-${signal.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug" data-testid={`text-signal-title-${signal.id}`}>
          {signal.title}
        </p>
        {score !== undefined && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground" data-testid={`text-signal-score-${signal.id}`}>
            {score >= 0 ? "+" : ""}
            {score.toFixed(2)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{signal.description}</p>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <VerificationTierBadge tier={signal.verificationTier} />
        <ProvenanceBadge provenanceClass={signal.provenanceClass} />
        <DirectionBadge direction={signal.direction} />
        <Badge variant="outline" className="text-[10px] font-mono">
          {signal.signalCategory}
        </Badge>
      </div>
      <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground/70">
        <span>{new Date(signal.retrievedAt).toLocaleDateString()}</span>
        <span className="font-mono">{signal.ingestionMethod}</span>
      </div>
    </div>
  );
}
