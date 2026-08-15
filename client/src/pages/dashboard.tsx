// Briefing — the home page's job is "what changed, what happened, what's
// projected". Verdict at the top, the week's movements in the middle, the
// deadline and the counter-evidence held permanently in view.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout";
import { ConfidenceGauge } from "@/components/confidence-gauge";
import { SignalRow } from "@/components/evidence-badges";
import {
  ActionButton,
  Chip,
  EvidenceBar,
  FilterPill,
  LoadingBlock,
  Meter,
  Panel,
  PanelHead,
  PanelTitle,
  SectionLabel,
  Stat,
} from "@/components/kit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  TIER_LABELS,
  activityWindow,
  byRetrievedDesc,
  fmtDateMedium,
  fmtRelative,
  fmtScore,
  predictionWindow,
  withinWindow,
} from "@/lib/design";
import { computeSignalScore, confidenceToGauge, toGaugeSeries, weeklyGaugeDelta } from "@/lib/scoring-client";
import { cn } from "@/lib/utils";
import type {
  Company,
  Signal,
  Source,
  Thesis,
  ThesisConfidenceHistory,
  ThesisMilestone,
} from "@shared/schema";

interface SegmentInfo {
  name: string;
  note: string;
  /** False for segments the thesis names but does not bet on. */
  isThesisLeg?: boolean;
  tickers: string[];
}

/** Milestone status decides the dot colour, so the timeline reads at a glance. */
const MILESTONE_COLORS: Record<string, string> = {
  scheduled: "var(--fc-forest-bright)",
  blocking: "var(--fc-amber)",
  closes: "var(--fc-ink-5)",
  done: "var(--fc-forest)",
};

interface EvidenceResponse {
  confirming: (Signal & { score: number })[];
  contradicting: (Signal & { score: number })[];
  neutral: (Signal & { score: number })[];
}

const TIER_ORDER = ["primary_source_confirmed", "corroborated", "single_source", "unverified"] as const;
const TIER_COLORS: Record<string, string> = {
  primary_source_confirmed: "var(--fc-forest-bright)",
  corroborated: "var(--fc-azure-bright)",
  single_source: "var(--fc-amber)",
  unverified: "var(--fc-ink-5)",
};

/** The seed notes carry an instruction to the app at the end; drop it. */
function readableNote(note: string): string {
  return note
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/^The app must/i.test(sentence.trim()))
    .join(" ")
    .trim();
}

