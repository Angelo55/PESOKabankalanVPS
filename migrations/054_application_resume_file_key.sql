-- 054_application_resume_file_key.sql
-- Phase 2 (object storage for PII): application_resumes can now hold the PDF in
-- private object storage (storageService) instead of base64-in-DB. Add file_key
-- (the storage key) and make file_data nullable so exactly one of the two is set.
-- Additive + backward compatible: existing rows keep their base64 file_data and are
-- still served by the retrieval route's fallback branch.
--
-- NOTE: this is the MySQL/TiDB-path migration record. On the Postgres/Supabase path
-- the schema is owned by postgres/schema.sql (already updated) and this column was
-- applied there via ALTER; do NOT run `npm run migrate` against Supabase.

ALTER TABLE application_resumes ADD COLUMN IF NOT EXISTS file_key VARCHAR(512) NULL;
ALTER TABLE application_resumes MODIFY COLUMN file_data LONGTEXT NULL;
