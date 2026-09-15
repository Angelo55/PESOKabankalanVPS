-- ============================================================================
-- Migration: 003_normalize_user_roles
--
-- THE PROBLEM
-- -----------
-- users.role currently holds legacy values:
--     applicant    18
--     peso_admin    6
--     super_admin   2
--
-- But the entire codebase treats applicant/employer/admin as canonical
-- (rbac.js ROLE_KEYS). The gap is bridged at runtime by normalizeRole(), which
-- means anything going through requireAuth/requireRole works -- and anything
-- comparing roles in RAW SQL silently does not:
--
--   adminRoutes.js:86   counts users WHERE role = 'employer'  -> always 0
--   adminRoutes.js:262  filters role IN ('applicant','employer','admin')
--                       -> silently drops all 8 non-applicants
--   authRoutes.js:129   INSERTs role = 'employer' on registration
--                       -> fails outright against the current ENUM
--
-- THE FIX
-- -------
-- Statement 1 widens the column from ENUM to VARCHAR(50). This MUST come
-- first: you cannot write 'employer' into an ENUM that has no such member.
-- Converting ENUM -> VARCHAR preserves the stored strings exactly.
--
-- VARCHAR, not a wider ENUM, because:
--   - db.js already declares this column as VARCHAR(50). We are honouring the
--     code's stated intent, not inventing a new one.
--   - Role validation belongs in rbac.js (ROLE_ALIASES / normalizeRole), where
--     it already lives. A DB-level ENUM is duplicate validation that can only
--     ever drift out of sync with it -- as it just did.
--   - Adding a role to an ENUM means a DDL migration against every user row.
--     With VARCHAR it is a one-line code change.
--
-- Statements 2-3 rename the 8 legacy rows to the canonical keys.
--
-- IDEMPOTENCY
-- -----------
-- Re-running is safe. Statement 1 is a no-op if the column is already
-- VARCHAR(50). Statements 2-3 match zero rows once normalized.
--
-- AFTER THIS RUNS
-- ---------------
-- No application code changes are needed. rbac.js normalizeRole() already maps
-- BOTH the old and new spellings to the same canonical key, so existing JWTs
-- carrying role='peso_admin' keep working until they expire. No forced logout.
-- ============================================================================

ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'applicant';

UPDATE users SET role = 'employer' WHERE role IN ('peso_admin', 'peso_administrator');
UPDATE users SET role = 'admin' WHERE role IN ('super_admin', 'super_administrator');


