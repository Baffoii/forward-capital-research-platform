/**
 * HTTP surface for the decision journal.
 *
 * The scheduled half (`/api/admin/journal/resurface`) is what makes this work:
 * left to ourselves we reread the reasoning on positions that are going well
 * and never look at the ones that aren't. The system decides when, not us.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { requireAdminToken } from "../routes";
import { storage } from "../storage";
import { appendHumanEvent, listWorldEvents } from "../human-loop/store";
import { queueNotifications, listArmedKillCriteria } from "../watcher/store";
import { buildCompanyFacts, buildConstraintFacts, listOpenPositions } from "../watcher/context";
import { resolvePath } from "../watcher/predicate";
import {
  createJournalEntry,
  createJournalReview,
  getJournalEntry,
  lastReviewedByEntry,
  listJournalEntries,
  listJournalReviews,
} from "./store";
import {
  rankResurfacings,
  resurfacingFor,
  summarizeCalibration,
  type KillCriterionReading,
  type Resurfacing,
} from "./resurface";

const entrySchema = z.object({
  companyId: z.number(),
  ticker: z.string().nullable().optional(),
  positionId: z.string().nullable().optional(),
  belief: z.string().min(1, "Say what you believe."),
  expectation: z.string().min(1, "Say what you expect."),
  expectBy: z.string().nullable().optional(),
  falsifier: z.string().min(1, "Say what would change your mind — this is the field that matters."),
  rawText: z.string().nullable().optional(),
});

const reviewSchema = z.object({
  stillAgree: z.enum(["yes", "no", "partly"]),
  note: z.string().nullable().optional(),
  triggerKind: z.string().default("manual"),
  triggerPayload: z.record(z.unknown()).optional(),
});

/**
 * Read the current value of whatever a kill criterion measures, so we can say
 * how close it is. Returns null when we don't hold the data — which reads as
 * "can't tell", never as "fine".
 */
async function readingsForCompany(
  companyId: number,
  now: Date,
): Promise<KillCriterionReading[]> {
  const [criteria, facts, constraintFacts, positions] = await Promise.all([
    listArmedKillCriteria(companyId),
    buildCompanyFacts(companyId, now),
    buildConstraintFacts(now),
    listOpenPositions(),
  ]);
  if (!facts) return [];

  return criteria.map((criterion) => {
    const predicate: any = criterion.predicate;
    const path: string | undefined = predicate?.field ?? predicate?.metric;

    const ctx: any = { ...facts.base };
    if (criterion.constraintId && constraintFacts.has(criterion.constraintId)) {
      ctx.constraint = constraintFacts.get(criterion.constraintId);
    }

    // resolvePath returns a sentinel symbol for a missing field, and Number()
    // on a symbol throws — so narrow to the two types worth converting rather
    // than coercing whatever comes back.
    const raw = path ? resolvePath(ctx, path) : undefined;
    const actual =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

    return {
      id: criterion.id,
      statement: criterion.statement,
      op: String(predicate?.op ?? ""),
      threshold: Number(predicate?.value),
      actual: Number.isFinite(actual) ? actual : null,
      status: criterion.status,
    };
  });
}

