-- Migration 043 — Walk-In Job Seeker registration (#7).
--
-- WHY: PESO Manager (Ma'am Elma) — staff must be able to encode applicants who
-- physically visit the office and have no online account yet, into the SAME
-- centralized Job Seeker model (a real users row, role='applicant') rather than a
-- separate record system. These columns mark such a row as staff-encoded and
-- CLAIMABLE later, once the seeker has a Gmail / online access.
--
-- Additive + idempotent. account_origin distinguishes walk-in rows from self-signups
-- (every pre-existing row defaults to 'self', so nothing changes for them). phone /
-- gender already exist on users. consent_given_at records the Data Privacy Act
-- consent captured at encoding time. Feature ships behind walk_in_registration_enabled.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS account_origin   VARCHAR(20) NOT NULL DEFAULT 'self',
    ADD COLUMN IF NOT EXISTS claim_status      VARCHAR(20) NOT NULL DEFAULT 'n/a',
    ADD COLUMN IF NOT EXISTS encoded_by        INT NULL,
    ADD COLUMN IF NOT EXISTS claim_token       VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS claimed_at        DATETIME NULL,
    ADD COLUMN IF NOT EXISTS consent_given_at  DATETIME NULL;
