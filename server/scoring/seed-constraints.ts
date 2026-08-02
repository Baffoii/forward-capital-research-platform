/**
 * Seeds the constraint registry into the database.
 *
 *   npm run seed:constraints
 *
 * Idempotent by slug: re-running after editing constraint-registry.ts updates
 * names and descriptions in place without churning ids, so exposure edges
 * pointing at a constraint survive a re-seed.
 */

import "dotenv/config";
import { CONSTRAINT_REGISTRY } from "./constraint-registry";
import { upsertConstraint } from "./store";

export async function seedConstraints(): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const c of CONSTRAINT_REGISTRY) {
    await upsertConstraint(c);
    upserted++;
  }
  return { upserted };
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);

if (isMain) {
  seedConstraints()
    .then(({ upserted }) => {
      const byTier = CONSTRAINT_REGISTRY.reduce<Record<string, number>>(
        (acc, c) => ({ ...acc, [c.tier]: (acc[c.tier] ?? 0) + 1 }),
        {},
      );
      console.log(`seeded ${upserted} constraints`);
      for (const [tier, n] of Object.entries(byTier).sort()) {
        console.log(`  ${tier.padEnd(20)} ${n}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("seed failed:", err.message);
      process.exit(1);
    });
}
