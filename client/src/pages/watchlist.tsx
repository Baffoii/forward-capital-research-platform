// Watchlist — segments read as legs of the thesis, not as folders. The segment
// with no companies in it is the loudest thing on the page, because that is
// where the prediction actually rests.

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { ActionButton, Chip, LoadingBlock, PageBody, PageHeader, Panel, SectionLabel } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtPctChange, fmtPrice, fmtRatio } from "@/lib/design";
import { computeSignalScore } from "@/lib/scoring-client";
import { cn } from "@/lib/utils";
import type {
  Company,
  CompanyAnalystConsensus,
  CompanyQuote,
  Signal,
  WatchlistItem,
} from "@shared/schema";

interface SegmentInfo {
  name: string;
  note: string;
  isThesisLeg?: boolean;
  tickers: string[];
}

interface CompanyView {
  company: Company;
  quote: CompanyQuote | null;
  consensus: CompanyAnalystConsensus | null;
  forCount: number;
  againstCount: number;
  signalCount: number;
  netScore: number;
}

const CONTEXT_GRID = "md:grid-cols-[80px_minmax(0,1fr)_110px_100px_130px_minmax(0,1fr)]";

/** The one-line read on consensus: is this name helping the thesis or not? */
function consensusVerdict(view: CompanyView): { text: string; tone: "muted" | "ochre" | "oxide" } {
  const { consensus, quote } = view;
  if (!consensus) return { text: "No analyst consensus synced yet.", tone: "muted" };

  const analysts = consensus.totalRatings ?? 0;
  const avg = consensus.avgPriceTarget;
  const price = quote?.price;
  const bullish = consensus.bullishPct ?? 0;
  const neutral = consensus.neutralPct ?? 0;
  const bearish = consensus.bearishPct ?? 0;

  if (avg != null && price != null && avg < price) {
    return bullish >= 60
      ? { text: `Bullish, but avg target ${fmtPrice(avg)} sits under spot`, tone: "ochre" }
      : { text: `Avg target ${fmtPrice(avg)} is below spot — counter-evidence`, tone: "oxide" };
  }
  if (analysts > 0 && neutral >= bullish) {
    return {
      text: `Contested: ${analysts} analysts split ${Math.round(bullish)} / ${Math.round(neutral)} / ${Math.round(bearish)}`,
      tone: "oxide",
    };
  }
  return {
    text: `${analysts} analysts · ${Math.round(bullish)}% bullish · avg target ${avg != null ? fmtPrice(avg) : "—"}`,
    tone: "muted",
  };
}

function ConsensusBar({ consensus }: { consensus: CompanyAnalystConsensus | null }) {
  if (!consensus) return <div className="mb-2 h-[5px] rounded-full bg-fc-rule-soft" />;
  const bull = consensus.bullishPct ?? 0;
  const neutral = consensus.neutralPct ?? 0;
  const bear = consensus.bearishPct ?? 0;
  const total = bull + neutral + bear || 1;
  return (
    <div
      className="mb-2 flex h-[5px] overflow-hidden rounded-full"
      role="img"
      aria-label={`${Math.round(bull)}% bullish, ${Math.round(neutral)}% neutral, ${Math.round(bear)}% bearish`}
    >
      <span style={{ width: `${(bull / total) * 100}%` }} className="bg-fc-forest-bright" />
      <span style={{ width: `${(neutral / total) * 100}%` }} className="bg-fc-chip" />
      <span style={{ width: `${(bear / total) * 100}%` }} className="bg-fc-oxide-bright" />
    </div>
  );
}

function CompanyCard({ view }: { view: CompanyView }) {
  const { company, quote, forCount, againstCount, signalCount, netScore } = view;
  const verdict = consensusVerdict(view);
  const drag = netScore < 0;

  return (
    <Link
      href={`/companies/${company.id}`}
      className={cn(
        "block rounded-lg border bg-fc-surface px-[18px] py-4 transition-colors hover:border-fc-teal-line",
        drag ? "border-fc-oxide-border" : "border-fc-rule"
      )}
      data-testid={`link-company-${company.id}`}
    >
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{company.ticker ?? "—"}</span>
        <span className="font-mono text-[15px] font-semibold">{fmtPrice(quote?.price)}</span>
      </div>
      <div className="mb-3.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11.5px] leading-snug text-fc-ink-3">{company.name}</span>
        <span
          className={cn(
            "shrink-0 font-mono text-[11.5px] font-medium leading-none",
            (quote?.changesPercentage ?? 0) < 0 ? "font-semibold text-fc-oxide-bright" : "text-fc-forest-bright"
          )}
        >
          {fmtPctChange(quote?.changesPercentage)}
        </span>
      </div>

      <ConsensusBar consensus={view.consensus} />
      <p
        className={cn(
          "mb-3 text-[11px] leading-[1.5]",
          verdict.tone === "oxide" ? "text-fc-oxide" : verdict.tone === "ochre" ? "text-fc-ochre-deep" : "text-fc-ink-3"
        )}
      >
        {verdict.text}
      </p>

      <div
        className={cn(
          "flex gap-3.5 border-t pt-[11px]",
          drag ? "border-fc-oxide-panel-line" : "border-fc-rule-soft"
        )}
      >
        <MiniStat label="Signals" value={signalCount} />
        <MiniStat label="For" value={forCount} tone={forCount > 0 ? "forest" : "muted"} />
        <MiniStat label="Against" value={againstCount} tone={againstCount > 0 ? "oxide" : "muted"} />
        <MiniStat label="P/E" value={fmtRatio(quote?.pe)} className="ml-auto" />
      </div>
    </Link>
  );
}

