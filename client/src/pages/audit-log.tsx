// Compliance & Audit — the guardrails written down as a standing statement,
// above the ordered record of everything the system ingested and scored.
// Read-only by construction: nothing on this page mutates anything.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import {
  ActionButton,
  Chip,
  FilterPill,
  LoadingBlock,
  PageBody,
  PageHeader,
  Panel,
  PanelHead,
  PanelTitle,
  SectionLabel,
  type Tone,
} from "@/components/kit";
import { EVENT_LABELS, fmtStampUtc, humanize } from "@/lib/design";
import { cn } from "@/lib/utils";
import type { AuditLog } from "@shared/schema";

const ROW_GRID = "md:grid-cols-[150px_minmax(0,1fr)_170px]";

const EVENT_TONES: Record<string, Tone> = {
  score_computed: "iris",
  ingestion: "azure",
  source_synced: "confirming",
  signal_promoted: "ochre",
  signal_created: "neutral",
};

const FILTERS: Array<{ key: string; label: string; events: string[] }> = [
  { key: "all", label: "All", events: [] },
  { key: "ingestion", label: "Ingestion", events: ["ingestion", "source_synced"] },
  { key: "scoring", label: "Scoring", events: ["score_computed"] },
  { key: "promotion", label: "Promotion", events: ["signal_promoted", "signal_created"] },
];

// The sixth is inked oxide: it is the one the interface itself enforces.
const GUARANTEES: Array<{ title: string; detail: string; critical?: boolean }> = [
  {
    title: "No material non-public information",
    detail: "MNPI is never knowingly collected, stored, or displayed anywhere in this application.",
  },
  {
    title: "No trade execution path exists",
    detail: "No order entry, no broker connection, no export to one. Not disabled — absent from the codebase.",
  },
  {
    title: "No self-botting",
    detail: "The Research Inbox is human-entry only, never an automated scraper of any chat platform or service.",
  },
  {
    title: "Provenance is preserved per signal",
    detail: "source_id, source_url, retrieved_at and ingestion_method are stored on every record without exception.",
  },
  {
    title: "Third-party terms respected",
    detail: "Only free or already-connected sources with no per-call confirmation are wired into live ingestion.",
  },
  {
    title: "Counter-evidence cannot be dismissed",
    detail:
      "The evidence-against panel has no close, collapse, or filter affordance. This is enforced in the component, not in policy.",
    critical: true,
  },
];

function toCsv(rows: AuditLog[]): string {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["id", "event_type", "description", "source_id", "created_at_utc"];
  const body = rows.map((r) => [r.id, r.eventType, r.description, r.sourceId ?? "", r.createdAt].map(escape).join(","));
  return [header.join(","), ...body].join("\n");
}

export default function AuditLogPage() {
  const [filter, setFilter] = useState("all");
  const { data: logs, isLoading } = useQuery<AuditLog[]>({ queryKey: ["/api/audit"] });

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const visible = useMemo(
    () => (active.events.length === 0 ? logs ?? [] : (logs ?? []).filter((l) => active.events.includes(l.eventType))),
    [logs, active]
  );

  const exportCsv = () => {
    const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `forward-capital-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <PageHeader
        title="Compliance & Audit"
        subtitle="Read-only. Every ingestion and scoring event, in order."
        actions={
          <ActionButton onClick={exportCsv} disabled={!visible.length} testId="button-export-audit">
            Export trail (CSV)
          </ActionButton>
        }
      />

      <PageBody>
        <Panel tone="teal" className="px-7 py-6" testId="card-compliance-notes">
          <SectionLabel className="mb-4 text-fc-teal">Standing guarantees</SectionLabel>
          <div className="grid gap-x-8 gap-y-[18px] md:grid-cols-2">
            {GUARANTEES.map((g, i) => (
              <div key={g.title} className="flex gap-3" data-testid={`text-compliance-note-${i}`}>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[11px] font-semibold leading-[1.6]",
                    g.critical ? "text-fc-oxide" : "text-fc-teal"
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="mb-1 text-[13px] font-medium leading-snug text-fc-ink">{g.title}</div>
                  <p className="text-pretty text-xs leading-[1.6] text-fc-ink-2">{g.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel flush testId="card-audit-feed">
          <PanelHead>
            <PanelTitle>Audit trail</PanelTitle>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <FilterPill
                  key={f.key}
                  active={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  testId={`filter-audit-${f.key}`}
                >
                  {f.label}
                </FilterPill>
              ))}
            </div>
          </PanelHead>

          <div
            className={cn(
              "hidden border-b border-fc-rule-soft bg-fc-surface-sunk px-[22px] py-2.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em] text-fc-ink-3 md:grid",
              ROW_GRID
            )}
          >
            <span>Event</span>
            <span>Description</span>
            <span className="text-right">Timestamp (UTC)</span>
          </div>

          {isLoading ? (
            <div className="p-5">
              <LoadingBlock height={200} className="border-0" />
            </div>
          ) : visible.length === 0 ? (
            <p className="px-[22px] py-6 text-[13px] text-fc-ink-3" data-testid="text-no-audit-logs">
              No audit events recorded for this filter.
            </p>
          ) : (
            visible.map((log, i) => (
              <div
                key={log.id}
                className={cn(
                  "grid grid-cols-1 items-center gap-2 px-[22px] py-3.5 md:gap-0",
                  ROW_GRID,
                  i < visible.length - 1 && "border-b border-fc-rule-soft"
                )}
                data-testid={`row-audit-${log.id}`}
              >
                <span className="justify-self-start">
                  <Chip tone={EVENT_TONES[log.eventType] ?? "neutral"} size="lead">
                    {EVENT_LABELS[log.eventType] ?? humanize(log.eventType)}
                  </Chip>
                </span>
                <span className="pr-5 text-[12.5px] leading-[1.5] text-fc-ink-2">{log.description}</span>
                <span className="font-mono text-[11.5px] font-medium leading-none text-fc-ink-3 md:text-right">
                  {fmtStampUtc(log.createdAt)}
                </span>
              </div>
            ))
          )}
        </Panel>
      </PageBody>
    </AppLayout>
  );
}
