const pool = require('../db');
const { LIMITS: QUOTAS } = require('../config/quotas');

/**
 * Supporting-certificate data access (migration 030, Enhancement C).
 *
 * Durable base64 in the DB (invariant 0.5/0.13), mirroring application_resumes.
 * Two homes: `user_certificates` is the applicant's reusable LIBRARY;
 * `application_certificates` is the immutable per-application SNAPSHOT.
 *
 * VALIDATION lives here so both the apply path and the profile library enforce the
 * same limits. Retrieval for administrators is OWNER-SCOPED via the ja→job join.
 */

// Accepted document types + caps. Kept small: a certificate is a page or two.
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
// Sourced from the central quota catalogue (config/quotas.js) so the caps stay in
// lockstep with the /usage indicators.
const MAX_FILE_BYTES = QUOTAS.CERTIFICATE_FILE_BYTES;         // 5 MB per file
const MAX_PER_APPLICATION = QUOTAS.CERTIFICATES_PER_APPLICATION; // per application
const MAX_LIBRARY = QUOTAS.CERTIFICATE_LIBRARY;              // per user's library

/**
 * Validates a decoded certificate. Returns an error string, or null if OK.
 * `base64` is the bare base64 string (no data: prefix).
 */
function validateCertificate({ mimeType, base64 }) {
	if (!base64 || typeof base64 !== 'string') return 'Missing file data.';
	if (!ALLOWED_MIME.has(mimeType)) return 'Only PDF, JPG, PNG, or WEBP files are accepted.';
	const bytes = Buffer.byteLength(base64, 'base64');
	if (bytes <= 0) return 'The file is empty.';
	if (bytes > MAX_FILE_BYTES) return 'Each certificate must be 5 MB or smaller.';
	return null;
}

const certificatesRepository = {
	ALLOWED_MIME,
	MAX_FILE_BYTES,
	MAX_PER_APPLICATION,
	MAX_LIBRARY,
	validateCertificate,

	// ── Application snapshot ────────────────────────────────────────────────

	async saveApplicationCertificate({ applicationId, userCertificateId = null, title, category = null, fileName, mimeType, base64, parsedText = null }, conn = pool) {
		const byteSize = Buffer.byteLength(base64, 'base64');
		const [result] = await conn.query(`
			INSERT INTO application_certificates
				(application_id, user_certificate_id, title, category, file_name, mime_type, byte_size, content_base64, parsed_text)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [applicationId, userCertificateId, String(title || fileName).slice(0, 255), category, String(fileName).slice(0, 255), mimeType, byteSize, base64, parsedText]);
		return result.insertId;
	},

	/** Certificate metadata for an application (NO base64 across the wire). */
	async listForApplication(applicationId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, title, category, file_name, mime_type, byte_size, created_at
			FROM application_certificates
			WHERE application_id = ?
			ORDER BY id ASC
		`, [applicationId]);
		return rows;
	},

	/** How many certs an application already has (for the per-application cap). */
	async countForApplication(applicationId, conn = pool) {
		const [[{ c }]] = await conn.query(
			'SELECT COUNT(*) AS c FROM application_certificates WHERE application_id = ?',
			[applicationId]
		);
		return Number(c) || 0;
	},

	/**
	 * One application certificate's bytes, OWNER-SCOPED: only the admin who owns
	 * the job the application targets can retrieve it. No row → null (404).
	 */
	async findApplicationCertificateForStream(applicationId, certId, employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT ac.file_name, ac.mime_type, ac.content_base64
			FROM application_certificates ac
			JOIN job_applications ja ON ja.id = ac.application_id
			JOIN pesoadmin_job_posts pj ON pj.id = ja.job_id
			WHERE ac.id = ? AND ac.application_id = ? AND pj.peso_admin_id = ?
		`, [certId, applicationId, employerId]);
		return rows[0] || null;
	},

	// ── Certificate text for AI scoring (C.3) ───────────────────────────────

	/** PDF certificates for an application (only PDFs are text-extractable). */
	async listPdfCertsForApplication(applicationId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, title, file_name, parsed_text, content_base64
			FROM application_certificates
			WHERE application_id = ? AND mime_type = 'application/pdf'
		`, [applicationId]);
		return rows;
	},

	/** Caches extracted PDF text so a re-score doesn't re-parse the same cert. */
	async setApplicationCertificateParsedText(certId, text, conn = pool) {
		await conn.query(
			'UPDATE application_certificates SET parsed_text = ? WHERE id = ?',
			[text, certId]
		);
	},

	// ── User library ────────────────────────────────────────────────────────

	async listForUser(userId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, title, category, file_name, mime_type, byte_size, created_at
			FROM user_certificates
			WHERE user_id = ?
			ORDER BY created_at DESC, id DESC
		`, [userId]);
		return rows;
	},

	async countForUser(userId, conn = pool) {
		const [[{ c }]] = await conn.query(
			'SELECT COUNT(*) AS c FROM user_certificates WHERE user_id = ?',
			[userId]
		);
		return Number(c) || 0;
	},

	async saveUserCertificate({ userId, title, category = null, fileName, mimeType, base64, parsedText = null }, conn = pool) {
		const byteSize = Buffer.byteLength(base64, 'base64');
		const [result] = await conn.query(`
			INSERT INTO user_certificates
				(user_id, title, category, file_name, mime_type, byte_size, content_base64, parsed_text)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, [userId, String(title || fileName).slice(0, 255), category, String(fileName).slice(0, 255), mimeType, byteSize, base64, parsedText]);
		return result.insertId;
	},

	/** One of the user's OWN library certificates (owner-scoped by user_id). */
	async findUserCertificate(userId, certId, conn = pool) {
		const [rows] = await conn.query(
			'SELECT * FROM user_certificates WHERE id = ? AND user_id = ?',
			[certId, userId]
		);
		return rows[0] || null;
	},

	async deleteUserCertificate(userId, certId, conn = pool) {
		const [result] = await conn.query(
			'DELETE FROM user_certificates WHERE id = ? AND user_id = ?',
			[certId, userId]
		);
		return result.affectedRows;
	},
};

module.exports = certificatesRepository;
