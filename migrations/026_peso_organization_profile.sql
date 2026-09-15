-- ============================================================================
-- 026_peso_organization_profile.sql
--
-- Reframes `pesoadmin_profiles` from an EMPLOYER profile into a PESO
-- ORGANIZATION profile — the public identity of the Kabankalan City PESO Office
-- as it appears on the job board and referral letters.
--
-- ── What changes ────────────────────────────────────────────────────────────
-- Adds the office-oriented fields the redesigned Organization Profile module
-- needs and that had no home before: office hours, a general office phone and
-- email (distinct from the authorized officer's personal contact), and a
-- Facebook page (the primary channel for a Philippine LGU office).
--
-- ── What is deliberately NOT changed ────────────────────────────────────────
-- The employer-specific columns — nature_of_business, industry,
-- years_in_operation, company_size, recruitment_contact / recruitment_email /
-- recruitment_phone — are LEFT IN PLACE. The app no longer reads or writes them
-- (they belong to a future dedicated Employer role, kept isolated from the PESO
-- Administrator workflow), but dropping columns on live TiDB is a downtime risk
-- (§0.7), and a later Employer implementation may reclaim them. They simply lie
-- dormant.
--
-- Additive only. `ADD COLUMN IF NOT EXISTS` (a TiDB extension already used
-- elsewhere in this codebase) keeps the migration safe to re-run and safe if the
-- table was partially altered by hand.
-- ============================================================================

ALTER TABLE pesoadmin_profiles ADD COLUMN IF NOT EXISTS office_hours VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE pesoadmin_profiles ADD COLUMN IF NOT EXISTS office_phone VARCHAR(60)  NULL DEFAULT NULL;
ALTER TABLE pesoadmin_profiles ADD COLUMN IF NOT EXISTS office_email VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE pesoadmin_profiles ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255) NULL DEFAULT NULL;
