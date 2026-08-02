/**
 * HTTP surface for the research queue.
 *
 * The queue is computed on request rather than stored: it depends on the
 * current scores, on how many hours the asker has, and on what the logs say
 * has recently been looked at. A stored ranking would be stale the moment
 * somebody claimed something.
 */

import type { Express } from "express";
import { z } from "zod";
import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";
import { requireUser } from "../auth";
import { storage } from "../storage";
import { appendHumanEvent, listHumanEvents } from "../human-loop/store";
import { lastLookedAtByCompany, passedOnByCompany } from "../human-loop/log-queries";
import { listOpportunityScores } from "../scoring/store";
import { asKnownAt } from "../scoring/opportunity";
import { shortName } from "@shared/team";
import {
  planResearch,
  scoreResearchItem,
  summarizePlan,
  type ResearchItemInput,
} from "./value";

interface ResearchItemRow {
  id: string;
  companyId: number;
  ticker: string | null;
  question: string;
  intendedPositionPct: number;
  timeSensitivity: number;
  estimatedHours: number;
  createdBy: string;
  status: string;
  claimedBy: string | null;
  claimedAt: Date | null;
  closedAt: Date | null;
  closedBy: string | null;
  conclusion: string | null;
  createdAt: Date;
}

function hydrate(r: any): ResearchItemRow {
  return {
    ...r,
    intendedPositionPct: Number(r.intendedPositionPct),
    timeSensitivity: Number(r.timeSensitivity),
    estimatedHours: Number(r.estimatedHours),
    claimedAt: r.claimedAt ? new Date(r.claimedAt) : null,
    closedAt: r.closedAt ? new Date(r.closedAt) : null,
    createdAt: new Date(r.createdAt),
  };
}

async function listItems(status?: string): Promise<ResearchItemRow[]> {
  let q = supabase.from("research_items").select("*");
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false });
  throwIfError(error, "listResearchItems");
  return rowsToCamel<any>(data).map(hydrate);
}

const createSchema = z.object({
  companyId: z.number(),
  question: z.string().min(1, "What would an hour actually answer?"),
  intendedPositionPct: z.number().min(0).max(100).default(1),
  timeSensitivity: z.number().min(0).max(1).default(0.5),
  estimatedHours: z.number().min(0.25).max(40).default(2),
});

