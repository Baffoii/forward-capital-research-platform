// Thesis Workspace — the balance beam. Every assumption the thesis rests on,
// weighed against the evidence that actually exists for it, with the
// counter-evidence given equal width and no way to close it.

import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout";
import { EvidenceItem } from "@/components/evidence-badges";
import {
  ActionButton,
  Chip,
  EvidenceBar,
  LoadingBlock,
  PageBody,
  PageHeader,
  Panel,
  PanelHead,
  PanelTitle,
  SectionLabel,
} from "@/components/kit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtRelative } from "@/lib/design";
import { cn } from "@/lib/utils";
import type { Signal, Thesis, ThesisAssumption, ThesisFalsifier } from "@shared/schema";

interface EvidenceResponse {
  confirming: (Signal & { score: number })[];
  contradicting: (Signal & { score: number })[];
  neutral: (Signal & { score: number })[];
}

// ── Assumption → evidence ────────────────────────────────────────────────
//
// thesis_assumptions.signal_categories records which signal categories can
// supply evidence for each assumption. NULL means it is not tracked by
// category, and the ledger says so instead of reporting a misleading zero; an
// empty array means it IS tracked but no category exists to hold it yet, which
// is a real finding and shows as zero.

function trackedCategories(assumption: ThesisAssumption): string[] | null {
  if (!assumption.signalCategories) return null;
  try {
    const parsed = JSON.parse(assumption.signalCategories);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : null;
  } catch {
    return null;
  }
}

function signalsFor(categories: string[] | null, signals: Signal[]): Signal[] | null {
  if (categories === null) return null;
  return signals.filter((s) => categories.includes(s.signalCategory));
}

const IMPORTANCE_TONE = { high: "contradicting", medium: "ochre", low: "neutral" } as const;

// Written out in full rather than composed at runtime — Tailwind only emits
// classes it can find as literal strings.
const LEDGER_GRID = "md:grid-cols-[minmax(0,1fr)_110px_180px_80px]";

