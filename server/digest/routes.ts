/**
 * HTTP surface for the weekly digest.
 *
 * The click endpoint matters more than it looks: what gets opened is the only
 * honest signal about what was worth sending, and it's the input to tuning the
 * suppression later. Nobody will tell you the digest is too noisy; they'll just
 * stop opening it.
 */

import type { Express } from "express";
import { requireUser } from "../auth";
import { requireAdminToken } from "../routes";
import { appendHumanEvent } from "../human-loop/store";
import { buildWeeklyDigest, getDigest, getLatestDigest, renderDigestEmail } from "./build";

export function registerDigestRoutes(app: Express) {
  /** The Sunday job. Idempotent — a retried run returns the existing digest. */
  app.post("/api/admin/digest/build", requireAdminToken, async (_req, res, next) => {
    try {
      const result = await buildWeeklyDigest();
      res.json({
        created: result.created,
        weekStart: result.digest?.weekStart,
        items: result.digest?.items.length ?? 0,
        suppressed: result.digest?.suppressed ?? 0,
        candidatesConsidered: result.candidatesConsidered,
        notificationsQueued: result.notificationsQueued,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/digest/latest", requireUser, async (_req, res, next) => {
    try {
      const digest = await getLatestDigest();
      if (!digest) return res.json(null);
      res.json({ ...digest, emailPreview: renderDigestEmail(digest) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Someone opened an item.
   *
   * Recorded against the digest AND the item, so a later question like "does
   * anyone ever click the rising-recognition ones" is answerable. This is the
   * only feedback the suppression rules will ever get.
   */
  app.post("/api/digest/:id/clicked", requireUser, async (req, res, next) => {
    try {
      const digestId = String(req.params.id);
      const itemId = String(req.body?.itemId ?? "");
      const digest = await getDigest(digestId);
      if (!digest) return res.status(404).json({ error: "Not found" });

      const item = digest.items.find((i) => i.candidate.id === itemId);

      await appendHumanEvent(req.user!, {
        kind: "clicked_digest_item",
        summary: item
          ? `Opened "${item.candidate.headline}" from the weekly email`
          : "Opened something from the weekly email",
        companyId: item?.candidate.companyId ?? null,
        ticker: item?.candidate.ticker ?? null,
        subjectType: "digest_item",
        subjectId: `${digestId}:${itemId}`,
        payload: {
          digestId,
          itemId,
          // Stored so tuning can ask "what score did the things people
          // actually opened have" rather than guessing.
          materiality: item?.materiality ?? null,
          kind: item?.candidate.kind ?? null,
          wasExitSignal: item?.isExitSignal ?? false,
        },
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
