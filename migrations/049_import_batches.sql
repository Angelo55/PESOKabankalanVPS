-- Migration 049 — Import Past Applications: import-batch audit + idempotency.
--
-- WHY: the refactored "Import Past Applications" pipeline (docs/data-processing-modules-
-- proposal.md, Phase B) records ONE row per committed import for (a) idempotency — a
-- repeated commit of the same client-generated `import_id` is a no-op, guarding double
-- clicks / refresh / retry — and (b) a lightweight history + the daily-import rate limit.
-- It stores COUNTS only (no raw CSV — normalized application rows go into usertrackedjobs).
--
-- The UNIQUE (user_id, import_id) is the idempotency key. Additive, greenfield table.
CREATE TABLE IF NOT EXISTS import_batches (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    import_id      VARCHAR(64) NOT NULL,
    file_name      VARCHAR(255) NULL,
    total_rows     INT NOT NULL DEFAULT 0,
    valid_rows     INT NOT NULL DEFAULT 0,
    duplicate_rows INT NOT NULL DEFAULT 0,
    invalid_rows   INT NOT NULL DEFAULT 0,
    imported_rows  INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_import_batches_user_import (user_id, import_id),
    INDEX idx_import_batches_user_created (user_id, created_at)
);
