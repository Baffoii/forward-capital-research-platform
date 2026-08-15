// Company Intelligence — one name, read as evidence. Everything on this page
// answers the same question: what is this company doing to the thesis?

import { useMemo } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout";
import {
  Chip,
  LoadingBlock,
  PageBody,
  PageHeader,
  Panel,
  PanelHead,
  PanelTitle,
  SectionLabel,
  scoreToneClass,
} from "@/components/kit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  type AnalystActionPayload,
  type FilingPayload,
  type InsiderTxPayload,
  fmtCompact,
  fmtCompactMoney,
  fmtDayMonth,
  fmtPctChange,
  fmtPrice,
  fmtPriceTerse,
  fmtRatio,
  fmtScore,
  fmtStampUtc,
  isConsensusSignal,
  readPayload,
} from "@/lib/design";
import { computeSignalScore } from "@/lib/scoring-client";
import { cn } from "@/lib/utils";
import type { Company, CompanyAnalystConsensus, CompanyQuote, Signal } from "@shared/schema";

const SYNC_BUTTONS: Array<{ key: string; label: string }> = [
  { key: "quote", label: "Sync quote" },
  { key: "profile", label: "Profile" },
  { key: "insiders", label: "Insiders" },
  { key: "analysts", label: "Analysts" },
  { key: "similarweb", label: "Web signals" },
  { key: "filings", label: "SEC filings" },
];

const ANALYST_GRID = "md:grid-cols-[70px_minmax(0,1fr)_110px_92px]";
const INSIDER_GRID = "md:grid-cols-[70px_minmax(0,1fr)_92px_100px]";

