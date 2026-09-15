-- Hi-Re role hierarchy and verification workflow migration
-- Internal role keys are preserved for backward compatibility:
--   employer -> PESO Administrator
--   admin    -> Super Administrator

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'applicant',
    ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) DEFAULT 'Active';

UPDATE users SET role = 'applicant' WHERE role IS NULL OR role = '';
UPDATE users SET role = 'employer' WHERE role IN ('peso_administrator', 'peso_admin');
UPDATE users SET role = 'admin' WHERE role IN ('super_administrator', 'super_admin');

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

INSERT INTO job_seeker_verifications (user_id, verification_status, submitted_id_type, document_path, submitted_at, review_remarks)
SELECT
    uv.user_id,
    COALESCE(uv.verification_status, 'Pending'),
    'Legacy PWD ID',
    uv.document_path,
    COALESCE(uv.submitted_at, CURRENT_TIMESTAMP),
    uv.remarks
FROM user_verifications uv
JOIN users u ON u.id = uv.user_id
WHERE uv.role_type = 'applicant'
  AND u.role = 'applicant'
ON DUPLICATE KEY UPDATE
    verification_status = VALUES(verification_status),
    document_path = COALESCE(job_seeker_verifications.document_path, VALUES(document_path)),
    submitted_at = COALESCE(job_seeker_verifications.submitted_at, VALUES(submitted_at)),
    review_remarks = COALESCE(job_seeker_verifications.review_remarks, VALUES(review_remarks));
