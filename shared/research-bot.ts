import { z } from "zod";

// Candidate universe transcribed from the user-supplied stock sheet. Research
// candidates stay separate from persisted holdings/watchlists.
export const THESIS_RESEARCH_CANDIDATES = [
  { ticker: "MP", name: "MP Materials", category: "Materials", bottleneck: "US rare-earth mining and processing" },
  { ticker: "TMC", name: "The Metals Company", category: "Materials", bottleneck: "Polymetallic nodules and critical-mineral supply" },
  { ticker: "WOLF", name: "Wolfspeed", category: "Chips", bottleneck: "Power semiconductors and materials for high-power data centers" },
  { ticker: "LITE", name: "Lumentum Holdings", category: "Networking", bottleneck: "Photonics and optical interconnect components" },
  { ticker: "COHR", name: "Coherent", category: "Networking", bottleneck: "Photonics and optical interconnect components" },
  { ticker: "VICR", name: "Vicor", category: "Power", bottleneck: "Compact power-delivery modules for AI servers" },
  { ticker: "NVTS", name: "Navitas Semiconductor", category: "Chips", bottleneck: "Power-conversion semiconductors for data centers" },
  { ticker: "POWL", name: "Powell Industries", category: "Power", bottleneck: "Switchgear and electrical systems required before energization" },
  { ticker: "VRT", name: "Vertiv", category: "Equipment", bottleneck: "Data-center power and cooling equipment" },
  { ticker: "MOD", name: "Modine Manufacturing", category: "Unclassified", bottleneck: "Candidate requires bottleneck definition" },
  { ticker: "TXN", name: "Texas Instruments", category: "Unclassified", bottleneck: "Candidate requires bottleneck definition" },
] as const;

export const researchEvidenceSchema = z.object({
  claim: z.string(),
  implication: z.enum(["supports", "contradicts", "neutral"]),
  sourceTitle: z.string(),
  sourceUrl: z.string().url(),
  publishedAt: z.string(),
  sourceQuality: z.enum(["primary", "reputable_secondary", "other"]),
});

export const specialistFindingSchema = z.object({
  agent: z.enum(["infrastructure_demand", "supply_constraint", "market_awareness", "skeptic"]),
  conclusion: z.string(),
  stance: z.enum(["supports", "contradicts", "mixed", "insufficient_evidence"]),
  confidence: z.number().min(0).max(100),
  evidence: z.array(researchEvidenceSchema),
  missingEvidence: z.array(z.string()),
});

export const thesisVerdictSchema = z.object({
  verdict: z.enum(["supported", "mixed", "weakened", "insufficient_evidence"]),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
  strongestEvidenceFor: z.array(z.string()),
  strongestEvidenceAgainst: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  nextChecks: z.array(z.string()),
});

export type SpecialistFinding = z.infer<typeof specialistFindingSchema>;
export type ThesisVerdict = z.infer<typeof thesisVerdictSchema>;

export interface ResearchBotReport {
  thesisId: number;
  thesisTitle: string;
  focusTicker: string | null;
  model: string;
  generatedAt: string;
  verdict: ThesisVerdict;
  findings: SpecialistFinding[];
  agentErrors: Array<{ agent: string; message: string }>;
  disclaimer: string;
}

