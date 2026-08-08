/**
 * Where a notification actually goes.
 *
 * One interface, three adapters: Discord, email, and a log-only fallback.
 * Adding a channel later means adding an adapter, not touching the watcher.
 *
 * ── TWO DISCORD WEBHOOKS, NOT ONE ───────────────────────────────────────
 * DISCORD_WEBHOOK_URGENT   kill criteria, pre-commitments, handoff escalation
 * DISCORD_WEBHOOK_DIGEST   the weekly five, journal resurfacing
 *
 * Splitting them is the whole reason this routes by kind. A channel that
 * carries both "a condition you set has been met" and "here are five things
 * from last week" trains people to skim both at the same rate, and the rate
 * they settle on is the one appropriate to the weekly digest. Keeping urgent
 * things rare in their own channel is what makes them readable as urgent.
 *
 * Neither URL is required. With neither set, dispatch logs the full body
 * server-side and marks the row sent — the same inert behaviour email has.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { emailIsLive, sendEmail } from "./dispatch";

export interface DeliveryResult {
  delivered: boolean;
  /** True when we deliberately didn't send because nothing is configured. */
  skippedBecauseDisabled: boolean;
  channel: string;
  error?: string;
}

export interface Notifier {
  readonly name: string;
  isLive(): boolean;
  send(input: {
    kind: string;
    recipientEmail: string;
    subject: string;
    body: string;
  }): Promise<DeliveryResult>;
}

/* ------------------------------------------------------------------ */
/* Which channel a kind belongs in                                     */
/* ------------------------------------------------------------------ */

/**
 * Things that mean "a decision is waiting on you right now".
 *
 * Deliberately short. Every kind added here costs a little of the channel's
 * ability to mean anything.
 */
const URGENT_KINDS = new Set([
  "kill_criterion",
  "precommitment",
  "handoff_assigned",
  "handoff_escalation",
]);

export function isUrgentKind(kind: string): boolean {
  return URGENT_KINDS.has(kind);
}

const DISCORD_URGENT = process.env.DISCORD_WEBHOOK_URGENT;
const DISCORD_DIGEST = process.env.DISCORD_WEBHOOK_DIGEST;

export function discordIsLive(): boolean {
  return Boolean(DISCORD_URGENT || DISCORD_DIGEST);
}

/**
 * Discord caps a message at 2000 characters.
 *
 * Truncating a pre-commitment notification would cut off the reasoning, which
 * is the part that has to argue with you — so the split keeps the whole body
 * across continuation messages rather than dropping the tail.
 */
export function splitForDiscord(text: string, limit = 1900): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Break on a paragraph boundary where possible, so a chunk never ends
    // mid-sentence.
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export const discordNotifier: Notifier = {
  name: "discord",
  isLive: discordIsLive,

  async send({ kind, subject, body }): Promise<DeliveryResult> {
    const urgent = isUrgentKind(kind);
    // Fall back to whichever webhook exists, so configuring only one still
    // delivers everything rather than silently dropping half of it.
    const url = urgent ? DISCORD_URGENT ?? DISCORD_DIGEST : DISCORD_DIGEST ?? DISCORD_URGENT;
    const channel = urgent ? "discord:urgent" : "discord:digest";

    if (!url) {
      return { delivered: false, skippedBecauseDisabled: true, channel };
    }

    const parts = splitForDiscord(`**${subject}**\n\n${body}`);
    try {
      for (const content of parts) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return {
            delivered: false,
            skippedBecauseDisabled: false,
            channel,
            error: `${res.status} ${detail.slice(0, 200)}`,
          };
        }
        // Discord rate-limits webhooks; space out continuation messages.
        if (parts.length > 1) await new Promise((r) => setTimeout(r, 400));
      }
      return { delivered: true, skippedBecauseDisabled: false, channel };
    } catch (err: any) {
      return {
        delivered: false,
        skippedBecauseDisabled: false,
        channel,
        error: err?.message ?? "unknown error",
      };
    }
  },
};

export const emailNotifier: Notifier = {
  name: "email",
  isLive: emailIsLive,
  async send({ recipientEmail, subject, body }): Promise<DeliveryResult> {
    const out = await sendEmail(recipientEmail, subject, body);
    return {
      delivered: out.delivered,
      skippedBecauseDisabled: out.skippedBecauseDisabled,
      channel: "email",
      error: out.error,
    };
  },
};

/**
 * Every configured channel, in preference order.
 *
 * Discord first because it's the decided channel; email is additive when it's
 * eventually switched on. If neither is live the caller falls back to logging,
 * which is handled in dispatch.ts.
 */
export function activeNotifiers(): Notifier[] {
  return [discordNotifier, emailNotifier].filter((n) => n.isLive());
}
