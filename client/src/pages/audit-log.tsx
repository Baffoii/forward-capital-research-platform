import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import type { AuditLog } from "@shared/schema";

const EVENT_LABELS: Record<string, string> = {
  ingestion: "Ingestion",
  score_computed: "Score computed",
  signal_created: "Signal created",
  signal_promoted: "Signal promoted",
  source_synced: "Source synced",
};

const COMPLIANCE_NOTES = [
  "No material non-public information (MNPI) is knowingly collected, stored, or displayed.",
  "No automated trade execution, order entry, or broker connections exist anywhere in this application.",
  "No self-botting: the Research Inbox is a manual, human-entry-only capture page — never an automated scraper of any chat platform.",
  "Source attribution is preserved on every signal: source_id, source_url (when available), retrieved_at, and ingestion_method are all stored.",
  "Third-party terms of service are respected — only free/already-connected, no-per-call-confirmation sources are wired into live ingestion.",
];

export default function AuditLogPage() {
  const { data: logs, isLoading } = useQuery<AuditLog[]>({ queryKey: ["/api/audit"] });

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Compliance & Audit Log</h1>
          <p className="text-sm text-muted-foreground">Read-only feed of ingestion and scoring events.</p>
        </div>

        <Card data-testid="card-compliance-notes">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Compliance notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {COMPLIANCE_NOTES.map((note, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`text-compliance-note-${i}`}>
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card data-testid="card-audit-feed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Audit trail</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : logs && logs.length > 0 ? (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3" data-testid={`row-audit-${log.id}`}>
                    <div>
                      <Badge variant="outline" className="mb-1 text-[10px]">{EVENT_LABELS[log.eventType] ?? log.eventType}</Badge>
                      <p className="text-sm text-muted-foreground leading-relaxed">{log.description}</p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-audit-logs">No audit events yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
