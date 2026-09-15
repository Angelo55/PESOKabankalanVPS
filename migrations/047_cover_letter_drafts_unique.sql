-- ============================================================================
-- 047_cover_letter_drafts_unique.sql  —  Cover-letter draft: one row per user
--
-- WHAT THIS ADDS
-- A hard UNIQUE(user_id) on cover_letter_drafts, so the "one draft per user"
-- rule the builder relies on is a DATABASE invariant, not just an application
-- convention.
--
-- WHY (the bug this closes as defense-in-depth)
-- cover_letter_drafts.user_id was only a NON-UNIQUE (FK) index. The original
-- builder saved with `INSERT ... ON DUPLICATE KEY UPDATE` — which, with no
-- unique key to conflict on, silently INSERTED a new row on every save (and the
-- old non-change-driven builder even re-saved EMPTY drafts on each revisit). The
-- table accumulated hundreds of rows per user (one account had 157), and an
-- unordered read could return a stale/empty draft over the user's real letter.
--
-- The CODE fix already shipped (2026-08-08): POST self-heals to a single row
-- (count → update-in-place / delete-all-and-insert) and GET returns the newest
-- MEANINGFUL draft (routes/coverLetterRoutes.js). This migration adds the DB
-- constraint the code fix could not add while historical duplicates remained,
-- so the invariant can never drift again even if a future code path regresses.
--
-- ── STEP 1: DEDUPLICATE (data), guarded and re-runnable ─────────────────────
-- Adding a UNIQUE constraint FAILS while duplicate user_id rows exist, so we
-- first collapse each user to exactly ONE surviving row. The row kept is the
-- SAME one the GET currently returns, so behaviour is unchanged post-migration:
--   • the newest row whose JSON body is non-empty (a real letter), else
--   • the newest row overall (an empty draft — preserved for users who never
--     wrote a body, exactly as GET falls back today).
-- The table has NO primary key, so rows are targeted by TiDB's implicit
-- `_tidb_rowid` (available because the table has no clustered PK). The keep-set
-- is the winner _tidb_rowid per user (meaningful-body → newest updated_at →
-- rowid as a deterministic final tiebreak, so a perfect updated_at tie can never
-- leave two survivors and cannot make STEP 2 fail). Every other row is deleted.
-- The keep-set subquery is wrapped in a derived table (`k`) so the DELETE can
-- read from its own target table (materialized subquery). No schema change here;
-- only duplicate rows are removed. Verified against live data before writing:
-- 263 rows / 10 users → keeps 10 (one each), deletes 253; every non-empty letter
-- retained. Re-running is a no-op (after dedup each user's only row IS its winner
-- rowid, so nothing matches `NOT IN (keep-set)`).
--
-- ── STEP 2: ADD THE CONSTRAINT ──────────────────────────────────────────────
-- With one row per user, ADD UNIQUE INDEX succeeds. The existing FK index
-- (cover_letter_drafts_ibfk_1 → users.id) is left in place — the FK is
-- unaffected; the new UNIQUE index simply coexists.
--
-- NOTE (TiDB gotcha): this TiDB version's parser REJECTS `ADD INDEX IF NOT
-- EXISTS` (ER_PARSE_ERROR), so the ALTER is plain — matching migration 033. This
-- migration is still safe to re-run after a partial failure: STEP 1 is
-- idempotent (after the first run each user has exactly one row, so it deletes
-- nothing), and STEP 2 only runs if the index does not yet exist (a failed
-- migration is NOT recorded, and the index was never created on the failed run).
--
-- SAFETY: If STEP 2 ever fails on an unexpected duplicate, TiDB reports the
-- conflict and changes nothing; a failed migration is NOT recorded, so it is
-- safe to re-run once the data is clean. This migration deletes only duplicate
-- draft rows and adds one index — nothing else is touched. NEVER run a write
-- path like this against prod by hand; run it only through `npm run migrate`
-- (which announces the target host first).
-- ============================================================================

-- STEP 1 — collapse each user to a single surviving draft row.
DELETE FROM cover_letter_drafts
WHERE _tidb_rowid NOT IN (
    SELECT keep_rid FROM (
        SELECT (
            SELECT c._tidb_rowid
            FROM cover_letter_drafts c
            WHERE c.user_id = u.user_id
            ORDER BY
                (CASE
                    WHEN JSON_VALID(c.draft_data)
                     AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.draft_data, '$.body')), '')) <> ''
                    THEN 1 ELSE 0
                 END) DESC,
                c.updated_at DESC,
                c._tidb_rowid DESC
            LIMIT 1
        ) AS keep_rid
        FROM (SELECT DISTINCT user_id FROM cover_letter_drafts) u
    ) k
);

-- STEP 2 — enforce one draft per user at the database level.
ALTER TABLE cover_letter_drafts
    ADD UNIQUE INDEX uq_cover_letter_drafts_user (user_id);
