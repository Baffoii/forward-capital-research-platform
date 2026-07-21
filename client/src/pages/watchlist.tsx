import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { Company, WatchlistItem } from "@shared/schema";

export default function Watchlist() {
  const { data: companies, isLoading: loadingCompanies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: watchlistItems, isLoading: loadingWatchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });

  const isLoading = loadingCompanies || loadingWatchlist;
  const watchedCompanyIds = new Set(watchlistItems?.map((w) => w.companyId));
  const watched = companies?.filter((c) => watchedCompanyIds.has(c.id)) ?? [];

  const segments = Array.from(new Set(watched.map((c) => c.segment)));

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Watchlist</h1>
          <p className="text-sm text-muted-foreground">Companies grouped by segment.</p>
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : (
          segments.map((segment) => (
            <div key={segment}>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide" data-testid={`text-segment-heading-${segment.replace(/\s+/g, "-").toLowerCase()}`}>
                {segment}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {watched.filter((c) => c.segment === segment).map((c) => (
                  <Link key={c.id} href={`/companies/${c.id}`}>
                    <a data-testid={`link-company-${c.id}`}>
                      <Card className="transition-colors hover:border-primary/40">
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center justify-between text-sm font-medium">
                            {c.name}
                            <Badge variant="outline" className="font-mono text-[10px]">{c.ticker}</Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xs text-muted-foreground">{c.sector} · {c.industry}</p>
                        </CardContent>
                      </Card>
                    </a>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}

        {!isLoading && watched.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-empty-watchlist">Watchlist is empty.</p>
        )}
      </div>
    </AppLayout>
  );
}
