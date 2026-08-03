// Signal Feed — a scannable register, not a tile wall. One line per signal,
// grouped by the day it was retrieved, with the direction carried on a rail so
// the shape of a week reads before any of the text does.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { AppLayout } from "@/components/layout";
import { CategoryBadge, DirectionBadge, VerificationTierBadge } from "@/components/evidence-badges";
import { FilterPill, LoadingBlock, PageHeader, Panel, SectionLabel, directionRailColor, scoreToneClass } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import {
  PROVENANCE_CLASSES,
  PROVENANCE_LABELS,
  SIGNAL_CATEGORIES,
  TIER_LABELS,
  VERIFICATION_TIERS,
  activityWindow,
  fmtDateFull,
  fmtScore,
  fmtTime,
  groupByDay,
  humanize,
  withinWindow,
} from "@/lib/design";
import { computeSignalScore } from "@/lib/scoring-client";
import { cn } from "@/lib/utils";
import type { Company, Signal, Source } from "@shared/schema";

type Scored = Signal & { score: number };

const ROW_GRID = "lg:grid-cols-[70px_66px_minmax(0,1fr)_270px_74px]";

function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  testId: string;
}) {
  const active = value !== "all";
  const current = options.find((o) => o.value === value);
  return (
    <div className="flex items-center">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          data-testid={`select-${testId}`}
          className={cn(
            "h-auto w-auto gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium leading-none",
            active
              ? "border-fc-teal-line bg-fc-teal-wash text-fc-teal-deep"
              : "border-fc-rule-strong bg-fc-surface text-fc-ink-3",
            active && "rounded-r-none border-r-0"
          )}
        >
          <SelectValue placeholder={label}>{active ? `${label}: ${current?.label ?? value}` : label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && (
        <button
          type="button"
          onClick={() => onChange("all")}
          aria-label={`Clear ${label} filter`}
          data-testid={`button-clear-${testId}`}
          className="rounded-r-md border border-l-0 border-fc-teal-line bg-fc-teal-wash py-[7px] pl-1 pr-2 text-fc-teal-deep"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default function SignalFeed() {
  const now = useMemo(() => new Date(), []);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "strongest">("newest");
  const [direction, setDirection] = useState<"all" | "confirming" | "contradicting" | "neutral">("all");
  const [category, setCategory] = useState("all");
  const [provenance, setProvenance] = useState("all");
  const [tier, setTier] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [sourceId, setSourceId] = useState("all");

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: sources } = useQuery<Source[]>({ queryKey: ["/api/sources"] });

  // Direction is applied on the client so the pill counts stay accurate for
  // whatever the other filters currently select.
  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (provenance !== "all") params.set("provenanceClass", provenance);
  if (tier !== "all") params.set("verificationTier", tier);
  if (companyId !== "all") params.set("companyId", companyId);
  if (sourceId !== "all") params.set("sourceId", sourceId);

  const { data: signals, isLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals", params.toString()],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signals?${params.toString()}`);
      return res.json();
    },
  });

  const companyById = useMemo(() => new Map((companies ?? []).map((c) => [c.id, c])), [companies]);

  const scored = useMemo<Scored[]>(
    () => (signals ?? []).map((s) => ({ ...s, score: computeSignalScore(s, now) })),
    [signals, now]
  );

  const counts = useMemo(
    () => ({
      all: scored.length,
      confirming: scored.filter((s) => s.direction === "confirming").length,
      contradicting: scored.filter((s) => s.direction === "contradicting").length,
      neutral: scored.filter((s) => s.direction === "neutral").length,
    }),
    [scored]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = scored
      .filter((s) => direction === "all" || s.direction === direction)
      .filter((s) => !needle || `${s.title} ${s.description}`.toLowerCase().includes(needle));

    return [...rows].sort((a, b) => {
      if (sort === "strongest") return Math.abs(b.score) - Math.abs(a.score);
      const delta = new Date(a.retrievedAt).getTime() - new Date(b.retrievedAt).getTime();
      return sort === "oldest" ? delta : -delta;
    });
  }, [scored, direction, search, sort]);

  const grouped = useMemo(() => (sort === "strongest" ? [] : groupByDay(visible)), [visible, sort]);
  const feedWindow = useMemo(() => activityWindow(signals, 7, now), [signals, now]);
  const recentCount = useMemo(
    () => (signals ?? []).filter((s) => withinWindow(s.retrievedAt, feedWindow)).length,
    [signals, feedWindow]
  );

  const anyFilter =
    category !== "all" || provenance !== "all" || tier !== "all" || companyId !== "all" || sourceId !== "all";

  return (
    <AppLayout>
      <PageHeader
        title="Signal Feed"
        subtitle={`${scored.length} signals · ${recentCount} in the ${feedWindow.label}`}
        actions={
          <>
            <label className="relative">
              <span className="sr-only">Search signals</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fc-ink-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search titles and descriptions…"
                data-testid="input-search-signals"
                className="w-[230px] rounded-md border border-fc-rule-strong bg-fc-surface py-2 pl-8 pr-3 text-[12.5px] leading-none text-fc-ink placeholder:text-fc-ink-3 focus:border-fc-teal focus:outline-none"
              />
            </label>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger
                data-testid="select-sort"
                className="h-auto w-auto gap-1.5 rounded-md border-fc-rule-strong bg-fc-surface px-3 py-2 text-[12.5px] font-medium leading-none text-fc-ink"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="strongest">Strongest score</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <SectionLabel className="mr-0.5 tracking-[0.1em]">Direction</SectionLabel>
          <FilterPill active={direction === "all"} onClick={() => setDirection("all")} testId="filter-direction-all">
            All {counts.all}
          </FilterPill>
          <FilterPill
            active={direction === "confirming"}
            tone="confirming"
            onClick={() => setDirection("confirming")}
            testId="filter-direction-confirming"
          >
            Confirming {counts.confirming}
          </FilterPill>
          <FilterPill
            active={direction === "contradicting"}
            tone="contradicting"
            onClick={() => setDirection("contradicting")}
            testId="filter-direction-contradicting"
          >
            Contradicting {counts.contradicting}
          </FilterPill>
          <FilterPill
            active={direction === "neutral"}
            onClick={() => setDirection("neutral")}
            testId="filter-direction-neutral"
          >
            Neutral {counts.neutral}
          </FilterPill>

          <span className="mx-1 h-5 w-px bg-fc-rule" aria-hidden="true" />

          <FilterSelect
            label="Category"
            value={category}
            onChange={setCategory}
            testId="category"
            options={SIGNAL_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))}
          />
          <FilterSelect
            label="Tier"
            value={tier}
            onChange={setTier}
            testId="tier"
            options={VERIFICATION_TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
          />
          <FilterSelect
            label="Provenance"
            value={provenance}
            onChange={setProvenance}
            testId="provenance"
            options={PROVENANCE_CLASSES.map((p) => ({ value: p, label: PROVENANCE_LABELS[p] }))}
          />
          <FilterSelect
            label="Company"
            value={companyId}
            onChange={setCompanyId}
            testId="company"
            options={(companies ?? []).map((c) => ({ value: String(c.id), label: c.ticker ?? c.name }))}
          />
          <FilterSelect
            label="Source"
            value={sourceId}
            onChange={setSourceId}
            testId="source"
            options={(sources ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
          />

          {anyFilter && (
            <button
              type="button"
              onClick={() => {
                setCategory("all");
                setProvenance("all");
                setTier("all");
                setCompanyId("all");
                setSourceId("all");
              }}
              className="px-1.5 text-[11.5px] font-medium leading-none text-fc-teal hover:underline"
              data-testid="button-clear-filters"
            >
              Clear all
            </button>
          )}
        </div>
      </PageHeader>

      <div className="px-5 pb-10 pt-5 md:px-8">
        {isLoading ? (
          <LoadingBlock height={280} />
        ) : visible.length === 0 ? (
          <Panel testId="text-no-signals-filtered">
            <p className="text-[13px] leading-relaxed text-fc-ink-3">
              No signals match these filters. Widen the direction, clear a filter, or check the Research Inbox for
              anything still waiting to be classified.
            </p>
          </Panel>
        ) : sort === "strongest" ? (
          <>
            <div className="mb-3 flex items-center gap-2.5">
              <SectionLabel className="tracking-[0.11em]">Sorted by absolute score</SectionLabel>
              <span className="h-px flex-1 bg-fc-rule" />
              <span className="text-[11px] leading-none text-fc-ink-3">{visible.length} signals</span>
            </div>
            <RegisterTable rows={visible} companyById={companyById} showHeader />
          </>
        ) : (
          grouped.map((group) => (
            <div key={group.key} className="mb-6 last:mb-0">
              <div className="mb-3 flex items-center gap-2.5">
                <SectionLabel className="tracking-[0.11em]">{fmtDateFull(group.date)}</SectionLabel>
                <span className="h-px flex-1 bg-fc-rule" />
                <span className="text-[11px] leading-none text-fc-ink-3">
                  {group.items.length} {group.items.length === 1 ? "signal" : "signals"}
                </span>
              </div>
              <RegisterTable rows={group.items} companyById={companyById} showHeader={group === grouped[0]} />
            </div>
          ))
        )}
      </div>
    </AppLayout>
  );
}

function RegisterTable({
  rows,
  companyById,
  showHeader,
}: {
  rows: Scored[];
  companyById: Map<number, Company>;
  showHeader?: boolean;
}) {
  return (
    <Panel flush>
      {showHeader && (
        <div
          className={cn(
            "hidden gap-0 border-b border-fc-rule-soft bg-fc-surface-sunk px-[18px] py-2.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3 lg:grid",
            ROW_GRID
          )}
        >
          <span>Time</span>
          <span>Ticker</span>
          <span>Signal</span>
          <span>Classification</span>
          <span className="text-right">Score</span>
        </div>
      )}
      {rows.map((s, i) => {
        const company = s.companyId != null ? companyById.get(s.companyId) : undefined;
        return (
          <div
            key={s.id}
            style={{ borderLeftColor: directionRailColor(s.direction) }}
            className={cn(
              "grid grid-cols-1 items-center gap-2 border-l-[3px] px-[18px] py-3.5 lg:gap-0",
              ROW_GRID,
              i < rows.length - 1 && "border-b border-fc-rule-soft"
            )}
            data-testid={`row-signal-${s.id}`}
          >
            <span className="font-mono text-[11px] font-medium leading-none text-fc-ink-3">{fmtTime(s.retrievedAt)}</span>
            <span className="font-mono text-xs font-semibold leading-none">
              {company ? (
                <Link
                  href={`/companies/${company.id}`}
                  className="text-fc-ink hover:text-fc-teal hover:underline"
                  data-testid={`link-company-${company.id}`}
                >
                  {company.ticker ?? company.name}
                </Link>
              ) : (
                <span className="text-fc-ink-3">—</span>
              )}
            </span>
            <span className="pr-5">
              <span
                className="mb-[3px] block text-[13px] font-medium leading-[1.4] text-fc-ink"
                data-testid={`text-signal-title-${s.id}`}
              >
                {s.title}
              </span>
              {/* Clamped so a row stays one scannable line — the full text is on
                  the company page and in the evidence panels. */}
              <span className="line-clamp-2 block text-[11.5px] leading-[1.5] text-fc-ink-3">{s.description}</span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              <DirectionBadge direction={s.direction} />
              <VerificationTierBadge tier={s.verificationTier} short />
              <CategoryBadge category={s.signalCategory} />
            </span>
            <span
              className={cn("font-mono text-[13px] font-semibold leading-none lg:text-right", scoreToneClass(s.score))}
              data-testid={`text-signal-score-${s.id}`}
            >
              {fmtScore(s.score)}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}
