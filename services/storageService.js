/**
 * Centralized, environment-aware object storage.
 * Blueprint: docs/cloud-storage-proposal.md (Cloudflare R2 as production storage).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Uploaded FILES that were written to the local `uploads/` directory (job featured
 * images) work on a dev laptop but VANISH in production, because Render's filesystem
 * is ephemeral (wiped on every deploy) and the deployed frontend/backend cannot reach
 * a developer's disk. This is the ONE place every upload-writing module goes through,
 * so no module keeps its own filesystem assumption.
 *
 * ── DRIVER (env only, never hardcoded) ──────────────────────────────────────
 * `STORAGE_DRIVER` selects the backend:
 *   - 'local' (default)  → the on-disk `uploads/` dir, served by express.static('/uploads').
 *                          Correct for localhost/dev; NOT durable on Render.
 *   - 'r2'               → Cloudflare R2 (S3-compatible) via @aws-sdk/client-s3.
 *                          Durable + reachable from the deployed app. Set this on Render.
 *
 * A saved asset ALWAYS returns a STABLE reference the frontend consumes as-is
 * (see jobs/jobImage.js `resolveJobImage`, which prefixes a relative path with the API
 * host and uses a full URL verbatim):
 *   - local → a server-relative '/uploads/<key>'
 *   - r2    → a full 'https://<public-base>/<key>' URL
 *
 * ── SECURITY ────────────────────────────────────────────────────────────────
 * Credentials + bucket config come EXCLUSIVELY from env (R2_*), never from code and
 * never sent to the browser — the frontend only ever sees the resulting public URL.
 * Job featured images are public marketing content, so R2 uses a PUBLIC bucket base
 * (R2_PUBLIC_BASE_URL). PII binaries (résumés, referral letters, certificates) are NOT
 * handled here — they stay base64-in-DB and, when migrated, will use a PRIVATE bucket
 * + presigned URLs (proposal §4/§5).
 *
 * ── CONTRACT ────────────────────────────────────────────────────────────────
 * Validation / MIME allow-list / size limits stay at the ROUTE (multer), never here.
 * `remove()` is best-effort and NEVER throws (a failed cleanup must not fail the action,
 * invariant 0.1). `save()` throws on a real write failure so the route can 500 honestly.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

// R2 config — all from env. R2_PUBLIC_BASE_URL is the bucket's public origin
// (an r2.dev subdomain or a custom domain), used to build the returned URL.
const R2 = {
	accountId: process.env.R2_ACCOUNT_ID || '',
	accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
	secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
	bucket: process.env.R2_BUCKET || '',
	publicBase: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
};

let _r2Client = null; // lazily created so `local` dev never needs the AWS SDK installed

function r2Configured() {
	return Boolean(R2.accountId && R2.accessKeyId && R2.secretAccessKey && R2.bucket && R2.publicBase);
}

function getR2Client() {
	if (_r2Client) return _r2Client;
	// Lazy require: the dependency is only needed when R2 is actually used.
	const { S3Client } = require('@aws-sdk/client-s3');
	_r2Client = new S3Client({
		region: 'auto',
		endpoint: `https://${R2.accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId: R2.accessKeyId, secretAccessKey: R2.secretAccessKey },
		forcePathStyle: true, // recommended for R2
	});
	return _r2Client;
}

/**
 * Normalize a storage key: forward slashes, no leading slash, no '..' segments
 * (defense-in-depth against path traversal in the local provider). Keys are built
 * from server-controlled values (ids + timestamps), but this stays safe regardless.
 */
function safeKey(key) {
	const clean = String(key || '')
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.split('/')
		.filter((seg) => seg && seg !== '.' && seg !== '..')
		.join('/');
	if (!clean) throw new Error('storageService: empty key');
	return clean;
}

// ── local provider ──────────────────────────────────────────────────────────
async function localSave(key, buffer) {
	const abs = path.join(UPLOADS_ROOT, key);
	await fsp.mkdir(path.dirname(abs), { recursive: true });
	await fsp.writeFile(abs, buffer);
	return `/uploads/${key}`;
}

async function localRemove(ref) {
	// ref is a '/uploads/<key>' path. Resolve WITHIN uploads/ only.
	const rel = ref.replace(/^\/uploads\//, '');
	const key = safeKey(rel);
	await fsp.unlink(path.join(UPLOADS_ROOT, key)).catch(() => {});
}

// ── r2 provider ───────────────────────────────────────────────────────────────
async function r2Save(key, buffer, contentType) {
	if (!r2Configured()) {
		throw new Error('storageService: STORAGE_DRIVER=r2 but R2_* env vars are not fully set.');
	}
	const { PutObjectCommand } = require('@aws-sdk/client-s3');
	await getR2Client().send(new PutObjectCommand({
		Bucket: R2.bucket,
		Key: key,
		Body: buffer,
		ContentType: contentType || 'application/octet-stream',
		CacheControl: 'public, max-age=31536000, immutable',
	}));
	return `${R2.publicBase}/${key}`;
}

async function r2Remove(ref) {
	if (!r2Configured()) return;
	const key = safeKey(ref.slice(R2.publicBase.length + 1));
	const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
	await getR2Client().send(new DeleteObjectCommand({ Bucket: R2.bucket, Key: key })).catch(() => {});
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Persist a binary and return a STABLE, frontend-consumable reference (a
 * '/uploads/…' path in local mode, a full public URL in r2 mode).
 * @param {string} key         e.g. 'job-featured/job-12-1699999999999.jpg'
 * @param {Buffer} buffer      the file bytes (multer memoryStorage → req.file.buffer)
 * @param {string} contentType the validated MIME type (req.file.mimetype)
 */
async function save(key, buffer, contentType) {
	const k = safeKey(key);
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('storageService: empty buffer');
	return DRIVER === 'r2' ? r2Save(k, buffer, contentType) : localSave(k, buffer);
}

/**
 * Best-effort delete of a previously saved reference. Driver-agnostic: it inspects the
 * ref shape so switching drivers never orphans or throws. NEVER throws (invariant 0.1).
 */
async function remove(ref) {
	if (!ref || typeof ref !== 'string') return;
	try {
		if (ref.startsWith('/uploads/')) return await localRemove(ref);
		if (R2.publicBase && ref.startsWith(`${R2.publicBase}/`)) return await r2Remove(ref);
		// Unknown/legacy shape (e.g. a base64 data URI or an external URL) — nothing to clean.
	} catch (_) { /* best-effort: a cleanup failure must not fail the caller's action */ }
}

/** Driver + config visibility for /admin/health and boot logging. */
function getStatus() {
	return {
		driver: DRIVER,
		r2Configured: r2Configured(),
		// Never leak secrets — only booleans + the public base (which is already public).
		publicBase: DRIVER === 'r2' ? R2.publicBase : null,
	};
}

module.exports = { save, remove, getStatus, DRIVER };
