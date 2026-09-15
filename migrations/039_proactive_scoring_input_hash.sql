-- 039_proactive_scoring_input_hash.sql
-- Change-detection guard for the PROACTIVE matcher (§20 twin of migration 038).
--
-- WHY: the proactive matcher AI-scores a shortlist of candidates per Open/Published
-- vacancy on every publish/edit/seeker-re-match. When a candidate's scoring inputs
-- (their résumé + the job's scoring fields) are unchanged since the last time they
-- were scored for THIS job, re-scoring is pure waste — scoring is deterministic
-- (temp 0, §21), so the same inputs yield the same score.
--
-- WHAT: `last_scored_input_hash` on proactive_referral_candidates stores the SHA-256
-- of the exact assembled scoring prompt at the last score for that (job, applicant)
-- pair. proactiveReferralService.matchJob compares the current inputs' hash to it and,
-- on a match, SKIPS the AI call (keeping the existing suggestion). Same safety posture
-- as 038: derived from the shared buildScoringPrompt (no drift), compared per
-- (job, applicant), and gated at EXECUTION so it can never drop a real re-score.
--
-- SHIP-DARK: inert until PROACTIVE_INPUT_HASH_GUARD=true. A brand-new candidate has a
-- NULL hash and is always scored. Additive + idempotent; safe on the live shared TiDB.
-- Rollback = flip the flag off (no deploy); the column can stay.

ALTER TABLE proactive_referral_candidates
    ADD COLUMN IF NOT EXISTS last_scored_input_hash CHAR(64) NULL DEFAULT NULL;