/** Splits a sentence around a phrase so the deadline can be inked in teal. */
function highlight(text: string, phrase: string) {
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold text-fc-teal">{text.slice(at, at + phrase.length)}</strong>
      {text.slice(at + phrase.length)}
    </>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [changeFilter, setChangeFilter] = useState<"all" | "confirming" | "contradicting" | "neutral">("all");
  const now = useMemo(() => new Date(), []);

  const { data: theses, isLoading: loadingTheses } = useQuery<Thesis[]>({ queryKey: ["/api/theses"] });
  const thesis = theses?.[0];

  const { data: segmentsData } = useQuery<{ thesisTitle: string; segments: SegmentInfo[] }>({
    queryKey: ["/api/segments"],
  });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: sources } = useQuery<Source[]>({ queryKey: ["/api/sources"] });

  const { data: signals, isLoading: loadingSignals } = useQuery<Signal[]>({
    queryKey: ["/api/signals", { thesisId: thesis?.id }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signals?thesisId=${thesis!.id}`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const { data: evidence, isLoading: loadingEvidence } = useQuery<EvidenceResponse>({
    queryKey: ["/api/thesis", thesis?.id, "evidence"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/thesis/${thesis!.id}/evidence`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const { data: history } = useQuery<ThesisConfidenceHistory[]>({
    queryKey: ["/api/theses", thesis?.id, "confidence-history"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/theses/${thesis!.id}/confidence-history?limit=26`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const { data: milestones } = useQuery<ThesisMilestone[]>({
    queryKey: ["/api/theses", thesis?.id, "milestones"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/theses/${thesis!.id}/milestones`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/thesis/${thesis!.id}/recompute-score`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/theses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/thesis", thesis?.id, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/theses", thesis?.id, "confidence-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/audit"] });
      toast({ title: "Confidence score recomputed" });
    },
    onError: (err: Error) => toast({ title: "Recompute failed", description: err.message, variant: "destructive" }),
  });

  const companyById = useMemo(() => new Map((companies ?? []).map((c) => [c.id, c])), [companies]);

  const scored = useMemo(
    () => (signals ?? []).map((s) => ({ signal: s, score: computeSignalScore(s, now) })).sort((a, b) => byRetrievedDesc(a.signal, b.signal)),
    [signals, now]
  );

  const changeWindow = useMemo(() => activityWindow(signals, 7, now), [signals, now]);
  const changed = useMemo(
    () => scored.filter((s) => withinWindow(s.signal.retrievedAt, changeWindow)),
    [scored, changeWindow]
  );

  const changeCounts = useMemo(
    () => ({
      all: changed.length,
      confirming: changed.filter((s) => s.signal.direction === "confirming").length,
      contradicting: changed.filter((s) => s.signal.direction === "contradicting").length,
      neutral: changed.filter((s) => s.signal.direction === "neutral").length,
    }),
    [changed]
  );

  const visibleChanges = useMemo(
    () => (changeFilter === "all" ? changed : changed.filter((s) => s.signal.direction === changeFilter)).slice(0, 6),
    [changed, changeFilter]
  );

  const series = useMemo(() => toGaugeSeries(history, 8), [history]);
  const gauge = thesis?.confidenceScore != null ? confidenceToGauge(thesis.confidenceScore) : 0;
  const delta = useMemo(() => weeklyGaugeDelta(series, now), [series, now]);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of signals ?? []) counts[s.verificationTier] = (counts[s.verificationTier] ?? 0) + 1;
    return counts;
  }, [signals]);

  // Coverage counts thesis legs only — the context segments the narrative names
  // are tracked but never scored.
  const segments = useMemo(
    () => (segmentsData?.segments ?? []).filter((seg) => seg.isThesisLeg !== false),
    [segmentsData]
  );
  const coveredSegments = segments.filter((seg) => seg.tickers.length > 0).length;
  const againstCount = evidence?.contradicting.length ?? 0;

  const predWindow = useMemo(() => predictionWindow(thesis, now), [thesis, now]);
  const wave = /\bwave\s*(\d+)\b/i.exec(`${thesis?.title ?? ""} ${thesis?.summary ?? ""}`);

  const lastSync = useMemo(() => {
    const stamps = (sources ?? []).map((s) => s.lastSyncedAt).filter(Boolean) as string[];
    if (!stamps.length) return null;
    return stamps.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  }, [sources]);

  const segmentStats = useMemo(() => {
    return segments.map((seg) => {
      const members = (companies ?? []).filter((c) => seg.tickers.includes(c.ticker ?? ""));
      const memberIds = new Set(members.map((c) => c.id));
      const own = scored.filter((s) => s.signal.companyId != null && memberIds.has(s.signal.companyId));
      return {
        seg,
        members,
        forCount: own.filter((s) => s.signal.direction === "confirming").length,
        neutralCount: own.filter((s) => s.signal.direction === "neutral").length,
        againstCount: own.filter((s) => s.signal.direction === "contradicting").length,
      };
    });
  }, [segments, companies, scored]);

  return (
    <AppLayout>
      <PageHeaderBriefing
        now={now}
        windowLabel={changeWindow.label}
        changedCount={changed.length}
        lastSync={lastSync}
        onRecompute={() => recompute.mutate()}
        recomputing={recompute.isPending}
        disabled={!thesis}
      />

      <div className="flex flex-col gap-5 px-5 pb-10 pt-6 md:px-8">
        {/* ── Verdict ──────────────────────────────────────────────── */}
        {loadingTheses ? (
          <LoadingBlock height={260} />
        ) : !thesis ? (
          <Panel testId="panel-no-thesis">
            <p className="text-[13px] text-fc-ink-3">No thesis found. Seed data may not have loaded.</p>
          </Panel>
        ) : (
          <div className="grid gap-9 rounded-xl bg-fc-paper-sunk p-7 lg:grid-cols-[1fr_380px]">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                <SectionLabel className="text-fc-teal">Active thesis</SectionLabel>
                {wave && (
                  <span className="rounded bg-fc-teal-wash px-[7px] py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-teal">
                    Wave {wave[1]}
                  </span>
                )}
                <span className="rounded bg-fc-chip px-[7px] py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3">
                  {thesis.status}
                </span>
              </div>
              <h2
                className="max-w-[600px] text-pretty font-display text-[27px] font-semibold leading-[1.24] tracking-[-0.02em] text-fc-ink"
                data-testid="text-thesis-title"
              >
                {thesis.title}
              </h2>
              <p className="mt-3.5 max-w-[620px] text-pretty text-[13.5px] leading-[1.65] text-fc-ink-3">
                {thesis.summary}
              </p>
              <div className="mt-5 flex flex-wrap gap-x-7 gap-y-4 border-t border-fc-rule pt-5">
                <Stat label="Evidence" value={signals?.length ?? 0} sub="signals" testId="stat-evidence-count" />
                <Stat
                  label="Against"
                  value={againstCount}
                  sub="contradicting"
                  valueClassName={againstCount > 0 ? "text-fc-oxide" : undefined}
                  testId="stat-against-count"
                />
                <Stat
                  label="Coverage"
                  value={
                    <>
                      {coveredSegments}
                      <span className="text-fc-ink-3">/{segments.length}</span>
                    </>
                  }
                  sub="segments"
                  testId="stat-coverage"
                />
                <div>
                  <SectionLabel className="mb-1.5">{thesis.author ? "Author" : "Recomputed"}</SectionLabel>
                  <div className="pt-0.5 text-sm font-medium leading-snug text-fc-ink-2">
                    {thesis.author ?? fmtRelative(thesis.updatedAt, now)}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-fc-rule bg-fc-chip p-5">
              <ConfidenceGauge gauge={gauge} delta={delta} series={series} />
            </div>
          </div>
        )}

        {/* ── What changed / prediction / evidence quality ──────────── */}
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_344px]">
          <Panel flush testId="panel-what-changed">
            <PanelHead>
              <PanelTitle>What changed</PanelTitle>
              <span className="text-[11px] font-medium leading-none text-fc-ink-3">{changeWindow.label}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <FilterPill
                  active={changeFilter === "all"}
                  onClick={() => setChangeFilter("all")}
                  testId="filter-changed-all"
                >
                  All {changeCounts.all}
                </FilterPill>
                <FilterPill
                  active={changeFilter === "confirming"}
                  tone="confirming"
                  onClick={() => setChangeFilter("confirming")}
                  testId="filter-changed-confirming"
                >
                  For {changeCounts.confirming}
                </FilterPill>
                <FilterPill
                  active={changeFilter === "contradicting"}
                  tone="contradicting"
                  onClick={() => setChangeFilter("contradicting")}
                  testId="filter-changed-contradicting"
                >
                  Against {changeCounts.contradicting}
                </FilterPill>
                <FilterPill
                  active={changeFilter === "neutral"}
                  onClick={() => setChangeFilter("neutral")}
                  testId="filter-changed-neutral"
                >
                  Neutral {changeCounts.neutral}
                </FilterPill>
              </div>
            </PanelHead>

            {loadingSignals ? (
              <div className="p-5">
                <LoadingBlock height={200} className="border-0" />
              </div>
            ) : visibleChanges.length === 0 ? (
              <p className="px-5 py-8 text-[13px] leading-relaxed text-fc-ink-3" data-testid="text-no-changes">
                Nothing in this window matches that filter. The register in the Signal Feed holds the full record.
              </p>
            ) : (
              visibleChanges.map((s, i) => (
                <SignalRow
                  key={s.signal.id}
                  signal={s.signal}
                  score={s.score}
                  ticker={s.signal.companyId ? companyById.get(s.signal.companyId)?.ticker : undefined}
                  last={i === visibleChanges.length - 1}
                />
              ))
            )}

            <Link
              href="/signals"
              className="block border-t border-fc-rule-soft bg-fc-surface-sunk px-5 py-3.5 text-xs font-medium text-fc-teal hover:underline"
              data-testid="link-view-all-signals"
            >
              See all {signals?.length ?? 0} signals in the feed →
            </Link>
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel testId="panel-prediction">
              <SectionLabel className="mb-3">The prediction</SectionLabel>
              <p className="text-pretty text-[13.5px] font-medium leading-[1.55] text-fc-ink">
                {thesis?.prediction
                  ? predWindow
                    ? highlight(thesis.prediction, predWindow.phrase)
                    : thesis.prediction
                  : "—"}
              </p>

              {predWindow ? (
                <>
                  <div className="mt-[18px] flex items-baseline gap-2">
                    <span
                      className="font-mono text-[34px] font-semibold leading-none tracking-[-0.02em] text-fc-ink"
                      data-testid="text-days-left"
                    >
                      {predWindow.daysLeft}
                    </span>
                    <span className="text-[12.5px] leading-none text-fc-ink-3">
                      {predWindow.hasClosed ? "days since the window closed" : "days left in the window"}
                    </span>
                  </div>
                  <Meter
                    value={predWindow.progress}
                    color="var(--fc-teal)"
                    className="mt-3.5 bg-fc-rule-soft"
                    ariaLabel="Progress through the prediction window"
                  />
                  <div className="mt-[7px] flex justify-between font-mono text-[10px] leading-none text-fc-ink-3">
                    <span>{fmtDateMedium(predWindow.start).toUpperCase()}</span>
                    <span className="text-fc-teal">
                      {predWindow.hasOpened ? `DAY ${predWindow.dayNumber}` : "NOT OPEN"}
                    </span>
                    <span>{fmtDateMedium(predWindow.end).toUpperCase()}</span>
                  </div>

                  <div className="mt-4 flex flex-col gap-2.5 border-t border-fc-rule-soft pt-3.5">
                    <Milestone
                      color="var(--fc-forest-bright)"
                      title="Evidence collected inside the window"
                      detail={`${
                        (signals ?? []).filter((s) => new Date(s.retrievedAt) >= predWindow.start).length
                      } of ${signals?.length ?? 0} signals retrieved since ${fmtDateMedium(predWindow.start)}`}
                    />
                    {(milestones ?? []).map((m) => (
                      <Milestone
                        key={m.id}
                        color={MILESTONE_COLORS[m.status] ?? "var(--fc-ink-5)"}
                        title={m.title}
                        detail={m.dueDate ? `${fmtDateMedium(m.dueDate)} · ${m.detail}` : m.detail}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-4 border-t border-fc-rule-soft pt-3.5 text-[11px] leading-[1.55] text-fc-ink-3">
                  No prediction window is set on this thesis, so there is no countdown to run against it.
                </p>
              )}
            </Panel>

            <Panel testId="panel-evidence-quality">
              <div className="mb-3.5 flex items-baseline justify-between gap-3">
                <SectionLabel>Evidence quality</SectionLabel>
                <span className="text-[11px] font-medium leading-none text-fc-ink-3">
                  {signals?.length ?? 0} signals
                </span>
              </div>
              <div className="mb-3 flex h-[9px] overflow-hidden rounded-full" role="img" aria-label="Verification tier mix">
                {TIER_ORDER.map((tier) => {
                  const pct = signals?.length ? ((tierCounts[tier] ?? 0) / signals.length) * 100 : 0;
                  if (pct === 0) return null;
                  return <div key={tier} style={{ width: `${pct}%`, background: TIER_COLORS[tier] }} />;
                })}
                {!signals?.length && <div className="w-full bg-fc-rule-soft" />}
              </div>
              <div className="flex flex-col gap-2">
                {TIER_ORDER.map((tier) => (
                  <div key={tier} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-sm" style={{ background: TIER_COLORS[tier] }} />
                    <span className="flex-1 text-xs leading-none text-fc-ink-3">{TIER_LABELS[tier]}</span>
                    <span className="font-mono text-xs font-semibold leading-none">{tierCounts[tier] ?? 0}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        {/* ── Counter-evidence. No close, no collapse, no filter. ───── */}
        <Panel tone="alert" flush testId="panel-contradicting-evidence">
          <PanelHead tone="alert">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-fc-oxide-bright font-display text-xs font-bold leading-none text-fc-oxide-bright"
              aria-hidden="true"
            >
              !
            </span>
            <div>
              <div className="font-display text-[13.5px] font-semibold leading-tight text-fc-oxide">
                Strongest counter-evidence
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-fc-ink-3">
                Cannot be dismissed, collapsed, or filtered out. Sorted strongest first.
              </p>
            </div>
            <Chip tone="contradicting" size="lead" className="ml-auto">
              Permanent panel
            </Chip>
          </PanelHead>

          {loadingEvidence ? (
            <div className="p-5">
              <LoadingBlock height={110} className="border-0" />
            </div>
          ) : againstCount === 0 ? (
            <p className="px-5 py-6 text-[13px] leading-relaxed text-fc-oxide" data-testid="text-no-contradicting-evidence">
              No contradicting evidence has been recorded yet. That is a gap in the search, not a clean bill of health.
            </p>
          ) : (
            <div className="grid md:grid-cols-3">
              {evidence!.contradicting.slice(0, 3).map((s, i) => (
                <div
                  key={s.id}
                  className={cn("px-5 py-[18px]", i < 2 && "border-b border-fc-oxide-panel-line md:border-b-0 md:border-r")}
                  data-testid={`card-counter-evidence-${s.id}`}
                >
                  <div className="mb-[7px] flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-fc-ink">
                      {s.companyId ? companyById.get(s.companyId)?.ticker ?? "—" : "THESIS"}
                    </span>
                    <span className="font-mono text-[13px] font-semibold leading-none text-fc-oxide-bright">
                      {fmtScore(s.score)}
                    </span>
                  </div>
                  <div className="mb-1.5 text-pretty font-display text-[13px] font-semibold leading-[1.4] text-fc-ink">
                    {s.title}
                  </div>
                  <p className="text-pretty text-xs leading-[1.6] text-fc-ink-3">{s.description}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ── Segment strength ─────────────────────────────────────── */}
        <div>
          <div className="mb-3 flex flex-wrap items-baseline gap-3">
            <PanelTitle>Segment strength</PanelTitle>
            <span className="text-[11.5px] leading-none text-fc-ink-3">evidence balance per leg of the thesis</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {segmentStats.map(({ seg, members, forCount, neutralCount, againstCount: against }) => {
              const isGap = members.length === 0;
              return (
                <Panel
                  key={seg.name}
                  tone={isGap ? "gap" : "plain"}
                  className="p-[18px]"
                  testId={`card-segment-${seg.name.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <div className="mb-0.5 flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "font-display text-[13.5px] font-semibold leading-none",
                        isGap ? "text-fc-ochre-deep" : "text-fc-ink"
                      )}
                    >
                      {seg.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs font-semibold leading-none",
                        isGap ? "text-fc-ochre" : "text-fc-ink-3"
                      )}
                    >
                      {members.length} {members.length === 1 ? "name" : "names"}
                    </span>
                  </div>
                  <div className={cn("mb-3.5 text-[11.5px] leading-[1.5]", isGap ? "text-fc-ochre" : "text-fc-ink-3")}>
                    {isGap ? "the core unproven bet" : members.map((c) => c.ticker).join(" · ")}
                  </div>
                  <EvidenceBar
                    forCount={forCount}
                    neutralCount={neutralCount}
                    againstCount={against}
                    showCounts
                    className="mb-2.5"
                    testId={`bar-segment-${seg.name.replace(/\s+/g, "-").toLowerCase()}`}
                  />
                  <p
                    className={cn(
                      "text-pretty text-[11.5px] leading-[1.55]",
                      isGap ? "text-fc-ochre-deep" : "text-fc-ink-3"
                    )}
                  >
                    {readableNote(seg.note)}
                  </p>
                </Panel>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function Milestone({ color, title, detail }: { color: string; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
      <div>
        <div className="text-xs font-medium leading-snug text-fc-ink">{title}</div>
        <div className="text-[11px] leading-snug text-fc-ink-3">{detail}</div>
      </div>
    </div>
  );
}

function PageHeaderBriefing({
  now,
  windowLabel,
  changedCount,
  lastSync,
  onRecompute,
  recomputing,
  disabled,
}: {
  now: Date;
  windowLabel: string;
  changedCount: number;
  lastSync: string | null;
  onRecompute: () => void;
  recomputing: boolean;
  disabled: boolean;
}) {
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  return (
    <header className="border-b border-fc-rule bg-fc-surface px-5 py-4 md:px-8">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="font-display text-[15px] font-semibold leading-tight text-fc-ink" data-testid="text-page-title">
            {weekday} briefing
          </h1>
          <p className="mt-0.5 text-xs leading-snug text-fc-ink-3">
            {fmtDateMedium(now)} · {changedCount} {changedCount === 1 ? "signal" : "signals"} in the {windowLabel}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <div
            className="flex items-center gap-[7px] rounded-full border border-fc-rule bg-fc-chip px-2.5 py-1.5"
            data-testid="pill-sync-status"
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", lastSync ? "bg-fc-forest-bright" : "bg-fc-ink-4")}
              aria-hidden="true"
            />
            <span className="text-[11.5px] font-medium leading-none text-fc-ink-3">
              {lastSync ? `Sources synced ${fmtRelative(lastSync, now)}` : "No source sync recorded"}
            </span>
          </div>
          <ActionButton tone="primary" onClick={onRecompute} disabled={disabled || recomputing} testId="button-recompute-score">
            <RefreshCw className={cn("h-3.5 w-3.5", recomputing && "animate-spin")} />
            Recompute confidence
          </ActionButton>
        </div>
      </div>
    </header>
  );
}
