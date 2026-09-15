-- ============================================================================
-- Migration: 005_real_ai_match_scores
--
-- THE PROBLEM
-- -----------
-- applicationRoutes.js:34 sets match_score with Math.random(), labelled
-- "AI Match Score Simulation". Every score in job_applications is a random
-- integer between 75 and 99. The ATS sorts by it. The referral module reads it.
-- It means nothing.
--
-- THE FIX
-- -------
-- 1. match_score becomes NULLABLE. NULL means "not scored" -- an honest absence.
--    The old default of 0 was indistinguishable from a genuine score of zero.
--
-- 2. ai_analysis stores DeepSeek's full reasoning (skills/education/experience),
--    so a PESO administrator can see WHY a score is what it is. A bare number is
--    not a defensible basis for a government referral.
--
-- 3. ai_scored_at records when the AI actually ran. NULL here means no AI has
--    ever touched this row, regardless of what match_score says.
--
-- 4. Every existing score is wiped. They are random numbers. Preserving them
--    would mean an auto-referral threshold could fire on a coin flip. An
--    application with no real score falls to manual review -- which is correct.
-- ============================================================================

ALTER TABLE job_applications
	MODIFY COLUMN match_score INT NULL DEFAULT NULL;

ALTER TABLE job_applications
	ADD COLUMN IF NOT EXISTS ai_analysis TEXT NULL,
	ADD COLUMN IF NOT EXISTS ai_scored_at TIMESTAMP NULL DEFAULT NULL;

-- Discard the simulated scores. They are not data.
UPDATE job_applications
SET match_score = NULL
WHERE ai_scored_at IS NULL;