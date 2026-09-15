-- Migration 040 — Gender as a supported JOB qualification field.
--
-- WHY: PESO Kabankalan office (interview) — accredited employers commonly
-- specify a gender requirement/preference on a vacancy. Gender becomes part of
-- the employer's STATED requirements that the AI compatibility scorer weighs
-- (services/aiScoringService.buildScoringPrompt). The candidate side already
-- exists (users.gender, captured in the seeker profile) — this adds ONLY the
-- employer/job side.
--
-- Additive + idempotent. VARCHAR (not ENUM) so values stay flexible and this
-- carries no enum-append constraints (§13). NULL / 'Any' means "no preference",
-- which the scorer treats as non-restrictive.
--
-- DEPLOY ORDER: run this BEFORE deploying the Phase 1.5 code — the Job
-- Publication Manager INSERT/UPDATE and the re-score SELECT reference pj.gender.
ALTER TABLE pesoadmin_job_posts
    ADD COLUMN IF NOT EXISTS gender VARCHAR(20) NULL AFTER qualifications;
