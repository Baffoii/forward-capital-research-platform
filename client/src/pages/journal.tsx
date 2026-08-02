/**
 * Decision journal.
 *
 * A normal form is right for writing an entry — this is done at a desk when a
 * position goes on, not one-handed between classes.
 *
 * The important screen is the review one: what you wrote, unedited, directly
 * next to what has happened since, and then one question. Showing a summary of
 * the original instead would quietly launder away whatever you got wrong,
 * which is the only thing here worth knowing.
 */

import { useState } from "react";
import { Link, useRoute } from "wouter";
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
import { shortName } from "@shared/team";

interface Entry {
  id: string;
  companyId: number;
  ticker: string | null;
  authorEmail: string;
  belief: string;
  expectation: string;
  expectBy: string | null;
  falsifier: string;
  status: string;
  createdAt: string;
}

interface Review {
  id: string;
  reviewerEmail: string;
  triggerKind: string;
  stillAgree: string;
  note: string | null;
  createdAt: string;
}

interface WorldEvent {
  id: string;
  headline: string;
  detail: string | null;
  knownAt: string;
}

interface Company {
  id: number;
  name: string;
  ticker: string | null;
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* List + write                                                        */
/* ------------------------------------------------------------------ */

export default function Journal() {
  const { data: entries, isLoading } = useQuery<Entry[]>({ queryKey: ["/api/journal"] });
  const { data: calibration } = useQuery<{
    reviews: number;
    heldUpRate: number | null;
    changedMind: number;
  }>({ queryKey: ["/api/journal/stats/calibration"] });

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Why we hold what we hold</h1>
          <p className="text-sm text-muted-foreground">
            Written when the position goes on, read again when it's uncomfortable.
          </p>
        </div>

        {calibration && calibration.reviews > 0 && (
          <Card>
            <CardContent className="py-4 text-sm">
              {/* Team-level. There is no per-person version of this number, on
                  purpose — changing your mind is the behaviour we want, so it
                  can't be something anyone is ranked on. */}
              Across {calibration.reviews} rereads, the team still agreed with its
              earlier reasoning{" "}
              <span className="font-medium">
                {Math.round((calibration.heldUpRate ?? 0) * 100)}%
              </span>{" "}
              of the time. {calibration.changedMind} outright changes of mind.
            </CardContent>
          </Card>
        )}

        <NewEntry />

        {isLoading && <Skeleton className="h-32 w-full" />}

        {!isLoading && (entries ?? []).length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing written down yet.
            </CardContent>
          </Card>
        )}

        {(entries ?? []).map((entry) => (
          <Link key={entry.id} href={`/journal/${entry.id}`}>
            <a className="block">
              <Card className="transition-colors hover:border-foreground/30">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.ticker && <Badge>{entry.ticker}</Badge>}
                    {entry.status === "closed" && <Badge variant="outline">Closed</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {shortName(entry.authorEmail)}, {day(entry.createdAt)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 text-sm leading-snug">{entry.belief}</p>
                </CardContent>
              </Card>
            </a>
          </Link>
        ))}
      </div>
    </AppLayout>
  );
}

