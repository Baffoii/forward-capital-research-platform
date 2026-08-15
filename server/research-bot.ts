import type { Company, Signal, Thesis, ThesisAssumption } from "@shared/schema";
import {
  specialistFindingSchema,
  thesisVerdictSchema,
  THESIS_RESEARCH_CANDIDATES,
  type ResearchBotReport,
  type SpecialistFinding,
} from "@shared/research-bot";

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
type AgentName = SpecialistFinding["agent"];

interface ResearchContext {
  thesis: Thesis;
  assumptions: ThesisAssumption[];
  companies: Company[];
  signals: Signal[];
  focusTicker?: string;
}

interface OpenAIResponse {
  status?: string;
  output_text?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  error?: { message?: string };
}

const evidenceJsonSchema = {
  type: "object",
  properties: {
    claim: { type: "string" }, implication: { type: "string", enum: ["supports", "contradicts", "neutral"] },
    sourceTitle: { type: "string" }, sourceUrl: { type: "string" }, publishedAt: { type: "string" },
    sourceQuality: { type: "string", enum: ["primary", "reputable_secondary", "other"] },
  },
  required: ["claim", "implication", "sourceTitle", "sourceUrl", "publishedAt", "sourceQuality"],
  additionalProperties: false,
} as const;

const specialistJsonSchema = {
  type: "object",
  properties: {
    agent: { type: "string", enum: ["infrastructure_demand", "supply_constraint", "market_awareness", "skeptic"] },
    conclusion: { type: "string" },
    stance: { type: "string", enum: ["supports", "contradicts", "mixed", "insufficient_evidence"] },
    confidence: { type: "number" }, evidence: { type: "array", items: evidenceJsonSchema },
    missingEvidence: { type: "array", items: { type: "string" } },
  },
  required: ["agent", "conclusion", "stance", "confidence", "evidence", "missingEvidence"],
  additionalProperties: false,
} as const;

const verdictJsonSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["supported", "mixed", "weakened", "insufficient_evidence"] },
    confidence: { type: "number" }, summary: { type: "string" },
    strongestEvidenceFor: { type: "array", items: { type: "string" } },
    strongestEvidenceAgainst: { type: "array", items: { type: "string" } },
    unresolvedQuestions: { type: "array", items: { type: "string" } },
    nextChecks: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "confidence", "summary", "strongestEvidenceFor", "strongestEvidenceAgainst", "unresolvedQuestions", "nextChecks"],
  additionalProperties: false,
} as const;

const AGENT_BRIEFS: Record<AgentName, string> = {
  infrastructure_demand: "Test whether current AI infrastructure growth is causing incremental demand for advanced material processing and the named candidates' products. Separate direct customer or capex evidence from broad AI enthusiasm.",
  supply_constraint: "Test whether advanced-material processing is genuinely scarce, slow to expand, strategically concentrated, or technically difficult. Look for capacity, lead-time, permitting, yield, refining, and substitution evidence.",
  market_awareness: "Test the timing and underappreciation claim using valuation, guidance, consensus, price action, and explicit analyst narratives. Do not equate a rising share price with proof by itself.",
  skeptic: "Red-team the thesis. Seek substitution, excess capacity, weak AI linkage, execution failures, regulation, customer concentration, and evidence that another layer is more binding.",
};

function compactContext(context: ResearchContext): string {
  const focus = context.focusTicker?.toUpperCase();
  const companies = context.companies
    .filter((company) => !focus || company.ticker?.toUpperCase() === focus)
    .map((company) => ({ ticker: company.ticker, name: company.name, segment: company.segment, description: company.description }))
    .slice(0, focus ? 1 : 20);
  const companyIds = new Set(companies.map((company) => context.companies.find((item) => item.ticker === company.ticker)?.id));
  const signals = context.signals
    .filter((signal) => !focus || (signal.companyId != null && companyIds.has(signal.companyId)))
    .slice(0, 40)
    .map((signal) => ({ id: signal.id, title: signal.title, description: signal.description, direction: signal.direction, verificationTier: signal.verificationTier, sourceUrl: signal.sourceUrl, retrievedAt: signal.retrievedAt }));
  return JSON.stringify({
    thesis: { title: context.thesis.title, summary: context.thesis.summary, prediction: context.thesis.prediction },
    assumptionsToChallenge: context.assumptions.map((item) => item.text),
    focusTicker: focus ?? null,
    suppliedCandidateUniverse: focus ? THESIS_RESEARCH_CANDIDATES.filter((item) => item.ticker === focus) : THESIS_RESEARCH_CANDIDATES,
    companies,
    existingSignals: signals,
  });
}

