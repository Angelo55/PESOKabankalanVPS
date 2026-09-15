-- ============================================================================
-- Migration: 001_referral_module
-- Target:    TiDB (MySQL 8.0 compatible)
-- Purpose:   Schema for automated referral letter generation and delivery.
-- Safety:    Additive only. No existing table is altered or dropped.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- referral_queue
-- The business record. One row per applicant referred for a job.
-- This is the system of record PESO can audit. It answers:
--   "who was referred, to what, by whom, when, and on what basis?"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_queue (
	id INT AUTO_INCREMENT PRIMARY KEY,
	application_id INT NOT NULL,
	match_score DECIMAL(5,2) NULL,
	ai_recommendation TEXT NULL,
	status ENUM('Pending AI', 'Pending Review', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending AI',
	reviewed_by INT NULL,
	reviewed_at TIMESTAMP NULL DEFAULT NULL,
	remarks TEXT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT uq_refq_application UNIQUE (application_id),
	CONSTRAINT fk_refq_application FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE,
	CONSTRAINT fk_refq_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
	INDEX idx_refq_status (status)
);

-- ----------------------------------------------------------------------------
-- referral_letters
-- The generated artifact. One row per PDF produced for a referral.
-- Separated from referral_queue because a referral is a DECISION, while a
-- letter is a DOCUMENT. A referral can be re-issued (corrected name, updated
-- employer contact) without inventing a second referral decision.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_letters (
	id INT AUTO_INCREMENT PRIMARY KEY,
	queue_id INT NOT NULL,
	reference_number VARCHAR(100) NOT NULL,
	pdf_path VARCHAR(500) NULL,
	email_status ENUM('Pending', 'Sent', 'Failed') NOT NULL DEFAULT 'Pending',
	sent_at TIMESTAMP NULL DEFAULT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT uq_refl_reference UNIQUE (reference_number),
	CONSTRAINT fk_refl_queue FOREIGN KEY (queue_id) REFERENCES referral_queue(id) ON DELETE CASCADE,
	INDEX idx_refl_queue (queue_id)
);

-- ----------------------------------------------------------------------------
-- referral_jobs  --  THE TRANSACTIONAL OUTBOX
-- This single table is what makes the whole workflow crash-safe.
--
-- One row per referral. `step` records how far the pipeline got, so a retry
-- RESUMES rather than restarting -- critical, because re-running `send_email`
-- would email the applicant twice.
--
-- Claiming is done with a conditional UPDATE, not SELECT ... FOR UPDATE,
-- because TiDB does not support SKIP LOCKED.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_jobs (
	id INT AUTO_INCREMENT PRIMARY KEY,
	queue_id INT NOT NULL,
	step ENUM('generate_pdf', 'send_email', 'notify', 'dispatch_n8n', 'done') NOT NULL DEFAULT 'generate_pdf',
	status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
	attempts INT NOT NULL DEFAULT 0,
	max_attempts INT NOT NULL DEFAULT 5,
	last_error TEXT NULL,
	next_run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	worker_id VARCHAR(64) NULL,
	locked_at TIMESTAMP NULL DEFAULT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT uq_refjobs_queue UNIQUE (queue_id),
	CONSTRAINT fk_refjobs_queue FOREIGN KEY (queue_id) REFERENCES referral_queue(id) ON DELETE CASCADE,
	INDEX idx_refjobs_claim (status, next_run_at)
);

-- ----------------------------------------------------------------------------
-- referral_activity_log
-- Append-only audit trail. Every state change, every attempt, every failure.
-- This is what you show the panel when they ask "how do you know it worked?"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_activity_log (
	id INT AUTO_INCREMENT PRIMARY KEY,
	queue_id INT NOT NULL,
	actor_id INT NULL,
	action VARCHAR(80) NOT NULL,
	detail TEXT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_reflog_queue FOREIGN KEY (queue_id) REFERENCES referral_queue(id) ON DELETE CASCADE,
	CONSTRAINT fk_reflog_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
	INDEX idx_reflog_queue (queue_id)
);

-- ----------------------------------------------------------------------------
-- notifications
-- Generic in-app notification store. Does not exist anywhere in the current
-- schema -- NotificationContext.jsx on the frontend currently has no table to
-- persist against. The referral module needs it, so it is created here and
-- deliberately kept generic for reuse by other modules.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
	id INT AUTO_INCREMENT PRIMARY KEY,
	user_id INT NOT NULL,
	type VARCHAR(60) NOT NULL,
	title VARCHAR(200) NOT NULL,
	body TEXT NULL,
	link VARCHAR(255) NULL,
	is_read BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	INDEX idx_notif_user_read (user_id, is_read, created_at)
);