export default function CompanyIntelligence() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);

  const { data: company, isLoading: loadingCompany } = useQuery<Company>({
    queryKey: ["/api/companies", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/companies/${id}`);
      return res.json();
    },
  });

  const { data: signals, isLoading: loadingSignals } = useQuery<Signal[]>({
    queryKey: ["/api/signals", { companyId: id }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signals?companyId=${id}`);
      return res.json();
    },
  });

  const { data: market } = useQuery<{ quote: CompanyQuote | null; consensus: CompanyAnalystConsensus | null }>({
    queryKey: ["/api/companies", id, "market"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/companies/${id}/market`);
      return res.json();
    },
  });

  const { data: usptoKey } = useQuery<{ hasKey: boolean }>({ queryKey: ["/api/settings/uspto_api_key"] });

  const sync = useMutation({
    mutationFn: async (source: string) => {
      const res = await apiRequest("POST", `/api/companies/${id}/sync/${source}`);
      return res.json();
    },
    onSuccess: (_data, source) => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      // A quote or analyst sync refreshes the snapshot tables too.
      queryClient.invalidateQueries({ queryKey: ["/api/companies", id, "market"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/consensus"] });
      toast({ title: `Synced ${source}` });
    },
    onError: (err: Error, source) => {
      if (err.message.includes("MISSING_USPTO_KEY") || err.message.includes("USPTO PatentSearch API key")) {
        toast({
          title: "USPTO key required",
          description: "Add a free USPTO PatentSearch API key in Sources to enable this.",
          variant: "destructive",
        });
      } else {
        toast({ title: `Sync failed (${source})`, description: err.message, variant: "destructive" });
      }
    },
  });

  const own = signals ?? [];
  // Quote and consensus come from their own tables; the individual analyst
  // actions, insider transactions and filings still live on the signals that
  // carry their provenance.
  const quote = market?.quote ?? null;
  const consensus = market?.consensus ?? null;

  const analystActions = useMemo(
    () =>
      own
        .filter((s) => s.signalCategory === "analyst_action" && !isConsensusSignal(s))
        .map((s) => ({ signal: s, payload: readPayload<AnalystActionPayload>(s.rawPayload) }))
        .sort((a, b) => new Date(b.signal.retrievedAt).getTime() - new Date(a.signal.retrievedAt).getTime()),
    [own]
  );

  const insiderTx = useMemo(
    () =>
      own
        .filter((s) => s.signalCategory === "insider_activity")
        .map((s) => ({ signal: s, payload: readPayload<InsiderTxPayload>(s.rawPayload) }))
        .sort((a, b) => new Date(b.signal.retrievedAt).getTime() - new Date(a.signal.retrievedAt).getTime()),
    [own]
  );

  const filings = useMemo(
    () =>
      own
        .filter((s) => s.signalCategory === "regulatory_filing")
        .map((s) => ({ signal: s, payload: readPayload<FilingPayload>(s.rawPayload) }))
        .sort((a, b) => new Date(b.signal.retrievedAt).getTime() - new Date(a.signal.retrievedAt).getTime()),
    [own]
  );

  const patents = useMemo(() => own.filter((s) => s.signalCategory === "patent_filing"), [own]);

  const netScore = useMemo(() => own.reduce((sum, s) => sum + computeSignalScore(s, now), 0), [own, now]);
  const forCount = own.filter((s) => s.direction === "confirming").length;
  const againstCount = own.filter((s) => s.direction === "contradicting").length;
  const neutralCount = own.filter((s) => s.direction === "neutral").length;
  const isDrag = netScore < 0;

  const targetBelowSpot =
    consensus?.avgPriceTarget != null && quote?.price != null && consensus.avgPriceTarget < quote.price;

  const roleText = (() => {
    if (!own.length) return "No signals are attached to this company yet, so it contributes nothing either way.";
    const ticker = company?.ticker ?? company?.name ?? "This name";
    const lead = isDrag
      ? `${ticker} is currently a net drag on thesis confidence: ${againstCount} contradicting signal${againstCount === 1 ? "" : "s"} outweigh ${forCount} confirming.`
      : netScore > 0
        ? `${ticker} currently supports the thesis: ${forCount} confirming signal${forCount === 1 ? "" : "s"} outweigh ${againstCount} contradicting.`
        : `${ticker} nets out flat — ${forCount} confirming against ${againstCount} contradicting, with ${neutralCount} logged neutral.`;
    const tail = targetBelowSpot
      ? " Its consensus target sits below spot, so this leg cannot be used as supporting evidence even where the ratings are bullish."
      : "";
    return lead + tail;
  })();

  const meta = company
    ? [
        company.sector,
        company.industry,
        company.ceo,
        company.employees ? `${company.employees.toLocaleString()} employees` : null,
        company.ipoDate ? `IPO ${company.ipoDate}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <AppLayout subNav={company?.ticker ? { under: "/watchlist", label: company.ticker } : undefined}>
      {loadingCompany ? (
        <PageBody>
          <LoadingBlock height={200} />
        </PageBody>
      ) : !company ? (
        <PageBody>
          <Panel testId="text-company-not-found">
            <p className="text-[13px] text-fc-ink-3">Company not found.</p>
          </Panel>
        </PageBody>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-xl tracking-[-0.01em]" data-testid="text-company-name">
                  {company.name}
                </span>
                <span className="font-mono text-sm font-semibold text-fc-ink-3">{company.ticker}</span>
                <Chip tone="teal" size="lead" className="border-transparent">
                  {company.segment} leg
                </Chip>
              </span>
            }
            subtitle={<span data-testid="text-company-meta">{meta}</span>}
            actions={
              <div className="flex max-w-[440px] flex-wrap justify-end gap-1.5">
                {SYNC_BUTTONS.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => sync.mutate(b.key)}
                    disabled={sync.isPending}
                    data-testid={`button-sync-${b.key}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-fc-rule-strong bg-fc-surface px-2.5 py-[7px] text-[11.5px] font-medium leading-none text-fc-ink hover:bg-fc-chip disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3 w-3", sync.isPending && "animate-spin")} />
                    {b.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => sync.mutate("patents")}
                  disabled={sync.isPending}
                  data-testid="button-sync-patents"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-[7px] text-[11.5px] font-medium leading-none disabled:opacity-50",
                    usptoKey?.hasKey
                      ? "border border-fc-rule-strong bg-fc-surface text-fc-ink hover:bg-fc-chip"
                      : "border border-fc-ochre bg-fc-ochre-panel text-fc-ochre-deep"
                  )}
                >
                  <RefreshCw className={cn("h-3 w-3", sync.isPending && "animate-spin")} />
                  {usptoKey?.hasKey ? "Patents" : "Patents · key required"}
                </button>
              </div>
            }
          />

          <PageBody>
            {/* ── Quote · consensus · role ─────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel tone="teal" className="px-[22px] py-5" testId="card-quote-block">
                <SectionLabel className="mb-3 text-fc-ink-2">
                  Quote{quote?.asOf ? ` · ${fmtStampUtc(quote.asOf)} UTC` : ""}
                </SectionLabel>
                {quote ? (
                  <>
                    <div className="mb-4 flex items-baseline gap-2.5">
                      <span className="font-mono text-[32px] font-semibold leading-none tracking-[-0.02em] text-fc-ink">
                        {fmtPrice(quote.price)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-sm font-semibold leading-none",
                          (quote.changesPercentage ?? 0) < 0 ? "text-fc-oxide" : "text-fc-forest"
                        )}
                      >
                        {fmtPctChange(quote.changesPercentage)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                      <QuoteFact label="MARKET CAP" value={fmtCompactMoney(quote.marketCap)} />
                      <QuoteFact label="P/E" value={fmtRatio(quote.pe, 2)} />
                      <QuoteFact label="VOLUME" value={fmtCompact(quote.volume)} />
                      <QuoteFact
                        label="52W RANGE"
                        value={
                          quote.yearLow != null && quote.yearHigh != null
                            ? `${fmtPrice(quote.yearLow)} – ${fmtPrice(quote.yearHigh)}`
                            : "—"
                        }
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-fc-ink-3" data-testid="text-no-quote-yet">
                    No quote synced yet. Use “Sync quote” above.
                  </p>
                )}
              </Panel>

              <Panel className="px-[22px] py-5" testId="card-analyst-consensus">
                <SectionLabel className="mb-3">Analyst consensus</SectionLabel>
                {consensus ? (
                  <>
                    <div className="mb-3.5 flex items-baseline gap-2">
                      <span className="font-display text-[19px] font-semibold capitalize leading-none">
                        {(consensus.rating ?? "—").replace(/_/g, " ")}
                      </span>
                      <span className="text-xs leading-none text-fc-ink-3">{consensus.totalRatings ?? 0} analysts</span>
                    </div>
                    <div className="mb-2.5 flex h-[9px] overflow-hidden rounded-full" role="img" aria-label="Rating split">
                      <span style={{ width: `${consensus.bullishPct ?? 0}%` }} className="bg-fc-forest-bright" />
                      <span style={{ width: `${consensus.neutralPct ?? 0}%` }} className="bg-fc-chip" />
                      <span style={{ width: `${consensus.bearishPct ?? 0}%` }} className="bg-fc-oxide-bright" />
                    </div>
                    <div className="mb-3.5 flex justify-between font-mono text-[10.5px] font-medium leading-none">
                      <span className="text-fc-forest">{Math.round(consensus.bullishPct ?? 0)}% bull</span>
                      <span className="text-fc-ink-3">{Math.round(consensus.neutralPct ?? 0)}% neutral</span>
                      <span className="text-fc-oxide">{Math.round(consensus.bearishPct ?? 0)}% bear</span>
                    </div>
                    <div className="flex justify-between border-t border-fc-rule-soft pt-3 text-xs leading-none text-fc-ink-3">
                      <span>Avg target</span>
                      <span
                        className={cn(
                          "font-mono text-[12.5px] font-semibold",
                          targetBelowSpot ? "text-fc-oxide-bright" : "text-fc-ink"
                        )}
                      >
                        {fmtPrice(consensus.avgPriceTarget)}
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between text-xs leading-none text-fc-ink-3">
                      <span>Range</span>
                      <span className="font-mono text-xs font-medium text-fc-ink">
                        {fmtPriceTerse(consensus.lowPriceTarget)} – {fmtPriceTerse(consensus.highPriceTarget)}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-fc-ink-3">No analyst consensus synced yet.</p>
                )}
              </Panel>

              <Panel tone={isDrag ? "alert" : "plain"} className="px-[22px] py-5" testId="card-thesis-role">
                <SectionLabel className={cn("mb-3", isDrag && "text-fc-oxide")}>Role in the thesis</SectionLabel>
                <div className="mb-3 flex items-baseline gap-2.5">
                  <span className={cn("font-mono text-[26px] font-semibold leading-none", scoreToneClass(netScore))}>
                    {fmtScore(netScore)}
                  </span>
                  <span className="text-xs leading-none text-fc-ink-3">net contribution</span>
                </div>
                <p className="text-pretty text-[12.5px] leading-[1.65] text-fc-ink-2">{roleText}</p>
                <div className="mt-3.5 flex flex-wrap gap-1.5">
                  {againstCount > 0 && (
                    <Chip tone="contradicting" size="lead">
                      {againstCount} contradicting
                    </Chip>
                  )}
                  {forCount > 0 && (
                    <Chip tone="confirming" size="lead">
                      {forCount} confirming
                    </Chip>
                  )}
                  {neutralCount > 0 && <Chip size="lead">{neutralCount} neutral</Chip>}
                </div>
              </Panel>
            </div>

            {/* ── Analyst actions · insider transactions ───────────── */}
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Panel flush testId="card-analyst-actions">
                <PanelHead>
                  <PanelTitle>Analyst actions</PanelTitle>
                </PanelHead>
                <div
                  className={cn(
                    "hidden border-b border-fc-rule-soft bg-fc-surface-sunk px-5 py-2.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3 md:grid",
                    ANALYST_GRID
                  )}
                >
                  <span>Date</span>
                  <span>Firm · analyst</span>
                  <span>Action</span>
                  <span className="text-right">Target</span>
                </div>
                {loadingSignals ? (
                  <div className="p-5">
                    <LoadingBlock height={90} className="border-0" />
                  </div>
                ) : analystActions.length === 0 ? (
                  <p className="px-5 py-5 text-[13px] text-fc-ink-3">No analyst actions synced yet.</p>
                ) : (
                  analystActions.slice(0, 8).map(({ signal, payload }, i, arr) => {
                    const delta =
                      payload?.price_target != null && payload?.prior_target != null
                        ? payload.price_target - payload.prior_target
                        : null;
                    const downgrade = /downgrade/i.test(payload?.action ?? "");
                    return (
                      <div
                        key={signal.id}
                        className={cn(
                          "grid grid-cols-1 items-center gap-1 px-5 py-3 text-[12.5px] leading-snug md:gap-0",
                          ANALYST_GRID,
                          i < arr.length - 1 && "border-b border-fc-rule-soft"
                        )}
                        data-testid={`row-analyst-${signal.id}`}
                      >
                        <span className="font-mono text-[11px] font-medium leading-none text-fc-ink-3">
                          {fmtDayMonth(payload?.date ?? signal.retrievedAt)}
                        </span>
                        <span className="truncate">
                          {payload?.firm ?? "—"}
                          {payload?.analyst ? ` · ${payload.analyst}` : ""}
                        </span>
                        <span
                          className={cn(
                            "text-[11.5px] leading-none",
                            downgrade ? "font-display font-semibold text-fc-oxide" : "font-medium text-fc-ink-3"
                          )}
                        >
                          {payload?.action ?? "—"}
                          {payload?.rating ? ` · ${payload.rating}` : ""}
                        </span>
                        <span className="font-mono text-xs font-semibold md:text-right">
                          {fmtPriceTerse(payload?.price_target)}
                          {delta != null && delta !== 0 && (
                            <span
                              className={cn("ml-1 font-normal", delta > 0 ? "text-fc-forest-bright" : "text-fc-oxide-bright")}
                            >
                              {delta > 0 ? "↑" : "↓"}
                              {Math.abs(Math.round(delta))}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </Panel>

              <Panel flush testId="card-insider-transactions">
                <PanelHead>
                  <PanelTitle>Insider transactions</PanelTitle>
                </PanelHead>
                <div
                  className={cn(
                    "hidden border-b border-fc-rule-soft bg-fc-surface-sunk px-5 py-2.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3 md:grid",
                    INSIDER_GRID
                  )}
                >
                  <span>Date</span>
                  <span>Insider</span>
                  <span>Type</span>
                  <span className="text-right">Value</span>
                </div>
                {loadingSignals ? (
                  <div className="p-5">
                    <LoadingBlock height={90} className="border-0" />
                  </div>
                ) : insiderTx.length === 0 ? (
                  <p className="px-5 py-5 text-[13px] text-fc-ink-3" data-testid="text-no-insider-data">
                    No insider transaction signals yet.
                  </p>
                ) : (
                  insiderTx.slice(0, 8).map(({ signal, payload }, i, arr) => (
                    <div
                      key={signal.id}
                      className={cn(
                        "grid grid-cols-1 items-center gap-1 px-5 py-3 text-[12.5px] leading-snug md:gap-0",
                        INSIDER_GRID,
                        i < arr.length - 1 && "border-b border-fc-rule-soft"
                      )}
                      data-testid={`row-insider-${signal.id}`}
                    >
                      <span className="font-mono text-[11px] font-medium leading-none text-fc-ink-3">
                        {fmtDayMonth(payload?.date ?? signal.retrievedAt)}
                      </span>
                      <span className="truncate capitalize">{(payload?.name ?? "—").toLowerCase()}</span>
                      <span className="justify-self-start">
                        <Chip mono tone={/S-SALE/i.test(payload?.type ?? "") ? "contradicting" : "neutral"}>
                          {payload?.type ?? "—"}
                        </Chip>
                      </span>
                      <span className="font-mono text-xs font-medium md:text-right">
                        {payload?.value ? fmtCompactMoney(payload.value) : "—"}
                      </span>
                    </div>
                  ))
                )}
              </Panel>
            </div>

            {/* ── Filings · patents ────────────────────────────────── */}
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Panel className="px-[22px] py-5" testId="card-sec-filings">
                <PanelTitle className="mb-3 block">SEC filings</PanelTitle>
                {filings.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-fc-ink-3">
                    No filings retrieved yet. Use “SEC filings” above — it reads the public EDGAR submissions API.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-col gap-2.5">
                      {filings.slice(0, 6).map(({ signal, payload }) => {
                        const form = payload?.form ?? payload?.formType ?? "—";
                        const primary = /^(10-[KQ]|8-K|S-1)$/i.test(form);
                        return (
                          <div key={signal.id} className="flex items-baseline gap-2.5" data-testid={`row-filing-${signal.id}`}>
                            <Chip mono tone={primary ? "teal" : "neutral"} className="border-transparent">
                              {form}
                            </Chip>
                            <span className="flex-1 text-[12.5px] leading-[1.5]">
                              {payload?.primaryDocDescription ?? payload?.description ?? signal.title}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] font-medium leading-none text-fc-ink-3">
                              {fmtDayMonth(payload?.filingDate ?? payload?.date ?? signal.retrievedAt)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3.5 border-t border-fc-rule-soft pt-3 text-[11px] leading-[1.5] text-fc-ink-3">
                      Source: SEC EDGAR public filings API · retrieved {fmtStampUtc(filings[0].signal.retrievedAt)} UTC
                    </p>
                  </>
                )}
              </Panel>

              {patents.length > 0 ? (
                <Panel className="px-[22px] py-5" testId="card-patents-block">
                  <PanelTitle className="mb-3 block">Patents</PanelTitle>
                  <div className="flex flex-col gap-2.5">
                    {patents.slice(0, 6).map((s) => (
                      <div key={s.id} className="text-[12.5px] leading-[1.5]" data-testid={`row-patent-${s.id}`}>
                        <span className="font-medium">{s.title}</span>
                        <span className="ml-2 font-mono text-[11px] text-fc-ink-3">{fmtDayMonth(s.retrievedAt)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              ) : (
                <Panel tone="gap" className="px-[22px] py-5" testId="text-patents-gap">
                  <PanelTitle className="mb-2.5 block text-fc-ochre-deep">Patents — not connected</PanelTitle>
                  <p className="text-pretty text-[12.5px] leading-[1.65] text-fc-ochre-deep">
                    Patent filings are one of the signal types this thesis explicitly calls for, and the segment with
                    zero coverage is the one patents would most likely surface. Add a free USPTO PatentSearch key in
                    Sources to enable it.
                  </p>
                  <a
                    href="#/sources"
                    className="mt-3.5 inline-block rounded-md bg-fc-ochre-deep px-[15px] py-2.5 font-display text-xs font-semibold leading-none text-white hover:opacity-85"
                    data-testid="link-add-uspto-key"
                  >
                    Add USPTO key
                  </a>
                </Panel>
              )}
            </div>
          </PageBody>
        </>
      )}
    </AppLayout>
  );
}

function QuoteFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] leading-none text-fc-ink-3">{label}</div>
      <div className="font-mono text-[12.5px] font-medium leading-none text-fc-ink">{value}</div>
    </div>
  );
}
