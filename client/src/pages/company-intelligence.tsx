import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalCard } from "@/components/evidence-badges";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, KeyRound } from "lucide-react";
import type { Company, Signal } from "@shared/schema";

const SYNC_BUTTONS: Array<{ key: string; label: string }> = [
  { key: "quote", label: "Sync quote" },
  { key: "profile", label: "Sync profile" },
  { key: "insiders", label: "Sync insiders" },
  { key: "analysts", label: "Sync analysts" },
  { key: "similarweb", label: "Sync web signals" },
  { key: "filings", label: "Sync SEC filings" },
  { key: "patents", label: "Sync patents" },
];

export default function CompanyIntelligence() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

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

  const sync = useMutation({
    mutationFn: async (source: string) => {
      const res = await apiRequest("POST", `/api/companies/${id}/sync/${source}`);
      return res.json();
    },
    onSuccess: (_data, source) => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", id] });
      toast({ title: `Synced ${source}` });
    },
    onError: (err: Error, source) => {
      if (err.message.includes("MISSING_USPTO_KEY") || err.message.includes("USPTO PatentSearch API key")) {
        toast({
          title: "USPTO key required",
          description: "Add a free USPTO PatentSearch API key in Source Management to enable this",
          variant: "destructive",
        });
      } else {
        toast({ title: `Sync failed (${source})`, description: err.message, variant: "destructive" });
      }
    },
  });

  const quoteSignal = signals?.find((s) => s.signalCategory === "price_action");
  const quotePayload = quoteSignal?.rawPayload ? JSON.parse(quoteSignal.rawPayload) : null;
  const insiderSignals = signals?.filter((s) => s.signalCategory === "insider_activity") ?? [];
  const analystSignals = signals?.filter((s) => s.signalCategory === "analyst_action") ?? [];
  const patentSignals = signals?.filter((s) => s.signalCategory === "patent_filing") ?? [];
  const otherSignals = signals?.filter((s) => !["price_action", "insider_activity", "analyst_action", "patent_filing"].includes(s.signalCategory)) ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        {loadingCompany ? (
          <Skeleton className="h-24 w-full" />
        ) : !company ? (
          <p className="text-sm text-muted-foreground" data-testid="text-company-not-found">
            Company not found.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold" data-testid="text-company-name">
                  {company.name} <span className="font-mono text-base text-muted-foreground">{company.ticker}</span>
                </h1>
                <p className="text-sm text-muted-foreground" data-testid="text-company-meta">
                  {company.sector} · {company.industry} · {company.segment} segment
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {SYNC_BUTTONS.map((b) => (
                  <Button
                    key={b.key}
                    size="sm"
                    variant="outline"
                    onClick={() => sync.mutate(b.key)}
                    disabled={sync.isPending}
                    data-testid={`button-sync-${b.key}`}
                  >
                    <RefreshCw className="mr-1.5 h-3 w-3" />
                    {b.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card data-testid="card-company-profile">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">CEO</span><span>{company.ceo ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Employees</span><span className="font-mono">{company.employees?.toLocaleString() ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">IPO date</span><span className="font-mono">{company.ipoDate ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Website</span><span className="truncate">{company.website ?? "—"}</span></div>
                </CardContent>
              </Card>

              <Card data-testid="card-quote-block">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Live quote</CardTitle>
                </CardHeader>
                <CardContent>
                  {quotePayload ? (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-mono">${quotePayload.price}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Change</span><span className={`font-mono ${quotePayload.changesPercentage >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{quotePayload.changesPercentage}%</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Market cap</span><span className="font-mono">${Number(quotePayload.marketCap).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">P/E</span><span className="font-mono">{quotePayload.pe ?? "—"}</span></div>
                      <div className="text-[11px] text-muted-foreground/70">as of {new Date(quotePayload.as_of).toLocaleString()}</div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-quote-yet">No quote synced yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-analyst-consensus">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Analyst actions</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingSignals ? (
                  <Skeleton className="h-20 w-full" />
                ) : analystSignals.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {analystSignals.map((s) => <SignalCard key={s.id} signal={s} />)}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No analyst signals yet.</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-insider-transactions">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Insider transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingSignals ? (
                  <Skeleton className="h-20 w-full" />
                ) : insiderSignals.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Direction</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {insiderSignals.map((s) => (
                        <TableRow key={s.id} data-testid={`row-insider-${s.id}`}>
                          <TableCell className="font-mono text-xs">{new Date(s.retrievedAt).toLocaleDateString()}</TableCell>
                          <TableCell className="text-xs">{s.title}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px] capitalize">{s.direction}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-insider-data">No insider transaction signals yet.</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-patents-block">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Patents</CardTitle>
              </CardHeader>
              <CardContent>
                {patentSignals.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {patentSignals.map((s) => <SignalCard key={s.id} signal={s} />)}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-3" data-testid="text-patents-gap">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No patent data yet. Add a free USPTO PatentSearch API key in Source Management, then use "Sync
                      patents" above.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {otherSignals.length > 0 && (
              <Card data-testid="card-other-signals">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Other attached signals</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {otherSignals.map((s) => <SignalCard key={s.id} signal={s} />)}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
