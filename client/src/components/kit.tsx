// Forward Capital — the small set of primitives every redesigned page is built
// from. Hairline rules rather than heavy card borders, one deepened teal used
// sparingly, and monospaced numerals so figures line up down a column.

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { balanceSplit } from "@/lib/design";

// ── Tone ─────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "confirming" | "contradicting" | "teal" | "ochre" | "azure" | "iris";

const CHIP_TONES: Record<Tone, string> = {
  neutral: "bg-fc-chip text-fc-ink-3 border-fc-rule",
  confirming: "bg-fc-forest-wash text-fc-forest border-fc-forest-line",
  contradicting: "bg-fc-oxide-wash text-fc-oxide border-fc-oxide-line",
  teal: "bg-fc-teal-wash text-fc-teal-deep border-fc-teal-line",
  ochre: "bg-fc-ochre-wash text-fc-ochre-deep border-fc-ochre-line",
  azure: "bg-fc-azure-wash text-fc-azure border-fc-azure-line",
  iris: "bg-fc-iris-wash text-fc-iris border-fc-iris-line",
};

export function directionTone(direction: string): Tone {
  if (direction === "confirming") return "confirming";
  if (direction === "contradicting") return "contradicting";
  return "neutral";
}

/** The 3px rail colour that runs down the side of a feed row. */
export function directionRailColor(direction: string): string {
  if (direction === "confirming") return "var(--fc-forest-bright)";
  if (direction === "contradicting") return "var(--fc-oxide-bright)";
  return "var(--fc-ink-4)";
}

/** Signed scores are inked forest / oxide, zero stays muted. */
export function scoreToneClass(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score) || Math.abs(score) < 0.005) return "text-fc-ink-3";
  return score > 0 ? "text-fc-forest-bright" : "text-fc-oxide-bright";
}

// ── Chips ────────────────────────────────────────────────────────────────

export function Chip({
  tone = "neutral",
  size = "meta",
  mono = false,
  className,
  children,
  testId,
}: {
  tone?: Tone;
  /** `lead` is the classification that matters; `meta` is supporting detail. */
  size?: "lead" | "meta";
  mono?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex shrink-0 items-center rounded border leading-none",
        size === "lead" ? "px-[7px] py-1 text-[10.5px] font-semibold" : "px-1.5 py-1 text-[10px] font-medium",
        mono && "font-mono",
        CHIP_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ── Labels and headings ──────────────────────────────────────────────────

/** The uppercase micro-label that titles a block without shouting. */
export function SectionLabel({
  className,
  children,
  testId,
}: {
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn("text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-fc-ink-3", className)}
    >
      {children}
    </div>
  );
}

/** Heading for a panel — Libre Franklin, semibold, small. */
export function PanelTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("font-display text-[13.5px] font-semibold leading-none text-fc-ink", className)}>{children}</span>;
}

// ── Panels ───────────────────────────────────────────────────────────────

export function Panel({
  tone = "plain",
  flush = false,
  className,
  style,
  children,
  testId,
}: {
  /** `alert` is the counter-evidence treatment; `gap` marks a research gap. */
  tone?: "plain" | "alert" | "gap" | "sunk" | "teal";
  /** Set when children own their own padding (tables, row lists). */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  testId?: string;
}) {
  const tones: Record<string, string> = {
    plain: "bg-fc-surface border border-fc-rule",
    alert: "bg-fc-surface border border-fc-oxide-border",
    gap: "bg-fc-ochre-panel border-[1.5px] border-dashed border-fc-ochre",
    sunk: "bg-fc-paper-sunk border border-transparent",
    teal: "bg-fc-teal-panel border border-transparent",
  };
  return (
    <div
      data-testid={testId}
      style={style}
      className={cn("rounded-lg", tones[tone], flush ? "overflow-hidden" : "p-5", className)}
    >
      {children}
    </div>
  );
}

/** Header strip inside a flush Panel, separated by a hairline. */
export function PanelHead({
  tone = "plain",
  className,
  children,
}: {
  tone?: "plain" | "alert";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-5 py-4",
        tone === "alert" ? "border-fc-oxide-panel-line bg-fc-oxide-panel" : "border-fc-rule-soft",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The tinted column-header row above a table body. */
export function TableHeadRow({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={style}
      className={cn(
        "border-b border-fc-rule-soft bg-fc-surface-sunk px-5 py-2.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3",
        className
      )}
    >
      {children}
    </div>
  );
}

// ── Page chrome ──────────────────────────────────────────────────────────

/** The white bar at the top of every page: what this is, and what you can do. */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
  testId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Filter rows and other controls that sit under the title line. */
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <header
      data-testid={testId}
      className="border-b border-fc-rule bg-fc-surface px-5 py-4 md:px-8"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[15px] font-semibold leading-tight text-fc-ink" data-testid="text-page-title">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-xs leading-snug text-fc-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </header>
  );
}

