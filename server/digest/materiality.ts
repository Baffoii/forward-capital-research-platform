/**
 * Deciding what actually matters this week.
 *
 * The digest is capped at five items. That cap is the feature — a list of
 * everything that changed is the thing people stop opening, and a digest
 * nobody opens is worse than none because it feels like coverage.
 *
 * So the work here is suppression, not collection. Two rules do most of it:
 *
 *   OWNERSHIP. A CFO change at a name we don't own is noise. The same change
 *   at a name we do own is the whole ballgame. Nothing scores highly just for
 *   being dramatic.
 *
 *   SPECIFICITY. Among things that happened to names we own, the ones that
 *   move money are the ones touching how the shortage reaches the P&L —
 *   contract structure, escalators, backlog, margin — not headline count.
 *
 * And one thing that gets surfaced which nobody instruments: RISING
 * RECOGNITION ON A NAME WE OWN. More analysts covering it, a first thematic
 * ETF picking it up, the company starting to say "data centre" on its own
 * calls. That is the thesis completing. It reads as good news and it is the
 * signal to trim, which is exactly why it needs to be in a weekly summary
 * rather than left to be noticed.
 *
 * Pure and dependency-free so the ranking can be tested directly.
 */

export interface DigestCandidate {
  id: string;
  kind: string;
  companyId?: number | null;
  ticker?: string | null;
  headline: string;
  detail?: string | null;
  payload: Record<string, unknown>;
  knownAt: Date;
}

export interface CompanyStance {
  /** Do we hold it. The single biggest input. */
  owned: boolean;
  /** Position size as a percent of the book. */
  weightPct?: number | null;
  side?: string | null;
  /** Is it on the watchlist even if we don't own it yet. */
  watched?: boolean;
}

export interface ScoredItem {
  candidate: DigestCandidate;
  materiality: number;
  /** Plain-language reasons, shown in the digest so the ranking is arguable. */
  reasons: string[];
  /** Set when this is the trim signal rather than a buy/hold signal. */
  isExitSignal: boolean;
}

/* ------------------------------------------------------------------ */
/* Base weights                                                        */
/* ------------------------------------------------------------------ */

/**
 * Where each kind of event starts before ownership is considered.
 *
 * These are starting points, not verdicts — an unowned name's kill criterion
 * firing still ends up below an owned name's contract-language change, which
 * is correct.
 */
const BASE_BY_KIND: Record<string, number> = {
  kill_criterion_fired: 0.95,
  precommitment_met: 0.9,
  earnings_reported: 0.6,
  estimate_revision: 0.5,
  score_change: 0.45,
  filing_published: 0.35,
  constraint_state_change: 0.45,
  recognition_change: 0.4,
  analyst_count_change: 0.35,
  etf_inclusion: 0.4,
  price_move: 0.3,
  signal_recorded: 0.15,
};

/**
 * Language that means the shortage is or isn't reaching the P&L.
 *
 * A filing that changes any of this is worth more than a filing that doesn't,
 * regardless of how big the filing is. Fixed-price backlog without escalators
 * turns a shortage into a longer queue and zero incremental margin — the whole
 * investment case turns on this wording, and it's the kind of change that gets
 * buried on page 40 and noticed by nobody.
 */
const CAPTURE_LANGUAGE = [
  "fixed-price",
  "fixed price",
  "cost-plus",
  "cost plus",
  "escalator",
  "escalation clause",
  "price adjustment",
  "take-or-pay",
  "backlog",
  "gross margin",
  "contract structure",
  "pass-through",
  "surcharge",
];