export function registerJournalRoutes(app: Express) {
  /* ---------------------------------------------------------------- */
  /* Writing the reasoning down                                        */
  /* ---------------------------------------------------------------- */

  app.post("/api/journal", requireUser, async (req, res, next) => {
    try {
      const parsed = entrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      }
      const company = await storage.getCompany(parsed.data.companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const entry = await createJournalEntry({
        companyId: parsed.data.companyId,
        ticker: parsed.data.ticker ?? company.ticker,
        positionId: parsed.data.positionId ?? null,
        authorId: req.user!.id,
        authorEmail: req.user!.email,
        belief: parsed.data.belief,
        expectation: parsed.data.expectation,
        expectBy: parsed.data.expectBy ? new Date(parsed.data.expectBy) : null,
        falsifier: parsed.data.falsifier,
        rawText: parsed.data.rawText ?? null,
      });

      await appendHumanEvent(req.user!, {
        kind: "wrote_journal_entry",
        summary: `Wrote down why we hold ${entry.ticker ?? company.name}`,
        rawText: parsed.data.rawText ?? null,
        companyId: entry.companyId,
        ticker: entry.ticker,
        subjectType: "journal_entry",
        subjectId: entry.id,
      });

      res.json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/journal", requireUser, async (req, res, next) => {
    try {
      res.json(
        await listJournalEntries({
          companyId: req.query.companyId ? Number(req.query.companyId) : undefined,
          status: req.query.status ? String(req.query.status) : undefined,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * One entry, with its full review history.
   *
   * The original text is returned untouched alongside every later review, so
   * the UI can show what was written then next to what's happened since. That
   * juxtaposition is the entire feature — a summary of the original would
   * quietly launder away whatever the author actually got wrong.
   */
  app.get("/api/journal/:id", requireUser, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const entry = await getJournalEntry(id);
      if (!entry) return res.status(404).json({ error: "Not found" });

      const [reviews, since] = await Promise.all([
        listJournalReviews(id),
        listWorldEvents({ companyId: entry.companyId, since: entry.createdAt, limit: 50 }),
      ]);

      res.json({ entry, reviews, whatHappenedSince: since });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Do you still agree with yourself                                  */
  /* ---------------------------------------------------------------- */

  app.post("/api/journal/:id/review", requireUser, async (req, res, next) => {
    try {
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const id = String(req.params.id);
      const entry = await getJournalEntry(id);
      if (!entry) return res.status(404).json({ error: "Not found" });

      const review = await createJournalReview({
        entryId: id,
        reviewerId: req.user!.id,
        reviewerEmail: req.user!.email,
        triggerKind: parsed.data.triggerKind,
        triggerPayload: parsed.data.triggerPayload ?? {},
        stillAgree: parsed.data.stillAgree,
        note: parsed.data.note ?? null,
      });

      await appendHumanEvent(req.user!, {
        kind: "reviewed_journal_entry",
        summary:
          parsed.data.stillAgree === "yes"
            ? `Reread why we hold ${entry.ticker ?? "a position"} and still agrees`
            : `Reread why we hold ${entry.ticker ?? "a position"} and has changed their mind`,
        rawText: parsed.data.note ?? null,
        companyId: entry.companyId,
        ticker: entry.ticker,
        subjectType: "journal_entry",
        subjectId: id,
        payload: { stillAgree: parsed.data.stillAgree, triggerKind: parsed.data.triggerKind },
      });

      res.json(review);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Team-level calibration. There is deliberately no per-person breakdown:
   * changing your mind in the face of evidence is the behaviour this exists to
   * encourage, so it must never be something anyone can be ranked on.
   */
  app.get("/api/journal/stats/calibration", requireUser, async (_req, res, next) => {
    try {
      res.json(summarizeCalibration(await listJournalReviews()));
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* The scheduled half                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Work out which entries are due and notify their authors.
   *
   * Runs over open entries only. Small enough to do in one request — there is
   * one entry per position, not one per company per source.
   */
  app.post("/api/admin/journal/resurface", requireAdminToken, async (_req, res, next) => {
    try {
      const now = new Date();
      const entries = await listJournalEntries({ status: "open" });
      const lastReviewed = await lastReviewedByEntry();

      const due: Resurfacing[] = [];
      const byEntry = new Map<string, (typeof entries)[number]>();

      for (const entry of entries) {
        byEntry.set(entry.id, entry);
        const since = lastReviewed.get(entry.id) ?? entry.createdAt;
        const [recentEvents, killCriteria] = await Promise.all([
          listWorldEvents({ companyId: entry.companyId, since, until: now, limit: 50 }),
          readingsForCompany(entry.companyId, now),
        ]);

        const resurfacing = resurfacingFor(entry, {
          now,
          lastReviewedAt: lastReviewed.get(entry.id) ?? null,
          recentEvents,
          killCriteria,
        });
        if (resurfacing) due.push(resurfacing);
      }

      const ranked = rankResurfacings(due);
      const queued = await queueNotifications(
        ranked.map((item) => {
          const entry = byEntry.get(item.entryId)!;
          return {
            kind: "journal_resurface" as const,
            ruleId: null,
            recipientEmail: entry.authorEmail,
            subject: `Worth rereading: ${entry.ticker ?? "a position"}`,
            body: [
              item.reason,
              `What you wrote on ${entry.createdAt.toISOString().slice(0, 10)}, unedited:`,
              `  We believe: ${entry.belief}`,
              `  We expect: ${entry.expectation}`,
              `  What would change our mind: ${entry.falsifier}`,
              `Do you still agree with that? Answering "no" is a real answer and the ` +
                `most useful one — it's what makes the record worth keeping.`,
              "Nothing has been traded. You decide and execute yourself.",
            ].join("\n\n"),
            payload: { entryId: entry.id, triggerKind: item.triggerKind, ...item.payload },
            companyId: entry.companyId,
            ticker: entry.ticker,
            // One prompt per entry per trigger per day — the cooldown in
            // resurface.ts is the real guard, this is the backstop.
            dedupeKey: `journal:${entry.id}:${item.triggerKind}:${now.toISOString().slice(0, 10)}`,
          };
        }),
      );

      res.json({
        entriesChecked: entries.length,
        due: ranked.length,
        notificationsQueued: queued.length,
        reasons: ranked.map((r) => ({ entryId: r.entryId, trigger: r.triggerKind, reason: r.reason })),
      });
    } catch (err) {
      next(err);
    }
  });

  /** What's due right now, for the re-entry briefing to fold in. */
  app.get("/api/journal/due", requireUser, async (req, res, next) => {
    try {
      const now = new Date();
      const entries = await listJournalEntries({ status: "open" });
      const lastReviewed = await lastReviewedByEntry();
      const mine = entries.filter((e) => e.authorEmail === req.user!.email);

      const due: Array<Resurfacing & { entry: (typeof entries)[number] }> = [];
      for (const entry of mine) {
        const since = lastReviewed.get(entry.id) ?? entry.createdAt;
        const [recentEvents, killCriteria] = await Promise.all([
          listWorldEvents({ companyId: entry.companyId, since, until: now, limit: 50 }),
          readingsForCompany(entry.companyId, now),
        ]);
        const resurfacing = resurfacingFor(entry, {
          now,
          lastReviewedAt: lastReviewed.get(entry.id) ?? null,
          recentEvents,
          killCriteria,
        });
        if (resurfacing) due.push({ ...resurfacing, entry });
      }

      res.json(rankResurfacings(due as Resurfacing[]));
    } catch (err) {
      next(err);
    }
  });
}
