/**
 * This week's five things.
 *
 * A read-only view of what was emailed. The email is the channel — this page
 * exists so someone can look back at an earlier week and see what got cut, not
 * as somewhere to remember to check.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";

interface DigestItem {
  candidate: {
    id: string;
    kind: string;
    companyId: number | null;
    ticker: string | null;
    headline: string;
    detail: string | null;
  };
  materiality: number;
  reasons: string[];
  isExitSignal: boolean;
}

interface Digest {
  id: string;
  weekStart: string;
  items: DigestItem[];
  suppressed: number;
  suppressedSummary: string | null;
}

export default function DigestPage() {
  const { data: digest, isLoading } = useQuery<Digest | null>({
    queryKey: ["/api/digest/latest"],
  });

  const click = useMutation({
    mutationFn: async (itemId: string) =>
      (await apiRequest("POST", `/api/digest/${digest!.id}/clicked`, { itemId })).json(),
  });

  if (isLoading) {
    return (
      <AppLayout>
        <Skeleton className="h-64 w-full max-w-3xl" />
      </AppLayout>
    );
  }

  if (!digest) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No digest yet. The first one goes out on Sunday evening.
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">
            Week of {new Date(digest.weekStart).toISOString().slice(0, 10)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Five at most, ranked by how much they bear on what we own. This went out by
            email — it isn't somewhere you need to remember to look.
          </p>
        </div>

        {digest.items.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing cleared the bar this week.
            </CardContent>
          </Card>
        )}

        {digest.items.map((item, index) => {
          const body = (
            <Card
              className={
                item.isExitSignal ? "border-primary/60 transition-colors" : "transition-colors hover:border-foreground/30"
              }
            >
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{index + 1}</span>
                  {item.candidate.ticker && <Badge>{item.candidate.ticker}</Badge>}
                  {item.isExitSignal && <Badge variant="secondary">Time to think about trimming</Badge>}
                </div>
                <CardTitle className="pt-1 text-sm leading-snug">
                  {item.candidate.headline}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {item.isExitSignal && (
                  <p className="text-muted-foreground">
                    The market is catching up to this one. That's the thesis completing, not
                    confirmation of it.
                  </p>
                )}
                {item.candidate.detail && <p>{item.candidate.detail}</p>}
                <p className="text-xs text-muted-foreground">
                  Why this made the list: {item.reasons.join("; ")}
                </p>
              </CardContent>
            </Card>
          );

          return item.candidate.companyId ? (
            <Link key={item.candidate.id} href={`/companies/${item.candidate.companyId}`}>
              <a
                className="block"
                onClick={() => click.mutate(item.candidate.id)}
                data-testid={`link-digest-item-${index}`}
              >
                {body}
              </a>
            </Link>
          ) : (
            <div key={item.candidate.id}>{body}</div>
          );
        })}

        {digest.suppressedSummary && (
          <p className="text-xs text-muted-foreground" data-testid="text-digest-suppressed">
            {digest.suppressedSummary} Left out on purpose — a list of everything is the
            thing people stop opening.
          </p>
        )}
      </div>
    </AppLayout>
  );
}
