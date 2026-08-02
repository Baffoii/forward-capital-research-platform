/**
 * HTTP surface for the watcher.
 *
 * Every scheduled endpoint does ONE company's work, or ONE small batch. The
 * cron fetches a plan and then makes many small calls. This repo already
 * learned that lesson the expensive way — doing all 13 companies in a single
 * request destabilised the deployment (see the note in server/routes.ts) — so
 * nothing here offers a "do everything" endpoint, even though it would be
 * shorter to write.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { requireAdminToken } from "../routes";
import { storage } from "../storage";
import { appendHumanEvent } from "../human-loop/store";
import { runWatcherForCompany } from "./evaluate";
import { dispatchPending, emailIsLive } from "./dispatch";
import { validatePredicate, describePredicate } from "./predicate";
import {
  listWatcherRules,
  listNotificationsFor,
  markClicked,
  upsertWatcherRule,
} from "./store";
import { RULE_CADENCES, NOTIFICATION_KINDS } from "@shared/human-loop-events";

const notificationKinds = Object.keys(NOTIFICATION_KINDS) as [string, ...string[]];

const ruleSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes."),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  kind: z.enum(notificationKinds),
  cadence: z.enum(RULE_CADENCES),
  predicate: z.record(z.unknown()),
  recipients: z.array(z.string().email()).default([]),
  companyId: z.number().nullable().optional(),
  enabled: z.boolean().default(true),
});

export function registerWatcherRoutes(app: Express) {
  /* ---------------------------------------------------------------- */
  /* Scheduled work — small jobs, called by cron                       */
  /* ---------------------------------------------------------------- */

  /**
   * The work list. The cron reads this, then calls the per-company endpoint
   * once per id.
   */
  app.get("/api/admin/watcher/plan", requireAdminToken, async (_req, res, next) => {
    try {
      const companies = await storage.listCompanies();
      res.json({
        companyIds: companies.map((c) => c.id),
        emailLive: emailIsLive(),
        note: "POST /api/admin/watcher/company/:id once per id, then POST /api/admin/watcher/dispatch.",
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    "/api/admin/watcher/company/:id",
    requireAdminToken,
    async (req, res, next) => {
      try {
        res.json(await runWatcherForCompany(Number(req.params.id)));
      } catch (err) {
        next(err);
      }
    },
  );

  /** One small batch per call. The cron calls it a few times in a row. */
  app.post("/api/admin/watcher/dispatch", requireAdminToken, async (req, res, next) => {
    try {
      const batchSize = Math.min(Number(req.query.batch) || 20, 50);
      res.json(await dispatchPending(batchSize));
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Rules                                                             */
  /* ---------------------------------------------------------------- */

  app.get("/api/watcher/rules", requireUser, async (_req, res, next) => {
    try {
      const rules = await listWatcherRules({ enabledOnly: false });
      // Echo back what each rule says in plain language, so someone can check
      // it means what they meant without reading JSON.
      res.json(
        rules.map((r) => ({ ...r, reads: describePredicate(r.predicate) })),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/watcher/rules", requireUser, async (req, res, next) => {
    try {
      const parsed = ruleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      // Catch a broken rule now rather than after six months of silence.
      // Stored JSON has no compiler behind it; this is the only thing between
      // a typo and a kill criterion nobody is watching with.
      const problems = validatePredicate(parsed.data.predicate as any);
      if (problems.length > 0) {
        return res.status(400).json({
          error: "That rule can't be checked as written.",
          problems,
        });
      }

      const rule = await upsertWatcherRule({
        ...parsed.data,
        description: parsed.data.description ?? null,
        companyId: parsed.data.companyId ?? null,
        createdBy: req.user!.email,
        predicate: parsed.data.predicate as any,
      });

      res.json({ ...rule, reads: describePredicate(rule.predicate) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Check a rule without saving it. Writing predicates by hand is error-prone
   * and the feedback loop for "did this say what I meant" should be seconds,
   * not a week of nothing arriving.
   */
  app.post("/api/watcher/rules/check", requireUser, async (req, res) => {
    const predicate = req.body?.predicate;
    const problems = validatePredicate(predicate);
    res.json({
      ok: problems.length === 0,
      problems,
      reads: problems.length === 0 ? describePredicate(predicate) : null,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Notifications                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Read-only view of what has been sent to you.
   *
   * This is a receipt, NOT the channel. The channel is email. An in-app
   * notification list as the primary channel is a dashboard you have to
   * remember to open, which is the thing this phase exists to escape.
   */
  app.get("/api/notifications/mine", requireUser, async (req, res, next) => {
    try {
      res.json(await listNotificationsFor(req.user!.email, Number(req.query.limit) || 50));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Records that someone acted on a notification. Feeds digest tuning — what
   * gets opened is the only honest signal about what was worth sending.
   */
  app.post("/api/notifications/:id/clicked", requireUser, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      await markClicked(id);
      await appendHumanEvent(req.user!, {
        kind: "clicked_digest_item",
        summary: "Opened something from a notification",
        subjectType: "notification",
        subjectId: id,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
