/**
 * The re-entry briefing endpoint.
 *
 * Gathers this person's state from every other feature and hands it to the
 * pure assembler in ./assemble.ts, which does the ranking.
 *
 * The one thing this endpoint must not do is record a page view as activity.
 * Opening the app is a `session_started` event and nothing more — if merely
 * looking counted as work, the research queue (which reads these logs to find
 * what's been neglected) would think every company had been researched.
 */

import type { Express } from "express";
import { requireUser } from "../auth";
import { storage } from "../storage";
import {
  appendHumanEvent,
  listHumanEvents,
  listWorldEvents,
  sessionContext,
} from "../human-loop/store";
import { openItems, daysAway, lastLookedAtByCompany } from "../human-loop/log-queries";
import { listHandoffPackets } from "../handoffs/store";
import { listPrecommitments } from "../precommitments/store";
import { shortName } from "@shared/team";
import { assembleBriefing, gapGreeting, type BriefingInputs } from "./assemble";

export function registerBriefingRoutes(app: Express) {
  app.get("/api/briefing", requireUser, async (req, res, next) => {
    try {
      const now = new Date();
      const user = req.user!;

      const { lastSessionEnd, recentEvents } = await sessionContext(user.id, now);
      const gap = daysAway(lastSessionEnd, now);

      const mine = openItems(recentEvents, now);

      const [packets, precommits, companies] = await Promise.all([
        listHandoffPackets({ forEmail: user.email }),
        listPrecommitments({ status: "met" }),
        storage.listCompanies(),
      ]);
      const nameById = new Map(companies.map((c) => [c.id, c.name]));

      const handoffsForMe = packets
        .filter(
          (p) =>
            p.status !== "closed" &&
            (p.assigneeEmail === user.email ||
              (p.assigneeEmail === null && p.authorEmail !== user.email)),
        )
        .map((p) => ({
          id: p.id,
          ticker: p.ticker,
          authorName: shortName(p.authorEmail),
          needsDecision: p.needsDecision,
          rawText: p.rawText,
          status: p.status,
          ageHours: (now.getTime() - p.createdAt.getTime()) / 3_600_000,
        }));

      const myUnacceptedHandoffs = packets
        .filter((p) => p.authorEmail === user.email && p.status === "open")
        .map((p) => ({
          id: p.id,
          ticker: p.ticker,
          assigneeName: p.assigneeEmail ? shortName(p.assigneeEmail) : null,
          ageHours: (now.getTime() - p.createdAt.getTime()) / 3_600_000,
        }));

      const metPrecommitments = precommits
        .filter((p) => p.authorEmail === user.email && !p.acknowledgedAt)
        .map((p) => ({
          id: p.id,
          ticker: p.ticker,
          conditionText: p.conditionText,
          actionText: p.actionText,
          reasoning: p.reasoning,
        }));

      // Journal entries the resurfacing rules think are worth rereading.
      // Imported lazily to keep this module's import graph shallow.
      const { listJournalEntries, lastReviewedByEntry } = await import("../journal/store");
      const { resurfacingFor } = await import("../journal/resurface");
      const entries = (await listJournalEntries({ status: "open" })).filter(
        (e) => e.authorEmail === user.email,
      );
      const lastReviewed = await lastReviewedByEntry();

      const journalDue: BriefingInputs["journalDue"] = [];
      for (const entry of entries) {
        const since = lastReviewed.get(entry.id) ?? entry.createdAt;
        const events = await listWorldEvents({
          companyId: entry.companyId,
          since,
          until: now,
          limit: 50,
        });
        const resurfacing = resurfacingFor(entry, {
          now,
          lastReviewedAt: lastReviewed.get(entry.id) ?? null,
          recentEvents: events,
          // Nearness needs a live reading, which is the scheduled job's work.
          // Here we surface the cheaper triggers rather than re-doing it per
          // page load; the emailed version carries the near-miss cases.
          killCriteria: [],
        });
        if (resurfacing) {
          journalDue.push({
            entryId: entry.id,
            ticker: entry.ticker,
            reason: resurfacing.reason,
            urgency: resurfacing.urgency,
          });
        }
      }

      // Changes on names THIS person has actually touched. The digest already
      // covers the world; this page is about them.
      const myCompanies = new Set(
        Array.from(lastLookedAtByCompany(recentEvents).keys()),
      );
      for (const packet of packets) if (packet.companyId) myCompanies.add(packet.companyId);
      for (const entry of entries) myCompanies.add(entry.companyId);

      const world = await listWorldEvents({ since: lastSessionEnd, until: now, limit: 200 });
      const changesOnMyThings = world
        .filter((e) => e.companyId != null && myCompanies.has(e.companyId))
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          ticker: e.ticker ?? (e.companyId ? nameById.get(e.companyId) ?? null : null),
          headline: e.headline,
          materiality: e.materiality ?? null,
          knownAt: e.knownAt,
        }));

      const briefing = assembleBriefing({
        now,
        lastSessionEnd,
        daysAway: gap,
        openItems: mine,
        handoffsForMe,
        myUnacceptedHandoffs,
        metPrecommitments,
        journalDue,
        changesOnMyThings,
      });

      // Opening the app is a session marker, nothing more. See the note at the
      // top of this file for why that distinction matters.
      const alreadyStarted = await listHumanEvents({
        userId: user.id,
        kinds: ["session_started"],
        since: lastSessionEnd,
        limit: 1,
      });
      if (alreadyStarted.length === 0) {
        await appendHumanEvent(user, {
          kind: "session_started",
          summary: "Opened the app",
          payload: { daysAway: gap },
        });
      }

      res.json({ ...briefing, greeting: gapGreeting(gap, shortName(user.email)) });
    } catch (err) {
      next(err);
    }
  });
}