function MiniStat({
  label,
  value,
  tone = "ink",
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: "ink" | "forest" | "oxide" | "muted";
  className?: string;
}) {
  const tones = {
    ink: "text-fc-ink",
    forest: "text-fc-forest-bright",
    oxide: "text-fc-oxide-bright",
    muted: "text-fc-ink-3",
  };
  return (
    <div className={className}>
      <SectionLabel className="mb-1 tracking-[0.1em]">{label}</SectionLabel>
      <div className={cn("font-mono text-[13px] font-semibold leading-none", tones[tone])}>{value}</div>
    </div>
  );
}

function AddCompanyDialog({ segments }: { segments: string[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [segment, setSegment] = useState(segments[0] ?? "");
  const [sector, setSector] = useState("");
  const [industry, setIndustry] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const created = await (
        await apiRequest("POST", "/api/companies", {
          name: name.trim(),
          ticker: ticker.trim().toUpperCase() || null,
          segment,
          sector: sector.trim() || null,
          industry: industry.trim() || null,
          ceo: null,
          employees: null,
          website: null,
          ipoDate: null,
          description: null,
          createdAt: new Date().toISOString(),
        })
      ).json();
      await apiRequest("POST", "/api/watchlist", {
        companyId: created.id,
        addedAt: new Date().toISOString(),
        notes: "Added manually from the Watchlist.",
      });
      return created;
    },
    onSuccess: (created: Company) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: `${created.ticker ?? created.name} added to the watchlist` });
      setOpen(false);
      setName("");
      setTicker("");
      setSector("");
      setIndustry("");
    },
    onError: (err: Error) => toast({ title: "Could not add company", description: err.message, variant: "destructive" }),
  });

  const field = "w-full rounded-md border border-fc-rule-strong bg-fc-surface px-3 py-2 text-[12.5px] leading-none text-fc-ink placeholder:text-fc-ink-3 focus:border-fc-teal focus:outline-none";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-md bg-fc-teal px-3.5 py-2 font-display text-[12.5px] font-semibold leading-none text-white hover:opacity-85"
          data-testid="button-add-company"
        >
          Add company
        </button>
      </DialogTrigger>
      <DialogContent className="bg-fc-surface">
        <DialogHeader>
          <DialogTitle className="font-display text-[15px]">Add a company to the watchlist</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && segment) add.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-fc-ink-3">Company name</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-company-name" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-fc-ink-3">Ticker</span>
              <input className={cn(field, "font-mono")} value={ticker} onChange={(e) => setTicker(e.target.value)} data-testid="input-company-ticker" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-fc-ink-3">Segment</span>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger className="h-auto border-fc-rule-strong bg-fc-surface px-3 py-2 text-[12.5px] leading-none" data-testid="select-company-segment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-fc-ink-3">Sector</span>
              <input className={field} value={sector} onChange={(e) => setSector(e.target.value)} data-testid="input-company-sector" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-fc-ink-3">Industry</span>
              <input className={field} value={industry} onChange={(e) => setIndustry(e.target.value)} data-testid="input-company-industry" />
            </label>
          </div>
          <p className="text-[11px] leading-[1.55] text-fc-ink-3">
            Adding a name here does not attach any evidence to it. Signals arrive from a source sync or from the
            Research Inbox.
          </p>
          <ActionButton tone="primary" type="submit" disabled={!name.trim() || add.isPending} testId="button-submit-company">
            {add.isPending ? "Adding…" : "Add to watchlist"}
          </ActionButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Watchlist() {
  const now = useMemo(() => new Date(), []);
  const [groupBy, setGroupBy] = useState<"segment" | "sector">("segment");

  const { data: companies, isLoading: loadingCompanies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: watchlistItems, isLoading: loadingWatchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const { data: segmentsData } = useQuery<{ thesisTitle: string; segments: SegmentInfo[] }>({ queryKey: ["/api/segments"] });
  const { data: signals } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const { data: quotes } = useQuery<CompanyQuote[]>({ queryKey: ["/api/quotes"] });
  const { data: consensusRows } = useQuery<CompanyAnalystConsensus[]>({ queryKey: ["/api/consensus"] });

  const isLoading = loadingCompanies || loadingWatchlist;
  const watchedIds = useMemo(() => new Set((watchlistItems ?? []).map((w) => w.companyId)), [watchlistItems]);
  const watched = useMemo(() => (companies ?? []).filter((c) => watchedIds.has(c.id)), [companies, watchedIds]);

  const quoteByCompany = useMemo(() => new Map((quotes ?? []).map((q) => [q.companyId, q])), [quotes]);
  const consensusByCompany = useMemo(
    () => new Map((consensusRows ?? []).map((c) => [c.companyId, c])),
    [consensusRows]
  );

  const views = useMemo<Map<number, CompanyView>>(() => {
    const map = new Map<number, CompanyView>();
    for (const company of watched) {
      const own = (signals ?? []).filter((s) => s.companyId === company.id);
      map.set(company.id, {
        company,
        quote: quoteByCompany.get(company.id) ?? null,
        consensus: consensusByCompany.get(company.id) ?? null,
        forCount: own.filter((s) => s.direction === "confirming").length,
        againstCount: own.filter((s) => s.direction === "contradicting").length,
        signalCount: own.length,
        netScore: own.reduce((sum, s) => sum + computeSignalScore(s, now), 0),
      });
    }
    return map;
  }, [watched, signals, quoteByCompany, consensusByCompany, now]);

  const allSegments = segmentsData?.segments ?? [];
  const segments = useMemo(() => allSegments.filter((s) => s.isThesisLeg !== false), [allSegments]);
  const legNames = useMemo(() => new Set(segments.map((s) => s.name)), [segments]);
  const contextCompanies = useMemo(
    () => watched.filter((c) => !legNames.has(c.segment)),
    [watched, legNames]
  );

  const sectorGroups = useMemo(() => {
    const map = new Map<string, Company[]>();
    for (const c of watched) {
      const key = c.sector ?? "Unclassified";
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [watched]);

  const segmentOptions = useMemo(
    () => Array.from(new Set([...allSegments.map((s) => s.name), ...watched.map((c) => c.segment)])),
    [allSegments, watched]
  );

  return (
    <AppLayout>
      <PageHeader
        title="Watchlist"
        subtitle={`${watched.length} companies · ${segments.length} thesis segments · ${contextCompanies.length} context names`}
        actions={
          <>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <SelectTrigger
                className="h-auto w-auto gap-1.5 rounded-md border-fc-rule-strong bg-fc-surface px-3 py-2 text-[12.5px] font-medium leading-none text-fc-ink"
                data-testid="select-group-by"
              >
                <SelectValue>{groupBy === "segment" ? "Group: segment" : "Group: sector"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="segment">Group: segment</SelectItem>
                <SelectItem value="sector">Group: sector</SelectItem>
              </SelectContent>
            </Select>
            <AddCompanyDialog segments={segmentOptions} />
          </>
        }
      />

      <PageBody className="gap-6">
        {isLoading ? (
          <LoadingBlock height={320} />
        ) : watched.length === 0 ? (
          <Panel testId="text-empty-watchlist">
            <p className="text-[13px] leading-relaxed text-fc-ink-3">
              The watchlist is empty. Add a company above, or promote a candidate from the Research Inbox.
            </p>
          </Panel>
        ) : groupBy === "sector" ? (
          sectorGroups.map(([sector, members]) => (
            <section key={sector}>
              <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                <span className="font-display text-sm font-semibold leading-none">{sector}</span>
                <span className="text-xs leading-none text-fc-ink-3">{members.length} names</span>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {members.map((c) => {
                  const view = views.get(c.id);
                  return view ? <CompanyCard key={c.id} view={view} /> : null;
                })}
              </div>
            </section>
          ))
        ) : (
          <>
            {segments.map((seg) => {
              const members = watched.filter((c) => seg.tickers.includes(c.ticker ?? ""));
              const isGap = members.length === 0;
              return (
                <section key={seg.name} data-testid={`section-segment-${seg.name.replace(/\s+/g, "-").toLowerCase()}`}>
                  <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                    <span
                      className={cn(
                        "font-display text-sm font-semibold leading-none",
                        isGap ? "text-fc-ochre-deep" : "text-fc-ink"
                      )}
                    >
                      {seg.name}
                    </span>
                    {isGap ? (
                      <Chip tone="ochre" size="lead" className="border-transparent">
                        Segment needs research
                      </Chip>
                    ) : (
                      <Chip tone="teal" size="lead" className="border-transparent">
                        Thesis leg
                      </Chip>
                    )}
                    {!isGap && <span className="text-xs leading-none text-fc-ink-3">{seg.note}</span>}
                  </div>

                  {isGap ? (
                    <Panel tone="gap" className="px-7 py-6" testId="panel-segment-gap">
                      <div className="flex flex-col items-start gap-7 lg:flex-row lg:items-center">
                        <div className="flex-1">
                          <p className="mb-2 text-pretty font-display text-base font-semibold leading-[1.35] text-fc-ochre-deep">
                            No companies identified yet — and that is the thesis, not an oversight.
                          </p>
                          <p className="max-w-[640px] text-pretty text-[13px] leading-[1.65] text-fc-ochre-deep">
                            The prediction rests on the market re-rating this segment. Until named companies sit here,
                            the core bet has zero evidence for or against it. The platform will not invent placeholder
                            tickers.
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2">
                          <Link
                            href="/inbox"
                            className="rounded-md bg-fc-ochre-deep px-4 py-2.5 text-center font-display text-[12.5px] font-semibold leading-none text-white hover:opacity-85"
                            data-testid="link-gap-to-inbox"
                          >
                            Add candidates via Research Inbox
                          </Link>
                          <a
                            href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-fc-ochre px-4 py-2.5 text-center text-[12.5px] font-medium leading-none text-fc-ochre-deep hover:bg-fc-ochre-wash"
                            data-testid="link-gap-to-edgar"
                          >
                            Search SEC EDGAR by SIC code
                          </a>
                        </div>
                      </div>
                    </Panel>
                  ) : (
                    <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                      {members.map((c) => {
                        const view = views.get(c.id);
                        return view ? <CompanyCard key={c.id} view={view} /> : null;
                      })}
                      {members.length < 3 && (
                        <div className="flex items-center justify-center rounded-lg border border-dashed border-fc-ink-5 px-[18px] py-4 text-center text-[12.5px] font-medium leading-[1.5] text-fc-ink-3">
                          Thinnest leg — only {members.length} {members.length === 1 ? "name" : "names"} carry it
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {contextCompanies.length > 0 && (
              <section>
                <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                  <span className="font-display text-sm font-semibold leading-none text-fc-ink-3">
                    Wave 1 &amp; 2 context
                  </span>
                  <Chip size="lead" className="border-transparent">
                    Not a thesis leg
                  </Chip>
                  <span className="text-xs leading-none text-fc-ink-3">
                    Tracked because the thesis narrative names them, excluded from segment scoring.
                  </span>
                </div>
                <Panel flush testId="panel-context-companies">
                  <div
                    className={cn(
                      "hidden border-b border-fc-rule-soft bg-fc-surface-sunk px-[18px] py-2.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3 md:grid",
                      CONTEXT_GRID
                    )}
                  >
                    <span>Ticker</span>
                    <span>Company</span>
                    <span className="text-right">Price</span>
                    <span className="text-right">Change</span>
                    <span className="text-right">Avg target</span>
                    <span className="text-right">Consensus</span>
                  </div>
                  {contextCompanies.map((c, i) => {
                    const view = views.get(c.id);
                    const consensus = view?.consensus;
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "grid grid-cols-1 items-center gap-1 px-[18px] py-3 text-[12.5px] leading-none md:gap-0",
                          CONTEXT_GRID,
                          i < contextCompanies.length - 1 && "border-b border-fc-rule-soft"
                        )}
                        data-testid={`row-context-${c.id}`}
                      >
                        <span className="font-mono text-xs font-semibold">
                          <Link href={`/companies/${c.id}`} className="hover:text-fc-teal hover:underline">
                            {c.ticker ?? "—"}
                          </Link>
                        </span>
                        <span className="truncate text-fc-ink-3">{c.name}</span>
                        <span className="font-mono md:text-right">{fmtPrice(view?.quote?.price)}</span>
                        <span
                          className={cn(
                            "font-mono md:text-right",
                            (view?.quote?.changesPercentage ?? 0) < 0 ? "text-fc-oxide-bright" : "text-fc-forest-bright"
                          )}
                        >
                          {fmtPctChange(view?.quote?.changesPercentage)}
                        </span>
                        <span className="font-mono md:text-right">{fmtPrice(consensus?.avgPriceTarget)}</span>
                        <span className="capitalize text-fc-ink-3 md:text-right">
                          {consensus?.rating ? consensus.rating.replace(/_/g, " ") : "—"} ·{" "}
                          {consensus?.totalRatings ?? 0} analysts
                        </span>
                      </div>
                    );
                  })}
                </Panel>
              </section>
            )}
          </>
        )}
      </PageBody>
    </AppLayout>
  );
}
