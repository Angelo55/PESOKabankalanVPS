-- ============================================================================
-- 023_referral_outcomes.sql
--
-- Placement outcome tracking. This is the phase that turns a letter generator
-- into a referral management system.
--
-- ── The problem ─────────────────────────────────────────────────────────────
-- referral_queue.status ends at 'Approved'. Nothing models what happens after
-- the letter is emailed, which is the part PESO is actually mandated to care
-- about: did this citizen get the job?
--
-- The consequence had already leaked into the product. The landing page counted
-- "Successful Referrals" as approved referral_queue rows, so a referral the
-- employer ignored was reported publicly as a success. A government placement
-- metric was being computed from "we sent a PDF". This migration is what makes
-- that tile honest (see the jobBoardRoutes change in the same commit).
--
-- ── Why a separate table, not an appended enum on referral_queue ────────────
-- Approval state and placement state are independent facts that move on
-- different timescales and are set by different events. Folding them into one
-- column makes "approved but outcome unknown" unrepresentable, and every
-- existing query that filters status = 'Approved' would silently change meaning
-- the moment an outcome was recorded. A separate table leaves all 27 existing
-- rows and every query touching them exactly as they are.
--
-- ── How outcomes are captured ───────────────────────────────────────────────
-- PESO confirmed that employers EMAIL the office when a referred applicant is
-- hired. So this is an admin-entered form, not an employer portal: whoever
-- reads the mail records the outcome. That is why recorded_by is an admin user
-- and why outcome_at is separate from recorded_at -- the email usually arrives
-- days after the actual hiring, and the report needs the real date.
--
-- ── Backward compatibility ──────────────────────────────────────────────────
-- A referral with no row here has an unknown outcome, which is the truthful
-- state for all 27 existing referrals -- nobody recorded them at the time. They
-- are NOT backfilled as 'Hired', because that would invent placement data. The
-- read path treats a missing row as 'Issued'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_outcomes (
	id INT AUTO_INCREMENT PRIMARY KEY,
	queue_id INT NOT NULL,

	-- Ordered roughly by progression, but NOT enforced as a state machine:
	-- real life skips steps. An employer often reports "hired" with no prior
	-- acknowledgement, and forcing the intermediate states would make the admin
	-- record events that never happened.
	--
	-- Append-only if extended (TiDB allows adding at the END of the list only).
	outcome ENUM(
		'Issued',
		'Employer Acknowledged',
		'Interview Scheduled',
		'Hired',
		'Not Hired',
		'Withdrawn',
		'No Response'
	) NOT NULL DEFAULT 'Issued',

	-- When the real-world event happened, as reported by the employer. Distinct
	-- from recorded_at, which is when PESO typed it in. Reports must use this.
	outcome_at DATETIME NULL DEFAULT NULL,

	-- The administrator who recorded it. SET NULL rather than CASCADE: an
	-- outcome is a fact about a placement and must survive the staff member who
	-- entered it leaving.
	recorded_by INT NULL DEFAULT NULL,
	recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

	-- Free text: "employer emailed 2026-07-20, started Monday", "declined the
	-- offer", "employer never replied after two follow-ups".
	notes TEXT NULL,

	-- CURRENT outcome, one per referral. History lives in
	-- referral_activity_log via OUTCOME_RECORDED entries, which is already the
	-- audit trail for everything else in this module -- a second history table
	-- would be a second place to look.
	CONSTRAINT uq_rout_queue UNIQUE (queue_id),
	CONSTRAINT fk_rout_queue FOREIGN KEY (queue_id) REFERENCES referral_queue(id) ON DELETE CASCADE,
	CONSTRAINT fk_rout_recorder FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,

	-- Serves the placement-rate and monthly-count reports DOLE requires.
	INDEX idx_rout_outcome_date (outcome, outcome_at)
);
