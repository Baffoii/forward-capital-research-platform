import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Source } from "@shared/schema";

function ReliabilityEditor({ source }: { source: Source }) {
  const { toast } = useToast();
  const [value, setValue] = useState(String(source.reliabilityScore));

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/sources/${source.id}`, { reliabilityScore: Number(value) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      toast({ title: `Updated reliability for ${source.name}` });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 font-mono"
        data-testid={`input-reliability-${source.id}`}
      />
      <Button size="sm" variant="outline" onClick={() => update.mutate()} disabled={update.isPending} data-testid={`button-save-reliability-${source.id}`}>
        Save
      </Button>
    </div>
  );
}

function UsptoKeyForm() {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const { data } = useQuery<{ hasKey: boolean }>({ queryKey: ["/api/settings/uspto_api_key"] });

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/uspto_api_key", { value: key });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/uspto_api_key"] });
      toast({ title: "USPTO API key saved" });
      setKey("");
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-uspto-key">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">USPTO PatentSearch API key</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Free to register at{" "}
          <a href="https://patentsview.org/apis" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            patentsview.org/apis
          </a>
          . Status:{" "}
          <Badge variant="outline" className="text-[10px]" data-testid="badge-uspto-key-status">
            {data?.hasKey ? "Key set" : "No key set"}
          </Badge>
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Paste API key…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            data-testid="input-uspto-key"
          />
          <Button size="sm" onClick={() => save.mutate()} disabled={!key || save.isPending} data-testid="button-save-uspto-key">
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SourceManagement() {
  const { data: sources, isLoading } = useQuery<Source[]>({ queryKey: ["/api/sources"] });

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Source Management</h1>
          <p className="text-sm text-muted-foreground">Reliability scores, API keys, and last-synced timestamps.</p>
        </div>

        <UsptoKeyForm />

        <Card data-testid="card-source-list">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Connected sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              sources?.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3" data-testid={`row-source-${s.id}`}>
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.kind} · last synced: {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "never"}
                    </p>
                  </div>
                  <ReliabilityEditor source={s} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-phase2-note">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Phase 2 (not wired in)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The following are potential future data sources. None are connected in this build, and none will call
              out to a paid API without an explicit, freshly-worded confirmation before every single call:
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Unusual Whales (options flow) — Phase 2 candidate, not wired in.</li>
              <li>Tradytics (options/dark pool analytics) — Phase 2 candidate, not wired in.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
