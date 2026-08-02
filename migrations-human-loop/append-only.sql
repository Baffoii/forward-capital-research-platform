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
