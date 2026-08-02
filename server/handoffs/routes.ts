/**
 * HTTP surface for handoff packets.
 *
 * Every state change writes a human_events row as well as updating the packet.
 * The packet is the current state; the log is how it got there, and it's what
 * the re-entry briefing and the research queue read.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { requireAdminToken } from "../routes";
import { appendHumanEvent } from "../human-loop/store";
import { queueNotifications } from "../watcher/store";
import { isTeamMember, shortName, TEAM_EMAILS, normalizeEmail } from "@shared/team";
import { HANDOFF_ESCALATION_HOURS } from "@shared/schema.human-loop";
import {
  createHandoffPacket,
  getHandoffPacket,
  listHandoffPackets,
  listUnacceptedSince,
  updateHandoffPacket,
  type HandoffPacketRow,
} from "./store";
import { structureHandoff, structuringIsAvailable } from "./structure";

/**
 * The ONLY required field. This is the whole input rule for handoffs: one
 * textarea, whatever was in someone's head, in whatever form it arrived.
 */
const newPacketSchema = z.object({
  rawText: z.string().min(1, "Write something first."),
  assigneeEmail: z.string().email().nullable().optional(),
});

const editSchema = z.object({
  ticker: z.string().nullable().optional(),
  companyId: z.number().nullable().optional(),
  found: z.string().nullable().optional(),
  stillOpen: z.string().nullable().optional(),
  needsDecision: z.string().nullable().optional(),
  sources: z.array(z.string()).optional(),
  assigneeEmail: z.string().email().nullable().optional(),
});

/** Plain-text body for the assignment email. Complete without opening the app. */
function packetEmailBody(packet: HandoffPacketRow): string {
  const parts: string[] = [];
  const who = shortName(packet.authorEmail);
  const subject = packet.ticker ? ` on ${packet.ticker}` : "";
  parts.push(`${who} handed you some research${subject}.`);

  if (packet.needsDecision) parts.push(`What you need to decide:\n${packet.needsDecision}`);
  if (packet.found) parts.push(`What they found:\n${packet.found}`);
  if (packet.stillOpen) parts.push(`What's still open:\n${packet.stillOpen}`);
  if (packet.sources.length) parts.push(`Sources:\n${packet.sources.map((s) => `  ${s}`).join("\n")}`);

  // Always included, always last. If the sorting above got something wrong —
  // and it will sometimes — this is the version that's definitely right.
  parts.push(`What they actually wrote:\n${packet.rawText}`);

  if (packet.followupQuestion) {
    parts.push(`One thing that wasn't clear: ${packet.followupQuestion}`);
  }

  parts.push(
    `Say yes or no in the app so ${who} knows whether you've got it. ` +
      `If nobody picks this up within ${HANDOFF_ESCALATION_HOURS} hours, everyone gets told.`,
  );
  return parts.join("\n\n");
}

