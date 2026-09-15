-- ============================================================================
-- 015_pin_and_color_labels.sql
--
-- Adds per-user organisation preferences to the two "my stuff" collections:
--   saved_jobs      -> the Job Seeker's bookmarked vacancies
--   usertrackedjobs -> the Job Seeker's private application pipeline (Kanban)
--
-- Both gain the same pair, so one shared frontend control can drive either:
--   is_pinned    pin-to-top priority. Sorted before everything else — for the
--                Kanban this means "first within its own stage column", never
--                across columns, so pinning can never imply a status change.
--   color_label  a Google-Keep-style colour tag. Stores the palette KEY
--                ('red', 'amber', …), NOT a hex value: the UI owns the actual
--                colours, so light/dark variants can be retuned later without
--                a data migration, and an unknown key degrades to "no label"
--                instead of injecting arbitrary CSS.
--
-- Both are per-row on tables that are already scoped by user_id, so these are
-- inherently private to the owning user. NULL/false defaults mean every
-- existing row keeps its current behaviour with no backfill.
-- ============================================================================

ALTER TABLE saved_jobs
	ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE saved_jobs
	ADD COLUMN color_label VARCHAR(20) NULL;

ALTER TABLE usertrackedjobs
	ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE usertrackedjobs
	ADD COLUMN color_label VARCHAR(20) NULL;