function NewEntry() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    companyId: "",
    belief: "",
    expectation: "",
    expectBy: "",
    falsifier: "",
  });

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/journal", {
          companyId: Number(form.companyId),
          belief: form.belief,
          expectation: form.expectation,
          expectBy: form.expectBy ? new Date(form.expectBy).toISOString() : null,
          falsifier: form.falsifier,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
      setForm({ companyId: "", belief: "", expectation: "", expectBy: "", falsifier: "" });
      setOpen(false);
      toast({ title: "Written down" });
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: err.message }),
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="button-new-journal-entry">
        Write down the reasoning for a position
      </Button>
    );
  }

  const ready = form.companyId && form.belief && form.expectation && form.falsifier;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">A new position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Company</div>
          <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
            <SelectTrigger data-testid="select-journal-company">
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {(companies ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.ticker ? `${c.ticker} — ${c.name}` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Labelled
          label="What we believe"
          hint="The claim about the world that makes this worth owning."
          value={form.belief}
          onChange={(v) => setForm({ ...form, belief: v })}
          testId="belief"
        />
        <Labelled
          label="What we expect, and roughly when"
          hint="Something specific enough that you'd notice if it didn't happen."
          value={form.expectation}
          onChange={(v) => setForm({ ...form, expectation: v })}
          testId="expectation"
        />

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            By when (optional)
          </div>
          <Input
            type="date"
            value={form.expectBy}
            onChange={(e) => setForm({ ...form, expectBy: e.target.value })}
            className="max-w-[12rem]"
            data-testid="input-expect-by"
          />
        </div>

        <Labelled
          label="What would change our mind"
          hint="Write this now, while it's easy. This is the field you'll be glad you filled in."
          value={form.falsifier}
          onChange={(v) => setForm({ ...form, falsifier: v })}
          testId="falsifier"
        />

        <div className="flex gap-2">
          <Button onClick={() => create.mutate()} disabled={!ready || create.isPending}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Labelled({
  label,
  hint,
  value,
  onChange,
  testId,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mb-1 text-[11px] text-muted-foreground/70">{hint}</div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[4.5rem] text-sm"
        data-testid={`input-journal-${testId}`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One entry: then, next to now                                        */
/* ------------------------------------------------------------------ */

export function JournalEntry() {
  const [, params] = useRoute("/journal/:id");
  const { toast } = useToast();
  const id = params?.id;

  const { data, isLoading } = useQuery<{
    entry: Entry;
    reviews: Review[];
    whatHappenedSince: WorldEvent[];
  }>({ queryKey: [`/api/journal/${id}`], enabled: Boolean(id) });

  const [answer, setAnswer] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/journal/${id}/review`, {
          stillAgree: answer,
          note: note || null,
          triggerKind: "manual",
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/journal/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal/stats/calibration"] });
      setAnswer(null);
      setNote("");
      toast({ title: "Recorded" });
    },
  });

  if (isLoading || !data) {
    return (
      <AppLayout>
        <Skeleton className="h-64 w-full max-w-3xl" />
      </AppLayout>
    );
  }

  const { entry, reviews, whatHappenedSince } = data;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {entry.ticker && <Badge>{entry.ticker}</Badge>}
          <span className="text-xs text-muted-foreground">
            {shortName(entry.authorEmail)} wrote this on {day(entry.createdAt)}
          </span>
        </div>

        {/* Then and now, side by side. This layout is the feature. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                What you wrote on {day(entry.createdAt)}
                <span className="ml-2 font-normal text-muted-foreground">— unedited</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Block label="We believe" text={entry.belief} />
              <Block
                label="We expect"
                text={entry.expectation + (entry.expectBy ? ` — by ${day(entry.expectBy)}` : "")}
              />
              <Block label="What would change our mind" text={entry.falsifier} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What's happened since</CardTitle>
            </CardHeader>
            <CardContent>
              {whatHappenedSince.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing we've recorded. That is itself worth noticing if you expected
                  something by now.
                </p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {whatHappenedSince.map((e) => (
                    <li key={e.id}>
                      <div className="text-xs text-muted-foreground">{day(e.knownAt)}</div>
                      <div className="leading-snug">{e.headline}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Do you still agree with that?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                { value: "yes", label: "Still agree" },
                { value: "partly", label: "Partly" },
                { value: "no", label: "No, I've changed my mind" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setAnswer(option.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    answer === option.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/40"
                  }`}
                  data-testid={`button-still-agree-${option.value}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              "No" is the most useful answer there is — it's the one that makes keeping
              this record worth the effort.
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed? (optional)"
              className="min-h-[4rem] text-sm"
              data-testid="input-review-note"
            />
            <Button
              onClick={() => review.mutate()}
              disabled={!answer || review.isPending}
              data-testid="button-save-review"
            >
              Record it
            </Button>
          </CardContent>
        </Card>

        {reviews.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Every time this came back up</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4 text-sm">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <div className="text-xs text-muted-foreground">
                      {day(r.createdAt)} — {shortName(r.reviewerEmail)}, asked because of{" "}
                      {r.triggerKind.replace(/_/g, " ")}
                    </div>
                    <div>
                      {r.stillAgree === "yes"
                        ? "Still agreed."
                        : r.stillAgree === "partly"
                          ? "Partly."
                          : "Changed their mind."}
                      {r.note ? ` ${r.note}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      <p className="whitespace-pre-wrap leading-snug">{text}</p>
    </div>
  );
}
