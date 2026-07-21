import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { SignalCard } from "@/components/evidence-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import type { Signal, Company, Source } from "@shared/schema";

const CATEGORIES = [
  "price_action", "insider_activity", "analyst_action", "institutional_flow", "congressional_trading",
  "patent_filing", "regulatory_filing", "hiring_signal", "web_traffic_signal", "partnership_or_supply_chain", "macro_indicator",
];
const PROVENANCE = [
  "raw_data", "detected_signal", "ai_generated_interpretation", "human_authored_research",
  "investment_hypothesis", "confirmed_event", "unverified_rumor_or_social_claim",
];
const TIERS = ["unverified", "single_source", "corroborated", "primary_source_confirmed"];
const DIRECTIONS = ["confirming", "contradicting", "neutral"];

function FilterSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: string[]; testId: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]" data-testid={`select-${testId}`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o.replace(/_/g, " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function SignalFeed() {
  const [category, setCategory] = useState("all");
  const [provenance, setProvenance] = useState("all");
  const [tier, setTier] = useState("all");
  const [direction, setDirection] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [sourceId, setSourceId] = useState("all");

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: sources } = useQuery<Source[]>({ queryKey: ["/api/sources"] });

  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (provenance !== "all") params.set("provenanceClass", provenance);
  if (tier !== "all") params.set("verificationTier", tier);
  if (direction !== "all") params.set("direction", direction);
  if (companyId !== "all") params.set("companyId", companyId);
  if (sourceId !== "all") params.set("sourceId", sourceId);

  const { data: signals, isLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals", params.toString()],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signals?${params.toString()}`);
      return res.json();
    },
  });

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Signal Feed</h1>
          <p className="text-sm text-muted-foreground">Unified chronological feed of all signals across all sources.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORIES} testId="category" />
          <FilterSelect label="Provenance" value={provenance} onChange={setProvenance} options={PROVENANCE} testId="provenance" />
          <FilterSelect label="Tier" value={tier} onChange={setTier} options={TIERS} testId="tier" />
          <FilterSelect label="Direction" value={direction} onChange={setDirection} options={DIRECTIONS} testId="direction" />
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-[180px]" data-testid="select-company">
              <SelectValue placeholder="Company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.ticker ?? c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="w-[180px]" data-testid="select-source">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources?.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
            : signals?.map((s) => <SignalCard key={s.id} signal={s} />)}
          {!isLoading && signals?.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="text-no-signals-filtered">No signals match these filters.</p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
