import { defineConfig } from "drizzle-kit";

/**
 * Schema config for the human-loop tables (the two logs and everything built
 * on them).
 *
 * A third config file rather than folding these into
 * drizzle.config.constraints.ts, for the same reason that file exists: one
 * dialect per config, and separate migration folders keep each phase's DDL
 * reviewable on its own. shared/schema.ts is sqlite-core and type-generation
 * only; this file and the constraints one are both pg-core against the live
 * Supabase Postgres.
 *
 * `npm run db:generate:human-loop` writes DDL to ./migrations-human-loop with
 * no database connection required. Apply it in the Supabase SQL editor, which
 * is how this repo already applies SQL.
 *
 * `npm run db:push:human-loop` needs DATABASE_URL — a direct Postgres
 * connection string with DDL rights. SUPABASE_ANON_KEY cannot run DDL.
 *
 * NOTE: the append-only triggers on world_events and human_events are hand
 * written in migrations-human-loop/append-only.sql. drizzle-kit does not model
 * triggers, and a comment saying "never update this table" is not an
 * invariant. Apply that file after the generated migration.
 */
export default defineConfig({
  out: "./migrations-human-loop",
  schema: "./shared/schema.human-loop.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://unset",
  },
});