export default function ThesisWorkspace() {
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);

  const { data: theses, isLoading: loadingTheses } = useQuery<Thesis[]>({ queryKey: ["/api/theses"] });
  const thesis = theses?.[0];

  const { data: assumptions, isLoading: loadingAssumptions } = useQuery<ThesisAssumption[]>({
    queryKey: ["/api/theses", thesis?.id, "assumptions"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/theses/${thesis!.id}/assumptions`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const { data: falsifiers, isLoading: loadingFalsifiers } = useQuery<ThesisFalsifier[]>({
    queryKey: ["/api/theses", thesis?.id, "falsifiers"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/theses/${thesis!.id}/falsifiers`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const { data: signals } = useQuery<Signal[]>({
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

  const recompute = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/thesis/${thesis!.id}/recompute-score`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/theses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/thesis", thesis?.id, "evidence"] });
      toast({ title: "Confidence score recomputed" });
    },
    onError: (err: Error) => toast({ title: "Recompute failed", description: err.message, variant: "destructive" }),
  });

  const ledger = useMemo(() => {
    const all = signals ?? [];
    return (assumptions ?? []).map((assumption) => {
      const matched = signalsFor(trackedCategories(assumption), all);
      return {
        assumption,
        tracked: matched != null,
        forCount: matched?.filter((s) => s.direction === "confirming").length ?? 0,
        neutralCount: matched?.filter((s) => s.direction === "neutral").length ?? 0,
        againstCount: matched?.filter((s) => s.direction === "contradicting").length ?? 0,
        total: matched?.length ?? 0,
      };
    });
  }, [assumptions, signals]);

  // "Unsupported" means tracked-but-empty. An untracked assumption is a
  // different problem and isn't counted as one.
  const unsupported = ledger.filter((row) => row.tracked && row.total === 0).length;

  const wave = /\bwave\s*(\d+)\b/i.exec(`${thesis?.title ?? ""} ${thesis?.summary ?? ""}`);

  return (
    <AppLayout>
      <PageHeader
        title="Thesis Workspace"
        subtitle={
          thesis
            ? `${wave ? `Wave ${wave[1]} · ` : ""}${thesis.status} · last recomputed ${fmtRelative(thesis.updatedAt, now)}`
            : "No active thesis"
        }
        actions={
          <ActionButton
            tone="primary"
            onClick={() => recompute.mutate()}
            disabled={!thesis || recompute.isPending}
            testId="button-recompute-score"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", recompute.isPending && "animate-spin")} />
            Recompute confidence
          </ActionButton>
        }
      />

      <PageBody>
        {loadingTheses ? (
          <LoadingBlock height={220} />
        ) : !thesis ? (
          <Panel testId="text-no-thesis">
            <p className="text-[13px] text-fc-ink-3">No thesis found. Seed data may not have loaded.</p>
          </Panel>
        ) : (
          <>
            {/* ── Summary, prediction, falsification ───────────────── */}
            <Panel className="p-6" testId="card-thesis-detail">
              <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
                <div>
                  <SectionLabel className="mb-2.5">Summary</SectionLabel>
                  <p className="text-pretty text-[13.5px] leading-[1.7] text-fc-ink-2" data-testid="text-thesis-summary">
                    {thesis.summary}
                  </p>
                  <div className="mt-5 rounded-lg border border-fc-teal-line bg-fc-teal-wash px-[18px] py-4">
                    <SectionLabel className="mb-2 text-fc-teal">Falsifiable prediction</SectionLabel>
                    <p
                      className="text-pretty text-sm font-medium leading-[1.6] text-fc-teal-deep"
                      data-testid="text-thesis-prediction"
                    >
                      {thesis.prediction}
                    </p>
                  </div>
                </div>

                <div className="lg:border-l lg:border-fc-rule-soft lg:pl-7">
                  <SectionLabel className="mb-3.5">What would prove this wrong</SectionLabel>
                  {loadingFalsifiers ? (
                    <LoadingBlock height={120} className="border-0 bg-fc-chip" />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {(falsifiers ?? []).map((f, i) => (
                        <div key={f.id} className="flex gap-2.5" data-testid={`text-falsifier-${f.id}`}>
                          <span className="shrink-0 font-mono text-[11px] font-semibold leading-[1.5] text-fc-oxide-bright">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <p className="text-pretty text-[12.5px] leading-[1.55] text-fc-ink-2">{f.text}</p>
                        </div>
                      ))}
                      {(falsifiers ?? []).length === 0 && (
                        <p className="text-[12.5px] leading-relaxed text-fc-ink-3">
                          No falsification conditions recorded. A thesis with nothing that could disprove it is not a
                          testable one.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            {/* ── Assumption ledger ────────────────────────────────── */}
            <Panel flush testId="panel-assumption-ledger">
              <PanelHead className="flex-wrap">
                <PanelTitle>Assumption ledger</PanelTitle>
                <span className="text-[11.5px] leading-none text-fc-ink-3">
                  each assumption the thesis rests on, and how much evidence it actually has
                </span>
                <span className="ml-auto font-mono text-[11px] font-medium leading-none text-fc-ink-3">
                  {ledger.length} assumptions · {unsupported} unsupported
                </span>
              </PanelHead>

              <div className={cn("hidden gap-0 border-b border-fc-rule-soft bg-fc-surface-sunk px-5 py-2.5 md:grid", LEDGER_GRID)}>
                <span className="text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3">
                  Assumption
                </span>
                <span className="text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3">
                  Importance
                </span>
                <span className="text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3">
                  Evidence balance
                </span>
                <span className="text-right text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3">
                  Signals
                </span>
              </div>

              {loadingAssumptions ? (
                <div className="p-5">
                  <LoadingBlock height={160} className="border-0" />
                </div>
              ) : ledger.length === 0 ? (
                <p className="px-5 py-6 text-[13px] text-fc-ink-3">No assumptions recorded for this thesis.</p>
              ) : (
                ledger.map((row, i) => (
                  <div
                    key={row.assumption.id}
                    className={cn(
                      "grid grid-cols-1 items-center gap-2 px-5 py-4 md:gap-0",
                      LEDGER_GRID,
                      i < ledger.length - 1 && "border-b border-fc-rule-soft"
                    )}
                    data-testid={`row-assumption-${row.assumption.id}`}
                  >
                    <span className="text-pretty pr-6 text-[13px] leading-[1.5] text-fc-ink">
                      {row.assumption.text}
                    </span>
                    <span className="justify-self-start">
                      <Chip
                        tone={IMPORTANCE_TONE[row.assumption.importance as keyof typeof IMPORTANCE_TONE] ?? "neutral"}
                        size="lead"
                        className="capitalize"
                      >
                        {row.assumption.importance}
                      </Chip>
                    </span>
                    <span className="pr-6">
                      {row.tracked ? (
                        row.total === 0 ? (
                          <span className="block h-2 rounded-full bg-fc-rule-soft" aria-label="No evidence recorded" />
                        ) : (
                          <EvidenceBar
                            forCount={row.forCount}
                            neutralCount={row.neutralCount}
                            againstCount={row.againstCount}
                            height={8}
                          />
                        )
                      ) : (
                        <span className="text-[11px] leading-none text-fc-ink-3">not category-tracked</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[13px] font-semibold leading-none md:text-right",
                        !row.tracked ? "text-fc-ink-3" : row.total === 0 ? "text-fc-ochre" : "text-fc-ink"
                      )}
                    >
                      {row.tracked ? row.total : "—"}
                    </span>
                  </div>
                ))
              )}
            </Panel>

            {/* ── The two sides, given equal width ─────────────────── */}
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Panel tone="alert" flush testId="panel-contradicting-evidence">
                <PanelHead tone="alert">
                  <span
                    className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 border-fc-oxide-bright font-display text-[11px] font-bold leading-none text-fc-oxide-bright"
                    aria-hidden="true"
                  >
                    !
                  </span>
                  <span className="font-display text-[13px] font-semibold leading-none text-fc-oxide">
                    Evidence against — {evidence?.contradicting.length ?? 0} signals
                  </span>
                  <span className="ml-auto text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-oxide">
                    Non-dismissible
                  </span>
                </PanelHead>
                {loadingEvidence ? (
                  <div className="p-5">
                    <LoadingBlock height={140} className="border-0" />
                  </div>
                ) : evidence?.contradicting.length ? (
                  evidence.contradicting
                    .slice(0, 5)
                    .map((s, i, arr) => (
                      <EvidenceItem key={s.id} signal={s} score={s.score} tone="alert" last={i === arr.length - 1} />
                    ))
                ) : (
                  <p className="px-5 py-6 text-[13px] leading-relaxed text-fc-oxide" data-testid="text-no-contradicting-evidence">
                    No contradicting evidence found yet — this is a gap, not a clean bill of health.
                  </p>
                )}
              </Panel>

              <Panel flush testId="panel-confirming-evidence">
                <PanelHead>
                  <PanelTitle>Evidence for — {evidence?.confirming.length ?? 0} signals</PanelTitle>
                  <span className="ml-auto text-[11px] font-medium leading-none text-fc-ink-3">
                    sorted by weighted score
                  </span>
                </PanelHead>
                {loadingEvidence ? (
                  <div className="p-5">
                    <LoadingBlock height={140} className="border-0" />
                  </div>
                ) : evidence?.confirming.length ? (
                  evidence.confirming
                    .slice(0, 5)
                    .map((s, i, arr) => <EvidenceItem key={s.id} signal={s} score={s.score} last={i === arr.length - 1} />)
                ) : (
                  <p className="px-5 py-6 text-[13px] text-fc-ink-3" data-testid="text-no-confirming-evidence">
                    No confirming evidence attached yet.
                  </p>
                )}
              </Panel>
            </div>

            {/* ── The maths, in the open ───────────────────────────── */}
            <Panel className="px-[22px] py-5" testId="card-confidence-math">
              <PanelTitle className="mb-3 block">How the confidence score is calculated</PanelTitle>
              <pre
                className="overflow-x-auto rounded-lg border border-fc-rule-soft bg-fc-surface-sunk px-4 py-3.5 font-mono text-xs leading-[2] text-fc-ink-3"
                data-testid="text-confidence-formula"
              >
{`signal_score = reliability × relevance × direction_multiplier × recency_decay
confidence   = clamp( Σ signal_score / count(signals), −1, 1 )
direction_multiplier: confirming = +1 · contradicting = −1 · neutral = 0
recency_decay = exp(−days_since_retrieved / half_life_days)`}
              </pre>
            </Panel>
          </>
        )}
      </PageBody>
    </AppLayout>
  );
}
