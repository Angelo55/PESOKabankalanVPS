/**
 * Centralized, environment-aware object storage.
 * Blueprint: docs/cloud-storage-proposal.md, docs/post-launch-roadmap.md (Phase 2).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The ONE place every upload-writing module goes through, so no module keeps its
 * own filesystem/base64 assumption. Two sensitivity tiers:
 *   • PUBLIC  (job images, avatars)  → save()/remove(), served by a public URL.
 *   • PRIVATE (résumé PDFs / PII)    → savePrivate()/getPrivate()/removePrivate(),
 *     NEVER a public URL — streamed back only through an authenticated API route.
 *
 * ── DRIVER (env only, never hardcoded) ──────────────────────────────────────
 * `STORAGE_DRIVER`:
 *   - 'local' (default) → PUBLIC to uploads/ (express.static '/uploads'); PRIVATE to
 *                         storage/private/ (NOT served — streamed via the API). Durable
 *                         on a real disk (VPS); ephemeral on Render.
 *   - 'r2'              → Cloudflare R2 (S3). PUBLIC bucket = R2_BUCKET (public base
 *                         R2_PUBLIC_BASE_URL); PRIVATE bucket = R2_PRIVATE_BUCKET.
 *   - 'supabase'        → Supabase Storage (S3-compatible). PUBLIC bucket
 *                         SUPABASE_BUCKET_PUBLIC (public base SUPABASE_PUBLIC_BASE);
 *                         PRIVATE bucket SUPABASE_BUCKET_PRIVATE.
 * r2 + supabase share ONE S3 code path (both are S3); only endpoint/creds/buckets differ.
 *
 * A PUBLIC save() returns a STABLE, frontend-consumable reference:
 *   - local    → '/uploads/<key>'
 *   - r2       → '<R2_PUBLIC_BASE_URL>/<key>'
 *   - supabase → '<SUPABASE_PUBLIC_BASE>/<publicBucket>/<key>'
 * A PRIVATE savePrivate() returns an OPAQUE storage key; getPrivate(key) streams it back.
 *
 * ── CONTRACT ────────────────────────────────────────────────────────────────
 * Validation / MIME allow-list / size limits stay at the ROUTE (multer), never here.
 * remove()/removePrivate() are best-effort and NEVER throw (invariant 0.1). save()/
 * savePrivate() throw on a real write failure so the route can fall back (base64) or 500.
 * Credentials come EXCLUSIVELY from env, never sent to the browser.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');            // PUBLIC (served)
const PRIVATE_ROOT = path.join(__dirname, '..', 'storage', 'private');  // PRIVATE (never served)

// ── S3-compatible config (r2 | supabase) ────────────────────────────────────
function s3cfg() {
	if (DRIVER === 'r2') {
		return {
			endpoint: `https://${process.env.R2_ACCOUNT_ID || ''}.r2.cloudflarestorage.com`,
			region: 'auto',
			accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
			publicBucket: process.env.R2_BUCKET || '',
			publicBase: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
			publicBaseHasBucket: true, // R2 public base already points AT the bucket
			privateBucket: process.env.R2_PRIVATE_BUCKET || process.env.R2_BUCKET || '',
		};
	}
	if (DRIVER === 'supabase') {
		return {
			endpoint: (process.env.SUPABASE_S3_ENDPOINT || '').replace(/\/+$/, ''),
			region: process.env.SUPABASE_S3_REGION || 'ap-southeast-1',
			accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID || '',
			secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '',
			publicBucket: process.env.SUPABASE_BUCKET_PUBLIC || 'avatars',
			publicBase: (process.env.SUPABASE_PUBLIC_BASE || '').replace(/\/+$/, ''), // .../object/public
			publicBaseHasBucket: false, // Supabase public base needs '/<bucket>/<key>'
			privateBucket: process.env.SUPABASE_BUCKET_PRIVATE || 'resumes',
		};
	}
	return null;
}

function s3Configured() {
	const c = s3cfg();
	return Boolean(c && c.endpoint && c.accessKeyId && c.secretAccessKey && c.publicBucket && c.privateBucket);
}

let _s3 = null;
function s3Client() {
	if (_s3) return _s3;
	const c = s3cfg();
	const { S3Client } = require('@aws-sdk/client-s3');
	_s3 = new S3Client({
		region: c.region,
		endpoint: c.endpoint,
		credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
		forcePathStyle: true, // required by both R2 and Supabase Storage
	});
	return _s3;
}

function publicUrlFor(c, key) {
	return c.publicBaseHasBucket ? `${c.publicBase}/${key}` : `${c.publicBase}/${c.publicBucket}/${key}`;
}

// ── key hygiene (defense-in-depth against traversal) ─────────────────────────
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

async function s3Put(bucket, key, buffer, contentType) {
	if (!s3Configured()) throw new Error(`storageService: STORAGE_DRIVER=${DRIVER} but its S3 env vars are not fully set.`);
	const { PutObjectCommand } = require('@aws-sdk/client-s3');
	await s3Client().send(new PutObjectCommand({
		Bucket: bucket, Key: key, Body: buffer,
		ContentType: contentType || 'application/octet-stream',
		CacheControl: 'public, max-age=31536000, immutable',
	}));
}

async function s3Delete(bucket, key) {
	if (!s3Configured()) return;
	const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
	await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
}

// ── PUBLIC API ───────────────────────────────────────────────────────────────

/** Persist a PUBLIC binary; returns a stable frontend-consumable reference (URL/path). */
async function save(key, buffer, contentType) {
	const k = safeKey(key);
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('storageService: empty buffer');
	if (DRIVER === 'r2' || DRIVER === 'supabase') {
		const c = s3cfg();
		await s3Put(c.publicBucket, k, buffer, contentType);
		return publicUrlFor(c, k);
	}
	const abs = path.join(UPLOADS_ROOT, k);
	await fsp.mkdir(path.dirname(abs), { recursive: true });
	await fsp.writeFile(abs, buffer);
	return `/uploads/${k}`;
}

