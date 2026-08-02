/**
 * Pure extraction of the capture-gate inputs from 10-Q text: backlog,
 * remaining performance obligations, gross margin, and contract structure.
 *
 * No network, no database. Same reasoning as edgar-extract.ts.
 *
 * Backlog has no standard us-gaap tag — filers either use a custom extension
 * or state it only in narrative MD&A — so unlike revenue it cannot be pulled
 * from XBRL and has to be parsed out of prose. RPO does have a tag
 * (RevenueRemainingPerformanceObligation) and should be preferred when present;
 * these parsers are the fallback and their confidence says so.
 */

// Explicit .ts extension: this module is imported by a test that runs on bare
// node with type stripping, where ESM does not do extensionless resolution.
import { stripMarkup, splitSentences } from "./edgar-extract.ts";

const SCALE: Record<string, number> = {
  thousand: 1e3,
  thousands: 1e3,
  million: 1e6,
  millions: 1e6,
  billion: 1e9,
  billions: 1e9,
};

const NEGATION = /\b(no |not |did not|excludes?|excluding|does not include)\b/i;

/** "$4.2 billion", "$4,200 million", "$4,200.5" */
function money(sentence: string): number | null {
  const m =
    /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(thousand|thousands|million|millions|billion|billions)?/i.exec(
      sentence,
    );
  if (!m) return null;
  const raw = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const scale = m[2] ? (SCALE[m[2].toLowerCase()] ?? 1) : 1;
  return raw * scale;
}

/* ------------------------------------------------------------------ */
/* Backlog / RPO                                                       */
/* ------------------------------------------------------------------ */

export interface BacklogFact {
  /** "backlog" | "remaining_performance_obligation" */
  kind: "backlog" | "remaining_performance_obligation";
  value: number;
  quote: string;
  confidence: number;
  flags: string[];
}

const BACKLOG_CUE = /\b(backlog|order book|unfilled orders?)\b/i;
const RPO_CUE =
  /\b(remaining performance obligations?|RPO|transaction price allocated to (?:the )?remaining performance obligations?)\b/i;

/**
 * Backlog and RPO from narrative text.
 *
 * Sentences that scope the number to a subset ("backlog in our Americas
 * segment", "backlog expected to be recognised within 12 months") are flagged
 * rather than dropped — a partial figure is still informative, but treating it
 * as the total would understate coverage and read as a queue shortening when
 * nothing shortened.
 */
export function parseBacklog(text: string): BacklogFact[] {
  const out: BacklogFact[] = [];

  for (const sentence of splitSentences(stripMarkup(text))) {
    const isBacklog = BACKLOG_CUE.test(sentence);
    const isRpo = RPO_CUE.test(sentence);
    if (!isBacklog && !isRpo) continue;
    if (NEGATION.test(sentence)) continue;

    const value = money(sentence);
    if (value === null || value <= 0) continue;

    const flags: string[] = [];
    // A figure scoped to one segment, geography, or recognition window is not
    // the company total and must not be compared against total revenue.
    if (/\b(segment|division|region|americas|emea|apac|within (?:the next )?(?:twelve|12) months|next twelve months)\b/i.test(sentence)) {
      flags.push("partial_scope");
    }
    if (/\b(approximately|about|roughly|nearly|in excess of|more than)\b/i.test(sentence)) {
      flags.push("approximate_figure");
    }
    if (/\b(prior year|year[- ]ago|compared (?:to|with)|versus|vs)\b/i.test(sentence)) {
      flags.push("comparative_sentence_may_state_two_periods");
    }

    // RPO is a defined, audited disclosure. Backlog is a management measure
    // with no standard definition, and companies change how they compute it.
    let confidence = isRpo ? 0.75 : 0.6;
    if (flags.includes("partial_scope")) confidence *= 0.6;
    if (flags.includes("comparative_sentence_may_state_two_periods")) confidence *= 0.8;

    out.push({
      kind: isRpo ? "remaining_performance_obligation" : "backlog",
      value,
      quote: sentence,
      confidence,
      flags,
    });
  }

  // Prefer the highest-confidence statement of each kind; the same figure is
  // typically repeated across MD&A and the notes.
  const best = new Map<string, BacklogFact>();
  for (const f of out) {
    const existing = best.get(f.kind);
    if (!existing || f.confidence > existing.confidence) best.set(f.kind, f);
  }
  return Array.from(best.values());
}

/* ------------------------------------------------------------------ */
/* Gross margin                                                        */
/* ------------------------------------------------------------------ */

export interface MarginFact {
  grossMarginPct: number;
  quote: string;
  confidence: number;
}

/**
 * Gross margin from narrative text.
 *
 * Prefer computing it from XBRL GrossProfit / Revenue when both are tagged —
 * that is exact. This catches the cases where they are not.
 */
export function parseGrossMargin(text: string): MarginFact | null {
  for (const sentence of splitSentences(stripMarkup(text))) {
    if (!/\bgross (?:profit )?margin\b/i.test(sentence)) continue;
    if (NEGATION.test(sentence)) continue;
    const m = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(sentence);
    if (!m) continue;
    const pct = parseFloat(m[1]);
    if (!(pct > 0 && pct < 100)) continue;
    return { grossMarginPct: pct, quote: sentence, confidence: 0.6 };
  }
  return null;
}

/** Exact when both tags are present, which is the normal case. */
export function grossMarginFromXbrl(
  grossProfit: number,
  revenue: number,
): MarginFact | null {
  if (!(revenue > 0)) return null;
  return {
    grossMarginPct: (grossProfit / revenue) * 100,
    quote: "computed from XBRL GrossProfit / Revenues",
    confidence: 0.95,
  };
}