export function registerResearchRoutes(app: Express) {
  /**
   * The queue, cut to the hours you say you have.
   *
   * `hours` is a required input rather than a default, because the whole point
   * is being told what doesn't fit — and that question has no answer until
   * somebody says how much time they've actually got.
   */
  app.get("/api/research/queue", requireUser, async (req, res, next) => {
    try {
      const hours = Number(req.query.hours);
      if (!Number.isFinite(hours) || hours < 0) {
        return res.status(400).json({
          error: "Say how many hours you have this week — the queue is cut to fit.",
        });
      }

      const now = new Date();
      const open = (await listItems()).filter(
        (i) => i.status === "open" || i.status === "claimed",
      );

      // Team-level attention, not per-person. A per-person version of "who has
      // looked at what" is a scorecard, and a scorecard makes people log
      // dishonestly — which would corrupt the very logs this ranking reads.
      const recentActivity = await listHumanEvents({
        since: new Date(now.getTime() - 90 * 86_400_000),
        limit: 1000,
      });

      const scored = await Promise.all(
        open.map(async (row): Promise<ReturnType<typeof scoreResearchItem>> => {
          const scores = await listOpportunityScores({ companyId: row.companyId });
          const latest = asKnownAt(
            scores.map((s) => ({ ...s, knownAt: s.asOf })),
            now,
          );
          const input: ResearchItemInput = {
            id: row.id,
            companyId: row.companyId,
            ticker: row.ticker,
            question: row.question,
            // No score yet is maximum uncertainty, which is honest: a company
            // we've never scored is exactly the kind of thing an hour resolves.
            state: latest
              ? { score: latest.longScore, confidence: latest.confidence }
              : { score: 0.5, confidence: 0.1 },
            intendedPositionPct: row.intendedPositionPct,
            timeSensitivity: row.timeSensitivity,
            estimatedHours: row.estimatedHours,
          };
          return scoreResearchItem(input);
        }),
      );

      const claimedBy = new Map<number, string>();
      for (const row of open) {
        if (row.claimedBy && row.claimedBy !== req.user!.email) {
          claimedBy.set(row.companyId, shortName(row.claimedBy));
        }
      }

      const plan = planResearch(scored, hours, {
        now,
        lastLookedAt: lastLookedAtByCompany(recentActivity),
        passedOn: passedOnByCompany(recentActivity),
        claimedBy,
      });

      const byId = new Map(open.map((row) => [row.id, row]));
      res.json({
        summary: summarizePlan(plan),
        hoursAvailable: plan.hoursAvailable,
        hoursUsed: plan.hoursUsed,
        doing: plan.doing.map((i) => ({ ...i, row: byId.get(i.id) })),
        notDoing: plan.notDoing.map((s) => ({
          why: s.why,
          item: { ...s.item, row: byId.get(s.item.id) },
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/research", requireUser, async (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      }
      const company = await storage.getCompany(parsed.data.companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const { data, error } = await supabase
        .from("research_items")
        .insert(
          objToSnake({
            ...parsed.data,
            ticker: company.ticker,
            createdBy: req.user!.email,
          }),
        )
        .select()
        .single();
      throwIfError(error, "createResearchItem");
      res.json(hydrate(rowsToCamel<any>([data])[0]));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Claim locks: so two people don't spend the same Saturday on the same name.
   *
   * Guarded on the item still being unclaimed, so a race resolves to whoever
   * got there first rather than silently overwriting.
   */
  app.post("/api/research/:id/claim", requireUser, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await supabase
        .from("research_items")
        .update({
          status: "claimed",
          claimed_by: req.user!.email,
          claimed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .is("claimed_by", null)
        .select()
        .maybeSingle();
      throwIfError(error, "claimResearchItem");

      if (!data) {
        return res.status(409).json({ error: "Somebody else got to this one first." });
      }
      const row = hydrate(rowsToCamel<any>([data])[0]);

      await appendHumanEvent(req.user!, {
        kind: "claimed_research",
        summary: `Took on: ${row.question}`,
        companyId: row.companyId,
        ticker: row.ticker,
        subjectType: "research_item",
        subjectId: id,
      });

      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/research/:id/release", requireUser, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await supabase
        .from("research_items")
        .update({ status: "open", claimed_by: null, claimed_at: null })
        .eq("id", id)
        .select()
        .maybeSingle();
      throwIfError(error, "releaseResearchItem");
      if (!data) return res.status(404).json({ error: "Not found" });
      const row = hydrate(rowsToCamel<any>([data])[0]);

      await appendHumanEvent(req.user!, {
        kind: "released_research",
        summary: `Put back: ${row.question}`,
        companyId: row.companyId,
        ticker: row.ticker,
        subjectType: "research_item",
        subjectId: id,
      });

      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Closing an item.
   *
   * `not_worth_more_time` sits beside `done` as an equal outcome, not a
   * lesser one. It is often the most valuable hour of the week — it takes
   * something off everyone's list — and the human_events row it writes counts
   * as a real result everywhere the logs are read.
   */
  app.post("/api/research/:id/close", requireUser, async (req, res, next) => {
    try {
      const body = z
        .object({
          outcome: z.enum(["done", "not_worth_more_time"]),
          conclusion: z.string().min(1, "Write down what you concluded — that's the output."),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
      }

      const id = String(req.params.id);
      const { data, error } = await supabase
        .from("research_items")
        .update({
          status: body.data.outcome,
          closed_at: new Date().toISOString(),
          closed_by: req.user!.email,
          conclusion: body.data.conclusion,
        })
        .eq("id", id)
        .select()
        .maybeSingle();
      throwIfError(error, "closeResearchItem");
      if (!data) return res.status(404).json({ error: "Not found" });
      const row = hydrate(rowsToCamel<any>([data])[0]);

      await appendHumanEvent(req.user!, {
        kind:
          body.data.outcome === "not_worth_more_time"
            ? "concluded_not_worth_more_time"
            : "finished_research",
        summary:
          body.data.outcome === "not_worth_more_time"
            ? `Looked at ${row.ticker ?? "this"} and concluded it isn't worth more time`
            : `Answered: ${row.question}`,
        rawText: body.data.conclusion,
        companyId: row.companyId,
        ticker: row.ticker,
        subjectType: "research_item",
        subjectId: id,
      });

      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Team-level counts. Both kinds of finishing are shown side by side and
   * neither is broken down by person — a leaderboard here would produce
   * activity rather than results, and the queue reads these same logs.
   */
  app.get("/api/research/stats", requireUser, async (_req, res, next) => {
    try {
      const all = await listItems();
      res.json({
        open: all.filter((i) => i.status === "open").length,
        claimed: all.filter((i) => i.status === "claimed").length,
        answered: all.filter((i) => i.status === "done").length,
        passedOn: all.filter((i) => i.status === "not_worth_more_time").length,
      });
    } catch (err) {
      next(err);
    }
  });
}
