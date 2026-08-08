/**
 * Getting a queued notification to a person, by email.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EMAIL SENDING IS DELIBERATELY NOT LIVE YET.
 *
 * Everything below is written and wired up, but `sendEmail` refuses to send
 * unless BOTH of these are set:
 *
 *   EMAIL_ENABLED=true
 *   EMAIL_API_KEY=<key>            (plus EMAIL_API_URL / EMAIL_FROM)
 *
 * Without them, dispatch marks each notification as sent and logs the full
 * body to the server console. That is the current intended behaviour — the
 * notification pipeline can be exercised end to end, and the bodies can be
 * read and criticised, before anything reaches an inbox.
 *
 * TO TURN IT ON: pick a provider (Resend, Postmark, SendGrid and Mailgun all
 * take a single JSON POST with a bearer token, which is what the request below
 * is shaped for), set the four variables, and check the payload field names
 * against that provider's docs — `to`/`from`/`subject`/`text` is the Resend
 * shape and the others differ slightly. No new npm dependency is needed;
 * Node's global fetch is enough.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The design constraint that outlives the provider choice: an in-app
 * notification bell is NOT the channel. A bell is a dashboard you have to
 * remember to check, which is the thing this phase exists to escape. Mail
 * arrives whether or not anyone remembers this app exists.
 */

import {
  listPendingNotifications,
  markSent,
  markSendFailed,
  type NotificationRow,
} from "./store";

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const EMAIL_API_URL = process.env.EMAIL_API_URL ?? "https://api.resend.com/emails";
const EMAIL_API_KEY = process.env.EMAIL_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Forward Capital <alerts@example.com>";

export interface SendResult {
  delivered: boolean;
  /** True when we deliberately didn't send because email isn't turned on. */
  skippedBecauseDisabled: boolean;
  error?: string;
}

export function emailIsLive(): boolean {
  return EMAIL_ENABLED && Boolean(EMAIL_API_KEY);
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<SendResult> {
  if (!emailIsLive()) {
    // Not an error and not a silent drop — the whole message goes to the
    // server log so the pipeline is checkable before it's live.
    console.log(
      `[notifications] would email ${to}\n  subject: ${subject}\n${body
        .split("\n")
        .map((l) => `  | ${l}`)
        .join("\n")}`,
    );
    return { delivered: false, skippedBecauseDisabled: true };
  }

  try {
    const res = await fetch(EMAIL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        // Plain text on purpose. These get read on a phone between classes,
        // and the body is written to be complete without any formatting.
        text: body,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return {
        delivered: false,
        skippedBecauseDisabled: false,
        error: `${res.status} ${detail.slice(0, 200)}`,
      };
    }
    return { delivered: true, skippedBecauseDisabled: false };
  } catch (err: any) {
    return {
      delivered: false,
      skippedBecauseDisabled: false,
      error: err?.message ?? "unknown error",
    };
  }
}

export interface DispatchResult {
  considered: number;
  sent: number;
  failed: number;
  loggedOnly: number;
  emailLive: boolean;
  /** Which channels actually carried anything this run. */
  channels: string[];
}

/**
 * Send what's queued.
 *
 * Small batches on purpose, same reasoning as everywhere else in this repo:
 * many small scheduled calls, not one large one. The cron calls this
 * repeatedly rather than asking it to drain the queue in one request.
 */
export async function dispatchPending(batchSize = 20): Promise<DispatchResult> {
  const { activeNotifiers } = await import("./notifier");
  const notifiers = activeNotifiers();

  const pending: NotificationRow[] = await listPendingNotifications(batchSize);
  const result: DispatchResult = {
    considered: pending.length,
    sent: 0,
    failed: 0,
    loggedOnly: 0,
    emailLive: emailIsLive(),
    channels: notifiers.map((n) => n.name),
  };

  for (const notification of pending) {
    // Try every live channel. A notification is delivered if ANY channel took
    // it — the point is that the person finds out, not that every route
    // succeeded. Errors are only recorded when nothing got through.
    let outcome: SendResult = { delivered: false, skippedBecauseDisabled: true };
    for (const notifier of notifiers) {
      const r = await notifier.send({
        kind: notification.kind,
        recipientEmail: notification.recipientEmail,
        subject: notification.subject,
        body: notification.body,
      });
      if (r.delivered) { outcome = { delivered: true, skippedBecauseDisabled: false, error: undefined }; break; }
      if (!r.skippedBecauseDisabled) {
        outcome = { delivered: false, skippedBecauseDisabled: false, error: r.error };
      }
    }

    // No channel configured at all — log the whole body so the pipeline stays
    // checkable before anything is switched on.
    if (!outcome.delivered && outcome.skippedBecauseDisabled) {
      outcome = await sendEmail(
        notification.recipientEmail,
        notification.subject,
        notification.body,
      );
    }

    if (outcome.delivered) {
      await markSent(notification.id);
      result.sent++;
    } else if (outcome.skippedBecauseDisabled) {
      // Marked sent so the queue drains and the same message doesn't pile up
      // for weeks before email is switched on — by then it would be stale and
      // the first live run would deliver a month of history at once.
      await markSent(notification.id);
      result.loggedOnly++;
    } else {
      await markSendFailed(
        notification.id,
        notification.sendAttempts,
        outcome.error ?? "unknown error",
      );
      result.failed++;
    }
  }

  return result;
}