/** Best-effort delete of a PUBLIC ref (URL or '/uploads/…'). NEVER throws (0.1). */
async function remove(ref) {
	if (!ref || typeof ref !== 'string') return;
	try {
		if (ref.startsWith('/uploads/')) {
			await fsp.unlink(path.join(UPLOADS_ROOT, safeKey(ref.replace(/^\/uploads\//, '')))).catch(() => {});
			return;
		}
		if (DRIVER === 'r2' || DRIVER === 'supabase') {
			const c = s3cfg();
			if (c.publicBase && ref.startsWith(`${c.publicBase}/`)) {
				let rest = ref.slice(c.publicBase.length + 1);
				if (!c.publicBaseHasBucket && rest.startsWith(`${c.publicBucket}/`)) rest = rest.slice(c.publicBucket.length + 1);
				await s3Delete(c.publicBucket, safeKey(rest));
			}
		}
		// Unknown/legacy shape (base64 data URI, external URL) — nothing to clean.
	} catch (_) { /* best-effort */ }
}

/** Persist a PRIVATE binary; returns an OPAQUE storage key (store it, stream via getPrivate). */
async function savePrivate(key, buffer, contentType) {
	const k = safeKey(key);
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('storageService: empty buffer');
	if (DRIVER === 'r2' || DRIVER === 'supabase') {
		await s3Put(s3cfg().privateBucket, k, buffer, contentType);
		return k;
	}
	const abs = path.join(PRIVATE_ROOT, k);
	await fsp.mkdir(path.dirname(abs), { recursive: true });
	await fsp.writeFile(abs, buffer);
	return k;
}

/**
 * Fetch a PRIVATE object for streaming back through an AUTHENTICATED route.
 * Returns { stream, contentType, contentLength } — the caller sets headers and pipes.
 * Throws if the object is missing so the route can 404 honestly.
 */
async function getPrivate(key) {
	const k = safeKey(key);
	if (DRIVER === 'r2' || DRIVER === 'supabase') {
		const { GetObjectCommand } = require('@aws-sdk/client-s3');
		const res = await s3Client().send(new GetObjectCommand({ Bucket: s3cfg().privateBucket, Key: k }));
		return { stream: res.Body, contentType: res.ContentType || 'application/octet-stream', contentLength: res.ContentLength };
	}
	const abs = path.join(PRIVATE_ROOT, k);
	const stat = await fsp.stat(abs); // throws ENOENT if missing → route 404s
	return { stream: fs.createReadStream(abs), contentType: 'application/octet-stream', contentLength: stat.size };
}

/** Best-effort delete of a PRIVATE key. NEVER throws (0.1). */
async function removePrivate(key) {
	if (!key || typeof key !== 'string') return;
	try {
		const k = safeKey(key);
		if (DRIVER === 'r2' || DRIVER === 'supabase') return await s3Delete(s3cfg().privateBucket, k);
		await fsp.unlink(path.join(PRIVATE_ROOT, k)).catch(() => {});
	} catch (_) { /* best-effort */ }
}

/** Driver + config visibility for /admin/health and boot logging (no secrets). */
function getStatus() {
	const c = s3cfg();
	return {
		driver: DRIVER,
		s3Configured: DRIVER === 'local' ? true : s3Configured(),
		publicBucket: c ? c.publicBucket : null,
		privateBucket: c ? c.privateBucket : null,
		publicBase: c ? c.publicBase : null,
	};
}

module.exports = { save, remove, savePrivate, getPrivate, removePrivate, getStatus, DRIVER };
