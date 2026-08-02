/**
 * Turning a matched rule into words a person can act on.
 *
 * The hard requirement: the notification must contain everything needed to act
 * WITHOUT opening the app. Someone reads this between classes, on a phone, and
 * either does something or doesn't. "3 items need your attention — log in to
 * review" is a dashboard with extra steps, and a dashboard you have to remember
 * to open is exactly what this phase exists to escape.
 *
 * So every body carries: what happened, what we said we'd do about it, why we
 * said that, and the numbers behind it. The link at the end is for reading
 * more, never for finding out what the alert was about.
 *
 * Pure and dependency-free, so the wording is testable.
 */

// Explicit .ts extension: this module is unit-tested on bare node with type
// stripping (scripts/run-tests.mjs), which resolves ESM specifiers literally.
// Anything reachable from a test file needs the extension.
import { describePredicate, missingFields, type Predicate, type Context } from "./predicate.ts";

export interface ComposeInput {
  ruleName: string;
  /** Plain language, written by whoever made the rule. */
  ruleDescription: string | null;
  predicate: Predicate;
  companyName: string;
  ticker: string | null;
  /** The world event that triggered it, if there was one. */
  headline?: string;
  detail?: string | null;
  /** Facts the rule looked at, for the "the numbers" section. */
  context: Context;
  /** Deep link back into the app. Optional extra, never load-bearing. */
  link?: string | null;
}

export interface ComposedMessage {
  subject: string;
  body: string;
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "not recorded";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}bn`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    return String(Number(value.toFixed(4)));
  }
  const asNumber = typeof value === "string" ? Number(value) : NaN;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(asNumber)) {
    return fmt(asNumber);
  }
  return String(value);
}

/**
 * The numbers a reader needs to believe the alert, pulled from exactly the
 * fields the rule looked at. Showing the whole context would bury the point;
 * showing none of it means trusting the machine, which is not what this team
 * does.
 */
function relevantNumbers(predicate: Predicate, context: Context): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  const walk = (p: any) => {
    if (!p || typeof p !== "object") return;
    if (Array.isArray(p.all)) return p.all.forEach(walk);
    if (Array.isArray(p.any)) return p.any.forEach(walk);
    if (p.not) return walk(p.not);
    const path: string | undefined = p.field ?? p.metric;
    if (!path || seen.has(path)) return;
    seen.add(path);

    let current: any = context;
    for (const segment of path.split(".")) {
      if (current === null || current === undefined || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[segment];
    }
    lines.push(`  ${humanFieldName(path)}: ${fmt(current)}`);
  };

  walk(predicate);
  return lines;
}

/**
 * Field paths are written for the machine. Nobody on this team is a trained
 * finance professional, so the email says what the number is rather than where
 * it's stored.
 */
const FIELD_NAMES: Record<string, string> = {
  "capture.backlogValue": "Orders signed but not yet delivered",
  "capture.grossMarginPct": "Gross margin (%)",
  "capture.contractStructure": "How their contracts are priced",
  "capture.hasPriceEscalators": "Can they raise prices mid-contract",
  "capture.utilizationPct": "How full their capacity is (%)",
  "constraint.tightening": "How tight the bottleneck is (-1 to +1)",
  "constraint.direction": "Which way the bottleneck is moving",
  "score.long": "Our score for buying this",
  "score.short": "Our score for shorting this",
  "score.confidence": "How much we trust that score (0-1)",
  "recognition.analystCount": "Analysts covering it",
  "recognition.thematicEtfCount": "Themed funds holding it",
  "recognition.themeMentionDensity": "How often they say 'data centre' themselves",
  "company.owned": "Do we own it",
  "company.weightPct": "Position size (% of book)",
  "event.payload.changePct": "Price move (%)",
  "event.kind": "What happened",
  "attention.daysSinceAnyoneLooked": "Days since anyone looked at it",
};

export function humanFieldName(path: string): string {
  return FIELD_NAMES[path] ?? path;
}

export function composeRuleNotification(input: ComposeInput): ComposedMessage {
  const name = input.ticker ? `${input.companyName} (${input.ticker})` : input.companyName;
  const subject = `${name} — ${input.ruleName}`;

  const parts: string[] = [];

  if (input.headline) parts.push(input.headline);
  if (input.detail) parts.push(input.detail);

  if (input.ruleDescription) {
    parts.push(`What you said about this:\n${input.ruleDescription}`);
  }

  parts.push(`The rule that fired:\n  ${describePredicate(input.predicate)}`);

  const numbers = relevantNumbers(input.predicate, input.context);
  if (numbers.length) parts.push(`The numbers right now:\n${numbers.join("\n")}`);

  const unchecked = missingFields(input.predicate, input.context);
  if (unchecked.length) {
    parts.push(
      `Couldn't check: ${unchecked.map(humanFieldName).join(", ")}. ` +
        `We don't hold that data, so treat this alert as partial.`,
    );
  }

  // Stated on every single one of these, deliberately. This system notifies;
  // it never places or exports a trade, and nothing in this repo does.
  parts.push("Nothing has been traded. You decide and execute yourself.");

  if (input.link) parts.push(`More detail: ${input.link}`);

  return { subject, body: parts.join("\n\n") };
}

/**
 * When a rule stops being checkable.
 *
 * Sent because the alternative is silence, and silence from a rule that used
 * to fire is indistinguishable from "nothing is wrong". A kill criterion that
 * quietly stopped being evaluated is worse than no kill criterion at all,
 * because it's still on the list and everyone assumes it's watching.
 */
export function composeUncheckableNotification(input: {
  ruleName: string;
  companyName: string;
  ticker: string | null;
  predicate: Predicate;
  missing: string[];
}): ComposedMessage {
  const name = input.ticker ? `${input.companyName} (${input.ticker})` : input.companyName;
  return {
    subject: `Can't check "${input.ruleName}" for ${name}`,
    body: [
      `The rule "${input.ruleName}" on ${name} can't be evaluated — we don't have the data it asks for.`,
      `Missing: ${input.missing.map(humanFieldName).join(", ")}.`,
      `The rule says:\n  ${describePredicate(input.predicate)}`,
      `This is not "nothing happened". It's "nobody is watching this". Either wire up the data or retire the rule.`,
    ].join("\n\n"),
  };
}
