import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ScoreRow {
  id: string;
  companyId: number;
  companyName: string;
  ticker: string | null;
  constraintSlug: string | null;
  constraintName: string | null;
  constraintTier: string | null;
  longScore: number;
  shortScore: number;
  confidence: number;
  components: {
    exposure: number;
    tightening: number;
    recognition: number;
    divergenceMultiplier: number;
    captureMultiplier: number;
    coverage: number;
    flags?: string[];
    hops?: number;
    inputs?: Record<string, any>;
    evidence?: Array<{
      path: number[];
      hops: number;
      revenueShare: number;
      confidence: number;
      derivation: string;
      sourceDocumentId: number | null;
      quote: string | null;
    }>;
  };
  scorerVersion: string;
  asOf: string;
}

interface BoardResponse {
  asOf: string | null;
  runs: string[];
  scores: ScoreRow[];
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const num = (n: number) => n.toFixed(4);

export default function OpportunityBoard() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading } = useQuery<BoardResponse>({
    queryKey: ["/api/opportunity-scores"],
  });

  const scores = data?.scores ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">
            Opportunity Board
          </h1>
          <p className="text-sm text-muted-foreground">
            {data?.asOf
              ? `Scored as of ${new Date(data.asOf).toISOString().slice(0, 10)} · scorer ${scores[0]?.scorerVersion ?? "—"}`
              : "Ranked by the larger of long and short score. Confidence is reported, never folded in."}
          </p>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : scores.length === 0 ? (
          // An empty board is the correct state until the pipeline has run.
          // It is not a rendering failure and must not be filled with samples.
          <div
            className="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
            data-testid="text-empty-board"
          >
            <p className="mb-2 font-medium text-foreground">No scores yet.</p>
            <p>
              Scores appear once the pipeline has produced an exposure edge, a constraint
              state, and a recognition snapshot for at least one company. Run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                npm run pipeline
              </code>
              , then{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                npm run score
              </code>
              .
            </p>
            <p className="mt-2">
              A pair is skipped rather than scored when any core input is missing — the
              runner logs which one and why.
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table data-testid="table-opportunity-scores">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Constraint</TableHead>
                  <TableHead className="text-right">Long</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead className="text-right">Exposure</TableHead>
                  <TableHead className="text-right">Tightening</TableHead>
                  <TableHead className="text-right">Recognition</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <Fragment key={s.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                      data-testid={`row-score-${s.id}`}
                    >
                      <TableCell className="font-medium">
                        <Link href={`/companies/${s.companyId}`}>
                          <a
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`link-company-${s.companyId}`}
                          >
                            {s.companyName}
                          </a>
                        </Link>
                        {s.ticker ? (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {s.ticker}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.constraintSlug ?? "—"}
                        {s.components.hops !== undefined ? (
                          <span className="ml-2 text-muted-foreground">
                            hop {s.components.hops}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs" data-testid={`text-long-${s.id}`}>
                        {num(s.longScore)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {num(s.shortScore)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {pct(s.confidence)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {pct(s.components.exposure)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {s.components.tightening >= 0 ? "+" : ""}
                        {s.components.tightening.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {pct(s.components.recognition)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(s.components.flags ?? []).map((f) => (
                            <Badge key={f} variant="outline" className="text-[10px]">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>

                    {expanded === s.id ? (
                      <TableRow data-testid={`row-evidence-${s.id}`}>
                        <TableCell colSpan={9} className="bg-muted/40 text-xs">
                          <div className="space-y-3 py-2">
                            <div>
                              <span className="font-medium">{s.constraintName}</span>
                              {s.constraintTier ? (
                                <span className="ml-2 text-muted-foreground">
                                  {s.constraintTier}
                                </span>
                              ) : null}
                            </div>

                            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                              <div>
                                divergence multiplier{" "}
                                <span className="font-mono">
                                  {s.components.divergenceMultiplier.toFixed(3)}
                                </span>
                              </div>
                              <div>
                                capture multiplier{" "}
                                <span className="font-mono">
                                  {s.components.captureMultiplier.toFixed(3)}
                                </span>
                              </div>
                              <div>
                                input coverage{" "}
                                <span className="font-mono">{pct(s.components.coverage)}</span>
                              </div>
                            </div>

                            {s.components.inputs?.tightening?.method ? (
                              <div>
                                <div className="font-medium">How tightening was derived</div>
                                <p className="text-muted-foreground">
                                  {s.components.inputs.tightening.method}
                                </p>
                              </div>
                            ) : null}

                            {(s.components.evidence ?? []).length > 0 ? (
                              <div>
                                <div className="font-medium">Evidence chain</div>
                                <ul className="space-y-1">
                                  {(s.components.evidence ?? []).map((e, i) => (
                                    <li key={i} className="text-muted-foreground">
                                      <span className="font-mono">
                                        {e.path.join(" → ")}
                                      </span>{" "}
                                      · {e.derivation} · share{" "}
                                      <span className="font-mono">
                                        {e.revenueShare.toFixed(3)}
                                      </span>{" "}
                                      · conf{" "}
                                      <span className="font-mono">
                                        {e.confidence.toFixed(2)}
                                      </span>
                                      {e.quote ? (
                                        <div className="mt-0.5 border-l-2 pl-2 italic">
                                          {e.quote}
                                        </div>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
