/**
 * Maps a company's reported segment to the constraint its revenue rides on,
 * plus the share of that segment's end demand attributable to the constraint.
 *
 * THIS FILE STARTS EMPTY ON PURPOSE.
 *
 * No filing states "our Electrical Equipment segment is 40% data-centre end
 * demand". That number is an analyst judgement, and it is the single largest
 * source of error in the entire exposure chain — an end-demand share wrong by
 * 3x makes every downstream score wrong by 3x with no symptom. Pre-filling it
 * with plausible-looking defaults would manufacture exactly the false
 * precision the confidence model exists to prevent.
 *
 * An empty map means zero exposure edges, which is the correct and
 * informative empty state: it says "nobody has done the attribution work yet",
 * not "these companies have no exposure".
 *
 * Fill it in as you do the work. Every entry needs a `basis` you would be
 * willing to defend out loud, and a confidence that reflects how much of it is
 * evidence versus judgement:
 *
 *   0.6   the filer states it, in a filing or on a call (attach the quote)
 *   0.4   triangulated from customer names, unit volumes, or a trade source
 *   0.25  informed judgement from industry structure
 *   0.15  a guess you are recording so it can be argued with
 */

export interface SegmentConstraintMapping {
  /** Ticker as it appears in the companies table. */
  ticker: string;
  /**
   * Matched case-insensitively against the segment name pulled from the
   * filing. Substring, not exact — reported segment names drift year to year.
   */
  segmentMatch: string;
  constraintSlug: string;
  /** 0..1 — share of THIS SEGMENT's end demand riding on the constraint. */
  endDemandShare: number;
  /** 0..1 — see the scale above. Floors the confidence of every edge built from it. */
  confidence: number;
  /** What this number is based on. Required — an unexplained estimate is not usable. */
  basis: string;
  /** Verbatim supporting sentence, when one exists. */
  quote?: string;
}

export const SEGMENT_CONSTRAINT_MAP: SegmentConstraintMapping[] = [];

export function mappingsForTicker(ticker: string): SegmentConstraintMapping[] {
  return SEGMENT_CONSTRAINT_MAP.filter(
    (m) => m.ticker.toUpperCase() === ticker.toUpperCase(),
  );
}

export function matchSegment(
  ticker: string,
  segmentName: string,
): SegmentConstraintMapping | null {
  const lower = segmentName.toLowerCase();
  return (
    mappingsForTicker(ticker).find((m) =>
      lower.includes(m.segmentMatch.toLowerCase()),
    ) ?? null
  );
}

/** Fails loudly rather than letting an unexplained estimate into the graph. */
export function validateMap(rows: SegmentConstraintMapping[]): void {
  for (const m of rows) {
    if (m.endDemandShare < 0 || m.endDemandShare > 1) {
      throw new Error(`endDemandShare out of range for ${m.ticker}/${m.segmentMatch}`);
    }
    if (m.confidence <= 0 || m.confidence > 1) {
      throw new Error(`confidence out of range for ${m.ticker}/${m.segmentMatch}`);
    }
    if (!m.basis || m.basis.trim().length < 10) {
      throw new Error(
        `mapping ${m.ticker}/${m.segmentMatch} needs a basis you would defend out loud`,
      );
    }
  }
}
validateMap(SEGMENT_CONSTRAINT_MAP);