export function registerHandoffRoutes(app: Express) {
  /* ---------------------------------------------------------------- */
  /* Writing one                                                       */
  /* ---------------------------------------------------------------- */

  app.post("/api/handoffs", requireUser, async (req, res, next) => {
    try {
      const parsed = newPacketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      }
      const { rawText } = parsed.data;
      const assigneeEmail = normalizeEmail(parsed.data.assigneeEmail) || null;

      if (assigneeEmail && !isTeamMember(assigneeEmail)) {
        return res.status(400).json({ error: "That isn't one of the three team addresses." });
      }

      // Sort the note if we can. If we can't, the packet still saves — the raw
      // text is the record and everything else is a convenience.
      const structured = await structureHandoff(rawText);

      const packet = await createHandoffPacket({
        authorId: req.user!.id,
        authorEmail: req.user!.email,
        assigneeEmail,
        rawText,
        structuringStatus: structured.status === "structured" ? "structured" : structured.status,
        ...(structured.status === "structured"
          ? {
              ticker: structured.data.ticker,
              found: structured.data.found,
              stillOpen: structured.data.stillOpen,
              needsDecision: structured.data.needsDecision,
              sources: structured.data.sources,
              followupQuestion: structured.data.followupQuestion,
            }
          : {}),
      });

      // The log entry is what keeps this packet showing up in the author's
      // re-entry briefing until it's closed.
      await appendHumanEvent(req.user!, {
        kind: "handed_off",
        summary: assigneeEmail
          ? `Handed research to ${shortName(assigneeEmail)}${packet.ticker ? ` on ${packet.ticker}` : ""}`
          : `Wrote up research for whoever picks it up${packet.ticker ? ` on ${packet.ticker}` : ""}`,
        rawText,
        ticker: packet.ticker,
        companyId: packet.companyId,
        subjectType: "handoff_packet",
        subjectId: packet.id,
        payload: { assigneeEmail, structuringStatus: packet.structuringStatus },
      });

      // Tell them. Unassigned packets go to the whole team, because a packet
      // with nobody's name on it is the one most likely to be dropped.
      const recipients = assigneeEmail
        ? [assigneeEmail]
        : TEAM_EMAILS.filter((e) => e !== req.user!.email);
      await queueNotifications(
        recipients.map((recipient) => ({
          kind: "handoff_assigned",
          ruleId: null,
          recipientEmail: recipient,
          subject: assigneeEmail
            ? `${shortName(req.user!.email)} handed you research${packet.ticker ? ` on ${packet.ticker}` : ""}`
            : `Research up for grabs${packet.ticker ? ` on ${packet.ticker}` : ""}`,
          body: packetEmailBody(packet),
          payload: { packetId: packet.id },
          companyId: packet.companyId,
          ticker: packet.ticker,
          dedupeKey: `handoff:${packet.id}:${recipient}`,
        })),
      );

      res.json({
        packet,
        // Surfaced so the UI can say "we couldn't sort this, fill it in
        // yourself" rather than silently showing empty fields.
        structuring: structured.status === "structured" ? null : structured,
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  app.get("/api/handoffs", requireUser, async (req, res, next) => {
    try {
      res.json(
        await listHandoffPackets({
          forEmail: req.query.mine === "true" ? req.user!.email : undefined,
          status: req.query.status ? String(req.query.status) : undefined,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/handoffs/available", requireUser, async (_req, res) => {
    res.json({ structuring: structuringIsAvailable() });
  });

  app.get("/api/handoffs/:id", requireUser, async (req, res, next) => {
    try {
      const packet = await getHandoffPacket(String(req.params.id));
      if (!packet) return res.status(404).json({ error: "Not found" });
      res.json(packet);
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Correcting it                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * The sorted version is editable because it will sometimes be wrong. Note
   * that rawText is not in the accepted patch — the note as typed can't be
   * rewritten, so there's always something to check the sorting against.
   */
  app.patch("/api/handoffs/:id", requireUser, async (req, res, next) => {
    try {
      const parsed = editSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const id = String(req.params.id);
      const existing = await getHandoffPacket(id);
      if (!existing) return res.status(404).json({ error: "Not found" });

      const assigneeEmail =
        parsed.data.assigneeEmail === undefined
          ? undefined
          : normalizeEmail(parsed.data.assigneeEmail) || null;
      if (assigneeEmail && !isTeamMember(assigneeEmail)) {
        return res.status(400).json({ error: "That isn't one of the three team addresses." });
      }

      const updated = await updateHandoffPacket(id, {
        ...parsed.data,
        ...(assigneeEmail === undefined ? {} : { assigneeEmail }),
        structuringStatus: "edited",
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  /** Answering the one follow-up question, if there was one. */
  app.post("/api/handoffs/:id/answer", requireUser, async (req, res, next) => {
    try {
      const answer = z.object({ answer: z.string().min(1) }).safeParse(req.body);
      if (!answer.success) return res.status(400).json({ error: answer.error.message });
      const updated = await updateHandoffPacket(String(req.params.id), {
        followupAnswer: answer.data.answer,
      });
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Accepting and closing                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Explicit accept. This is the whole point of the feature — until someone
   * says "I've got it", nobody knows whether anybody has.
   *
   * Accepting does NOT close the packet. The work is still outstanding; only
   * finishing it closes it.
   */
  app.post("/api/handoffs/:id/accept", requireUser, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const packet = await getHandoffPacket(id);
      if (!packet) return res.status(404).json({ error: "Not found" });
      if (packet.status !== "open") {
        return res.status(409).json({ error: `Already ${packet.status}.` });
      }

      const updated = await updateHandoffPacket(id, {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedBy: req.user!.email,
        // Picking up an unassigned packet claims it.
        assigneeEmail: packet.assigneeEmail ?? req.user!.email,
      });

      await appendHumanEvent(req.user!, {
        kind: "accepted_handoff",
        summary: `Picked up ${shortName(packet.authorEmail)}'s research${packet.ticker ? ` on ${packet.ticker}` : ""}`,
        ticker: packet.ticker,
        companyId: packet.companyId,
        subjectType: "handoff_packet",
        subjectId: id,
      });

      // Tell the author somebody has it. That single fact is what the whole
      // feature is for.
      await queueNotifications([
        {
          kind: "handoff_assigned",
          ruleId: null,
          recipientEmail: packet.authorEmail,
          subject: `${shortName(req.user!.email)} picked up your handoff${packet.ticker ? ` on ${packet.ticker}` : ""}`,
          body:
            `${shortName(req.user!.email)} has your handoff and is working on it.\n\n` +
            `What you asked them to decide:\n${packet.needsDecision ?? packet.rawText}`,
          payload: { packetId: id },
          companyId: packet.companyId,
          ticker: packet.ticker,
          dedupeKey: `handoff-accepted:${id}`,
        },
      ]);

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/handoffs/:id/close", requireUser, async (req, res, next) => {
    try {
      const body = z.object({ note: z.string().optional() }).safeParse(req.body);
      const id = String(req.params.id);
      const packet = await getHandoffPacket(id);
      if (!packet) return res.status(404).json({ error: "Not found" });

      const updated = await updateHandoffPacket(id, {
        status: "closed",
        closedAt: new Date(),
        closedBy: req.user!.email,
        closingNote: body.success ? body.data.note ?? null : null,
      });

      // This is the event that stops the packet appearing in everyone's
      // re-entry briefing.
      await appendHumanEvent(req.user!, {
        kind: "closed_handoff",
        summary: `Finished ${shortName(packet.authorEmail)}'s handoff${packet.ticker ? ` on ${packet.ticker}` : ""}`,
        rawText: body.success ? body.data.note ?? null : null,
        ticker: packet.ticker,
        companyId: packet.companyId,
        subjectType: "handoff_packet",
        subjectId: id,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Escalation — the scheduled half                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Anything unaccepted after 48 hours gets escalated to the whole team.
   *
   * Not a nag at the assignee: the failure mode this catches is everyone
   * assuming somebody else has it, so the fix is making the silence visible to
   * everyone rather than pointing at one person.
   */
  app.post("/api/admin/handoffs/escalate", requireAdminToken, async (_req, res, next) => {
    try {
      const cutoff = new Date(Date.now() - HANDOFF_ESCALATION_HOURS * 60 * 60 * 1000);
      const stale = await listUnacceptedSince(cutoff);

      let queued = 0;
      for (const packet of stale) {
        const hours = Math.floor((Date.now() - packet.createdAt.getTime()) / (60 * 60 * 1000));
        const written = await queueNotifications(
          TEAM_EMAILS.map((recipient) => ({
            kind: "handoff_escalation",
            ruleId: null,
            recipientEmail: recipient,
            subject: `Nobody has picked this up (${hours}h)${packet.ticker ? ` — ${packet.ticker}` : ""}`,
            body:
              `${shortName(packet.authorEmail)} wrote this ${hours} hours ago and nobody has said they've got it.\n\n` +
              packetEmailBody(packet),
            payload: { packetId: packet.id, hoursOpen: hours },
            companyId: packet.companyId,
            ticker: packet.ticker,
            dedupeKey: `handoff-escalation:${packet.id}:${recipient}`,
          })),
        );
        queued += written.length;
        // Mark it so the next run doesn't send this again.
        await updateHandoffPacket(packet.id, { escalatedAt: new Date() });
      }

      res.json({ stale: stale.length, notificationsQueued: queued });
    } catch (err) {
      next(err);
    }
  });
}
