/**
 * Exposure graph: revenue-share arithmetic and multi-hop traversal.
 *
 * Dependency-free and pure, same reasoning as opportunity.ts. This is where
 * the expensive bugs live — a revenue share that is wrong by 3x produces a
 * score that is wrong by 3x with no symptom anywhere downstream — so the
 * arithmetic is separated from the extraction and tested directly.
 *
 * The number every function here is trying to produce is ONE thing:
 *
 *   the fraction of a company's TOTAL revenue that rides on a constraint
 *
 * Not segment revenue. Not "they're in the space". 60% of revenue in a
 * segment where data centres are 40% of end demand is 0.24, not 0.6.
 */

/* ------------------------------------------------------------------ */
/* Revenue share composition                                           */
/* ------------------------------------------------------------------ */

/**
 * One multiplicative step in the chain from total revenue down to the
 * constraint. Each factor keeps the sentence it came from, because in six
 * months nobody remembers why 0.4 seemed right.
 */
export interface ShareFactor {
  /** 0..1 */
  value: number;
  /** 0..1 — how much we trust THIS factor specifically. */
  confidence: number;
  /** e.g. "segment share of total revenue", "data-centre share of segment end demand" */
  label: string;
  quote?: string;
  sourceDocumentId?: number | null;
}

export interface ComposedShare {
  revenueShare: number;
  confidence: number;
  factors: ShareFactor[];
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/**
 * Multiply factors down the chain.
 *
 * Confidence is the MINIMUM of the factor confidences, not their product.
 * A chain is only as good as its weakest estimate, and the product decays
 * far too fast to be meaningful — three solidly-disclosed factors at 0.9
 * would land at 0.73 and read as shaky when nothing shaky happened.
 *
 * The failure this prevents: a disclosed segment share (confidence 0.9)
 * multiplied by a guessed end-demand share (confidence 0.35) must NOT come
 * out looking like a disclosure. It comes out at 0.35.
 */
export function composeRevenueShare(factors: ShareFactor[]): ComposedShare {
  if (factors.length === 0) {
    throw new Error("composeRevenueShare requires at least one factor");
  }
  let revenueShare = 1;
  let confidence = 1;
  for (const f of factors) {
    revenueShare *= clamp(f.value, 0, 1);
    confidence = Math.min(confidence, clamp(f.confidence, 0, 1));
  }
  return { revenueShare, confidence, factors };
}

/* ------------------------------------------------------------------ */
/* Graph inputs                                                        */
/* ------------------------------------------------------------------ */

/** A company's exposure to a constraint, as stored. */
export interface ExposureEdgeLike {
  companyId: number;
  constraintId: string;
  viaCompanyId: number | null;
  revenueShare: number;
  hops: number;
  confidence: number;
  derivation: string;
  supportingQuote?: string | null;
  sourceDocumentId?: number | null;
}

/**
 * A supplier relationship: `supplierId` earns `revenueShare` of ITS total
 * revenue from `customerId`. Comes from 10-K customer-concentration
 * disclosure, which is the only place this is reliably stated.
 */
export interface SupplyLink {
  supplierId: number;
  customerId: number;
  /** 0..1 — fraction of the SUPPLIER's total revenue from this customer. */
  revenueShare: number;
  confidence: number;
  supportingQuote?: string | null;
  sourceDocumentId?: number | null;
}

/** Confidence multiplier applied per additional hop from the constraint. */
export const HOP_CONFIDENCE_DECAY = 0.7;

/** Beyond this, the share is noise wearing a number. */
export const MAX_HOPS = 3;

/* ------------------------------------------------------------------ */
/* Traversal                                                           */
/* ------------------------------------------------------------------ */

export interface DerivedExposure {
  companyId: number;
  constraintId: string;
  viaCompanyId: number | null;
  revenueShare: number;
  hops: number;
  confidence: number;
  derivation: string;
  /** Company ids from this company out to the one holding the direct edge. */
  path: number[];
  supportingQuote?: string | null;
  sourceDocumentId?: number | null;
}

/**
 * Walk supplier links outward from companies with direct constraint exposure.
 *
 * If A earns 20% of its revenue from B, and B has 50% of its revenue riding on
 * constraint C, then A has 0.20 x 0.50 = 0.10 of its revenue riding on C, one
 * hop further out. Hop 0 is a direct hyperscaler supplier; the rows worth
 * finding are usually 2-3 hops out, where the exposure is real but nothing
 * about the company says "AI".
 *
 * Confidence decays multiplicatively per hop AND is floored by the weakest
 * link on the path, so a confident third-hop inference through a shaky second
 * hop cannot come out looking solid.
 *
 * Cycles are handled by refusing to revisit a company already on the current
 * path — A supplies B and B supplies A is common and must not loop.
 */
export function traverseExposure(
  directEdges: ExposureEdgeLike[],
  supplyLinks: SupplyLink[],
  opts: { maxHops?: number; decay?: number; minRevenueShare?: number } = {},
): DerivedExposure[] {
  const maxHops = opts.maxHops ?? MAX_HOPS;
  const decay = opts.decay ?? HOP_CONFIDENCE_DECAY;
  // Below this a row is not worth carrying: it cannot move a score and it
  // clutters the board. Explicit rather than implicit so it shows up in review.
  const minShare = opts.minRevenueShare ?? 0.005;

  // customerId -> suppliers who sell to it
  const suppliersOf = new Map<number, SupplyLink[]>();
  for (const link of supplyLinks) {
    const list = suppliersOf.get(link.customerId) ?? [];
    list.push(link);
    suppliersOf.set(link.customerId, list);
  }

  const out: DerivedExposure[] = [];

  for (const edge of directEdges) {
    out.push({
      companyId: edge.companyId,
      constraintId: edge.constraintId,
      viaCompanyId: edge.viaCompanyId,
      revenueShare: edge.revenueShare,
      hops: edge.hops,
      confidence: edge.confidence,
      derivation: edge.derivation,
      path: [edge.companyId],
      supportingQuote: edge.supportingQuote ?? null,
      sourceDocumentId: edge.sourceDocumentId ?? null,
    });

    // Breadth-first outward from the company holding the direct edge.
    let frontier: DerivedExposure[] = [out[out.length - 1]];

    while (frontier.length > 0) {
      const next: DerivedExposure[] = [];
      for (const node of frontier) {
        if (node.hops >= maxHops) continue;
        const upstream = suppliersOf.get(node.companyId) ?? [];
        for (const link of upstream) {
          if (node.path.includes(link.supplierId)) continue; // cycle
          const revenueShare = link.revenueShare * node.revenueShare;
          if (revenueShare < minShare) continue;
          const derived: DerivedExposure = {
            companyId: link.supplierId,
            constraintId: node.constraintId,
            // The immediate counterparty this exposure flows through. This is
            // what makes double-counting detectable downstream.
            viaCompanyId: node.companyId,
            revenueShare,
            hops: node.hops + 1,
            // One decay per step, not pow(decay, hops). `node.confidence`
            // already carries the decay accumulated so far, so exponentiating
            // here applies it twice and a hop-2 row lands at decay^3.
            confidence: Math.min(node.confidence, link.confidence) * decay,
            derivation: "transcript_mention",
            path: [link.supplierId, ...node.path],
            supportingQuote: link.supportingQuote ?? null,
            sourceDocumentId: link.sourceDocumentId ?? null,
          };
          out.push(derived);
          next.push(derived);
        }
      }
      frontier = next;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Aggregation — the double-counting problem                           */
/* ------------------------------------------------------------------ */

export interface AggregatedExposure {
  companyId: number;
  constraintId: string;
  revenueShare: number;
  confidence: number;
  /** Smallest hop count among the paths that contributed. */
  hops: number;
  /** Every path that fed this number, for the evidence chain. */
  contributions: DerivedExposure[];
  flags: string[];
}

/**
 * Collapse many paths into one exposure number per (company, constraint).
 *
 * The rule that matters, and the one that is easy to get wrong in both
 * directions:
 *
 *   SUM across distinct immediate counterparties. If a company earns 20% of
 *   revenue from customer B and 15% from customer D, and both are exposed to
 *   the same constraint, those are DISJOINT revenue streams. 0.35, not 0.20.
 *
 *   MAX within a single immediate counterparty. Two paths that both run
 *   through B are two measurements of the same revenue, not two revenues.
 *   Summing them counts the same dollar twice and is how an exposure of 1.4
 *   gets produced.
 *
 * Direct edges (viaCompanyId = null) form their own group, so a direct
 * reading and an inferred one do not stack.
 *
 * Confidence is the contribution-weighted mean, so a large well-sourced
 * stream is not dragged down by a small speculative one.
 */
export function aggregateExposure(
  derived: DerivedExposure[],
): AggregatedExposure[] {
  const byPair = new Map<string, DerivedExposure[]>();
  for (const d of derived) {
    const key = `${d.companyId}::${d.constraintId}`;
    const list = byPair.get(key) ?? [];
    list.push(d);
    byPair.set(key, list);
  }

  const out: AggregatedExposure[] = [];

  for (const [key, rows] of byPair) {
    const byVia = new Map<string, DerivedExposure[]>();
    for (const r of rows) {
      const viaKey = r.viaCompanyId === null ? "direct" : String(r.viaCompanyId);
      const list = byVia.get(viaKey) ?? [];
      list.push(r);
      byVia.set(viaKey, list);
    }

    const winners: DerivedExposure[] = [];
    for (const [, group] of byVia) {
      // Same counterparty: take the largest reading, tie-break on confidence.
      const best = group.reduce((a, b) =>
        b.revenueShare > a.revenueShare ||
        (b.revenueShare === a.revenueShare && b.confidence > a.confidence)
          ? b
          : a,
      );
      winners.push(best);
    }

    const rawTotal = winners.reduce((a, w) => a + w.revenueShare, 0);
    const flags: string[] = [];
    // A company cannot have more than 100% of its revenue riding on one
    // constraint. Hitting this means an upstream share is wrong, a supply
    // link double-counts, or two "distinct" counterparties are the same
    // entity under different ids. Clamp so the score stays sane, but say so.
    if (rawTotal > 1) flags.push("exposure_clamped_check_double_counting");
    if (winners.length > 1) flags.push("multi_path_exposure");

    const totalWeight = winners.reduce((a, w) => a + w.revenueShare, 0);
    const confidence =
      totalWeight > 0
        ? winners.reduce((a, w) => a + w.confidence * w.revenueShare, 0) /
          totalWeight
        : Math.min(...winners.map((w) => w.confidence));

    const [companyIdStr, constraintId] = key.split("::");
    out.push({
      companyId: Number(companyIdStr),
      constraintId,
      revenueShare: clamp(rawTotal, 0, 1),
      confidence: clamp(confidence, 0, 1),
      hops: Math.min(...winners.map((w) => w.hops)),
      contributions: winners,
      flags,
    });
  }

  return out.sort((a, b) => b.revenueShare - a.revenueShare);
}

/**
 * Diagnostic, deliberately NOT an invariant.
 *
 * The same dollar of revenue can legitimately ride on two constraints at once
 * — a transformer maker is exposed to grain-oriented steel on the input side
 * and to transformer demand on the output side, and both readings are true of
 * the same revenue. So exposure across constraints is not a partition and the
 * sum is free to exceed 1.
 *
 * It is still worth looking at. A company summing to 4.0 across constraints is
 * usually a registry that has sliced one bottleneck into five overlapping
 * ones, not a company with unusually broad exposure.
 */
export function totalExposureByCompany(
  aggregated: AggregatedExposure[],
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const a of aggregated) {
    totals.set(a.companyId, (totals.get(a.companyId) ?? 0) + a.revenueShare);
  }
  return totals;
}
