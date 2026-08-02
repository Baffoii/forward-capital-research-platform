import { defineConfig } from "drizzle-kit";

/**
 * Separate drizzle config for the opportunity-scoring tables.
 *
 * Why this file exists instead of re-exporting from shared/schema.ts:
 * shared/schema.ts is `sqlite-core` (dialect: "sqlite", ./data.db) and is
 * used purely to generate TypeScript types — the live query layer is
 * PostgREST via server/supabase.ts against Supabase Postgres, not Drizzle.
 * drizzle-kit takes ONE dialect per config, so pg-core tables and
 * sqlite-core tables cannot share a schema entrypoint. Re-exporting
 * schema.constraints.ts from schema.ts breaks `npm run db:push`.
 *
 * `npm run db:generate:constraints` writes DDL to ./migrations-constraints
 * with no database connection required. Apply it in the Supabase SQL editor,
 * which is how this repo already applies SQL (see scripts/gen_migration_sql.py).
 *
 * `npm run db:push:constraints` needs DATABASE_URL — a direct Postgres
 * connection string with DDL rights. The SUPABASE_ANON_KEY cannot run DDL.
 */
export default defineConfig({
  out: "./migrations-constraints",
  schema: "./shared/schema.constraints.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://unset",
  },
});
