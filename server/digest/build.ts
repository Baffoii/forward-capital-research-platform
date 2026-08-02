/**
 * Assembling the weekly digest.
 *
 * Reads world_events for the week, works out our stance on each company,
 * detects rising recognition on the ones we own, scores everything, and cuts
 * to five. The ranking itself is in ./materiality.ts and is tested there.
 */

import { supabase, objToSnake, rowsToCamel, throwIfError } from "../supabase";
import { storage } from "../storage";
import { listWorldEvents } from "../human-loop/store";
import { queueNotifications } from "../watcher/store";
import { listOpenPositions } from "../watcher/context";
import { listRecognitionSnapshots } from "../scoring/store";
import { TEAM_EMAILS } from "@shared/team";
import {
  buildDigest,
  recognitionShift,
  scoreCandidate,
  weekStart,
  type CompanyStance,
  type DigestCandidate,
  type ScoredItem,
} from "./materiality";

export interface DigestRow {
  id: string;
  weekStart: Date;
  items: ScoredItem[];
  suppressed: number;
  suppressedSummary: string | null;
  dedupeKey: string;
  createdAt: Date;
}

function hydrate(r: any): DigestRow {
  return {
    ...r,
    items: Array.isArray(r.items) ? r.items : [],
    weekStart: new Date(r.weekStart),
    createdAt: new Date(r.createdAt),
  };
}

export async function getLatestDigest(): Promise<DigestRow | null> {
  const { data, error } = await supabase
    .from("digests")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(1);
  throwIfError(error, "getLatestDigest");
  const row = (data ?? [])[0];
  return row ? hydrate(rowsToCamel<any>([row])[0]) : null;
}