function extractOutputText(payload: OpenAIResponse): string {
  if (payload.status === "incomplete") throw new Error(`OpenAI response incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}`);
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal") throw new Error(content.refusal || "OpenAI refused the research request");
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error(payload.error?.message || "OpenAI returned no structured output");
}

async function callOpenAI(body: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json()) as OpenAIResponse;
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status})`);
  return JSON.parse(extractOutputText(payload));
}

async function runSpecialist(agent: AgentName, context: ResearchContext, apiKey: string, model: string): Promise<SpecialistFinding> {
  const raw = await callOpenAI({
    model,
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search" }],
    include: ["web_search_call.action.sources"],
    instructions: [
      "You are one member of an institutional research committee testing a falsifiable investment thesis.",
      "Search the current public web. Prefer filings, company releases, government records, customer disclosures, and technical publications.",
      "Treat supplied signals only as leads. Independently verify material claims.",
      "Return 2-6 material evidence items when available, each with the direct https URL of a source you reviewed.",
      "State insufficient evidence when appropriate. Do not give trading advice or price targets.",
      `Your assigned role: ${AGENT_BRIEFS[agent]}`,
    ].join("\n"),
    input: `Research as of ${new Date().toISOString().slice(0, 10)}. Test this context:\n${compactContext(context)}\nYour agent field must be exactly ${agent}.`,
    text: { verbosity: "medium", format: { type: "json_schema", name: "specialist_finding", strict: true, schema: specialistJsonSchema } },
  }, apiKey);
  const finding = specialistFindingSchema.parse(raw);
  if (finding.agent !== agent) throw new Error(`Agent identity mismatch: expected ${agent}, received ${finding.agent}`);
  return finding;
}

async function adjudicate(context: ResearchContext, findings: SpecialistFinding[], apiKey: string, model: string) {
  const raw = await callOpenAI({
    model,
    reasoning: { effort: "high" },
    instructions: [
      "You chair an investment research committee. Adjudicate a falsifiable thesis from specialist findings.",
      "Weight primary sources above secondary sources, independent evidence above repeated claims, and contradictory evidence at least as seriously as confirming evidence.",
      "The verdict concerns whether the thesis prediction is supported, not whether any stock should be bought.",
      "Use insufficient_evidence when coverage, recency, or directness is too weak.",
    ].join("\n"),
    input: JSON.stringify({ context: JSON.parse(compactContext(context)), specialistFindings: findings }),
    text: { verbosity: "medium", format: { type: "json_schema", name: "thesis_verdict", strict: true, schema: verdictJsonSchema } },
  }, apiKey);
  return thesisVerdictSchema.parse(raw);
}

export async function runResearchBot(context: ResearchContext): Promise<ResearchBotReport> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on the server");
  const model = process.env.OPENAI_RESEARCH_MODEL || DEFAULT_MODEL;
  const agents: AgentName[] = ["infrastructure_demand", "supply_constraint", "market_awareness", "skeptic"];
  const settled = await Promise.allSettled(agents.map((agent) => runSpecialist(agent, context, apiKey, model)));
  const findings: SpecialistFinding[] = [];
  const agentErrors: Array<{ agent: string; message: string }> = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") findings.push(result.value);
    else agentErrors.push({ agent: agents[index], message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  if (findings.length < 2) throw new Error(`Research run failed: only ${findings.length} of 4 specialist agents completed`);
  const verdict = await adjudicate(context, findings, apiKey, model);
  return {
    thesisId: context.thesis.id,
    thesisTitle: context.thesis.title,
    focusTicker: context.focusTicker?.toUpperCase() ?? null,
    model,
    generatedAt: new Date().toISOString(),
    verdict,
    findings,
    agentErrors,
    disclaimer: "Research aid only. This report tests a thesis from public evidence and is not investment advice or an instruction to trade.",
  };
}

