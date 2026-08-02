/**
 * Pre-commitments: decisions made in advance, while calm.
 *
 * Two halves to each one. The prose halves — the condition, what you'd do, and
 * why — are what actually reaches you later, so they're written in your own
 * words and never paraphrased. The machine half is a short picker, because a
 * condition nobody can check is a note-to-self, not a trigger.
 *
 * The system never places or exports a trade. It sends you a message with the
 * decision and reasoning you already wrote, and you act in your own brokerage.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { shortName } from "@shared/team";

interface Precommitment {
  id: string;
  ticker: string | null;
  authorEmail: string;
  conditionText: string;
  actionText: string;
  reasoning: string;
  reads: string;
  status: string;
  metAt: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  createdAt: string;
}

interface Company {
  id: number;
  name: string;
  ticker: string | null;
}

const OPS = [
  { value: "lt", label: "drops below" },
  { value: "lte", label: "is at or below" },
  { value: "gt", label: "rises above" },
  { value: "gte", label: "is at or above" },
  { value: "abs_gte", label: "moves by at least (either way)" },
  { value: "eq", label: "is exactly" },
];

export default function Precommitments() {
  const { data: items } = useQuery<Precommitment[]>({ queryKey: ["/api/precommitments"] });

  const met = (items ?? []).filter((p) => p.status === "met");
  const armed = (items ?? []).filter((p) => p.status === "armed");
  const done = (items ?? []).filter((p) => p.status === "retired");

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Decided in advance</h1>
          <p className="text-sm text-muted-foreground">
            Written while calm, so you don't have to decide while it's happening.
          </p>
        </div>

        <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-snug">
          This never places or exports a trade. When a condition is met you get a
          message with what you decided and why, and you act in your own brokerage.
        </p>

        {met.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium">These have happened</h2>
            {met.map((p) => (
              <MetCard key={p.id} item={p} />
            ))}
          </div>
        )}

        <NewPrecommitment />

        {armed.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Watching for</h2>
            {armed.map((p) => (
              <ArmedCard key={p.id} item={p} />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="space-y-3 pt-4">
            <h2 className="text-sm font-medium text-muted-foreground">Closed out</h2>
            {done.map((p) => (
              <Card key={p.id}>
                <CardContent className="py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 pb-1">
                    {p.ticker && <Badge variant="outline">{p.ticker}</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {p.outcome === "followed"
                        ? "Followed through"
                        : p.outcome === "changed_mind"
                          ? "Changed their mind"
                          : p.outcome === "ignored"
                            ? "Didn't act"
                            : "Retired"}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    If {p.conditionText}, {p.actionText}.
                  </p>
                  {p.outcomeNote && <p className="mt-1">{p.outcomeNote}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ArmedCard({ item }: { item: Precommitment }) {
  const retire = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/precommitments/${item.id}/retire`, {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/precommitments"] }),
  });

  return (
    <Card>
      <CardContent className="space-y-2 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {item.ticker && <Badge>{item.ticker}</Badge>}
          <span className="text-xs text-muted-foreground">{shortName(item.authorEmail)}</span>
        </div>
        <p>
          <span className="text-muted-foreground">If </span>
          {item.conditionText}
          <span className="text-muted-foreground">, then </span>
          {item.actionText}
        </p>
        <p className="text-muted-foreground">{item.reasoning}</p>
        <p className="text-[11px] text-muted-foreground/70">Checked as: {item.reads}</p>
        <Button variant="ghost" size="sm" onClick={() => retire.mutate()} data-testid="button-retire-precommitment">
          No longer relevant
        </Button>
      </CardContent>
    </Card>
  );
}

function MetCard({ item }: { item: Precommitment }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");

  const ack = useMutation({
    mutationFn: async (outcome: string) =>
      (await apiRequest("POST", `/api/precommitments/${item.id}/acknowledge`, {
        outcome,
        note: note || null,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/precommitments"] });
      toast({ title: "Recorded" });
    },
  });

  return (
    <Card className="border-primary/50">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {item.ticker && <Badge>{item.ticker}</Badge>}
          <Badge variant="secondary">Condition met</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">You said: if </span>
          {item.conditionText}
          <span className="text-muted-foreground">, then </span>
          <span className="font-medium">{item.actionText}</span>
        </p>
        <div>
          <div className="text-xs text-muted-foreground">Because, in your words:</div>
          <p className="whitespace-pre-wrap">{item.reasoning}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Nothing has been traded. Do it in your brokerage, then tell us what you did —
          including if you decided not to.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth recording? (optional)"
          className="min-h-[3.5rem] text-sm"
          data-testid="input-precommitment-note"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => ack.mutate("followed")} data-testid="button-ack-followed">
            I did it
          </Button>
          <Button size="sm" variant="outline" onClick={() => ack.mutate("changed_mind")} data-testid="button-ack-changed">
            I've changed my mind
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ack.mutate("ignored")} data-testid="button-ack-ignored">
            I didn't act
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NewPrecommitment() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    companyId: "",
    conditionText: "",
    actionText: "",
    reasoning: "",
    field: "",
    op: "lt",
    value: "",
  });

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: fields } = useQuery<{ field: string; label: string }[]>({
    queryKey: ["/api/precommitments/fields"],
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/precommitments", {
          companyId: Number(form.companyId),
          conditionText: form.conditionText,
          actionText: form.actionText,
          reasoning: form.reasoning,
          field: form.field,
          op: form.op,
          value: Number(form.value),
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/precommitments"] });
      setForm({ companyId: "", conditionText: "", actionText: "", reasoning: "", field: "", op: "lt", value: "" });
      setOpen(false);
      toast({ title: "Saved. We'll tell you if it happens." });
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: err.message }),
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="button-new-precommitment">
        Decide something in advance
      </Button>
    );
  }

  const ready =
    form.companyId && form.conditionText && form.actionText && form.reasoning && form.field && form.value !== "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">While you're calm</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
          <SelectTrigger data-testid="select-precommitment-company">
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

        <Field
          label="If…"
          hint="In your own words. This is what you'll read later."
          value={form.conditionText}
          onChange={(v) => setForm({ ...form, conditionText: v })}
          placeholder="backlog comes in below $2.1bn"
          testId="condition"
        />
        <Field
          label="…then I'll"
          value={form.actionText}
          onChange={(v) => setForm({ ...form, actionText: v })}
          placeholder="trim 30%"
          testId="action"
        />
        <Field
          label="Because"
          hint="Write this properly. It's the bit that has to argue with you when it happens."
          value={form.reasoning}
          onChange={(v) => setForm({ ...form, reasoning: v })}
          placeholder="below that level the shortage isn't reaching their P&L, and that's the whole reason we own it"
          testId="reasoning"
        />

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">
            And how should we check it? Pick the number to watch.
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={form.field} onValueChange={(v) => setForm({ ...form, field: v })}>
              <SelectTrigger className="w-full sm:w-[16rem]" data-testid="select-precommitment-field">
                <SelectValue placeholder="Which number" />
              </SelectTrigger>
              <SelectContent>
                {(fields ?? []).map((f) => (
                  <SelectItem key={f.field} value={f.field}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.op} onValueChange={(v) => setForm({ ...form, op: v })}>
              <SelectTrigger className="w-full sm:w-[14rem]" data-testid="select-precommitment-op">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="2100000000"
              className="w-full sm:w-[12rem]"
              data-testid="input-precommitment-value"
            />
          </div>
        </div>

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

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {hint && <div className="mb-1 text-[11px] text-muted-foreground/70">{hint}</div>}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[3.5rem] text-sm"
        data-testid={`input-precommitment-${testId}`}
      />
    </div>
  );
}