/** Standard page body padding, matching the design's 26px / 32px rhythm. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-5 px-5 pb-10 pt-6 md:px-8", className)}>{children}</div>;
}

// ── Buttons ──────────────────────────────────────────────────────────────

const BUTTON_TONES = {
  primary: "bg-fc-teal text-white font-display font-semibold border border-transparent",
  outline: "bg-fc-surface text-fc-ink border border-fc-rule-strong font-medium",
  ochre: "bg-fc-ochre-deep text-white font-display font-semibold border border-transparent",
  "ochre-outline": "bg-transparent text-fc-ochre-deep border border-fc-ochre font-medium",
  quiet: "bg-transparent text-fc-ink-3 border border-fc-rule-strong font-medium",
} as const;

export type ButtonTone = keyof typeof BUTTON_TONES;

export function ActionButton({
  tone = "outline",
  type = "button",
  className,
  disabled,
  onClick,
  children,
  testId,
}: {
  tone?: ButtonTone;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-[12.5px] leading-none transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_TONES[tone],
        className
      )}
    >
      {children}
    </button>
  );
}

/** Filter pill — selected is inked, unselected is a hairline outline. */
export function FilterPill({
  active,
  tone = "neutral",
  onClick,
  className,
  children,
  testId,
}: {
  active?: boolean;
  tone?: Tone;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const inactiveText: Record<Tone, string> = {
    neutral: "text-fc-ink-3",
    confirming: "text-fc-forest",
    contradicting: "text-fc-oxide",
    teal: "text-fc-teal-deep",
    ochre: "text-fc-ochre-deep",
    azure: "text-fc-azure",
    iris: "text-fc-iris",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={!!active}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-[11.5px] font-medium leading-none transition-colors",
        active
          ? "bg-fc-ink text-fc-paper"
          : cn("border border-fc-rule-strong bg-fc-surface hover:bg-fc-chip", inactiveText[tone]),
        className
      )}
    >
      {children}
    </button>
  );
}

// ── Figures ──────────────────────────────────────────────────────────────

/** Micro-label above a monospaced figure — the unit of the stat rows. */
export function Stat({
  label,
  value,
  sub,
  valueClassName,
  className,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={className} data-testid={testId}>
      <SectionLabel className="mb-1.5">{label}</SectionLabel>
      <div className={cn("font-mono text-[19px] font-semibold leading-none text-fc-ink", valueClassName)}>
        {value}
        {sub && <span className="ml-1.5 font-sans text-xs font-normal text-fc-ink-2">{sub}</span>}
      </div>
    </div>
  );
}

/** Segmented for / neutral / against bar. Counts sit inside when there's room. */
export function EvidenceBar({
  forCount,
  neutralCount,
  againstCount,
  height = 26,
  showCounts = false,
  className,
  testId,
}: {
  forCount: number;
  neutralCount: number;
  againstCount: number;
  height?: number;
  showCounts?: boolean;
  className?: string;
  testId?: string;
}) {
  const split = balanceSplit(forCount, neutralCount, againstCount);
  const label = `${forCount} confirming, ${neutralCount} neutral, ${againstCount} contradicting`;

  if (split.total === 0) {
    return (
      <div
        data-testid={testId}
        role="img"
        aria-label="No evidence either way"
        style={{ height }}
        className={cn(
          "flex items-center justify-center rounded-md border-[1.5px] border-dashed border-fc-ochre text-[10px] font-semibold uppercase tracking-[0.11em] text-fc-ochre-deep",
          className
        )}
      >
        No evidence either way
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      role="img"
      aria-label={label}
      style={{ height }}
      className={cn("flex overflow-hidden rounded-md", height <= 10 && "rounded-full", className)}
    >
      {split.for > 0 && (
        <div
          style={{ width: `${split.for}%` }}
          className="flex items-center bg-fc-forest-bright pl-2 font-mono text-[11px] font-semibold text-white"
        >
          {showCounts && split.for >= 14 ? forCount : null}
        </div>
      )}
      {split.neutral > 0 && <div style={{ width: `${split.neutral}%` }} className="bg-fc-chip" />}
      {split.against > 0 && (
        <div
          style={{ width: `${split.against}%` }}
          className="flex items-center justify-end bg-fc-oxide-bright pr-2 font-mono text-[11px] font-semibold text-white"
        >
          {showCounts && split.against >= 14 ? againstCount : null}
        </div>
      )}
    </div>
  );
}

/** Single-value progress rail — reliability weights, window progress. */
export function Meter({
  value,
  color = "var(--fc-forest-bright)",
  height = 8,
  className,
  ariaLabel,
  testId,
}: {
  /** 0..1 */
  value: number;
  color?: string;
  height?: number;
  className?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div
      data-testid={testId}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={{ height }}
      className={cn("overflow-hidden rounded-full bg-fc-rule-soft", className)}
    >
      <div style={{ width: `${pct}%`, background: color, height: "100%" }} />
    </div>
  );
}

/** Trend line for the confidence series. Zero sits on the dashed baseline. */
export function Sparkline({
  points,
  min,
  max,
  color = "var(--fc-forest)",
  height = 62,
  baseline = 0,
  className,
  testId,
}: {
  points: number[];
  min?: number;
  max?: number;
  color?: string;
  height?: number;
  baseline?: number;
  className?: string;
  testId?: string;
}) {
  if (points.length < 2) return null;

  const lo = min ?? Math.min(...points, baseline);
  const hi = max ?? Math.max(...points, baseline);
  const span = hi - lo || 1;
  const w = 320;
  const pad = 6;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);

  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      data-testid={testId}
      viewBox={`0 0 ${w} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cn("block", className)}
      aria-hidden="true"
    >
      <line
        x1="0"
        y1={y(baseline)}
        x2={w}
        y2={y(baseline)}
        stroke="var(--fc-ink-5)"
        strokeWidth="1"
        strokeDasharray="3 4"
      />
      <polyline points={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="4" fill={color} />
    </svg>
  );
}

// ── States ───────────────────────────────────────────────────────────────

export function LoadingBlock({ height = 120, className }: { height?: number; className?: string }) {
  return (
    <div
      style={{ height }}
      className={cn("animate-pulse rounded-lg border border-fc-rule bg-fc-surface", className)}
      data-testid="block-loading"
    />
  );
}

export function EmptyNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="px-5 py-6 text-[13px] leading-relaxed text-fc-ink-3" data-testid={testId}>
      {children}
    </p>
  );
}
