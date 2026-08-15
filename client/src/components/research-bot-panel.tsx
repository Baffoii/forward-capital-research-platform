import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, ExternalLink, Search, ShieldAlert } from "lucide-react";
import type { Company, Thesis } from "@shared/schema";
import { THESIS_RESEARCH_CANDIDATES, type ResearchBotReport, type SpecialistFinding } from "@shared/research-bot";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const AGENT_LABELS: Record<SpecialistFinding["agent"], string> = {
  infrastructure_demand: "Demand",
  supply_constraint: "Supply constraint",
  market_awareness: "Market awareness",
  skeptic: "Red team",
};

function stanceClasses(stance: SpecialistFinding["stance"] | ResearchBotReport["verdict"]["verdict"]) {
  if (stance === "supports" || stance === "supported") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (stance === "contradicts" || stance === "weakened") return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (stance === "mixed") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-border bg-muted text-muted-foreground";
}

export function ResearchBotPanel({ thesis }: { thesis: Thesis }) {
  const [focusTicker, setFocusTicker] = useState("");
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const research = useMutation<ResearchBotReport, Error>({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/theses/${thesis.id}/research-bot`, { focusTicker: focusTicker || undefined });
      return response.json();
    },
  });
  const focusOptions = [
    ...THESIS_RESEARCH_CANDIDATES,
    ...(companies ?? [])
      .filter((company) => company.ticker && !THESIS_RESEARCH_CANDIDATES.some((item) => item.ticker === company.ticker))
      .map((company) => ({ ticker: company.ticker!, name: company.name, category: company.segment, bottleneck: company.description ?? "Existing app company" })),
  ].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const report = research.data;

  return (
    <Card data-testid="panel-research-bot">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" /> Research Bot
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Four independent research agents plus adversarial adjudication</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="research-focus">Focus company</label>
            <select
              id="research-focus"
              value={focusTicker}
              onChange={(event) => setFocusTicker(event.target.value)}
              disabled={research.isPending}
              className="h-9 max-w-[240px] rounded-md border border-input bg-background px-3 text-xs shadow-sm outline-none focus:ring-1 focus:ring-ring"
              data-testid="select-research-focus"
            >
              <option value="">Test full thesis</option>
              {focusOptions.map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker} · {company.name}</option>)}
            </select>
            <Button size="sm" onClick={() => research.mutate()} disabled={research.isPending} data-testid="button-run-research-bot">
              <Search className={`mr-2 h-3.5 w-3.5 ${research.isPending ? "animate-pulse" : ""}`} />
              {research.isPending ? "Agents researching…" : "Run fresh test"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!report && !research.isError && (
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Tests the prediction, assumptions, supplied candidate universe, and existing signals against current public-web evidence. Specialists independently assess demand, physical scarcity, market awareness, and the bear case.
            </p>
            <p className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              Reports are not added to the evidence ledger automatically. Review source links before promoting a finding.
            </p>
          </div>
        )}

        {research.isError && (
          <div className="flex gap-3 rounded-md border border-rose-500/30 bg-rose-500/[0.06] p-4 text-rose-700 dark:text-rose-300" data-testid="research-bot-error">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-medium">Research run could not complete</p><p className="mt-1 text-xs">{research.error.message}</p></div>
          </div>
        )}

        {report && (
          <>
            <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Committee verdict</p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="font-mono text-3xl font-semibold" data-testid="text-research-confidence">{Math.round(report.verdict.confidence)}</span>
                  <span className="pb-1 text-xs text-muted-foreground">/ 100 confidence</span>
                </div>
                <Badge variant="outline" className={`mt-3 capitalize ${stanceClasses(report.verdict.verdict)}`}>{report.verdict.verdict.replace("_", " ")}</Badge>
                <p className="mt-3 text-[10px] text-muted-foreground">{report.focusTicker ? `Focus: ${report.focusTicker}` : "Full thesis"} · {new Date(report.generatedAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adjudication</p>
                <p className="mt-2 text-sm leading-relaxed" data-testid="text-research-summary">{report.verdict.summary}</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div><p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Strongest evidence for</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{report.verdict.strongestEvidenceFor.map((item, index) => <li key={index}>• {item}</li>)}</ul></div>
                  <div><p className="text-xs font-medium text-rose-700 dark:text-rose-300">Strongest evidence against</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{report.verdict.strongestEvidenceAgainst.map((item, index) => <li key={index}>• {item}</li>)}</ul></div>
                </div>
              </div>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-2">
              {report.findings.map((finding) => (
                <div key={finding.agent} className="rounded-lg border p-4" data-testid={`card-agent-${finding.agent}`}>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{AGENT_LABELS[finding.agent]}</p>
                    <Badge variant="outline" className={`capitalize ${stanceClasses(finding.stance)}`}>{finding.stance.replace("_", " ")}</Badge>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{Math.round(finding.confidence)}%</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{finding.conclusion}</p>
                  <div className="mt-3 space-y-2 border-t pt-3">
                    {finding.evidence.map((evidence, index) => (
                      <a key={`${evidence.sourceUrl}-${index}`} href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="group block text-xs leading-relaxed text-muted-foreground hover:text-primary">
                        <span className="font-medium text-foreground group-hover:text-primary">{evidence.claim}</span>
                        <span className="mt-0.5 flex items-center gap-1">{evidence.sourceTitle} · {evidence.sourceQuality.replace("_", " ")} <ExternalLink className="h-3 w-3" /></span>
                      </a>
                    ))}
                    {finding.evidence.length === 0 && <p className="text-xs text-muted-foreground">No reliable source evidence returned.</p>}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-5 border-t pt-4 md:grid-cols-2">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unresolved questions</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{report.verdict.unresolvedQuestions.map((item, index) => <li key={index}>• {item}</li>)}</ul></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next checks</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{report.verdict.nextChecks.map((item, index) => <li key={index}>• {item}</li>)}</ul></div>
            </div>
            {report.agentErrors.length > 0 && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">Partial run: {report.agentErrors.map((error) => `${error.agent}: ${error.message}`).join(" · ")}</p>}
            <p className="text-[11px] text-muted-foreground">{report.disclaimer} Model: {report.model}.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

