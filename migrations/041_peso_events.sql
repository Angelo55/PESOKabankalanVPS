-- Migration 041 — PESO Events / Announcements subsystem.
--
-- WHY: PESO Kabankalan office (interview) — announce upcoming Job Fairs and other
-- employment events to registered Job Seekers. Built as an EXTENSIBLE event
-- subsystem (event_type discriminator), NOT a hard-coded Job Fair feature, so
-- future PESO events reuse the same table, API, and notification path.
--
-- Additive + greenfield (new table, no collision). VARCHAR discriminators/status
-- (not ENUM) so new event types / statuses need no DDL (§13). The banner is stored
-- as base64 in the DB (durable — Render's filesystem is ephemeral, §0.5), never on
-- disk. created_by is the PESO Manager or Staff who authored it (RBAC events:manage).
CREATE TABLE IF NOT EXISTS peso_events (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    created_by        INT NULL,
    event_type        VARCHAR(40)  NOT NULL DEFAULT 'job_fair',
    title             VARCHAR(255) NOT NULL,
    description       TEXT NULL,
    venue             VARCHAR(255) NULL,
    event_date        DATE NULL,
    start_time        VARCHAR(20) NULL,
    end_time          VARCHAR(20) NULL,
    registration_info TEXT NULL,
    banner_image      LONGTEXT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'Draft',
    published_at      DATETIME NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_events_status_date (status, event_date)
);
