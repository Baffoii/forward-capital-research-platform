import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout";
import { ConfidenceGauge } from "@/components/confidence-gauge";
import { SignalCard } from "@/components/evidence-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Thesis, Signal, Company } from "@shared/schema";
import { confidenceToGauge } from "@/lib/scoring-client";

interface SegmentInfo {
  name: string;
  note: string;
  tickers: string[];
}

export default function Dashboard() {
  const { toast } = useToast();
  const { data: theses, isLoading: loadingTheses } = useQuery<Thesis[]>({ queryKey: ["/api/theses"] });
  const thesis = theses?.[0];
  const { data: segmentsData, isLoading: loadingSegments } = useQuery<{ thesisTitle: string; segments: SegmentInfo[] }>({
    queryKey: ["/api/segments"],
  });
  const { data: companies, isLoading: loadingCompanies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: signals, isLoading: loadingSignals } = useQuery<Signal[]>({
    queryKey: ["/api/signals", { thesisId: thesis?.id }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signals${thesis ? `?thesisId=${thesis.id}` : ""}`);
      return res.json();
    },
    enabled: !!thesis,
  });

  const recompute = useMutation({
    mutationFn: async () => {
      if (!thesis) return;
      const res = await apiRequest("POST", `/api/thesis/${thesis.id}/recompute-score`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/theses"] });
      toast({ title: "Confidence score recomputed" });
    },
    onError: (err: Error) => toast({ title: "Recompute failed", description: err.message, variant: "destructive" }),
  });

  const gauge = thesis?.confidenceScore != null ? confidenceToGauge(thesis.confidenceScore) : 0;

  const companyCountBySegment = (tickers: string[]) =>
    companies?.filter((c) => tickers.includes(c.ticker ?? "")).length ?? 0;

  const isLoading = loadingTheses || loadingSegments;

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">
              Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">Thesis-testing overview — not a stock-tip generator.</p>
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

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-1" data-testid="card-confidence-gauge">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Thesis confidence</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-24 w-full" /> : <ConfidenceGauge gauge={gauge} />}
            </CardContent>
          </Card>

          <Card className="md:col-span-2" data-testid="card-thesis-summary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium" data-testid="text-thesis-title">
                {thesis?.title ?? "No active thesis"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-thesis-prediction">
                    {thesis?.prediction}
                  </p>
                  <Link href="/thesis">
                    <a className="mt-3 inline-block text-sm text-primary hover:underline" data-testid="link-view-thesis-workspace">
                      Open Thesis Workspace →
                    </a>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Segment breakdown</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {loadingSegments || loadingCompanies
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
              : segmentsData?.segments.map((seg) => {
                  const count = companyCountBySegment(seg.tickers);
                  const isGap = seg.tickers.length === 0;
                  return (
                    <Card key={seg.name} className={isGap ? "border-amber-500/40" : ""} data-testid={`card-segment-${seg.name.replace(/\s+/g, "-").toLowerCase()}`}>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center justify-between text-sm font-medium">
                          {seg.name}
                          {isGap && <AlertTriangle className="h-4 w-4 text-amber-500" data-testid="icon-segment-gap" />}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {isGap ? (
                          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400" data-testid="text-segment-gap-message">
                            No companies identified yet — this is the thesis's core unproven bet. Add candidates via
                            Research Inbox.
                          </p>
                        ) : (
                          <>
                            <p className="font-mono text-2xl font-semibold" data-testid={`text-segment-count-${seg.name.replace(/\s+/g, "-").toLowerCase()}`}>
                              {count}
                            </p>
                            <p className="text-xs text-muted-foreground">companies tracked</p>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent signals</h2>
            <Link href="/signals">
              <a className="text-xs text-primary hover:underline" data-testid="link-view-all-signals">
                View all →
              </a>
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {loadingSignals
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
              : signals?.slice(0, 6).map((s) => <SignalCard key={s.id} signal={s} />)}
            {!loadingSignals && signals?.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-no-signals">
                No signals yet. Sync a source or add one via the Research Inbox.
              </p>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
