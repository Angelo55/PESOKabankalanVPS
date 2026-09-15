-- ============================================================================
-- Migration: 013_job_board_and_application_extras
--
-- Supports three product features:
--   1. Category-based browsing of the job board. `category` is a first-class
--      field distinct from the free-text `department` -- the public board and
--      admin filters group by it, falling back to `department` for legacy rows.
--   2. The multi-step Apply wizard. Applications now carry a per-application
--      snapshot of the applicant's personal info (they may review/edit before
--      submitting WITHOUT mutating their profile), plus an optional cover letter
--      (pasted text or an uploaded file path; resume_url already exists).
--   3. Job-specific "Additional Questions" configured by the PESO admin and
--      answered by the applicant in the wizard.
--
-- Idempotent: ADD COLUMN / CREATE TABLE IF NOT EXISTS are no-ops when already
-- present (TiDB v6.6.0+). DDL is not transactional, so each statement stands
-- alone. The same changes are also applied defensively at route-load time
-- (ensureJobBoardSchema in jobBoardRoutes.js) so the feature works even if this
-- migration has not been run yet.
-- ============================================================================

-- 1. Category on job posts
ALTER TABLE pesoadmin_job_posts
	ADD COLUMN IF NOT EXISTS category VARCHAR(100) NULL DEFAULT NULL;

-- 2. Application extras: personal-info snapshot + cover letter
ALTER TABLE job_applications
	ADD COLUMN IF NOT EXISTS applicant_snapshot TEXT NULL,
	ADD COLUMN IF NOT EXISTS cover_letter_text TEXT NULL,
	ADD COLUMN IF NOT EXISTS cover_letter_url VARCHAR(512) NULL DEFAULT NULL;

-- 3. Job-specific additional questions (configured by PESO admin)
CREATE TABLE IF NOT EXISTS job_application_questions (
	id INT AUTO_INCREMENT PRIMARY KEY,
	job_id INT NOT NULL,
	question_text VARCHAR(500) NOT NULL,
	question_type ENUM('text', 'textarea', 'select', 'boolean') NOT NULL DEFAULT 'text',
	options TEXT NULL,               -- JSON array of choices for 'select'
	is_required BOOLEAN NOT NULL DEFAULT TRUE,
	sort_order INT NOT NULL DEFAULT 0,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_jaq_job FOREIGN KEY (job_id) REFERENCES pesoadmin_job_posts(id) ON DELETE CASCADE
);

-- 4. Applicant answers to those questions
CREATE TABLE IF NOT EXISTS job_application_answers (
	id INT AUTO_INCREMENT PRIMARY KEY,
	application_id INT NOT NULL,
	question_id INT NOT NULL,
	answer_text TEXT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_jaa_application FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE,
	CONSTRAINT fk_jaa_question FOREIGN KEY (question_id) REFERENCES job_application_questions(id) ON DELETE CASCADE
);
