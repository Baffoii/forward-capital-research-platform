/**
 * Handoffs: the list, and one packet in detail.
 *
 * The sorted fields are shown as editable text next to the note as it was
 * originally typed. Both are always visible — the sorting can be wrong, and
 * the only way to notice is to see them side by side.
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { shortName } from "@shared/team";

interface Packet {
  id: string;
  authorEmail: string;
  assigneeEmail: string | null;
  rawText: string;
  ticker: string | null;
  found: string | null;
  stillOpen: string | null;
  needsDecision: string | null;
  sources: string[];
  structuringStatus: string;
  followupQuestion: string | null;
  followupAnswer: string | null;
  status: string;
  acceptedBy: string | null;
  closingNote: string | null;
  createdAt: string;
}

function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
}

function StatusBadge({ packet }: { packet: Packet }) {
  if (packet.status === "closed") {
    return <Badge variant="outline">Done</Badge>;
  }
  if (packet.status === "accepted") {
    return <Badge variant="secondary">{shortName(packet.acceptedBy)} has it</Badge>;
  }
  const hours = hoursSince(packet.createdAt);
  if (hours >= 48) {
    return <Badge variant="destructive">Nobody has it — {hours}h</Badge>;
  }
  return <Badge variant="outline">Waiting for someone to say yes</Badge>;
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export default function Handoffs() {
  const { data: packets, isLoading } = useQuery<Packet[]>({
    queryKey: ["/api/handoffs"],
  });

  const open = (packets ?? []).filter((p) => p.status !== "closed");
  const done = (packets ?? []).filter((p) => p.status === "closed");

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Handoffs</h1>
            <p className="text-sm text-muted-foreground">
              Work passed between us. It stays here until someone finishes it.
            </p>
          </div>
          <Link href="/h">
            <a>
              <Button data-testid="button-new-handoff">Hand something over</Button>
            </a>
          </Link>
        </div>

        {isLoading && <Skeleton className="h-24 w-full" />}

        {!isLoading && open.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing outstanding.
            </CardContent>
          </Card>
        )}

        {open.map((packet) => (
          <PacketCard key={packet.id} packet={packet} />
        ))}

        {done.length > 0 && (
          <div className="space-y-3 pt-4">
            <h2 className="text-sm font-medium text-muted-foreground">Finished</h2>
            {done.map((packet) => (
              <PacketCard key={packet.id} packet={packet} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function PacketCard({ packet }: { packet: Packet }) {
  const headline = packet.needsDecision ?? packet.found ?? packet.rawText;
  return (
    <Link href={`/handoffs/${packet.id}`}>
      <a className="block">
        <Card className="transition-colors hover:border-foreground/30">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              {packet.ticker && <Badge>{packet.ticker}</Badge>}
              <StatusBadge packet={packet} />
              <span className="text-xs text-muted-foreground">
                from {shortName(packet.authorEmail)}
                {packet.assigneeEmail ? ` to ${shortName(packet.assigneeEmail)}` : " — unclaimed"}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="line-clamp-2 text-sm leading-snug">{headline}</p>
          </CardContent>
        </Card>
      </a>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export function HandoffDetail() {
  const [, params] = useRoute("/handoffs/:id");
  const { user } = useAuth();
  const { toast } = useToast();
  const id = params?.id;

  const { data: packet, isLoading } = useQuery<Packet>({
    queryKey: [`/api/handoffs/${id}`],
    enabled: Boolean(id),
  });

  const [draft, setDraft] = useState<Partial<Packet> | null>(null);
  const [answer, setAnswer] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/handoffs/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/handoffs"] });
  };

  const saveEdits = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/handoffs/${id}`, draft)).json(),
    onSuccess: () => {
      setDraft(null);
      refresh();
      toast({ title: "Saved" });
    },
  });

  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/handoffs/${id}/accept`, {})).json(),
    onSuccess: () => {
      refresh();
      toast({ title: "You've got it", description: "The author has been told." });
    },
  });

  const close = useMutation({
    mutationFn: async (note: string) =>
      (await apiRequest("POST", `/api/handoffs/${id}/close`, { note })).json(),
    onSuccess: () => {
      refresh();
      toast({ title: "Marked finished" });
    },
  });

  const sendAnswer = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/handoffs/${id}/answer`, { answer })).json(),
    onSuccess: () => {
      setAnswer("");
      refresh();
    },
  });

  if (isLoading || !packet) {
    return (
      <AppLayout>
        <Skeleton className="h-64 w-full max-w-3xl" />
      </AppLayout>
    );
  }

  const value = (field: keyof Packet) =>
    (draft?.[field] as string | null | undefined) ?? (packet[field] as string | null) ?? "";
  const edit = (field: keyof Packet, v: string) =>
    setDraft({ ...(draft ?? {}), [field]: v });

  const isAuthor = packet.authorEmail === user?.email;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {packet.ticker && <Badge>{packet.ticker}</Badge>}
          <StatusBadge packet={packet} />
          <span className="text-xs text-muted-foreground">
            {shortName(packet.authorEmail)} wrote this {hoursSince(packet.createdAt)}h ago
          </span>
        </div>

        {packet.status === "open" && (
          <Card className="border-primary/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-sm">
                {isAuthor
                  ? "Nobody has said they've got this yet."
                  : "Are you taking this on?"}
              </p>
              {!isAuthor && (
                <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
                  Yes, I've got it
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* The one follow-up question, if the sorting flagged something missing. */}
        {packet.followupQuestion && !packet.followupAnswer && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">One thing that wasn't clear</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{packet.followupQuestion}</p>
              <div className="flex gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="A sentence is enough"
                  data-testid="input-followup-answer"
                />
                <Button
                  variant="outline"
                  onClick={() => sendAnswer.mutate()}
                  disabled={!answer.trim() || sendAnswer.isPending}
                >
                  Answer
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {packet.followupAnswer && (
          <Card>
            <CardContent className="py-4 text-sm">
              <span className="text-muted-foreground">{packet.followupQuestion} </span>
              {packet.followupAnswer}
            </CardContent>
          </Card>
        )}

        {packet.structuringStatus === "unavailable" && (
          <p className="text-xs text-muted-foreground">
            Automatic sorting is turned off, so the fields below are blank. Fill in
            whatever is useful — the note as written is underneath either way.
          </p>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              The sorted version
              <span className="ml-2 font-normal text-muted-foreground">
                — editable, because it's sometimes wrong
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="What they found" value={value("found")} onChange={(v) => edit("found", v)} testId="found" />
            <Field label="What's still open" value={value("stillOpen")} onChange={(v) => edit("stillOpen", v)} testId="still-open" />
            <Field label="What you need to decide" value={value("needsDecision")} onChange={(v) => edit("needsDecision", v)} testId="needs-decision" />

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Ticker</div>
              <Input
                value={value("ticker")}
                onChange={(e) => edit("ticker", e.target.value)}
                className="max-w-[10rem]"
                data-testid="input-packet-ticker"
              />
            </div>

            {packet.sources.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Sources</div>
                <ul className="space-y-0.5 text-sm">
                  {packet.sources.map((s, i) => (
                    <li key={i} className="break-all">{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {draft && (
              <Button onClick={() => saveEdits.mutate()} disabled={saveEdits.isPending} data-testid="button-save-edits">
                Save corrections
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Always shown. If the sorting above got something wrong, this is the
            version that's definitely right. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">What they actually wrote</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-packet-raw">
              {packet.rawText}
            </p>
          </CardContent>
        </Card>

        {packet.status !== "closed" && <CloseBox onClose={(note) => close.mutate(note)} />}

        {packet.closingNote && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">How it turned out</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{packet.closingNote}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[4rem] text-sm"
        data-testid={`input-packet-${testId}`}
      />
    </div>
  );
}

function CloseBox({ onClose }: { onClose: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Finished with it?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you conclude? 'Not worth more time on this' is a real answer and counts as a result."
          className="min-h-[4rem] text-sm"
          data-testid="input-close-note"
        />
        <Button variant="outline" onClick={() => onClose(note)} data-testid="button-close-handoff">
          Mark finished
        </Button>
      </CardContent>
    </Card>
  );
}
