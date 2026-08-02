-- All human-loop migrations, in order, plus the append-only triggers.
-- Generated from migrations-human-loop/. Paste this whole file into the
-- Supabase SQL editor and run it once.

-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0000_simple_weapon_omega.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "human_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"company_id" integer,
	"ticker" text,
	"summary" text NOT NULL,
	"raw_text" text,
	"subject_type" text,
	"subject_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "world_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"company_id" integer,
	"ticker" text,
	"constraint_id" uuid,
	"headline" text NOT NULL,
	"detail" text,
	"payload" jsonb NOT NULL,
	"materiality" numeric(4, 3),
	"source_url" text,
	"source_ref" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"known_at" timestamp with time zone NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "human_events_user_idx" ON "human_events" USING btree ("user_id","occurred_at");
CREATE INDEX "human_events_session_idx" ON "human_events" USING btree ("session_id");
CREATE INDEX "human_events_company_idx" ON "human_events" USING btree ("company_id","occurred_at");
CREATE INDEX "human_events_subject_idx" ON "human_events" USING btree ("subject_type","subject_id");
CREATE UNIQUE INDEX "world_events_dedupe_idx" ON "world_events" USING btree ("dedupe_key");
CREATE INDEX "world_events_recent_idx" ON "world_events" USING btree ("known_at");
CREATE INDEX "world_events_company_idx" ON "world_events" USING btree ("company_id","known_at");
CREATE INDEX "world_events_kind_idx" ON "world_events" USING btree ("kind","known_at");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0001_classy_maggott.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"rule_id" uuid,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company_id" integer,
	"ticker" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"send_error" text,
	"clicked_at" timestamp with time zone
);

CREATE TABLE "watcher_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"cadence" text NOT NULL,
	"predicate" jsonb NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"company_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("sent_at","created_at");
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_email","created_at");
CREATE UNIQUE INDEX "watcher_rules_slug_idx" ON "watcher_rules" USING btree ("slug");
CREATE INDEX "watcher_rules_active_idx" ON "watcher_rules" USING btree ("enabled","cadence");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0002_aspiring_zeigeist.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "handoff_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"assignee_email" text,
	"raw_text" text NOT NULL,
	"ticker" text,
	"company_id" integer,
	"found" text,
	"still_open" text,
	"needs_decision" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structuring_status" text DEFAULT 'pending' NOT NULL,
	"followup_question" text,
	"followup_answer" text,
	"status" text DEFAULT 'open' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"closing_note" text,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "handoff_assignee_idx" ON "handoff_packets" USING btree ("assignee_email","status");
CREATE INDEX "handoff_open_idx" ON "handoff_packets" USING btree ("status","created_at");
CREATE INDEX "handoff_author_idx" ON "handoff_packets" USING btree ("author_id","created_at");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0003_thankful_absorbing_man.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"ticker" text,
	"position_id" uuid,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"belief" text NOT NULL,
	"expectation" text NOT NULL,
	"expect_by" timestamp with time zone,
	"falsifier" text NOT NULL,
	"raw_text" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "journal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reviewer_email" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"still_agree" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "journal_reviews" ADD CONSTRAINT "journal_reviews_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "journal_company_idx" ON "journal_entries" USING btree ("company_id","created_at");
CREATE INDEX "journal_due_idx" ON "journal_entries" USING btree ("status","expect_by");
CREATE INDEX "journal_reviews_entry_idx" ON "journal_reviews" USING btree ("entry_id","created_at");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0004_zippy_sphinx.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "precommitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"ticker" text,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"condition_text" text NOT NULL,
	"action_text" text NOT NULL,
	"reasoning" text NOT NULL,
	"predicate" jsonb NOT NULL,
	"status" text DEFAULT 'armed' NOT NULL,
	"met_at" timestamp with time zone,
	"met_context" jsonb,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"outcome" text,
	"outcome_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "precommitments_armed_idx" ON "precommitments" USING btree ("status","company_id");
CREATE INDEX "precommitments_company_idx" ON "precommitments" USING btree ("company_id","created_at");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0005_exotic_bastion.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"items" jsonb NOT NULL,
	"suppressed" integer DEFAULT 0 NOT NULL,
	"suppressed_summary" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "digests_dedupe_idx" ON "digests" USING btree ("dedupe_key");
CREATE INDEX "digests_week_idx" ON "digests" USING btree ("week_start");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/0006_fresh_triathlon.sql
-- ───────────────────────────────────────────────────────────────
CREATE TABLE "research_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"ticker" text,
	"question" text NOT NULL,
	"intended_position_pct" numeric(6, 3) DEFAULT '1' NOT NULL,
	"time_sensitivity" numeric(4, 3) DEFAULT '0.5' NOT NULL,
	"estimated_hours" numeric(5, 2) DEFAULT '2' NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "research_items_status_idx" ON "research_items" USING btree ("status","created_at");
CREATE INDEX "research_items_company_idx" ON "research_items" USING btree ("company_id");
CREATE INDEX "research_items_claim_idx" ON "research_items" USING btree ("claimed_by","status");
-- ───────────────────────────────────────────────────────────────
-- migrations-human-loop/append-only.sql
-- ───────────────────────────────────────────────────────────────
-- Append-only enforcement for the two logs.
--
-- Run this in the Supabase SQL editor AFTER the generated migration.
--
-- Why a trigger and not a code convention: "never update this table" written
-- in a comment survives exactly until someone is debugging at 1am and reaches
-- for an UPDATE to fix one bad row. Every feature in this phase reads history
-- and assumes it is immutable — the weekly digest, the re-entry briefing, and
-- the calibration record of whether we still agree with our own reasoning are
-- all worthless if history can be quietly rewritten. Correcting a mistaken
-- event means APPENDING a correcting event, the way a ledger works.
--
-- This is also why there is no update or delete function anywhere in
-- server/human-loop/store.ts.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only. To correct an entry, append a new one instead of changing history.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS world_events_append_only ON world_events;
CREATE TRIGGER world_events_append_only
  BEFORE UPDATE OR DELETE ON world_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS human_events_append_only ON human_events;
CREATE TRIGGER human_events_append_only
  BEFORE UPDATE OR DELETE ON human_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Note on the daily jobs: appendWorldEvents() inserts with
-- ON CONFLICT (dedupe_key) DO NOTHING. That performs no UPDATE, so a retried
-- cron run passes through this trigger untouched — which is the point of the
-- dedupe key existing at all.

