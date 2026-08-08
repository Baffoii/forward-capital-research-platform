/**
 * Consensus estimate revision — the term that links the physical read to price.
 *
 * Pure. Constraints move over quarters; prices move on revisions. The
 * tradeable case is a constraint tightening while consensus sits flat, because
 * the resolution mechanism is the next print. Tightening while estimates are
 * already ripping is the same physical fact with the trade already taken.
 */

import { asKnownAt, type Measurement } from "./opportunity.ts";

export interface EstimateSnapshotLike {
  fiscalPeriod: string;
  consensusEps: number | null;
  consensusRevenue: number | null;
  analystCount: number | null;
  knownAt: Date;
}

/**
 * Revision over a lookback window, as a signed fraction.
 *
 * Compares the latest snapshot knowable at `asOf` against the latest one
 * knowable `lookbackDays` earlier — NOT against a fixed calendar date. Using
 * a fixed date would silently compare against nothing whenever coverage is
 * sparse, which is exactly the situation for the obscure names being hunted.
 *
 * Returns null rather than zero when there is nothing to compare. Zero would
 * assert "consensus is flat", which is the most bullish reading the divergence
 * term can take, on the strength of having no data.
 */
export function estimateRevision(
  snapshots: EstimateSnapshotLike[],
  asOf: Date,
  opts: { fiscalPeriod?: string; lookbackDays?: number } = {},
): Measurement | null {
  const lookbackDays = opts.lookbackDays ?? 90;
  const relevant = opts.fiscalPeriod
    ? snapshots.filter((s) => s.fiscalPeriod === opts.fiscalPeriod)
    : snapshots;
  if (relevant.length === 0) return null;

  // Compare like with like: a revision measured across two different fiscal
  // periods is not a revision, it is a growth rate.
  const period =
    opts.fiscalPeriod ?? asKnownAt(relevant, asOf)?.fiscalPeriod ?? null;
  if (period === null) return null;
  const series = relevant.filter((s) => s.fiscalPeriod === period);

  const latest = asKnownAt(series, asOf);
  if (!latest) return null;

  const earlier = series.filter(
    (s) => s.knownAt.getTime() < latest.knownAt.getTime(),
  );
  const priorDate = new Date(asOf.getTime() - lookbackDays * 864e5);
  // Prefer a snapshot from a full lookback ago so the window matches the
  // tightening reading. Failing that, fall back to the most recent earlier
  // snapshot: for thinly covered names — the ones this model is hunting —
  // being strict here returns null on companies that do have two points, and
  // a shorter-window revision beats no revision at all.
  const prior = asKnownAt(earlier, priorDate) ?? asKnownAt(earlier, asOf);
  if (!prior) return null;
  const windowDays =
    (latest.knownAt.getTime() - prior.knownAt.getTime()) / 864e5;

  const metric = (s: EstimateSnapshotLike): number | null =>
    s.consensusEps ?? s.consensusRevenue ?? null;

  const now = metric(latest);
  const before = metric(prior);
  if (now === null || before === null) return null;
  // A sign flip through zero makes the percentage meaningless: -0.10 to +0.05
  // is not a 150% revision of anything.
  if (before === 0 || Math.sign(before) !== Math.sign(now)) return null;

  const raw = (now - before) / Math.abs(before);
  // Clamp to the scorer's -1..1 contract. A 40% cut and a 300% cut are both
  // "consensus capitulated"; the difference does not carry more information.
  const value = Math.min(1, Math.max(-1, raw));

  // Thin coverage means the "consensus" is one or two people, which is a much
  // weaker claim about what the market thinks.
  const analysts = Math.min(latest.analystCount ?? 0, prior.analystCount ?? 0);
  let confidence =
    analysts >= 10 ? 0.8 : analysts >= 4 ? 0.6 : analysts >= 1 ? 0.4 : 0.3;
  // A window much shorter than the intended lookback measures less of the
  // revision and should not be trusted as if it measured all of it.
  if (windowDays < lookbackDays * 0.5) confidence *= 0.7;

  return {
    value,
    confidence,
    asOf,
  };
}
