// Sources — reliability is a multiplier inside every signal score, so it is
// shown as one: a weight you can see and change, next to what it is weighing.

import { useMemo, useRef, useState, type RefObject } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import {
  ActionButton,
  Chip,
  LoadingBlock,
  Meter,
  PageBody,
  PageHeader,
  Panel,
  PanelTitle,
  SectionLabel,
  type Tone,
} from "@/components/kit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtStampUtc, humanize } from "@/lib/design";
import { cn } from "@/lib/utils";
import type { Signal, Source } from "@shared/schema";

const ROW_GRID = "md:grid-cols-[minmax(0,1fr)_110px_150px_260px]";

const KIND_LABELS: Record<string, { label: string; tone: Tone }> = {
  free_api: { label: "Live · public API", tone: "confirming" },
  connector: { label: "Pushed via ingest", tone: "azure" },
  manual: { label: "Manual entry", tone: "neutral" },
};

const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  needs_key: { label: "Key required", tone: "ochre" },
  not_connected: { label: "Not connected", tone: "neutral" },
};

function reliabilityColor(score: number): string {
  if (score >= 0.8) return "var(--fc-forest-bright)";
  if (score >= 0.55) return "var(--fc-azure-bright)";
  return "var(--fc-amber)";
}

function ReliabilityCell({ source, dim }: { source: Source; dim?: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(source.reliabilityScore));

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/sources/${source.id}`, { reliabilityScore: Number(value) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      toast({ title: `Updated reliability for ${source.name}` });
      setEditing(false);
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid={`input-reliability-${source.id}`}
          className="w-20 rounded-md border border-fc-rule-strong bg-fc-surface px-2 py-1.5 font-mono text-xs text-fc-ink focus:border-fc-teal focus:outline-none"
        />
        <ActionButton
          tone="primary"
          className="px-2.5 py-1.5 text-[11.5px]"
          onClick={() => update.mutate()}
          disabled={update.isPending}
          testId={`button-save-reliability-${source.id}`}
        >
          Save
        </ActionButton>
        <button
          type="button"
          onClick={() => {
            setValue(String(source.reliabilityScore));
            setEditing(false);
          }}
          className="text-[11.5px] font-medium text-fc-ink-3 hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <Meter
        value={source.reliabilityScore}
        color={dim ? "var(--fc-ink-5)" : reliabilityColor(source.reliabilityScore)}
        className="flex-1"
        ariaLabel={`Reliability weight for ${source.name}`}
      />
      <span className={cn("w-9 text-right font-mono text-[13px] font-semibold leading-none", dim && "text-fc-ink-3")}>
        {source.reliabilityScore.toFixed(2)}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        data-testid={`button-edit-reliability-${source.id}`}
        className="rounded-md border border-fc-rule-strong px-2.5 py-1.5 text-[11.5px] font-medium leading-none text-fc-ink-3 hover:bg-fc-chip"
      >
        Edit
      </button>
    </div>
  );
}

function UsptoKeyCard({ innerRef }: { innerRef: RefObject<HTMLDivElement> }) {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const { data } = useQuery<{ hasKey: boolean }>({ queryKey: ["/api/settings/uspto_api_key"] });

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/uspto_api_key", { value: key });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/uspto_api_key"] });
      toast({ title: "USPTO API key saved" });
      setKey("");
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div ref={innerRef} className="scroll-mt-6">
      <Panel className="px-[22px] py-5" testId="card-uspto-key">
        <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
          <PanelTitle>USPTO PatentSearch API key</PanelTitle>
          <Chip tone={data?.hasKey ? "confirming" : "ochre"} size="lead" testId="badge-uspto-key-status">
            {data?.hasKey ? "Key set" : "No key set"}
          </Chip>
        </div>
        <p className="mb-3.5 text-pretty text-[12.5px] leading-[1.65] text-fc-ink-3">
          Free to register at{" "}
          <a href="https://patentsview.org/apis" target="_blank" rel="noreferrer" className="text-fc-teal hover:underline">
            patentsview.org/apis
          </a>
          . Stored server-side, never sent back to the browser once saved.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key) save.mutate();
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste API key…"
            data-testid="input-uspto-key"
            className="flex-1 rounded-md border border-fc-rule-strong bg-fc-surface px-3 py-2.5 font-mono text-[12.5px] leading-none text-fc-ink placeholder:text-fc-ink-3 focus:border-fc-teal focus:outline-none"
          />
          <ActionButton tone="primary" type="submit" disabled={!key || save.isPending} testId="button-save-uspto-key">
            {save.isPending ? "Saving…" : "Save"}
          </ActionButton>
        </form>
      </Panel>
    </div>
  );
}

export default function SourceManagement() {
  const keyCardRef = useRef<HTMLDivElement>(null);
  const { data: sources, isLoading } = useQuery<Source[]>({ queryKey: ["/api/sources"] });
  const { data: signals } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const { data: usptoKey } = useQuery<{ hasKey: boolean }>({ queryKey: ["/api/settings/uspto_api_key"] });

  const signalsBySource = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of signals ?? []) counts.set(s.sourceId, (counts.get(s.sourceId) ?? 0) + 1);
    return counts;
  }, [signals]);

  // A source that requires a key is only blocked while the key is missing.
  const isBlocked = (source: Source) => source.requiresKey && !usptoKey?.hasKey;
  const needsKey = (sources ?? []).filter(isBlocked).length;
  const connected = (sources ?? []).filter((s) => s.lastSyncedAt).length;

  return (
    <AppLayout>
      <PageHeader
        title="Sources"
        subtitle={`${connected} synced · ${needsKey} needs a key · reliability feeds directly into every signal score`}
      />

      <PageBody>
        {isLoading ? (
          <LoadingBlock height={280} />
        ) : (
          <Panel flush testId="card-source-list">
            <div
              className={cn(
                "hidden border-b border-fc-rule-soft bg-fc-surface-sunk px-[22px] py-3 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3 md:grid",
                ROW_GRID
              )}
            >
              <span>Source</span>
              <span>Signals</span>
              <span>Last synced</span>
              <span>Reliability weight</span>
            </div>

            {(sources ?? []).map((source, i, arr) => {
              const blocked = isBlocked(source);
              const kind = blocked
                ? STATUS_LABELS.needs_key
                : STATUS_LABELS[source.status] ??
                  KIND_LABELS[source.kind] ?? { label: humanize(source.kind), tone: "neutral" as Tone };
              const count = signalsBySource.get(source.id) ?? 0;

              return (
                <div
                  key={source.id}
                  className={cn(
                    "grid grid-cols-1 items-center gap-3 px-[22px] py-4 md:gap-0",
                    ROW_GRID,
                    blocked && "bg-fc-ochre-panel",
                    i < arr.length - 1 && "border-b border-fc-rule-soft"
                  )}
                  data-testid={`row-source-${source.id}`}
                >
                  <div className="pr-6">
                    <div className="mb-1 flex flex-wrap items-center gap-2.5">
                      <span className="font-display text-[13.5px] font-semibold leading-none">{source.name}</span>
                      <Chip tone={kind.tone} size="lead">
                        {kind.label}
                      </Chip>
                    </div>
                    <p className={cn("text-[11.5px] leading-[1.5]", blocked ? "text-fc-ochre-deep" : "text-fc-ink-3")}>
                      {source.description ?? `Registered as ${source.sourceIdentifier}.`}
                    </p>
                  </div>

                  <span className={cn("font-mono text-sm font-semibold leading-none", count === 0 && "text-fc-ink-3")}>
                    {count}
                  </span>

                  <span className="text-xs leading-snug text-fc-ink-3">
                    {source.lastSyncedAt ? fmtStampUtc(source.lastSyncedAt) : "never"}
                  </span>

                  {blocked ? (
                    <div className="flex items-center gap-2.5">
                      <Meter value={source.reliabilityScore} color="var(--fc-ink-5)" className="flex-1" />
                      <span className="w-9 text-right font-mono text-[13px] font-semibold leading-none text-fc-ink-3">
                        {source.reliabilityScore.toFixed(2)}
                      </span>
                      <ActionButton
                        tone="ochre"
                        className="px-2.5 py-1.5 text-[11.5px]"
                        onClick={() => keyCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        testId="button-goto-uspto-key"
                      >
                        Add key
                      </ActionButton>
                    </div>
                  ) : (
                    <ReliabilityCell source={source} />
                  )}
                </div>
              );
            })}
          </Panel>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <UsptoKeyCard innerRef={keyCardRef} />

          <Panel className="border-dashed border-fc-ink-5 px-[22px] py-5" testId="card-phase2-note">
            <SectionLabel className="mb-2.5">Phase 2 — not wired in</SectionLabel>
            <p className="mb-3 text-pretty text-[12.5px] leading-[1.65] text-fc-ink-3">
              Candidates only. Neither will ever be called without an explicit, freshly-worded confirmation immediately
              before each request.
            </p>
            <div className="flex flex-col gap-2">
              {[
                "Unusual Whales — options flow",
                "Tradytics — options / dark-pool analytics",
              ].map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2.5 rounded-md border border-fc-rule-soft bg-fc-surface-sunk px-3 py-2.5"
                >
                  <span className="flex-1 text-[12.5px] font-medium leading-none">{name}</span>
                  <span className="text-[10.5px] font-semibold leading-none text-fc-ink-3">Not connected</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </PageBody>
    </AppLayout>
  );
}
