-- 038_scoring_input_hash.sql
-- Change-detection guard for AI re-scoring (Enhancement B refinement).
--
-- WHY: a re-score is expensive (a DeepSeek call) and today the worker ALWAYS calls
-- the AI even when the scoring inputs are identical to the last run (e.g. a résumé
-- re-uploaded byte-for-byte, or a job edit that didn't touch a scoring-relevant
-- field). Because scoring is DETERMINISTIC (temperature 0 + JSON mode, §21), the
-- same inputs yield the same score, so recomputing is pure waste.
--
-- WHAT: `last_scored_input_hash` stores a SHA-256 of the exact assembled scoring
-- prompt (whitespace-normalized) at the moment of the last SUCCESSFUL score. The
-- worker compares the current inputs' hash to it and, on a match, completes the
-- job WITHOUT an AI call (keeping the still-correct live score). It is written
-- ONLY on a real score (never on a NULL/skip), so an AI outage never poisons the
-- baseline, and the guard is at EXECUTION not scheduling — so it can never swallow
-- a genuine re-score (a real content change changes the hash → it scores).
--
-- SHIP-DARK: the column is inert until SCORING_INPUT_HASH_GUARD=true is set on the
-- worker. Additive + idempotent; safe on the live shared TiDB. Rollback = flip the
-- flag off (no deploy); the column can stay.

ALTER TABLE job_applications
    ADD COLUMN IF NOT EXISTS last_scored_input_hash CHAR(64) NULL DEFAULT NULL;
