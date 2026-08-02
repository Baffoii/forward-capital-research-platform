/**
 * HTTP surface for the two logs.
 *
 * Kept out of server/routes.ts, which is already long and belongs to the
 * ingestion/scoring side of the app. Registered from there.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { requireAdminToken } from "../routes";
import { storage } from "../storage";
import {
  appendHumanEvent,
  listHumanEvents,
  listWorldEvents,
  sessionContext,
} from "./store";
import { openItems, daysAway } from "./log-queries";
import { backfillCompany } from "./backfill";
import { HUMAN_EVENT_KINDS } from "@shared/human-loop-events";

const humanEventKinds = Object.keys(HUMAN_EVENT_KINDS) as [string, ...string[]];

const newHumanEventSchema = z.object({
  kind: z.enum(humanEventKinds),
  summary: z.string().min(1),
  companyId: z.number().nullable().optional(),
  ticker: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  subjectType: z.string().nullable().optional(),
  subjectId: z.string().nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

export function registerHumanLoopRoutes(app: Express) {
  /* ---------------------------------------------------------------- */
  /* Writing to the human log                                          */
  /* ---------------------------------------------------------------- */

  // The user id comes from the verified token, never from the request body.
  // A client that could name its own author would make the log worthless.
  app.post("/api/events", requireUser, async (req, res, next) => {
    try {
      const parsed = newHumanEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const row = await appendHumanEvent(req.user!, parsed.data);
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  app.get("/api/events/world", requireUser, async (req, res, next) => {
    try {
      const since = req.query.since ? new Date(String(req.query.since)) : null;
      const events = await listWorldEvents({
        since,
        companyId: req.query.companyId ? Number(req.query.companyId) : undefined,
        kinds: req.query.kind ? [String(req.query.kind)] : undefined,
        limit: Number(req.query.limit) || 200,
      });
      res.json(events);
    } catch (err) {
      next(err);
    }
  });

  /**
   * The team's activity, not one person's.
   *
   * There is deliberately no "show me what rchen23 did" endpoint. This system
   * logs the team's own behaviour, and if it reads as a scorecard on who is
   * slacking it will be used dishonestly — which would corrupt the research
   * queue, since that ranks on these same logs.
   */
  app.get("/api/events/team", requireUser, async (req, res, next) => {
    try {
      const since = req.query.since ? new Date(String(req.query.since)) : null;
      const events = await listHumanEvents({
        since,
        companyId: req.query.companyId ? Number(req.query.companyId) : undefined,
        limit: Number(req.query.limit) || 200,
      });
      res.json(events);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Where the signed-in person left off. The re-entry briefing (task 8) is
   * built on this; exposing it on its own makes the session logic checkable
   * without a UI.
   */
  app.get("/api/events/my-session", requireUser, async (req, res, next) => {
    try {
      const now = new Date();
      const { sessionId, lastSessionEnd, recentEvents } = await sessionContext(
        req.user!.id,
        now,
      );
      res.json({
        sessionId,
        lastSessionEnd,
        daysAway: daysAway(lastSessionEnd, now),
        firstEverVisit: lastSessionEnd === null,
        openItems: openItems(recentEvents, now),
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Backfill                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * One company per request. The existing deployment was unstable doing every
   * company's work in one call, which is why this repo already splits sync
   * into small per-company requests. Same pattern.
   */
  app.post(
    "/api/admin/backfill/company/:id",
    requireAdminToken,
    async (req, res, next) => {
      try {
        const result = await backfillCompany(Number(req.params.id));
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * The list of company ids to walk. The caller (a scheduled job or a one-off
   * script) fetches this, then calls the per-company endpoint for each — so
   * the work is spread across many small requests rather than one long one.
   */
  app.get("/api/admin/backfill/plan", requireAdminToken, async (_req, res, next) => {
    try {
      const companies = await storage.listCompanies();
      res.json({
        companyIds: companies.map((c) => c.id),
        note: "POST /api/admin/backfill/company/:id for each id, one request at a time.",
      });
    } catch (err) {
      next(err);
    }
  });
}
