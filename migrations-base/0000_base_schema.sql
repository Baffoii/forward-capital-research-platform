-- Base schema for Forward Capital Research Platform (Postgres / Supabase).
--
-- WHY THIS FILE EXISTS
-- shared/schema.ts is sqlite-core and drizzle.config.ts targets ./data.db, so
-- `npm run db:push` has never been able to create these tables in Postgres.
-- The Postgres tables were originally created by some means that was never
-- committed, which means a fresh Supabase project has no way to stand the app
-- up from this repo. This is that missing piece: a direct translation of
-- shared/schema.ts, with the exact snake_case column names server/storage.ts
-- converts to via objToSnake().
--
-- ORDER OF APPLICATION on a fresh project:
--   1. this file
--   2. migrations-constraints/0000_*.sql   (opportunity-scoring tables)
--
-- Integer primary keys are `serial`, not `identity`, because
-- scripts/gen_migration_sql.py calls pg_get_serial_sequence(table, 'id') when
-- reseeding and that only resolves for serial columns.
--
-- TYPE MAPPING from sqlite-core:
--   integer().primaryKey({autoIncrement}) -> serial primary key
--   integer()                             -> integer
--   integer({mode: "boolean"})            -> boolean
--   real()                                -> real
--   text()                                -> text
-- Timestamps are text throughout because the app stores ISO strings
-- (createdAt: text("created_at")), not native timestamps. Do not "fix" this
-- to timestamptz without changing storage.ts — the round-trip is untyped.

BEGIN;

CREATE TABLE IF NOT EXISTS companies (
  id          serial PRIMARY KEY,
  ticker      text,
  name        text NOT NULL,
  sector      text,
  industry    text,
  ceo         text,
  employees   integer,
  website     text,
  ipo_date    text,
  description text,
  segment     text NOT NULL,
  created_at  text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS theses (
  id               serial PRIMARY KEY,
  title            text NOT NULL,
  summary          text NOT NULL,
  prediction       text NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  confidence_score real,
  created_at       text NOT NULL DEFAULT '',
  updated_at       text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS thesis_assumptions (
  id         serial PRIMARY KEY,
  thesis_id  integer NOT NULL,
  text       text NOT NULL,
  importance text NOT NULL
);

CREATE TABLE IF NOT EXISTS thesis_companies (
  id         serial PRIMARY KEY,
  thesis_id  integer NOT NULL,
  company_id integer NOT NULL,
  segment    text NOT NULL,
  rationale  text
);

CREATE TABLE IF NOT EXISTS sources (
  id                serial PRIMARY KEY,
  name              text NOT NULL,
  kind              text NOT NULL,
  source_identifier text NOT NULL,
  reliability_score real NOT NULL DEFAULT 0.5,
  url               text,
  last_synced_at    text
);

CREATE TABLE IF NOT EXISTS signals (
  id                        serial PRIMARY KEY,
  thesis_id                 integer,
  company_id                integer,
  source_id                 integer NOT NULL,
  title                     text NOT NULL,
  description               text NOT NULL,
  signal_category           text NOT NULL,
  provenance_class          text NOT NULL,
  verification_tier         text NOT NULL,
  direction                 text NOT NULL,
  relevance                 real NOT NULL DEFAULT 0.5,
  reliability               real NOT NULL DEFAULT 0.5,
  novelty                   real NOT NULL DEFAULT 0.5,
  independent_confirmations integer NOT NULL DEFAULT 0,
  expected_magnitude        text NOT NULL DEFAULT 'medium',
  time_horizon              text NOT NULL DEFAULT 'months',
  priced_in_flag            boolean NOT NULL DEFAULT false,
  raw_payload               text,
  source_url                text,
  retrieved_at              text NOT NULL,
  ingestion_method          text NOT NULL,
  created_at                text NOT NULL
);

CREATE TABLE IF NOT EXISTS signal_scores (
  id          serial PRIMARY KEY,
  signal_id   integer NOT NULL,
  thesis_id   integer NOT NULL,
  score       real NOT NULL,
  computed_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS research_inbox_items (
  id                  serial PRIMARY KEY,
  raw_text            text NOT NULL,
  source_context      text NOT NULL,
  submitted_at        text NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  promoted_signal_id  integer
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id         serial PRIMARY KEY,
  company_id integer NOT NULL,
  added_at   text NOT NULL,
  notes      text
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          serial PRIMARY KEY,
  event_type  text NOT NULL,
  description text NOT NULL,
  source_id   integer,
  created_at  text NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id    serial PRIMARY KEY,
  key   text NOT NULL UNIQUE,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS edgar_ticker_cik_cache (
  id         serial PRIMARY KEY,
  ticker     text NOT NULL UNIQUE,
  cik        text NOT NULL,
  fetched_at text NOT NULL
);

-- Kept from the project template. Unused by the app.
CREATE TABLE IF NOT EXISTS users (
  id       serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password text NOT NULL
);

-- Indexes on the columns storage.ts actually filters by.
CREATE INDEX IF NOT EXISTS signals_thesis_idx     ON signals (thesis_id);
CREATE INDEX IF NOT EXISTS signals_company_idx    ON signals (company_id);
CREATE INDEX IF NOT EXISTS signals_category_idx   ON signals (signal_category);
CREATE INDEX IF NOT EXISTS signals_created_idx    ON signals (created_at DESC);
CREATE INDEX IF NOT EXISTS signal_scores_thesis_idx ON signal_scores (thesis_id);
CREATE INDEX IF NOT EXISTS thesis_assumptions_idx ON thesis_assumptions (thesis_id);
CREATE INDEX IF NOT EXISTS thesis_companies_idx   ON thesis_companies (thesis_id);
CREATE INDEX IF NOT EXISTS companies_ticker_idx   ON companies (ticker);
CREATE INDEX IF NOT EXISTS audit_log_created_idx  ON audit_log (created_at DESC);

COMMIT;

-- NOTE ON ROW LEVEL SECURITY
-- These tables are created without RLS, which is what the app expects: every
-- read and write in server/storage.ts goes through the anon key, and enabling
-- RLS without policies would make all of them fail.
--
-- The consequence is that the anon key — which is public by design and ships
-- in the browser bundle — has full read/write on this database. That is a
-- deliberate trade-off for a single-user research prototype (see the note in
-- server/routes.ts about INGEST_ADMIN_TOKEN), not an oversight. It stops being
-- acceptable the moment this is deployed anywhere reachable with data you care
-- about, at which point the fix is RLS policies plus a server-side key, not a
-- different anon key.
