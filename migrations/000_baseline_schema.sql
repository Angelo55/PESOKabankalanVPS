-- ============================================================================
-- Migration: 000_baseline_schema
-- Origin:    Extracted from 2026-07-01-role-and-job-seeker-verification.sql
-- Purpose:   Job seeker verification workflow schema.
--
-- WHAT WAS REMOVED FROM THE ORIGINAL, AND WHY
-- -------------------------------------------
-- 1. The `user_verifications` backfill (final statement). That source table
--    exists in neither MariaDB nor TiDB. Its work is done and its input is
--    gone. Retired, not repaired.
--
-- 2. The three role-normalization UPDATE statements. They are NOT dead -- the
--    database really does still hold peso_admin (6) and super_admin (2) -- but
--    they cannot run here: users.role is an ENUM without an 'employer' member,
--    so the UPDATE fails on the SET with warning 1265 (Data truncated), which
--    strict mode promotes to an error. Role normalization needs a column type
--    change FIRST. It is therefore a migration of its own:
--    003_normalize_user_roles.sql.
--
-- 3. `ALTER TABLE users ADD COLUMN IF NOT EXISTS role ...`. The column already
--    exists and is an ENUM, not the VARCHAR(50) the statement claims. IF NOT
--    EXISTS made it a silent no-op, so the original migration was operating on
--    a schema it believed it had created but had not -- which is precisely how
--    the ENUM/VARCHAR mismatch survived undetected. The real type change now
--    happens explicitly in 003.
--
-- Everything below is idempotent. On the current TiDB it is a complete no-op:
-- all three tables already exist and job_seeker_verifications has 3 rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS verification_id_types (
	id INT AUTO_INCREMENT PRIMARY KEY,
	name VARCHAR(120) NOT NULL UNIQUE,
	is_active BOOLEAN DEFAULT TRUE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO verification_id_types (name) VALUES
('Philippine National ID (PhilSys ID)'),
('Passport'),
('Driver''s License'),
('UMID'),
('Postal ID'),
('PRC ID'),
('Voter''s ID'),
('PhilHealth ID'),
('SSS ID'),
('GSIS ID'),
('Senior Citizen ID'),
('PWD ID'),
('Other government-issued ID');

CREATE TABLE IF NOT EXISTS job_seeker_verifications (
	id INT AUTO_INCREMENT PRIMARY KEY,
	user_id INT NOT NULL UNIQUE,
	verification_status ENUM('Not Submitted', 'Pending', 'Approved', 'Rejected', 'Requires Additional Information') DEFAULT 'Not Submitted',
	submitted_id_type VARCHAR(120),
	document_path TEXT,
	submitted_at TIMESTAMP NULL DEFAULT NULL,
	reviewed_by INT NULL,
	reviewed_at TIMESTAMP NULL DEFAULT NULL,
	review_remarks TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT fk_jsv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_jsv_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS verification_history (
	id INT AUTO_INCREMENT PRIMARY KEY,
	verification_id INT NOT NULL,
	user_id INT NOT NULL,
	action VARCHAR(80) NOT NULL,
	status VARCHAR(80) NOT NULL,
	remarks TEXT,
	performed_by INT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_vh_verification FOREIGN KEY (verification_id) REFERENCES job_seeker_verifications(id) ON DELETE CASCADE,
	CONSTRAINT fk_vh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_vh_performer FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
);


