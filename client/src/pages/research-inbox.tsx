// Research Inbox — capture, then classify in one pass. Manual entry only: no
// scraper, no bot, no automated capture. That constraint is what makes the
// audit trail mean anything, so the page says so rather than hiding it.

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { ActionButton, Chip, LoadingBlock, PageHeader, Panel, PanelTitle, SectionLabel, type Tone } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DIRECTIONS,
  PROVENANCE_LABELS,
  TIER_LABELS,
  humanize,
} from "@/lib/design";
import { cn } from "@/lib/utils";
import type { Company, ResearchInboxItem, Thesis } from "@shared/schema";

interface SegmentInfo {
  name: string;
  note: string;
  tickers: string[];
}

const CATEGORIES = [
  "partnership_or_supply_chain",
  "price_action",
  "insider_activity",
  "analyst_action",
  "patent_filing",
  "regulatory_filing",
  "hiring_signal",
  "web_traffic_signal",
  "macro_indicator",
];
const PROVENANCE = [
  "human_authored_research",
  "unverified_rumor_or_social_claim",
  "investment_hypothesis",
  "detected_signal",
  "confirmed_event",
];
const TIERS = ["unverified", "single_source", "corroborated"];

const FIELD =
  "w-full rounded-md border border-fc-rule-strong bg-fc-surface px-3 py-2 text-[12.5px] leading-none text-fc-ink placeholder:text-fc-ink-3 focus:border-fc-teal focus:outline-none";

/**
 * A hint, drawn from what the author wrote in the source-context box. It is a
 * prompt for the human classifier, never a classification in itself — the
 * signal only gets a tier when someone picks one below.
 */
function contextHint(sourceContext: string): { label: string; tone: Tone } {
  if (/my own|own reasoning|own hypothesis|no external source/i.test(sourceContext)) {
    return { label: "Own hypothesis", tone: "iris" };
  }
  if (/https?:\/\/|\.com|\.org|deck|filing|prospectus|investor|transcript|report|slide/i.test(sourceContext)) {
    return { label: "Primary source available", tone: "confirming" };
  }
  return { label: "Unverified", tone: "neutral" };
}

