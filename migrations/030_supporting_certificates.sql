-- ============================================================================
-- 030_supporting_certificates.sql  —  Enhancement C: supporting certificates
--
-- WHAT THIS ADDS
-- Durable storage for applicant supporting documents (TESDA certs, licences,
-- training/seminar certificates, etc.), following the approved "library + snapshot"
-- model and the same durable-base64 pattern as application_resumes (invariant
-- 0.5/0.13):
--   • user_certificates       — the applicant's reusable LIBRARY (managed in Profile).
--   • application_certificates — the immutable per-application SNAPSHOT (a base64
--                                copy taken at apply time, so the admin always sees
--                                exactly what was submitted even if the library
--                                cert is later changed or deleted).
-- `parsed_text` is reserved for the optional "certs feed the AI score" step (C.3):
-- extracted PDF text that Enhancement B's re-scoring can fold into the prompt.
--
-- SAFETY: additive only, CREATE TABLE IF NOT EXISTS — instant metadata change on
-- TiDB, no downtime, no touch to existing tables, safe to re-run. Base64 lives in
-- the DB (never on the ephemeral /uploads disk, which is public + wiped on deploy).
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_certificates (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    title          VARCHAR(255) NOT NULL,
    category       VARCHAR(60) NULL,             -- e.g. TESDA | License | Seminar | Training | Other
    file_name      VARCHAR(255) NOT NULL,
    mime_type      VARCHAR(100) NOT NULL,
    byte_size      INT NOT NULL DEFAULT 0,
    content_base64 LONGTEXT NOT NULL,
    parsed_text    LONGTEXT NULL,                -- PDF text, for optional AI-feed (C.3)
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_certificates_user (user_id)
);

CREATE TABLE IF NOT EXISTS application_certificates (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    application_id      INT NOT NULL,
    user_certificate_id INT NULL,                -- provenance (which library cert), if any
    title               VARCHAR(255) NOT NULL,
    category            VARCHAR(60) NULL,
    file_name           VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(100) NOT NULL,
    byte_size           INT NOT NULL DEFAULT 0,
    content_base64      LONGTEXT NOT NULL,
    parsed_text         LONGTEXT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_app_certificates_app (application_id)
);