/* ------------------------------------------------------------------ */
/* Contract structure — can the shortage be repriced?                  */
/* ------------------------------------------------------------------ */

export interface ContractStructureFact {
  /** fixed_price | cost_plus | spot | mixed | unknown */
  contractStructure: string;
  /** yes | no | unknown */
  hasPriceEscalators: string;
  quotes: string[];
  confidence: number;
}

/**
 * The capture gate's qualitative half.
 *
 * A shortage only pays if the company can reprice. Fixed-price backlog with no
 * escalator turns a shortage into a longer queue at yesterday's margin — the
 * order book swells, the stock rerates on it, and the P&L never moves.
 */
export function parseContractStructure(text: string): ContractStructureFact {
  const quotes: string[] = [];
  let fixed = 0;
  let costPlus = 0;
  let spot = 0;
  let escalatorYes = 0;
  let escalatorNo = 0;

  for (const sentence of splitSentences(stripMarkup(text))) {
    let hit = false;
    if (/\bfixed[- ]price\b|\bfirm[- ]fixed\b|\bfixed[- ]fee\b/i.test(sentence)) {
      fixed++;
      hit = true;
    }
    if (/\bcost[- ]plus\b|\bcost reimbursable\b/i.test(sentence)) {
      costPlus++;
      hit = true;
    }
    if (/\bspot (?:price|market|pricing)\b|\bindex(?:ed)? pricing\b/i.test(sentence)) {
      spot++;
      hit = true;
    }
    if (
      /\b(price escalat\w*|escalation clause|indexed to|pass[- ]through of (?:raw material|commodity|input) cost|surcharge)\b/i.test(
        sentence,
      )
    ) {
      escalatorYes++;
      hit = true;
    }
    if (
      /\b(?:do(?:es)? not (?:contain|include|permit)|without|no)\s+(?:price\s+)?escalat\w*/i.test(
        sentence,
      )
    ) {
      escalatorNo++;
      hit = true;
    }
    if (hit && quotes.length < 6) quotes.push(sentence);
  }

  const signals = [fixed, costPlus, spot].filter((n) => n > 0).length;
  let contractStructure = "unknown";
  if (signals > 1) contractStructure = "mixed";
  else if (fixed > 0) contractStructure = "fixed_price";
  else if (costPlus > 0) contractStructure = "cost_plus";
  else if (spot > 0) contractStructure = "spot";

  // An explicit denial outranks a mention: boilerplate describing escalators
  // in general is weaker evidence than a statement that these contracts have
  // none.
  const hasPriceEscalators =
    escalatorNo > 0 ? "no" : escalatorYes > 0 ? "yes" : "unknown";

  const confidence =
    contractStructure === "unknown" && hasPriceEscalators === "unknown"
      ? 0.15
      : // Keyword counting over MD&A boilerplate. Directionally useful,
        // nowhere near a read of the actual contracts.
        0.45;

  return { contractStructure, hasPriceEscalators, quotes, confidence };
}

/* ------------------------------------------------------------------ */
/* Capture score                                                       */
/* ------------------------------------------------------------------ */

export interface CaptureInput {
  grossMarginPct: number | null;
  priorGrossMarginPct: number | null;
  contractStructure: string;
  hasPriceEscalators: string;
}

/**
 * Compose the 0..1 capture term the scorer consumes.
 *
 * Gross margin trend is the validator and carries the most weight: backlog up
 * with margin flat is the tell that the tightening is not reaching the P&L,
 * and it is a fact rather than a keyword count. Contract structure is the
 * prior; margin is the evidence.
 *
 * Returns null when there is nothing to go on, which the scorer treats as
 * capture_unknown (0.85 multiplier) rather than as weak capture. Not knowing
 * is not the same as knowing it is bad.
 */
export function computeCapture(
  input: CaptureInput,
): { value: number; confidence: number; basis: string[] } | null {
  const basis: string[] = [];
  let score = 0.5;
  let weight = 0;

  if (input.grossMarginPct !== null && input.priorGrossMarginPct !== null) {
    const delta = input.grossMarginPct - input.priorGrossMarginPct;
    // +2pp of gross margin in a quarter is a strong repricing signal;
    // -2pp says the shortage is being absorbed rather than passed on.
    const marginScore = Math.min(1, Math.max(0, 0.5 + delta / 4));
    score = score * weight + marginScore * 2;
    weight += 2;
    score = score / weight;
    basis.push(`gross margin ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp QoQ`);
  }

  const structureScore =
    input.contractStructure === "spot"
      ? 0.9
      : input.contractStructure === "cost_plus"
        ? 0.65
        : input.contractStructure === "mixed"
          ? 0.5
          : input.contractStructure === "fixed_price"
            ? input.hasPriceEscalators === "yes"
              ? 0.55
              : 0.25
            : null;

  if (structureScore !== null) {
    score = (score * weight + structureScore) / (weight + 1);
    weight += 1;
    basis.push(
      `${input.contractStructure} contracts, escalators: ${input.hasPriceEscalators}`,
    );
  }

  if (weight === 0) return null;

  return {
    value: Math.min(1, Math.max(0, score)),
    // Margin trend is a fact; contract structure is a keyword count.
    confidence: weight >= 3 ? 0.6 : weight >= 2 ? 0.5 : 0.3,
    basis,
  };
}
