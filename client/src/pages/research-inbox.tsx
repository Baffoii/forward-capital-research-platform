import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertResearchInboxItemSchema } from "@shared/schema";
import type { ResearchInboxItem } from "@shared/schema";

const CATEGORIES = ["price_action", "insider_activity", "analyst_action", "web_traffic_signal", "partnership_or_supply_chain", "macro_indicator", "hiring_signal", "regulatory_filing"];
const PROVENANCE = ["human_authored_research", "unverified_rumor_or_social_claim", "investment_hypothesis", "detected_signal"];
const TIERS = ["unverified", "single_source", "corroborated"];
const DIRECTIONS = ["confirming", "contradicting", "neutral"];

const promoteSchema = z.object({
  title: z.string().min(1, "Required"),
  signalCategory: z.string().min(1),
  provenanceClass: z.string().min(1),
  verificationTier: z.string().min(1),
  direction: z.enum(["confirming", "contradicting", "neutral"]),
});

function PromoteDialog({ item }: { item: ResearchInboxItem }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof promoteSchema>>({
    resolver: zodResolver(promoteSchema),
    defaultValues: { title: "", signalCategory: "human_authored_research".includes("") ? "partnership_or_supply_chain" : "", provenanceClass: "human_authored_research", verificationTier: "single_source", direction: "neutral" },
  });

  const promote = useMutation({
    mutationFn: async (values: z.infer<typeof promoteSchema>) => {
      const res = await apiRequest("POST", `/api/inbox/${item.id}/promote`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      toast({ title: "Promoted to signal" });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Promote failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-promote-${item.id}`}>Promote to Signal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classify and promote to signal</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => promote.mutate(v))} className="space-y-3">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel>Signal title</FormLabel>
                <FormControl><Input {...field} data-testid="input-promote-title" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="signalCategory" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger data-testid="select-promote-category"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="provenanceClass" render={({ field }) => (
              <FormItem>
                <FormLabel>Provenance</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger data-testid="select-promote-provenance"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{PROVENANCE.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="verificationTier" render={({ field }) => (
              <FormItem>
                <FormLabel>Verification tier</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger data-testid="select-promote-tier"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{TIERS.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="direction" render={({ field }) => (
              <FormItem>
                <FormLabel>Direction (relative to thesis)</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger data-testid="select-promote-direction"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{DIRECTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
            <Button type="submit" disabled={promote.isPending} className="w-full" data-testid="button-submit-promote">
              {promote.isPending ? "Promoting…" : "Create signal"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const formSchema = insertResearchInboxItemSchema;

export default function ResearchInbox() {
  const { toast } = useToast();
  const { data: items, isLoading } = useQuery<ResearchInboxItem[]>({ queryKey: ["/api/inbox"] });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { rawText: "", sourceContext: "" },
  });

  const submit = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const res = await apiRequest("POST", "/api/inbox", values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      form.reset({ rawText: "", sourceContext: "" });
      toast({ title: "Note added to inbox" });
    },
    onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const pending = items?.filter((i) => i.status === "pending") ?? [];
  const resolved = items?.filter((i) => i.status !== "pending") ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Research Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Manual text-entry only. Paste things you personally saw and are authorized to share — this is never an
            automated scraper of any chat platform or service.
          </p>
        </div>

        <Card data-testid="card-inbox-form">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Add a research note</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-3">
                <FormField control={form.control} name="rawText" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Raw text</FormLabel>
                    <FormControl>
                      <Textarea rows={5} placeholder="Paste the note here…" {...field} data-testid="input-raw-text" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="sourceContext" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source context</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g. "Wealth Collective #vip-market-recaps, viewed personally on 2026-07-20"' {...field} data-testid="input-source-context" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={submit.isPending} data-testid="button-submit-inbox">
                  {submit.isPending ? "Saving…" : "Add to inbox"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pending items</h2>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-pending-items">No pending items.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((item) => (
                <Card key={item.id} data-testid={`card-inbox-item-${item.id}`}>
                  <CardContent className="space-y-2 pt-4">
                    <p className="text-sm leading-relaxed">{item.rawText}</p>
                    <p className="text-xs text-muted-foreground">{item.sourceContext}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-muted-foreground/70">{new Date(item.submittedAt).toLocaleString()}</span>
                      <PromoteDialog item={item} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {resolved.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Resolved</h2>
            <div className="space-y-2">
              {resolved.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm" data-testid={`row-resolved-${item.id}`}>
                  <span className="truncate text-muted-foreground">{item.rawText}</span>
                  <Badge variant="outline" className="ml-2 shrink-0 text-[10px] capitalize">{item.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
