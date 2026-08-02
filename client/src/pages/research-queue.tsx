/**
 * The research queue.
 *
 * The list of what you're NOT doing is given the same visual weight as the
 * list of what you are, and sits on the same screen. That's the point of the
 * feature: a queue that quietly truncates lets you believe you're on top of
 * things, and being told what you've implicitly decided to skip is the part
 * nobody else will tell you.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QueueItem {
  id: string;
  ticker: string | null;
  question: string;
  estimatedHours: number;
  valuePerHour: number;
  rationale: string;
  row?: { status: string; claimedBy: string | null };
}

interface Queue {
  summary: string;
  hoursAvailable: number;
  hoursUsed: number;
  doing: QueueItem[];
  notDoing: Array<{ why: string; item: QueueItem }>;
}

interface Company {
  id: number;
  name: string;
  ticker: string | null;
}

export default function ResearchQueue() {
  const [hours, setHours] = useState(6);
  const { data: queue, isLoading } = useQuery<Queue>({
    queryKey: ["/api/research/queue", `?hours=${hours}`],
    // The queue key carries the hours so changing them refetches — the cut is
    // the whole answer, not a display filter.
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/queue?hours=${hours}`);
      return res.json();
    },
  });

  const { data: stats } = useQuery<{ answered: number; passedOn: number }>({
    queryKey: ["/api/research/stats"],
  });

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">What's worth an hour</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by where an hour changes a decision — not by which names look most
            interesting.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-muted-foreground" htmlFor="hours">
            Hours you actually have this week
          </label>
          <Input
            id="hours"
            type="number"
            min={0}
            max={60}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-24"
            data-testid="input-available-hours"
          />
        </div>

        {stats && (stats.answered > 0 || stats.passedOn > 0) && (
          <p className="text-xs text-muted-foreground">
            {/* Both outcomes side by side, team-level, no names. Deciding
                something isn't worth more time is a result, and a queue that
                only counted answers would produce answers nobody needed. */}
            The team has answered {stats.answered} question
            {stats.answered === 1 ? "" : "s"} and decided {stats.passedOn} weren't worth
            more time. Both count.
          </p>
        )}

        {isLoading && <Skeleton className="h-40 w-full" />}

        {queue && (
          <>
            <p className="text-sm" data-testid="text-queue-summary">
              {queue.summary}
            </p>

            {queue.doing.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Doing
                </h2>
                {queue.doing.map((item) => (
                  <QueueCard key={item.id} item={item} />
                ))}
              </section>
            )}

            {queue.notDoing.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Not doing, and why
                </h2>
                {queue.notDoing.map(({ why, item }) => (
                  <Card key={item.id} className="border-dashed">
                    <CardContent className="py-3">
                      <div className="flex flex-wrap items-center gap-2 pb-1">
                        {item.ticker && (
                          <Badge variant="outline" className="text-muted-foreground">
                            {item.ticker}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {item.estimatedHours}h
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.question}</p>
                      <p className="mt-1 text-xs" data-testid="text-not-doing-why">
                        {why}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}
          </>
        )}

        <NewItem />
      </div>
    </AppLayout>
  );
}

function QueueCard({ item }: { item: QueueItem }) {
  const { toast } = useToast();
  const [closing, setClosing] = useState(false);
  const [conclusion, setConclusion] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/research/queue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
  };

  const claim = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/research/${item.id}/claim`, {})).json(),
    onSuccess: () => {
      refresh();
      toast({ title: "Yours", description: "Nobody else will be sent this one." });
    },
    onError: (err: any) => toast({ title: "Couldn't claim it", description: err.message }),
  });

  const release = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/research/${item.id}/release`, {})).json(),
    onSuccess: refresh,
  });

  const close = useMutation({
    mutationFn: async (outcome: string) =>
      (await apiRequest("POST", `/api/research/${item.id}/close`, { outcome, conclusion })).json(),
    onSuccess: () => {
      setClosing(false);
      setConclusion("");
      refresh();
      toast({ title: "Recorded" });
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: err.message }),
  });

  const claimed = item.row?.claimedBy;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {item.ticker && <Badge>{item.ticker}</Badge>}
          <span className="text-xs text-muted-foreground">{item.estimatedHours}h</span>
          {claimed && <Badge variant="secondary">Claimed</Badge>}
        </div>
        <CardTitle className="pt-1 text-sm leading-snug">{item.question}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{item.rationale}</p>

        {!closing ? (
          <div className="flex flex-wrap gap-2">
            {!claimed && (
              <Button size="sm" onClick={() => claim.mutate()} data-testid="button-claim-research">
                I'll take this
              </Button>
            )}
            {claimed && (
              <Button size="sm" variant="ghost" onClick={() => release.mutate()} data-testid="button-release-research">
                Put it back
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setClosing(true)} data-testid="button-close-research">
              Close it out
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
              placeholder="What did you conclude?"
              className="min-h-[4rem] text-sm"
              data-testid="input-research-conclusion"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => close.mutate("done")}
                disabled={!conclusion.trim()}
                data-testid="button-research-answered"
              >
                Answered it
              </Button>
              {/* Equal visual weight to "answered". This is a result, and the
                  most valuable hour of the week is often the one that takes
                  something off everyone's list. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => close.mutate("not_worth_more_time")}
                disabled={!conclusion.trim()}
                data-testid="button-research-not-worth-it"
              >
                Not worth more time
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setClosing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewItem() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    companyId: "",
    question: "",
    intendedPositionPct: "2",
    timeSensitivity: "0.5",
    estimatedHours: "2",
  });

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/research", {
          companyId: Number(form.companyId),
          question: form.question,
          intendedPositionPct: Number(form.intendedPositionPct),
          timeSensitivity: Number(form.timeSensitivity),
          estimatedHours: Number(form.estimatedHours),
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/queue"] });
      setForm({ companyId: "", question: "", intendedPositionPct: "2", timeSensitivity: "0.5", estimatedHours: "2" });
      setOpen(false);
      toast({ title: "Added" });
    },
    onError: (err: any) => toast({ title: "Couldn't add it", description: err.message }),
  });

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-new-research-item">
        Add a question
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">A question an hour would answer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
          <SelectTrigger data-testid="select-research-company">
            <SelectValue placeholder="Which company" />
          </SelectTrigger>
          <SelectContent>
            {(companies ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.ticker ? `${c.ticker} — ${c.name}` : c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div>
          <Textarea
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="Do their long-term contracts have price escalators?"
            className="min-h-[3.5rem] text-sm"
            data-testid="input-research-question"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Specific enough to finish. "Look at Vertiv" can't be estimated or closed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Labelled label="Position if it works (%)">
            <Input
              type="number"
              value={form.intendedPositionPct}
              onChange={(e) => setForm({ ...form, intendedPositionPct: e.target.value })}
              data-testid="input-research-position"
            />
          </Labelled>
          <Labelled label="Urgency (0–1)">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={form.timeSensitivity}
              onChange={(e) => setForm({ ...form, timeSensitivity: e.target.value })}
              data-testid="input-research-urgency"
            />
          </Labelled>
          <Labelled label="Hours">
            <Input
              type="number"
              step="0.5"
              value={form.estimatedHours}
              onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })}
              data-testid="input-research-hours"
            />
          </Labelled>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => create.mutate()}
            disabled={!form.companyId || !form.question || create.isPending}
          >
            Add
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
