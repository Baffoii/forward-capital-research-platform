/**
 * HTTP surface for pre-commitments.
 *
 * Note what is absent and must stay absent: there is no endpoint that places
 * an order, generates an order file, or exports positions in a form a broker
 * could ingest. The system notifies; a human decides and executes elsewhere.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { storage } from "../storage";
import { appendHumanEvent } from "../human-loop/store";
import { describePredicate, validatePredicate } from "../watcher/predicate";
import { humanFieldName } from "../watcher/compose";
import {
  acknowledge,
  createPrecommitment,
  getPrecommitment,
  listPrecommitments,
  retirePrecommitment,
} from "./store";

/**
 * The things a condition can be written about.
 *
 * A deliberately short list. Every entry is something we actually hold data
 * for, named in plain language — a picker of forty fields nobody understands
 * produces rules nobody trusts.
 */
export const CONDITION_FIELDS = [
  "capture.backlogValue",
  "capture.grossMarginPct",
  "capture.utilizationPct",
  "constraint.tightening",
  "score.long",
  "score.confidence",
  "recognition.analystCount",
  "recognition.thematicEtfCount",
  "company.weightPct",
] as const;

const createSchema = z.object({
  companyId: z.number(),
  conditionText: z.string().min(1, "Say what the condition is, in your own words."),
  actionText: z.string().min(1, "Say what you'd do about it."),
  reasoning: z.string().min(1, "Say why. This is the part you'll need when it happens."),
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(["lt", "lte", "gt", "gte", "abs_gte", "eq"]),
  value: z.number(),
});

export function registerPrecommitmentRoutes(app: Express) {
  /** What a condition can be written about, with readable names for the UI. */
  app.get("/api/precommitments/fields", requireUser, async (_req, res) => {
    res.json(
      CONDITION_FIELDS.map((field) => ({ field, label: humanFieldName(field) })),
    );
  });

  app.post("/api/precommitments", requireUser, async (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      }
      const company = await storage.getCompany(parsed.data.companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const predicate = {
        field: parsed.data.field,
        op: parsed.data.op,
        value: parsed.data.value,
      };
      const problems = validatePredicate(predicate);
      if (problems.length > 0) {
        return res.status(400).json({ error: "That condition can't be checked.", problems });
      }

      const commitment = await createPrecommitment({
        companyId: parsed.data.companyId,
        ticker: company.ticker,
        authorId: req.user!.id,
        authorEmail: req.user!.email,
        conditionText: parsed.data.conditionText,
        actionText: parsed.data.actionText,
        reasoning: parsed.data.reasoning,
        predicate,
      });

      await appendHumanEvent(req.user!, {
        kind: "set_precommitment",
        summary: `Decided in advance: if ${parsed.data.conditionText}, ${parsed.data.actionText} (${company.ticker ?? company.name})`,
        companyId: company.id,
        ticker: company.ticker,
        subjectType: "precommitment",
        subjectId: commitment.id,
      });

      res.json({ ...commitment, reads: describePredicate(predicate) });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/precommitments", requireUser, async (req, res, next) => {
    try {
      const rows = await listPrecommitments({
        companyId: req.query.companyId ? Number(req.query.companyId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
      });
      // Echo each rule back in plain language so someone can check it says
      // what they meant without reading JSON.
      res.json(rows.map((r) => ({ ...r, reads: describePredicate(r.predicate) })));
    } catch (err) {
      next(err);
    }
  });

  /**
   * What the human actually did about it.
   *
   * "Ignored" is a first-class answer. The gap between what people decide when
   * calm and what they do when it happens is the most interesting thing this
   * table records, and it only shows up if admitting the gap is easy.
   */
  app.post("/api/precommitments/:id/acknowledge", requireUser, async (req, res, next) => {
    try {
      const body = z
        .object({
          outcome: z.enum(["followed", "ignored", "changed_mind"]),
          note: z.string().nullable().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: body.error.message });

      const id = String(req.params.id);
      const commitment = await getPrecommitment(id);
      if (!commitment) return res.status(404).json({ error: "Not found" });

      const updated = await acknowledge(
        id,
        req.user!.email,
        body.data.outcome,
        body.data.note ?? null,
      );

      await appendHumanEvent(req.user!, {
        kind: "recorded_conclusion",
        summary:
          body.data.outcome === "followed"
            ? `Did what they'd decided in advance on ${commitment.ticker ?? "a position"}`
            : body.data.outcome === "changed_mind"
              ? `Changed their mind about a rule they'd set on ${commitment.ticker ?? "a position"}`
              : `Did not act on a rule they'd set on ${commitment.ticker ?? "a position"}`,
        rawText: body.data.note ?? null,
        companyId: commitment.companyId,
        ticker: commitment.ticker,
        subjectType: "precommitment",
        subjectId: id,
        payload: { outcome: body.data.outcome },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/precommitments/:id/retire", requireUser, async (req, res, next) => {
    try {
      await retirePrecommitment(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