export async function getDigest(id: string): Promise<DigestRow | null> {
  const { data, error } = await supabase
    .from("digests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "getDigest");
  return data ? hydrate(rowsToCamel<any>([data])[0]) : null;
}

/**
 * Where each company stands with us.
 *
 * Ownership is the biggest single input to whether something is worth
 * anyone's Monday morning, so it's worth fetching properly rather than
 * inferring from whether we happen to have a score.
 */
async function stancesByCompany(): Promise<Map<number, CompanyStance>> {
  const [positions, watchlist] = await Promise.all([
    listOpenPositions(),
    storage.listWatchlistItems(),
  ]);

  const out = new Map<number, CompanyStance>();
  for (const item of watchlist) {
    out.set(item.companyId, { owned: false, watched: true });
  }
  for (const position of positions) {
    out.set(position.companyId, {
      owned: true,
      weightPct: position.weightPct,
      side: position.side,
      watched: out.get(position.companyId)?.watched ?? false,
    });
  }
  return out;
}

/**
 * Has the market started noticing a name we own?
 *
 * Compares the newest recognition reading against the one from before the
 * window. This is the exit signal — it reads as good news and it means the
 * thesis is completing.
 */
async function recognitionShiftsFor(
  companyIds: number[],
  since: Date,
): Promise<Map<number, ReturnType<typeof recognitionShift>>> {
  const out = new Map<number, ReturnType<typeof recognitionShift>>();

  for (const companyId of companyIds) {
    const snapshots = (await listRecognitionSnapshots(companyId)).sort(
      (a, b) => a.knownAt.getTime() - b.knownAt.getTime(),
    );
    if (snapshots.length < 2) continue;

    const before = [...snapshots].reverse().find((s) => s.knownAt <= since) ?? snapshots[0];
    const after = snapshots[snapshots.length - 1];
    if (before === after) continue;

    const shift = recognitionShift(before, after);
    if (shift.rising) out.set(companyId, shift);
  }

  return out;
}

export interface BuildResult {
  digest: DigestRow | null;
  /** False when this week's digest already existed — a retried cron. */
  created: boolean;
  notificationsQueued: number;
  candidatesConsidered: number;
}

export async function buildWeeklyDigest(now = new Date()): Promise<BuildResult> {
  const start = weekStart(now);

  const events = await listWorldEvents({ since: start, until: now, limit: 500 });
  const stances = await stancesByCompany();

  // Only bother computing recognition shifts for names we actually hold —
  // "the market noticed a company we don't own" is not a signal about us.
  const ownedIds = Array.from(stances.entries())
    .filter(([, stance]) => stance.owned)
    .map(([id]) => id);
  const shifts = await recognitionShiftsFor(ownedIds, start);

  const companies = await storage.listCompanies();
  const nameById = new Map(companies.map((c) => [c.id, c.name]));

  const candidates: DigestCandidate[] = events.map((event) => ({
    id: event.id,
    kind: event.kind,
    companyId: event.companyId ?? null,
    ticker: event.ticker ?? null,
    headline: event.headline,
    detail: event.detail ?? null,
    payload: {
      ...event.payload,
      ...(event.companyId != null && shifts.has(event.companyId)
        ? { recognitionShift: shifts.get(event.companyId) }
        : {}),
    },
    knownAt: event.knownAt,
  }));

  // Rising recognition may not have produced a world event of its own — the
  // analyst count just crept up. Synthesise one so the exit signal can't be
  // missed simply because nothing "happened".
  for (const [companyId, shift] of Array.from(shifts.entries())) {
    const alreadyCovered = candidates.some(
      (c) => c.companyId === companyId && c.kind === "recognition_change",
    );
    if (alreadyCovered) continue;
    candidates.push({
      id: `recognition:${companyId}:${start.toISOString().slice(0, 10)}`,
      kind: "recognition_change",
      companyId,
      ticker: companies.find((c) => c.id === companyId)?.ticker ?? null,
      headline: `${nameById.get(companyId) ?? "A company we own"}: the market is starting to notice`,
      detail: shift.signals.join(". "),
      payload: { recognitionShift: shift },
      knownAt: now,
    });
  }

  const scored = candidates.map((candidate) =>
    scoreCandidate(
      candidate,
      candidate.companyId != null
        ? stances.get(candidate.companyId) ?? { owned: false }
        : { owned: false },
    ),
  );

  const digest = buildDigest(scored);

  const dedupeKey = `digest:${start.toISOString().slice(0, 10)}`;
  const { data, error } = await supabase
    .from("digests")
    .upsert(
      objToSnake({
        weekStart: start.toISOString(),
        items: digest.items,
        suppressed: digest.suppressed,
        suppressedSummary: digest.suppressedSummary,
        dedupeKey,
      }),
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select();
  throwIfError(error, "buildWeeklyDigest");

  const rows = rowsToCamel<any>(data).map(hydrate);
  if (rows.length === 0) {
    return {
      digest: await getLatestDigest(),
      created: false,
      notificationsQueued: 0,
      candidatesConsidered: candidates.length,
    };
  }

  const row = rows[0];
  const queued = await queueNotifications(
    TEAM_EMAILS.map((recipient) => ({
      kind: "weekly_digest" as const,
      ruleId: null,
      recipientEmail: recipient,
      subject:
        digest.items.length === 0
          ? "Quiet week — nothing worth your Monday"
          : `This week: ${digest.items[0].candidate.ticker ?? "the short version"} and ${digest.items.length - 1} other thing${digest.items.length === 2 ? "" : "s"}`,
      body: renderDigestEmail(row),
      payload: { digestId: row.id, itemIds: digest.items.map((i) => i.candidate.id) },
      companyId: null,
      ticker: null,
      dedupeKey: `${dedupeKey}:${recipient}`,
    })),
  );

  return {
    digest: row,
    created: true,
    notificationsQueued: queued.length,
    candidatesConsidered: candidates.length,
  };
}

/**
 * Plain text, complete on its own.
 *
 * Someone should be able to read this on a phone on Monday morning and know
 * whether anything needs them, without opening the app.
 */
export function renderDigestEmail(digest: DigestRow): string {
  if (digest.items.length === 0) {
    return [
      "Nothing happened this week that clears the bar for your attention.",
      digest.suppressedSummary ?? "Nothing at all was recorded, which is itself worth a glance.",
      "Nothing has been traded. This is a summary, not advice.",
    ].join("\n\n");
  }

  const parts: string[] = [
    `${digest.items.length} thing${digest.items.length === 1 ? "" : "s"} worth your attention this week.`,
  ];

  digest.items.forEach((item, index) => {
    const lines: string[] = [
      `${index + 1}. ${item.candidate.ticker ? `${item.candidate.ticker} — ` : ""}${item.candidate.headline}`,
    ];
    if (item.isExitSignal) {
      lines.push(
        "   ⤷ This is the thesis completing, not confirmation. It's a reason to think about trimming.",
      );
    }
    if (item.candidate.detail) lines.push(`   ${item.candidate.detail}`);
    lines.push(`   Why this made the list: ${item.reasons.join("; ")}`);
    parts.push(lines.join("\n"));
  });

  if (digest.suppressedSummary) parts.push(digest.suppressedSummary);
  parts.push("Nothing has been traded. This is a summary, not advice.");

  return parts.join("\n\n");
}
