-- Migration: 008_rename_employer_applications
-- Legacy table with NO application code references (superseded by
-- job_applications). Renamed for schema consistency. FK leaf.
-- If you would rather remove it entirely, replace the RENAME with:
--   DROP TABLE IF EXISTS employer_applications;

RENAME TABLE employer_applications TO pesoadmin_applications;