-- Migration 051 — Employer contact email on a vacancy.
--
-- WHY: the referral automation notifies the EMPLOYER by email, but no employer
-- email existed anywhere — the dispatch payload fell back to the PESO admin's own
-- user email (referralRepository.findReferralForDispatch: emp.email via
-- pj.peso_admin_id). This adds the authoritative recipient to the vacancy itself,
-- filled in the Job Publication Manager and read straight into the dispatch payload.
--
-- Additive + idempotent. Nullable so existing rows and drafts are unaffected; the
-- API enforces a valid email only when a job is PUBLISHED (Draft may omit it).
-- Also created defensively at boot (pesoAdminRoutes.js) so a deploy is never ahead
-- of this migration.
ALTER TABLE pesoadmin_job_posts
    ADD COLUMN IF NOT EXISTS company_email VARCHAR(255) NULL AFTER company;
