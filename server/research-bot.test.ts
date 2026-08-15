import assert from "node:assert/strict";
import test from "node:test";
import type { Company, Thesis, ThesisAssumption } from "@shared/schema";
import { runResearchBot } from "./research-bot";

test("research bot runs four specialists and an independent adjudicator", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_RESEARCH_MODEL;
  const calls: Array<Record<string, unknown>> = [];
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_RESEARCH_MODEL = "test-model";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    calls.push(body);
    const match = String(body.input).match(/Your agent field must be exactly ([a-z_]+)\./);
    const output = match ? {
      agent: match[1], conclusion: `${match[1]} completed`, stance: match[1] === "skeptic" ? "contradicts" : "supports", confidence: 70,
      evidence: [{ claim: "A sourced test claim", implication: match[1] === "skeptic" ? "contradicts" : "supports", sourceTitle: "Primary source", sourceUrl: "https://example.com/source", publishedAt: "2026-08-01", sourceQuality: "primary" }],
      missingEvidence: [],
    } : {
      verdict: "mixed", confidence: 62, summary: "The committee found material evidence on both sides.",
      strongestEvidenceFor: ["Demand evidence"], strongestEvidenceAgainst: ["Substitution risk"],
      unresolvedQuestions: ["Processing capacity"], nextChecks: ["Review the next filings"],
    };
    return new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const thesis = { id: 1, title: "Advanced material processing bottleneck", summary: "AI infrastructure depends on scarce physical inputs.", prediction: "The market recognizes advanced material processing as the next bottleneck in H2 2026." } as Thesis;
    const assumptions = [{ id: 1, thesisId: 1, text: "Supply is constrained", importance: "high" }] as ThesisAssumption[];
    const companies = [{ id: 1, ticker: "MP", name: "MP Materials", segment: "Materials" }] as Company[];
    const report = await runResearchBot({ thesis, assumptions, companies, signals: [], focusTicker: "MP" });
    assert.equal(calls.length, 5);
    assert.equal(report.findings.length, 4);
    assert.equal(report.agentErrors.length, 0);
    assert.equal(report.verdict.verdict, "mixed");
    assert.equal(report.focusTicker, "MP");
    assert.equal(report.model, "test-model");
    assert.ok(calls.slice(0, 4).every((call) => Array.isArray(call.tools)));
    assert.equal(calls[4].tools, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENAI_RESEARCH_MODEL; else process.env.OPENAI_RESEARCH_MODEL = originalModel;
  }
});

