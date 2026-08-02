/**
 * The rule language the watcher evaluates.
 *
 * Rules are stored as JSON so they can be written, read and argued with
 * without a deploy. A rule is either a single comparison:
 *
 *   { "field": "event.payload.changePct", "op": "lte", "value": -8 }
 *
 * or a combination:
 *
 *   { "all": [
 *       { "field": "event.kind", "op": "eq", "value": "price_move" },
 *       { "field": "company.owned", "op": "eq", "value": true },
 *       { "field": "event.payload.changePct", "op": "lte", "value": -8 }
 *   ]}
 *
 * THE IMPORTANT DESIGN DECISION IN THIS FILE is that evaluation is
 * three-valued: true, false, or "unknown". "unknown" means a field the rule
 * asked about isn't there — we have no price data, the filing didn't disclose
 * backlog, the company has no score yet.
 *
 * Two-valued logic would collapse that into `false`, and a rule that silently
 * never fires because the data stopped arriving is the worst possible failure
 * for this system. The whole point is being told when something happens; a
 * kill criterion that quietly stopped being checkable must surface as
 * "couldn't check this", not as "everything's fine".
 *
 * Pure and dependency-free so it can be tested directly on bare node, same as
 * server/scoring/*. The database work lives in ./evaluate.ts.
 */

export type Verdict = true | false | "unknown";

export interface Comparison {
  /** Dotted path into the context, e.g. "event.payload.changePct". */
  field?: string;
  /**
   * Alias for `field`. The kill_criteria table already stores predicates as
   * { metric, op, value } (see shared/schema.constraints.ts), and those rows
   * must keep working unchanged.
   */
  metric?: string;
  op: string;
  value?: unknown;
}

export interface AllOf {
  all: Predicate[];
}
export interface AnyOf {
  any: Predicate[];
}
export interface Not {
  not: Predicate;
}

export type Predicate = Comparison | AllOf | AnyOf | Not;

export type Context = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Path resolution                                                     */
/* ------------------------------------------------------------------ */

const MISSING = Symbol("missing");

/**
 * Walk a dotted path. Returns MISSING rather than undefined so that a field
 * explicitly set to null, or to 0, is distinguishable from a field that isn't
 * there — 0 is a real backlog reading and null may be a real "no escalators".
 */
export function resolvePath(ctx: Context, path: string): unknown | typeof MISSING {
  if (!path) return MISSING;
  let current: unknown = ctx;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return MISSING;
    if (typeof current !== "object") return MISSING;
    if (!(segment in (current as Record<string, unknown>))) return MISSING;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/* ------------------------------------------------------------------ */
/* Comparisons                                                         */
/* ------------------------------------------------------------------ */

function isComparison(p: Predicate): p is Comparison {
  return typeof (p as Comparison).op === "string";
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Postgres numeric arrives over PostgREST as a string. A rule comparing
  // "2100000000" to 2.1e9 as strings would be quietly wrong.
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Equality that doesn't trip over Postgres numerics arriving as strings, but
 * still treats "armed" and "ARMED" as different, because status strings are
 * exact and quietly case-folding them would hide a typo in a rule.
 */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  const a = asNumber(actual);
  const b = asNumber(expected);
  return a !== null && b !== null && a === b;
}

/** Ops that need a number on both sides. */
const NUMERIC_OPS = new Set([
  "lt",
  "lte",
  "gt",
  "gte",
  "abs_gte",
  "abs_lt",
  "between",
]);

export const SUPPORTED_OPS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "nin",
  "contains",
  "exists",
  "missing",
  /** |actual| >= value. For "moved a lot, either direction". */
  "abs_gte",
  "abs_lt",
  /** value is [low, high], inclusive both ends. */
  "between",
] as const;

