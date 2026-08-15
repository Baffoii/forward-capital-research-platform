import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { ConfidenceGauge } from "@/components/confidence-gauge";
import { SignalCard } from "@/components/evidence-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { confidenceToGauge } from "@/lib/scoring-client";
import { AlertOctagon, RefreshCw, ShieldAlert } from "lucide-react";
import type { Thesis, ThesisAssumption, Signal } from "@shared/schema";
import { ResearchBotPanel } from "@/components/research-bot-panel";

interface EvidenceResponse {
  confirming: (Signal & { score: number })[];
  contradicting: (Signal & { score: number })[];
  neutral: (Signal & { score: number })[];
}

export default function ThesisWorkspace() {
  const { toast } = useToast();
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

  const gauge = thesis?.confidenceScore != null ? confidenceToGauge(thesis.confidenceScore) : 0;
  const isLoading = loadingTheses;

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">
              Thesis Workspace
            </h1>
            <p className="text-sm text-muted-foreground">Evidence-weighing tool. No recommendations, no predictions.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => recompute.mutate()}
            disabled={!thesis || recompute.isPending}
            data-testid="button-recompute-score"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${recompute.isPending ? "animate-spin" : ""}`} />
            Recompute confidence
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !thesis ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-thesis">
            No thesis found. Seed data may not have loaded.
          </p>
        ) : (
          <>
            <Card data-testid="card-thesis-detail">
              <CardHeader>
                <CardTitle className="text-base font-semibold" data-testid="text-thesis-title">
                  {thesis.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</h3>
                  <p className="text-sm leading-relaxed" data-testid="text-thesis-summary">
                    {thesis.summary}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prediction</h3>
                  <p className="text-sm leading-relaxed" data-testid="text-thesis-prediction">
                    {thesis.prediction}
                  </p>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assumptions</h3>
                  {loadingAssumptions ? (
                    <Skeleton className="h-16 w-full" />
                  ) : (
                    <ul className="space-y-1.5">
                      {assumptions?.map((a) => (
                        <li key={a.id} className="flex items-start gap-2 text-sm" data-testid={`text-assumption-${a.id}`}>
                          <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px] capitalize">
                            {a.importance}
                          </Badge>
                          <span className="text-muted-foreground">{a.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            <ResearchBotPanel thesis={thesis} />

            <Card data-testid="card-confidence-math">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Confidence gauge</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ConfidenceGauge gauge={gauge} />
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none font-medium text-foreground" data-testid="toggle-confidence-math">
                    How is this calculated?
                  </summary>
                  <div className="mt-2 space-y-1 font-mono leading-relaxed">
                    <p>signal_score = reliability × relevance × direction_multiplier × recency_decay</p>
                    <p>confidence = clamp( Σ signal_score / count(signals), -1, 1 )</p>
                    <p>direction_multiplier: confirming=+1, contradicting=-1, neutral=0</p>
                    <p>recency_decay = exp(-days_since_retrieved / half_life_days)</p>
                  </div>
                </details>
              </CardContent>
            </Card>

            {/* Non-dismissible contradicting-evidence panel — always renders, cannot be closed. */}
            <Card
              className="border-rose-500/40 bg-rose-500/[0.03]"
              data-testid="panel-contradicting-evidence"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-400">
                  <AlertOctagon className="h-4 w-4" />
                  Strongest counter-evidence
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  This panel cannot be dismissed. It always shows the highest-magnitude contradicting evidence for
                  this thesis, sorted strongest first.
                </p>
              </CardHeader>
              <CardContent>
                {loadingEvidence ? (
                  <Skeleton className="h-24 w-full" />
                ) : evidence && evidence.contradicting.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {evidence.contradicting.slice(0, 5).map((s) => (
                      <SignalCard key={s.id} signal={s} score={s.score} />
                    ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-dashed border-rose-500/30 p-4" data-testid="text-no-contradicting-evidence">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    <p className="text-sm text-rose-600 dark:text-rose-400">
                      No contradicting evidence found yet — this is a gap, not a clean bill of health.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="panel-confirming-evidence">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Confirming evidence</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingEvidence ? (
                  <Skeleton className="h-24 w-full" />
                ) : evidence && evidence.confirming.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {evidence.confirming.slice(0, 6).map((s) => (
                      <SignalCard key={s.id} signal={s} score={s.score} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-confirming-evidence">
                    No confirming evidence attached yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
