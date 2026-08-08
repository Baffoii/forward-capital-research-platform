import {
  CONSTRAINT_REGISTRY,
  CONSTRAINT_TIERS,
  validateRegistry,
  type RegisteredConstraint,
} from "./constraint-registry.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  pass  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

console.log("\nconstraint registry");

check(
  "registry has 10-14 constraints",
  CONSTRAINT_REGISTRY.length >= 10 && CONSTRAINT_REGISTRY.length <= 14,
  `(${CONSTRAINT_REGISTRY.length})`,
);

const slugs = new Set(CONSTRAINT_REGISTRY.map((c) => c.slug));
check("slugs are unique", slugs.size === CONSTRAINT_REGISTRY.length);

const tiersUsed = new Set(CONSTRAINT_REGISTRY.map((c) => c.tier));
check(
  "every tier in the supply chain is represented",
  CONSTRAINT_TIERS.every((t) => tiersUsed.has(t)),
  `(missing: ${CONSTRAINT_TIERS.filter((t) => !tiersUsed.has(t)).join(", ")})`,
);

check(
  "no tier outside the allowed set",
  [...tiersUsed].every((t) => (CONSTRAINT_TIERS as readonly string[]).includes(t)),
);

// A vague constraint produces a vague exposure estimate, which is the failure
// this registry exists to prevent. Descriptions carry the specificity that
// makes "what fraction of revenue rides on this" an answerable question.
check(
  "every constraint has a substantive description",
  CONSTRAINT_REGISTRY.every((c) => (c.description ?? "").length > 120),
  `(shortest: ${Math.min(...CONSTRAINT_REGISTRY.map((c) => (c.description ?? "").length))})`,
);

check(
  "no constraint name is a bare category",
  !CONSTRAINT_REGISTRY.some((c) =>
    ["power equipment", "cooling", "semiconductors", "power", "grid"].includes(
      c.name.toLowerCase(),
    ),
  ),
);

console.log("\nregistry validation");

let threwOnDupe = false;
try {
  validateRegistry([
    { slug: "a", name: "A", tier: "component", description: "x" },
    { slug: "a", name: "A2", tier: "component", description: "x" },
  ]);
} catch {
  threwOnDupe = true;
}
check("rejects duplicate slugs", threwOnDupe);

let threwOnTier = false;
try {
  validateRegistry([
    { slug: "b", name: "B", tier: "made_up_tier", description: "x" },
  ] as RegisteredConstraint[]);
} catch {
  threwOnTier = true;
}
check("rejects unknown tier", threwOnTier);

let threwOnSlugCase = false;
try {
  validateRegistry([
    { slug: "Not_Kebab", name: "C", tier: "component", description: "x" },
  ]);
} catch {
  threwOnSlugCase = true;
}
check("rejects non-kebab-case slug", threwOnSlugCase);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