function LabeledSelect({
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
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-medium leading-none text-fc-ink-3">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="h-auto w-full border-fc-rule-strong bg-fc-surface px-3 py-2 text-[12.5px] leading-none text-fc-ink"
          data-testid={`select-promote-${testId}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ClassifyForm({
  item,
  thesisId,
  companies,
  onDone,
}: {
  item: ResearchInboxItem;
  thesisId?: number;
  companies: Company[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [signalCategory, setCategory] = useState(CATEGORIES[0]);
  const [provenanceClass, setProvenance] = useState(PROVENANCE[0]);
  const [verificationTier, setTier] = useState(TIERS[0]);
  const [direction, setDirection] = useState<"confirming" | "contradicting" | "neutral">("neutral");
  const [companyId, setCompanyId] = useState("none");

  const promote = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${item.id}/promote`, {
        thesisId: thesisId ?? null,
        companyId: companyId === "none" ? null : Number(companyId),
        title: title.trim(),
        signalCategory,
        provenanceClass,
        verificationTier,
        direction,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/audit"] });
      toast({ title: "Promoted to signal" });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Promote failed", description: err.message, variant: "destructive" }),
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${item.id}/dismiss`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({ title: "Note dismissed" });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Dismiss failed", description: err.message, variant: "destructive" }),
  });

  return (
    <form
      className="border-t border-fc-rule-soft bg-fc-surface-sunk px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) promote.mutate();
      }}
    >
      <SectionLabel className="mb-3">Classify to promote</SectionLabel>

      <div className="mb-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[11px] font-medium leading-none text-fc-ink-3">Signal title</span>
          <input
            className={FIELD}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="One line, as it should read in the register"
            required
            data-testid="input-promote-title"
          />
        </label>
        <LabeledSelect
          label="Category"
          value={signalCategory}
          onChange={setCategory}
          testId="category"
          options={CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))}
        />
        <LabeledSelect
          label="Provenance"
          value={provenanceClass}
          onChange={setProvenance}
          testId="provenance"
          options={PROVENANCE.map((p) => ({ value: p, label: PROVENANCE_LABELS[p] ?? humanize(p) }))}
        />
        <LabeledSelect
          label="Verification tier"
          value={verificationTier}
          onChange={setTier}
          testId="tier"
          options={TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
        />
        <LabeledSelect
          label="Company (optional)"
          value={companyId}
          onChange={setCompanyId}
          testId="company"
          options={[
            { value: "none", label: "Not company-specific" },
            ...companies.map((c) => ({ value: String(c.id), label: `${c.ticker ?? ""} ${c.name}`.trim() })),
          ]}
        />
      </div>

      <span className="mb-1.5 block text-[11px] font-medium leading-none text-fc-ink-3">
        Direction relative to the thesis
      </span>
      <div className="mb-3.5 flex gap-2">
        {DIRECTIONS.map((d) => {
          const selected = direction === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              aria-pressed={selected}
              data-testid={`button-direction-${d}`}
              className={cn(
                "flex-1 rounded-md py-2.5 text-center text-xs capitalize leading-none transition-colors",
                selected
                  ? d === "confirming"
                    ? "border-[1.5px] border-fc-forest-bright bg-fc-forest-wash font-display font-semibold text-fc-forest"
                    : d === "contradicting"
                      ? "border-[1.5px] border-fc-oxide-bright bg-fc-oxide-wash font-display font-semibold text-fc-oxide"
                      : "border-[1.5px] border-fc-ink-4 bg-fc-chip font-display font-semibold text-fc-ink-2"
                  : "border border-fc-rule-strong bg-fc-surface font-medium text-fc-ink-3"
              )}
            >
              {d}
            </button>
          );
        })}
      </div>

      {verificationTier === "unverified" && (
        <p className="mb-3.5 text-pretty rounded-md border border-fc-ochre-line bg-fc-ochre-panel px-3 py-2.5 text-[11.5px] leading-[1.6] text-fc-ochre-deep">
          This will enter the evidence board tagged <strong className="font-semibold">unverified</strong> and carry a low
          reliability weight. The label stays on the signal permanently and cannot be removed — only upgraded by
          attaching a corroborating source.
        </p>
      )}

      <div className="flex gap-2">
        <ActionButton tone="primary" type="submit" disabled={!title.trim() || promote.isPending} testId={`button-submit-promote-${item.id}`}>
          {promote.isPending ? "Creating…" : "Create signal"}
        </ActionButton>
        <ActionButton tone="quiet" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} testId={`button-dismiss-${item.id}`}>
          Dismiss
        </ActionButton>
      </div>
    </form>
  );
}

export default function ResearchInbox() {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const [rawText, setRawText] = useState("");
  const [sourceContext, setSourceContext] = useState("");

  const { data: items, isLoading } = useQuery<ResearchInboxItem[]>({ queryKey: ["/api/inbox"] });
  const { data: theses } = useQuery<Thesis[]>({ queryKey: ["/api/theses"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: segmentsData } = useQuery<{ thesisTitle: string; segments: SegmentInfo[] }>({ queryKey: ["/api/segments"] });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox", { rawText: rawText.trim(), sourceContext: sourceContext.trim() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      setRawText("");
      setSourceContext("");
      toast({ title: "Note added to inbox" });
    },
    onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const pending = useMemo(
    () =>
      (items ?? [])
        .filter((i) => i.status === "pending")
        .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()),
    [items]
  );
  const resolved = useMemo(() => (items ?? []).filter((i) => i.status !== "pending"), [items]);
  const promoted = resolved.filter((i) => i.status === "promoted").length;

  // The first pending note opens straight into the classify form — the point
  // of the page is to clear the queue, not to admire it.
  const expandedId = openId ?? pending[0]?.id ?? null;
  const emptySegments = (segmentsData?.segments ?? []).filter((s) => s.tickers.length === 0);

  return (
    <AppLayout>
      <PageHeader
        title="Research Inbox"
        subtitle={`${pending.length} pending · ${promoted} promoted to signals · manual entry only`}
      />

      <div className="grid items-start gap-6 px-5 pb-10 pt-6 md:px-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2.5">
            <PanelTitle>Pending — classify or dismiss</PanelTitle>
            <span className="ml-auto text-[11.5px] leading-none text-fc-ink-3">oldest first</span>
          </div>

          {isLoading ? (
            <LoadingBlock height={200} />
          ) : pending.length === 0 ? (
            <Panel testId="text-no-pending-items">
              <p className="text-[13px] leading-relaxed text-fc-ink-3">
                Nothing pending. Anything you add on the right lands here to be classified.
              </p>
            </Panel>
          ) : (
            pending.map((item) => {
              const hint = contextHint(item.sourceContext);
              const expanded = expandedId === item.id;
              return (
                <Panel key={item.id} flush testId={`card-inbox-item-${item.id}`}>
                  <div className="px-5 py-[18px]">
                    <p className="text-pretty text-[13.5px] leading-[1.7] text-fc-ink">{item.rawText}</p>
                    <p className="mt-3 rounded-md border border-fc-rule-soft bg-fc-surface-sunk px-3 py-2.5 text-[11.5px] leading-[1.5] text-fc-ink-3">
                      <strong className="font-semibold text-fc-ink">Source context:</strong> {item.sourceContext}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Chip tone={hint.tone} size="lead">
                        {hint.label}
                      </Chip>
                      <span className="text-[11.5px] leading-none text-fc-ink-3">
                        submitted {new Date(item.submittedAt).toLocaleString()}
                      </span>
                      {!expanded && (
                        <button
                          type="button"
                          onClick={() => setOpenId(item.id)}
                          data-testid={`button-classify-${item.id}`}
                          className="ml-auto rounded-md border border-fc-teal px-3.5 py-2 font-display text-xs font-semibold leading-none text-fc-teal hover:bg-fc-teal-wash"
                        >
                          Classify
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <ClassifyForm
                      item={item}
                      thesisId={theses?.[0]?.id}
                      companies={companies ?? []}
                      onDone={() => setOpenId(null)}
                    />
                  )}
                </Panel>
              );
            })
          )}

          {resolved.length > 0 && (
            <div className="mt-1.5">
              <SectionLabel className="mb-2.5">Resolved · {resolved.length}</SectionLabel>
              <Panel flush>
                {resolved.map((item, i) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 px-[18px] py-3 text-[12.5px] leading-snug text-fc-ink-3",
                      i < resolved.length - 1 && "border-b border-fc-rule-soft"
                    )}
                    data-testid={`row-resolved-${item.id}`}
                  >
                    <span className="flex-1 truncate">{item.rawText}</span>
                    <Chip tone={item.status === "promoted" ? "confirming" : "neutral"} size="lead" className="border-transparent capitalize">
                      {item.status}
                    </Chip>
                  </div>
                ))}
              </Panel>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-5">
          <Panel testId="card-inbox-form">
            <PanelTitle className="mb-3.5 block">Add a research note</PanelTitle>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (rawText.trim() && sourceContext.trim()) submit.mutate();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium leading-none text-fc-ink-3">Raw text</span>
                <textarea
                  rows={5}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  required
                  placeholder="Paste what you personally saw. Keep the original wording — the classifier is you, later."
                  data-testid="input-raw-text"
                  className={cn(FIELD, "min-h-[120px] resize-y py-3 leading-[1.6]")}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] font-medium leading-none text-fc-ink-3">
                  Source context <span className="text-fc-oxide">required</span>
                </span>
                <input
                  value={sourceContext}
                  onChange={(e) => setSourceContext(e.target.value)}
                  required
                  placeholder="Where you saw it, when, and whether you may share it"
                  data-testid="input-source-context"
                  className={FIELD}
                />
              </label>
              <ActionButton
                tone="primary"
                type="submit"
                className="mt-3.5 w-full"
                disabled={!rawText.trim() || !sourceContext.trim() || submit.isPending}
                testId="button-submit-inbox"
              >
                {submit.isPending ? "Saving…" : "Add to inbox"}
              </ActionButton>
            </form>
          </Panel>

          <Panel tone="teal" testId="panel-why-manual">
            <SectionLabel className="mb-3 text-fc-teal">Why this page is manual</SectionLabel>
            <p className="text-pretty text-[12.5px] leading-[1.7] text-fc-ink-2">
              There is no scraper, no bot and no automated capture behind this box. Every item here was typed by a human
              who saw the thing and is authorised to record it. That constraint is what makes the audit trail
              meaningful — and it is deliberate, not a missing feature.
            </p>
          </Panel>

          {emptySegments.length > 0 && (
            <Panel tone="gap" testId="panel-inbox-gap">
              <PanelTitle className="mb-2.5 block text-fc-ochre-deep">Gap this inbox should be filling</PanelTitle>
              <p className="text-pretty text-[12.5px] leading-[1.65] text-fc-ochre-deep">
                {emptySegments.map((s) => s.name).join(" and ")}{" "}
                {emptySegments.length === 1 ? "still has" : "still have"} zero named companies. Promoting a note that
                points at {emptySegments.length === 1 ? "it" : "them"} is the single highest-value action available
                right now.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