function mentionsCaptureLanguage(candidate: DigestCandidate): string | null {
  const haystack = [
    candidate.headline,
    candidate.detail ?? "",
    typeof candidate.payload?.excerpt === "string" ? candidate.payload.excerpt : "",
    typeof candidate.payload?.contractStructure === "string"
      ? candidate.payload.contractStructure
      : "",
  ]
    .join(" ")
    .toLowerCase();

  return CAPTURE_LANGUAGE.find((term) => haystack.includes(term)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Rising recognition — the exit signal                                */
/* ------------------------------------------------------------------ */

export interface RecognitionReading {
  analystCount?: number | null;
  thematicEtfCount?: number | null;
  themeMentionDensity?: number | null;
}

export interface RecognitionShift {
  rising: boolean;
  /** Plain-language descriptions of each thing that moved. */
  signals: string[];
  /** 0..1 — how much the market has noticed since we did. */
  strength: number;
}

/**
 * Has the market started to notice?
 *
 * Deliberately generous about what counts. Each of these on its own is weak;
 * the point of checking all three is that they tend to move together, and by
 * the time any one of them is unarguable the repricing has happened.
 */
export function recognitionShift(
  before: RecognitionReading | null,
  after: RecognitionReading | null,
): RecognitionShift {
  if (!before || !after) return { rising: false, signals: [], strength: 0 };

  const signals: string[] = [];
  let strength = 0;

  const analystsBefore = before.analystCount ?? null;
  const analystsAfter = after.analystCount ?? null;
  if (analystsBefore !== null && analystsAfter !== null && analystsAfter > analystsBefore) {
    const added = analystsAfter - analystsBefore;
    signals.push(
      `${added} more analyst${added === 1 ? "" : "s"} covering it (${analystsBefore} → ${analystsAfter})`,
    );
    // Going from 3 to 5 is a much bigger deal than 30 to 32.
    strength += Math.min(0.5, added / Math.max(1, analystsBefore));
  }

  const etfBefore = before.thematicEtfCount ?? null;
  const etfAfter = after.thematicEtfCount ?? null;
  if (etfBefore !== null && etfAfter !== null && etfAfter > etfBefore) {
    if (etfBefore === 0) {
      // The first one is the one that matters: it means somebody built an
      // index that classifies this company as part of the theme.
      signals.push("Picked up by a themed index fund for the first time");
      strength += 0.5;
    } else {
      signals.push(`Now held by ${etfAfter} themed funds, up from ${etfBefore}`);
      strength += 0.2;
    }
  }

  const densityBefore = before.themeMentionDensity ?? null;
  const densityAfter = after.themeMentionDensity ?? null;
  if (densityBefore !== null && densityAfter !== null && densityAfter > densityBefore * 1.25) {
    signals.push(
      "The company is talking about data centres far more on its own calls than it used to",
    );
    strength += 0.3;
  }

  return { rising: signals.length > 0, signals, strength: Math.min(1, strength) };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const clamp = (x: number) => Math.min(1, Math.max(0, x));

export function scoreCandidate(
  candidate: DigestCandidate,
  stance: CompanyStance,
): ScoredItem {
  const reasons: string[] = [];
  let score = BASE_BY_KIND[candidate.kind] ?? 0.2;

  /* Ownership. The single biggest input. */
  if (stance.owned) {
    const weight = stance.weightPct ?? 0;
    // A 6% position matters more than a 1% one, but not six times more — the
    // question is whether this is worth reading, not how much money moves.
    score *= 1.6 + Math.min(0.6, weight / 10);
    reasons.push(
      stance.weightPct
        ? `We own it (${stance.weightPct.toFixed(1)}% of the book)`
        : "We own it",
    );
  } else if (stance.watched) {
    score *= 0.8;
    reasons.push("On the watchlist, not owned");
  } else {
    // The CFO-change-at-a-name-we-don't-own rule. Not zero — a name we don't
    // own can still be telling us something about a bottleneck — but it has to
    // clear a much higher bar to reach five slots.
    score *= 0.25;
    reasons.push("We don't own it");
  }

  /* Specificity: does it touch whether the shortage reaches the P&L. */
  const captureTerm = mentionsCaptureLanguage(candidate);
  if (captureTerm) {
    score *= 1.8;
    reasons.push(
      `Talks about "${captureTerm}" — that's whether the shortage actually reaches their profits`,
    );
  }

  /* Size, where the event carries one. */
  const changePct = Number(candidate.payload?.changePct);
  if (Number.isFinite(changePct)) {
    score += Math.min(0.35, Math.abs(changePct) / 60);
    if (Math.abs(changePct) >= 10) {
      reasons.push(`Moved ${changePct > 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(1)}%`);
    }
  }

  const scoreDelta = Number(candidate.payload?.delta);
  if (Number.isFinite(scoreDelta)) {
    score += Math.min(0.3, Math.abs(scoreDelta));
    reasons.push(`Our score moved ${scoreDelta > 0 ? "up" : "down"} ${Math.abs(scoreDelta).toFixed(2)}`);
  }

  /* Rising recognition on a name we own — the exit signal. */
  let isExitSignal = false;
  const shift = candidate.payload?.recognitionShift as RecognitionShift | undefined;
  if (stance.owned && shift?.rising) {
    isExitSignal = true;
    score = Math.max(score, 0.65 + shift.strength * 0.3);
    reasons.push(
      "The market is starting to notice this one — which is the thesis completing, not confirmation",
    );
    reasons.push(...shift.signals);
  }

  if (candidate.kind === "kill_criterion_fired") {
    reasons.push("This is something we wrote down as proof we'd be wrong");
  }

  return { candidate, materiality: clamp(score), reasons, isExitSignal };
}

/* ------------------------------------------------------------------ */
/* The cap                                                             */
/* ------------------------------------------------------------------ */

export const DIGEST_CAP = 5;

export interface Digest {
  items: ScoredItem[];
  /**
   * What was left out. Reported rather than hidden — a digest that silently
   * drops things reads as "nothing else happened", which is a lie.
   */
  suppressed: number;
  suppressedSummary: string | null;
}

/**
 * Rank, dedupe by company, and cut to five.
 *
 * One item per company on purpose. Three filings from the same name would
 * crowd out three other names, and by the third one the reader has learned
 * everything they were going to learn about that company this week.
 */
export function buildDigest(scored: ScoredItem[], cap = DIGEST_CAP): Digest {
  const ranked = [...scored].sort((a, b) => b.materiality - a.materiality);

  const seenCompanies = new Set<number>();
  const kept: ScoredItem[] = [];
  const dropped: ScoredItem[] = [];

  for (const item of ranked) {
    const companyId = item.candidate.companyId;
    if (companyId != null && seenCompanies.has(companyId)) {
      dropped.push(item);
      continue;
    }
    if (kept.length >= cap) {
      dropped.push(item);
      continue;
    }
    if (companyId != null) seenCompanies.add(companyId);
    kept.push(item);
  }

  return {
    items: kept,
    suppressed: dropped.length,
    suppressedSummary: summarizeSuppressed(dropped),
  };
}

function summarizeSuppressed(dropped: ScoredItem[]): string | null {
  if (dropped.length === 0) return null;

  const unowned = dropped.filter((d) =>
    d.reasons.some((r) => r.startsWith("We don't own it")),
  ).length;
  const owned = dropped.length - unowned;

  const parts: string[] = [];
  if (unowned > 0) {
    parts.push(`${unowned} at names we don't own`);
  }
  if (owned > 0) {
    parts.push(`${owned} that scored below these`);
  }
  return `${dropped.length} other thing${dropped.length === 1 ? "" : "s"} happened (${parts.join(", ")}).`;
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

/**
 * Start of the week the given moment falls in — Sunday 00:00 UTC.
 *
 * Used both to window the digest and to build its dedupe key, so a retried
 * cron run in the same week doesn't send a second copy.
 */
export function weekStart(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
