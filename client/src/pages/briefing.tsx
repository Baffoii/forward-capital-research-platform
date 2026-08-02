/**
 * The landing view: where you left off.
 *
 * One thing at the top, large, with everything else visually subordinate. The
 * layout is doing the same job as the ranking — if the four things below the
 * fold looked as important as the one above it, the page would be a list of
 * twelve again in everything but count.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface Card_ {
  kind: string;
  headline: string;
  detail?: string;
  href?: string;
  urgency: number;
}

interface Briefing {
  greeting: string;
  daysAway: number | null;
  firstEverVisit: boolean;
  theOneThing: Card_;
  alsoWaiting: Card_[];
  whileYouWereAway: { summary: string | null; items: Card_[] };
}

const KIND_LABEL: Record<string, string> = {
  precommitment_met: "You decided this in advance",
  handoff_waiting: "Someone is waiting on you",
  handoff_dropped: "Nobody picked this up",
  journal_due: "Worth rereading",
  open_item: "Still open",
  change: "Changed",
};

export default function Briefing() {
  const { data, isLoading } = useQuery<Briefing>({ queryKey: ["/api/briefing"] });

  if (isLoading || !data) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AppLayout>
    );
  }

  const top = data.theOneThing;

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-8">
        <p className="text-sm text-muted-foreground" data-testid="text-greeting">
          {data.greeting}
        </p>

        {/* The one thing. Deliberately the only large thing on the page. */}
        <section data-testid="section-one-thing">
          {top.kind !== "nothing" && (
            <Badge variant="secondary" className="mb-3">
              {KIND_LABEL[top.kind] ?? "Needs you"}
            </Badge>
          )}
          <h1 className="text-2xl font-semibold leading-snug">{top.headline}</h1>
          {top.detail && (
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">
              {top.detail}
            </p>
          )}
          {top.href && (
            <Link href={top.href}>
              <a
                className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
                data-testid="link-one-thing"
              >
                Deal with it
              </a>
            </Link>
          )}
        </section>

        {data.alsoWaiting.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Also waiting
            </h2>
            {data.alsoWaiting.map((card, i) => (
              <SmallCard key={i} card={card} testId={`card-also-${i}`} />
            ))}
          </section>
        )}

        {data.whileYouWereAway.summary && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {data.daysAway !== null && data.daysAway >= 7 ? "While you were away" : "Since you last looked"}
            </h2>
            <p className="text-sm text-muted-foreground" data-testid="text-while-away">
              {data.whileYouWereAway.summary}
            </p>
            {data.whileYouWereAway.items.map((card, i) => (
              <SmallCard key={i} card={card} testId={`card-change-${i}`} />
            ))}
            {data.daysAway !== null && data.daysAway >= 7 && (
              <Link href="/digest">
                <a className="inline-block text-sm underline underline-offset-4">
                  Read this week's five
                </a>
              </Link>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
}

function SmallCard({ card, testId }: { card: Card_; testId: string }) {
  const body = (
    <Card className={card.href ? "transition-colors hover:border-foreground/30" : ""}>
      <CardContent className="py-3">
        <p className="text-sm leading-snug">{card.headline}</p>
        {card.detail && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.detail}</p>
        )}
      </CardContent>
    </Card>
  );

  return card.href ? (
    <Link href={card.href}>
      <a className="block" data-testid={testId}>
        {body}
      </a>
    </Link>
  ) : (
    <div data-testid={testId}>{body}</div>
  );
}