function compare(actual: unknown, op: string, expected: unknown): Verdict {
  // Presence checks are the only ops that are meaningful on a missing field.
  if (op === "exists") return actual !== MISSING && actual !== null;
  if (op === "missing") return actual === MISSING || actual === null;

  if (actual === MISSING) return "unknown";

  switch (op) {
    case "eq":
      return sameValue(actual, expected);
    case "ne":
      return !sameValue(actual, expected);
    case "in":
      return Array.isArray(expected) ? expected.includes(actual) : false;
    case "nin":
      return Array.isArray(expected) ? !expected.includes(actual) : false;
    case "contains": {
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      if (Array.isArray(actual)) return actual.includes(expected);
      return false;
    }
    default:
      break;
  }

  if (NUMERIC_OPS.has(op)) {
    const a = asNumber(actual);
    if (a === null) return "unknown";

    if (op === "between") {
      if (!Array.isArray(expected) || expected.length !== 2) return "unknown";
      const low = asNumber(expected[0]);
      const high = asNumber(expected[1]);
      if (low === null || high === null) return "unknown";
      return a >= low && a <= high;
    }

    const b = asNumber(expected);
    if (b === null) return "unknown";

    switch (op) {
      case "lt":
        return a < b;
      case "lte":
        return a <= b;
      case "gt":
        return a > b;
      case "gte":
        return a >= b;
      case "abs_gte":
        return Math.abs(a) >= b;
      case "abs_lt":
        return Math.abs(a) < b;
    }
  }

  // An op nobody implemented is not "false" — it's a rule we can't check.
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Three-valued evaluation.
 *
 * `all`: false wins over unknown — if one clause is definitely false, the
 *        whole thing is false regardless of what we couldn't check.
 * `any`: true wins over unknown — one definite match is a match.
 *
 * That asymmetry is what stops missing data from either firing a rule
 * spuriously or silencing one that has already matched.
 */
export function evaluate(predicate: Predicate, ctx: Context): Verdict {
  if (!predicate || typeof predicate !== "object") return "unknown";

  if ("all" in predicate) {
    if (!Array.isArray(predicate.all)) return "unknown";
    // An empty `all` is vacuously true, which would make an unfinished rule
    // fire on everything. Treat it as unwritten.
    if (predicate.all.length === 0) return "unknown";
    let sawUnknown = false;
    for (const clause of predicate.all) {
      const v = evaluate(clause, ctx);
      if (v === false) return false;
      if (v === "unknown") sawUnknown = true;
    }
    return sawUnknown ? "unknown" : true;
  }

  if ("any" in predicate) {
    if (!Array.isArray(predicate.any)) return "unknown";
    if (predicate.any.length === 0) return "unknown";
    let sawUnknown = false;
    for (const clause of predicate.any) {
      const v = evaluate(clause, ctx);
      if (v === true) return true;
      if (v === "unknown") sawUnknown = true;
    }
    return sawUnknown ? "unknown" : false;
  }

  if ("not" in predicate) {
    const v = evaluate(predicate.not, ctx);
    if (v === "unknown") return "unknown";
    return !v;
  }

  if (isComparison(predicate)) {
    const path = predicate.field ?? predicate.metric;
    if (!path) return "unknown";
    return compare(resolvePath(ctx, path), predicate.op, predicate.value);
  }

  return "unknown";
}

/** Convenience: did this rule definitely match? */
export function matches(predicate: Predicate, ctx: Context): boolean {
  return evaluate(predicate, ctx) === true;
}

/* ------------------------------------------------------------------ */
/* Explaining and validating                                           */
/* ------------------------------------------------------------------ */

/**
 * Every field a predicate reads. Used to say, in plain language, what a rule
 * couldn't check — "we have no price data for this name" beats a rule that
 * silently never fires.
 */
export function referencedFields(predicate: Predicate): string[] {
  const out: string[] = [];
  const walk = (p: Predicate) => {
    if (!p || typeof p !== "object") return;
    if ("all" in p && Array.isArray(p.all)) return p.all.forEach(walk);
    if ("any" in p && Array.isArray(p.any)) return p.any.forEach(walk);
    if ("not" in p) return walk(p.not);
    if (isComparison(p)) {
      const path = p.field ?? p.metric;
      if (path) out.push(path);
    }
  };
  walk(predicate);
  return Array.from(new Set(out));
}

/** Fields the rule wanted but the context didn't have. */
export function missingFields(predicate: Predicate, ctx: Context): string[] {
  return referencedFields(predicate).filter(
    (f) => resolvePath(ctx, f) === MISSING,
  );
}

export interface ValidationProblem {
  path: string;
  problem: string;
}

/**
 * Catch broken rules when they're written rather than when they fail to fire.
 * A rule stored as JSON has no compiler behind it, so this is the only thing
 * standing between a typo and six months of silence.
 */
export function validatePredicate(
  predicate: Predicate,
  at = "predicate",
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  if (!predicate || typeof predicate !== "object") {
    return [{ path: at, problem: "Not an object." }];
  }

  if ("all" in predicate || "any" in predicate) {
    const key = "all" in predicate ? "all" : "any";
    const clauses = (predicate as any)[key];
    if (!Array.isArray(clauses)) {
      problems.push({ path: `${at}.${key}`, problem: `"${key}" must be a list.` });
    } else if (clauses.length === 0) {
      problems.push({
        path: `${at}.${key}`,
        problem: `"${key}" is empty, so this rule can never be checked.`,
      });
    } else {
      clauses.forEach((c: Predicate, i: number) =>
        problems.push(...validatePredicate(c, `${at}.${key}[${i}]`)),
      );
    }
    return problems;
  }

  if ("not" in predicate) {
    return validatePredicate((predicate as Not).not, `${at}.not`);
  }

  if (!isComparison(predicate)) {
    return [
      {
        path: at,
        problem: 'Needs one of "all", "any", "not", or an "op" comparison.',
      },
    ];
  }

  const path = predicate.field ?? predicate.metric;
  if (!path) {
    problems.push({ path: at, problem: 'Missing "field" (what to look at).' });
  }
  if (!(SUPPORTED_OPS as readonly string[]).includes(predicate.op)) {
    problems.push({
      path: at,
      problem: `"${predicate.op}" isn't a comparison this system knows. Known: ${SUPPORTED_OPS.join(", ")}.`,
    });
  }
  const needsValue = predicate.op !== "exists" && predicate.op !== "missing";
  if (needsValue && predicate.value === undefined) {
    problems.push({ path: at, problem: `"${predicate.op}" needs a value to compare against.` });
  }
  if (predicate.op === "between") {
    if (!Array.isArray(predicate.value) || predicate.value.length !== 2) {
      problems.push({
        path: at,
        problem: '"between" needs a value of exactly [low, high].',
      });
    }
  }

  return problems;
}

/**
 * Read a rule back in plain language, for the notification and for anyone
 * checking whether the rule says what they meant.
 */
export function describePredicate(predicate: Predicate): string {
  if (!predicate || typeof predicate !== "object") return "(not a valid rule)";

  if ("all" in predicate && Array.isArray(predicate.all)) {
    return predicate.all.map(describePredicate).join(" and ");
  }
  if ("any" in predicate && Array.isArray(predicate.any)) {
    return predicate.any.map(describePredicate).join(" or ");
  }
  if ("not" in predicate) {
    return `not (${describePredicate((predicate as Not).not)})`;
  }
  if (isComparison(predicate)) {
    const field = predicate.field ?? predicate.metric ?? "(nothing)";
    const v = JSON.stringify(predicate.value);
    switch (predicate.op) {
      case "eq":
        return `${field} is ${v}`;
      case "ne":
        return `${field} is not ${v}`;
      case "lt":
        return `${field} is below ${v}`;
      case "lte":
        return `${field} is ${v} or below`;
      case "gt":
        return `${field} is above ${v}`;
      case "gte":
        return `${field} is ${v} or above`;
      case "in":
        return `${field} is one of ${v}`;
      case "nin":
        return `${field} is none of ${v}`;
      case "contains":
        return `${field} mentions ${v}`;
      case "exists":
        return `${field} has a value`;
      case "missing":
        return `${field} has no value`;
      case "abs_gte":
        return `${field} moved by ${v} or more in either direction`;
      case "abs_lt":
        return `${field} moved by less than ${v}`;
      case "between":
        return `${field} is between ${v}`;
      default:
        return `${field} ${predicate.op} ${v}`;
    }
  }
  return "(not a valid rule)";
}
