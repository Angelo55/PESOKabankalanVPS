/**
 * PROFILE & IDENTITY — the job seeker's own record.
 *
 * WHAT: personal details, work preferences, verification identity, the profile
 * picture, and the AI resume-analysis upload that populates the Unified Profile.
 *
 * WHEN: the "Identity & Profile" page, plus the avatar reads that every other
 * module depends on.
 *
 * ── AVATARS: ONE ENDPOINT, TWO SOURCES ─────────────────────────────────────
 * POST /avatar accepts BOTH an uploaded photo and an avatar chosen from the
 * DiceBear gallery, and deliberately does not distinguish them. A chosen avatar
 * has to behave exactly like an uploaded one everywhere downstream, and the
 * surest way to guarantee that is for both to be the same stored value, in the
 * same column, written by the same code path.
 *
 * Two sizes are stored: avatar_url (512px display) and avatar_thumb (96px, what
 * list endpoints select). Downscaling happens in the BROWSER with a canvas —
 * see src/utils/imageThumb.js. That reuses the image decoder the browser already
 * has and avoids adding a native library (sharp/jimp) to the Render deployment.
 *
 * SVG is accepted because that is what the generated gallery avatars are. It is
 * safe HERE because avatars are only ever rendered inside an <img> tag, where
 * browsers refuse to run scripts or load external resources. It would NOT be
 * safe to inline this value into the DOM or serve it from our own origin with an
 * image/svg+xml content type; the application does neither.
 *
 * A user with no stored avatar is NOT a blank circle: the frontend generates a
 * deterministic avatar from their user id (src/utils/avatar.js). That fallback
 * is derived, never stored, which is why every pre-existing account gained a
 * picture with no migration and no backfill.
 *
 * ── RESUME ANALYSIS ────────────────────────────────────────────────────────
 * The upload path extracts text through services/pdfTextService.js and never by
 * requiring pdf-parse directly. That module bridges the v1 function API and the
 * v2 PDFParse class; calling the library directly broke twice on a version bump,
 * and the failure was SILENT — the AI scorer simply received no resume text and
 * every applicant scored NULL.
 *
 * ── NAMING ─────────────────────────────────────────────────────────────────
 * `pwd_category` and `pwd_verification_status` are legacy PHYSICAL column names
 * that hold the government ID TYPE and its state. They are not PWD
 * classifications and the product is not PWD-specific. Migration 019 added
 * `verification_id_type` as the replacement; new code reads that and falls back
 * to pwd_category until the old column is dropped. Do not "tidy" these names —
 * renaming a populated column on live TiDB is not reversible.
 */

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const { aiLimiter, writeLimiter } = require('../middleware/rateLimiters');
const certificatesRepository = require('../repositories/certificatesRepository');
const onboardingService = require('../services/onboardingService');
const multer = require('multer');
const aiClient = require('../services/aiClient');
const { getReferralPreference, setReferralPreference, REFERRAL_MODES } = require('../services/referralService');
const phoneVerifyService = require('../services/phoneVerifyService');
const { toE164PH } = require('../services/smsService');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const verificationUploadDir = path.join(__dirname, '..', 'uploads', 'verification-ids');
fs.mkdirSync(verificationUploadDir, { recursive: true });

// Zero-crash boot create for the seeker referral-automation preference table.
// Canonical schema lives in migration 050; created here too so the GET/PUT below
// work on a fresh deploy before the migration is run. Idempotent.
(async () => {
    if (db.isPostgres) return; // schema owned by postgres/schema.sql
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS referral_preferences (
                user_id    INT PRIMARY KEY,
                mode       VARCHAR(20) NOT NULL DEFAULT 'manual',
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
    } catch (e) { console.error('referral_preferences init error:', e.message); }
})();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
});

// Import Past Applications: memory storage + a hard 2 MB cap at the multer layer
// (importService also re-checks). Accepts CSV/XLSX only.
const importService = require('../services/importService');
const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: importService.LIMITS.MAX_FILE_BYTES },
});

// Analyze My Resume: memory storage, 5 MB cap, PDF/DOCX only (Phase C). The MIME
// allow-list + size are enforced here; extraction/validation stays in resumeText.
const { extractResumeText } = require('../services/resumeText');
const resumeAnalyzer = require('../services/resumeAnalyzer');
const RESUME_MAX_BYTES = 5 * 1024 * 1024;
const RESUME_MIME_ALLOW = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);
const resumeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: RESUME_MAX_BYTES },
    fileFilter: (req, file, cb) => {
        const ext = String(file.originalname || '').toLowerCase();
        if (RESUME_MIME_ALLOW.has(file.mimetype) || ext.endsWith('.pdf') || ext.endsWith('.docx')) return cb(null, true);
        cb(new Error('Please upload a PDF or DOCX résumé.'));
    },
});
// Wrap so multer's fileFilter/size errors return a clean 400 instead of a 500.
const resumeUploadMw = (req, res, next) => resumeUpload.single('resume')(req, res, (err) => {
    if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'The résumé is too large (max 5 MB).' : err.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
    next();
});

const verificationUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, verificationUploadDir),
        filename: (req, file, cb) => {
            const safeExt = path.extname(file.originalname || '').toLowerCase();
            cb(null, `${req.userId}-${Date.now()}${safeExt}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Please upload a JPG, PNG, WEBP, or PDF document.'));
        }
        cb(null, true);
    }
});

router.use(requireAuth);

// ── SMS channel: phone verification + opt-in (#8) ───────────────────────────
// Owner-scoped (req.userId). Verifying proves the seeker owns the number (an
// OTP-to-phone); opting in is a separate explicit consent. The channel router only
// texts a recipient who is BOTH verified AND opted in. All are no-ops with a clear
// message when no SMS provider is configured (the service guards that).
router.post('/phone/verify/start', async (req, res) => {
    try {
        const data = await phoneVerifyService.startVerification({ userId: req.userId, phone: req.body?.phone });
        res.status(200).json({ status: 'success', message: data.delivered ? 'A verification code has been texted to your number.' : 'Could not text the code just now — try resending shortly.', data });
    } catch (error) {
        res.status(error.status || 500).json({ status: 'error', message: error.status ? error.message : 'Could not start phone verification.' });
    }
});

router.post('/phone/verify/confirm', async (req, res) => {
    try {
        const data = await phoneVerifyService.confirmVerification({ userId: req.userId, code: req.body?.code });
        res.status(200).json({ status: 'success', message: 'Your mobile number is verified.', data });
    } catch (error) {
        res.status(error.status || 500).json({ status: 'error', message: error.status ? error.message : 'Could not verify the code.', ...(error.attemptsRemaining != null ? { attemptsRemaining: error.attemptsRemaining } : {}) });
    }
});

router.put('/phone/opt-in', async (req, res) => {
    try {
        const data = await phoneVerifyService.setOptIn({ userId: req.userId, optIn: !!req.body?.optIn });
        res.status(200).json({ status: 'success', message: data.optIn ? 'SMS alerts are on.' : 'SMS alerts are off.', data });
    } catch (error) {
        res.status(error.status || 500).json({ status: 'error', message: error.status ? error.message : 'Could not update SMS preference.' });
    }
});

// ── Referral automation preference (Job Seeker) ─────────────────────────────
// How incoming PESO referrals are handled once they reach 'Pending Seeker
// Acceptance': manual (default) | auto_accept | auto_decline. Owner-scoped by
// req.userId; enforced by referralService.approveReferral. See migration 050.
router.get('/referral-preference', async (req, res) => {
    try {
        const mode = await getReferralPreference(req.userId);
        res.status(200).json({ status: 'success', data: { mode, options: REFERRAL_MODES } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Could not load your referral preference.' });
    }
});

router.put('/referral-preference', writeLimiter, async (req, res) => {
    try {
        const mode = await setReferralPreference(req.userId, req.body?.mode);
        res.status(200).json({ status: 'success', message: 'Referral preference saved.', data: { mode } });
    } catch (error) {
        res.status(error.status || 500).json({ status: 'error', message: error.status ? error.message : 'Could not save your referral preference.' });
    }
});

// NOTE (Identity Verification ID removed, 2026-08-23): the government ID-TYPE
// selector — and the `/verification/id-types` endpoint that fed it — were removed
// because PESO confirmed capturing an identity ID is outside their workflow. This is
// the SECOND, separate removal after the Job Seeker Verification APPROVAL WORKFLOW
// was decommissioned (2026-08-01). The underlying columns (users.verification_id_type
// / pwd_category / pwd_verification_status) and the verification_id_types table are
// left DORMANT — not dropped — to keep live-TiDB compatibility (§0.7); no code reads
// or writes them any more. The job_seeker_verifications / verification_history tables
// remain dormant from the earlier removal.

// ==========================================
// FETCH PROFILE (Fully Synchronized Hydration)
// ==========================================
// GET /profile/onboarding — the seeker's account-completion state (owner-scoped,
// derived from the DB). Drives the onboarding flow + the Apply gate on the frontend;
// the POST /applications endpoint re-checks it server-side (defense in depth).
router.get('/onboarding', async (req, res) => {
    const state = await onboardingService.evaluate(req.userId);
    res.status(200).json({ status: 'success', data: state });
});

router.get('/', async (req, res) => {
    try {
        // PERF (P1, 2026-08-02): a batch of per-request CREATE TABLE / ALTER TABLE
        // schema patching used to run HERE, on EVERY profile load — the measured cause
        // of GET /api/profile taking ~3.5s (running DDL against TiDB per request).
        // Migrations own the schema (§0.6) and these tables/columns already exist in
        // prod, so the DDL was pure waste. Removed. A fresh DB gets the schema from
        // `npm run migrate` (and DB_INIT_ON_BOOT for the legacy bootstrap), not from
        // a user-facing GET.

        // `userprofiles` can legitimately hold MULTIPLE rows per user_id
        // (SKILL.md invariant 0.8 — one user on live data already has two).
        // Taking rows[0] unordered meant the AI resume profile could be read
        // from whichever row the storage engine happened to return first, so a
        // user's parsed resume could silently "disappear" while still stored.
        // Order deterministically so the RICHEST row always wins. Note the table
        // has neither a primary key nor a timestamp (columns: user_id, skills,
        // preferred_roles, experience_level, career_goals, ai_profile_data,
        // is_ai_profile_visible, ai_insights_data), so "newest" is not
        // expressible — rank by presence of AI data, then by payload size.
        const [profileRows] = await db.query(
            `SELECT * FROM userprofiles
             WHERE user_id = ?
             ORDER BY (ai_profile_data IS NOT NULL) DESC,
                      (ai_insights_data IS NOT NULL) DESC,
                      CHAR_LENGTH(COALESCE(ai_profile_data, '')) DESC
             LIMIT 1`,
            [req.userId]
        );
        const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [req.userId]);

        const aiData = profileRows[0] || {};
        const userData = userRows[0] || {};

        const mergedData = { ...aiData, ...userData };
        ['skills', 'preferred_roles', 'experience_level', 'career_goals'].forEach(key => {
            if (userData[key] === null && aiData[key]) {
                mergedData[key] = aiData[key];
            }
        });

        delete mergedData.password;
        delete mergedData.reset_token;

        res.status(200).json({ status: 'success', data: mergedData });
    } catch (error) {
        console.error("Profile GET Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch profile.' });
    }
});

// ==========================================
// SAVE & UPDATE USER PROFILE DETAILS
// ==========================================
router.put('/', (req, res, next) => {
    // .none(): parse the multipart profile form's TEXT fields only. The identity
    // DOCUMENT upload was removed with the Job Seeker Verification workflow, and the
    // ID-TYPE field was removed too (2026-08-23) — no identity ID is captured here.
    verificationUpload.none()(req, res, function (err) {
        if (err) return res.status(400).json({ status: 'error', message: `Profile parsing failure: ${err.message}` });
        next();
    });
}, async (req, res) => {
    try {
        const {
            name, gender, dob, phone, location,
            availability, educational_attainment, languages,
            skills, preferred_roles, experience_level, career_goals
        } = req.body;

        const updateQuery = `
            UPDATE users
            SET
                name = COALESCE(?, name),
                -- Identity ID-TYPE removed (2026-08-23): verification_id_type /
                -- pwd_category are no longer written. Columns left dormant (§0.7).
                gender = ?,
                dob = ?,
                phone = ?,
                location = ?,
                availability = ?,
                educational_attainment = ?,
                languages = ?,
                skills = ?,
                preferred_roles = ?,
                experience_level = ?,
                career_goals = ?
            WHERE id = ?
        `;

        const values = [
            name, gender, dob || null, phone, location,
            availability, educational_attainment, languages,
            skills, preferred_roles, experience_level, career_goals,
            req.userId
        ];

        // If the seeker is changing to a GENUINELY different mobile number, any prior
        // SMS phone verification + opt-in no longer applies (they must re-verify the new
        // number before it can receive texts). Compared via E.164 normalization so a
        // mere format change (0917… ↔ +63917…) does NOT spuriously reset verification.
        let phoneChanged = false;
        if (phone != null && String(phone).trim() !== '') {
            const [[cur]] = await db.query('SELECT phone, phone_verified_at FROM users WHERE id = ?', [req.userId]);
            if (cur?.phone_verified_at) phoneChanged = toE164PH(phone) !== toE164PH(cur.phone);
        }

        await db.query(updateQuery, values);

        if (phoneChanged) {
            await db.query('UPDATE users SET phone_verified_at = NULL, sms_opt_in = 0 WHERE id = ?', [req.userId]);
        }

        // Job Seeker Verification decommissioned (2026-08-01) and the identity ID-TYPE
        // field removed (2026-08-23): the profile save no longer stages a
        // job_seeker_verifications review row nor writes any identity ID column. Those
        // columns are dormant (§0.7).

        // NOTE: no AI re-score is triggered here. The compatibility scorer reads ONLY
        // the résumé `parsed_text` (+ supporting certificates + the job's own fields),
        // never these `users` profile columns — so editing name/phone/location/skills/
        // etc. cannot change any score. Re-scoring on a profile save was pure waste
        // (N DeepSeek calls per edit for no possible ranking change), so it was removed.
        // The résumé builder + PDF upload (resumeRoutes) and certificate attach are the
        // real scoring-input changes and enqueue re-scores themselves (dirty-checked).

        res.status(200).json({ status: 'success', message: 'Profile updated successfully.' });
    } catch (error) {
        console.error("Profile Update Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to save profile details to the database.' });
    }
});

// ==========================================
// SUPPORTING-CERTIFICATE LIBRARY (Enhancement C.2)
// ==========================================
// The applicant's reusable certificates, managed here and re-selectable in the
// Apply Wizard (which snapshots the chosen ones into the application package).
// Durable base64 in the DB; owner-scoped by req.userId throughout.
router.get('/certificates', async (req, res) => {
    try {
        res.status(200).json({ status: 'success', data: await certificatesRepository.listForUser(req.userId) });
    } catch (error) {
        console.error('Certificate library read error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load your certificates.' });
    }
});

router.post('/certificates', async (req, res) => {
    try {
        const { file_name, mime_type, base64, title, category } = req.body || {};
        const problem = certificatesRepository.validateCertificate({ mimeType: mime_type, base64 });
        if (problem) return res.status(400).json({ status: 'error', message: problem });

        if ((await certificatesRepository.countForUser(req.userId)) >= certificatesRepository.MAX_LIBRARY) {
            return res.status(409).json({ status: 'error', message: `You can store up to ${certificatesRepository.MAX_LIBRARY} certificates.` });
        }

        const id = await certificatesRepository.saveUserCertificate({
            userId: req.userId,
            title: title || file_name,
            category: category || null,
            fileName: file_name || 'certificate',
            mimeType: mime_type,
            base64,
        });
        res.status(201).json({ status: 'success', message: 'Certificate saved to your library.', data: { id } });
    } catch (error) {
        console.error('Certificate upload error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to save the certificate.' });
    }
});

router.delete('/certificates/:id', async (req, res) => {
    try {
        const affected = await certificatesRepository.deleteUserCertificate(req.userId, req.params.id);
        if (!affected) return res.status(404).json({ status: 'error', message: 'Certificate not found.' });
        res.status(200).json({ status: 'success', message: 'Certificate removed.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to remove the certificate.' });
    }
});

// Stream one of the user's OWN library certificates (owner-scoped by user_id).
router.get('/certificates/:id', async (req, res) => {
    try {
        const cert = await certificatesRepository.findUserCertificate(req.userId, req.params.id);
        if (!cert) return res.status(404).json({ status: 'error', message: 'Certificate not found.' });
        const buffer = Buffer.from(cert.content_base64, 'base64');
        const safeName = (cert.file_name || 'certificate').replace(/["\r\n]/g, '');
        res.setHeader('Content-Type', cert.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to retrieve the certificate.' });
    }
});

// ==========================================
// UPLOAD / SELECT PROFILE PICTURE
// ==========================================

/**
 * ~700KB of characters. A canvas-downscaled 512px JPEG lands around 30KB and a
 * generated SVG avatar around 8KB, so this is generous headroom rather than a
 * working limit — it exists to stop a pathological payload, not to trim normal
 * ones.
 */
const MAX_AVATAR_DATA_URI_CHARS = 700000;

/**
 * Raster formats plus SVG (which is what the DiceBear avatar gallery posts).
 *
 * SVG IS SAFE HERE because avatars are only ever rendered through an <img> tag,
 * and browsers refuse to run scripts, load external resources, or apply
 * same-origin privileges to SVG referenced that way. What would NOT be safe is
 * inlining this string into the DOM or serving it from a route with an
 * `image/svg+xml` content type on our own origin — neither of which the
 * application does. If that ever changes, this allowance has to be revisited.
 */
const ACCEPTED_AVATAR_PREFIXES = [
	'data:image/png',
	'data:image/jpeg',
	'data:image/jpg',
	'data:image/webp',
	'data:image/gif',
	'data:image/svg+xml'
];

const isAcceptableAvatarDataUri = (value) =>
	ACCEPTED_AVATAR_PREFIXES.some((prefix) => value.startsWith(prefix));
router.post('/avatar', writeLimiter, (req, res, next) => {
    upload.single('avatar')(req, res, function (err) {
        if (err) return res.status(400).json({ status: 'error', message: `Upload error: ${err.message}` });
        next();
    });
}, async (req, res) => {
    try {
        if (!db.isPostgres) try { await db.query('ALTER TABLE users MODIFY COLUMN avatar_url LONGTEXT'); } catch(e) {}

        // PREFERRED PATH: the client downscales with a canvas and posts both
        // sizes as data URIs (see utils/imageThumb.js). This keeps the stored
        // avatar ~30KB instead of ~319KB and gives lists a ~15KB thumb, without
        // needing a native image library on the server.
        //
        // This branch now serves BOTH client-downscaled photo uploads and
        // gallery avatar selections (which post an SVG data URI). They are
        // deliberately not distinguished: a chosen avatar has to behave exactly
        // like an uploaded one everywhere downstream, and the surest way to
        // guarantee that is for them to be the same stored value in the same
        // column, written by the same code path.
        const { avatar_url: clientAvatar, avatar_thumb: clientThumb } = req.body || {};

        if (typeof clientAvatar === 'string' && isAcceptableAvatarDataUri(clientAvatar)) {
            // A payload this large is either a bug or an attempt to use the
            // users table as blob storage. LONGTEXT would accept it; the row is
            // read on every login and every list that shows a face, so it must
            // not.
            if (clientAvatar.length > MAX_AVATAR_DATA_URI_CHARS) {
                return res.status(413).json({ status: 'error', message: 'That image is too large. Please choose a smaller one.' });
            }

            const thumb = (typeof clientThumb === 'string'
                && isAcceptableAvatarDataUri(clientThumb)
                && clientThumb.length <= MAX_AVATAR_DATA_URI_CHARS)
                ? clientThumb
                : clientAvatar; // no usable thumb supplied -> reuse, still correct

            await db.query(
                'UPDATE users SET avatar_url = ?, avatar_thumb = ? WHERE id = ?',
                [clientAvatar, thumb, req.userId]
            );
            return res.status(200).json({
                status: 'success', message: 'Avatar updated.',
                avatar_url: clientAvatar, avatar_thumb: thumb
            });
        }

        // FALLBACK: raw multipart upload from an older client. Stored as-is —
        // full size, no thumb — so behaviour never regresses, it just misses
        // the size benefit until that client is updated.
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No image provided.' });

        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        await db.query('UPDATE users SET avatar_url = ?, avatar_thumb = NULL WHERE id = ?', [base64Image, req.userId]);

        res.status(200).json({ status: 'success', message: 'Avatar updated.', avatar_url: base64Image });
    } catch (error) {
        console.error("Avatar Upload Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to upload profile picture.' });
    }
});

// ==========================================================
// TRACKER & DEEPSEEK ROUTE ARCHITECTURES (PRESERVED 100%)
// ==========================================================
router.get('/tracker', async (req, res) => {
    try {
        if (!db.isPostgres) await db.query(`
            CREATE TABLE IF NOT EXISTS UserTrackedJobs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT, company VARCHAR(255), job_title VARCHAR(255),
                job_type VARCHAR(100), date_applied VARCHAR(50), status VARCHAR(50),
                link TEXT, notes TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        const [rows] = await db.query('SELECT * FROM UserTrackedJobs WHERE user_id = ?', [req.userId]);
        res.status(200).json({ status: 'success', data: rows });
    } catch (error) {
        console.error("❌ Fetch Tracker Error:", error.message);
        res.status(500).json({ status: 'error', message: 'Failed to fetch tracked jobs.' });
    }
});

router.put('/visibility', async (req, res) => {
    const { isVisible } = req.body;
    try {
        await db.query('UPDATE userprofiles SET is_ai_profile_visible = ? WHERE user_id = ?', [isVisible, req.userId]);
        res.status(200).json({ status: 'success', isVisible });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to update visibility.' });
    }
});

router.post('/match', aiLimiter, async (req, res) => {
    try {
        await new Promise(resolve => setTimeout(resolve, 1500));
        res.status(200).json({
            overall: Math.floor(Math.random() * (98 - 75 + 1)) + 75,
            skills: ['High', 'Medium', 'Exceptional'][Math.floor(Math.random() * 3)],
            education: ['High', 'Medium', 'Satisfactory'][Math.floor(Math.random() * 3)],
            experience: ['High', 'Medium', 'Strong'][Math.floor(Math.random() * 3)]
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

router.post('/upload', aiLimiter, resumeUploadMw, async (req, res) => {
    try {
        if (!req.file) throw new Error("No file uploaded or file format rejected.");
        if (!aiClient.isAiConfigured()) throw new Error("No AI provider is configured.");

        // Extract text — PDF via the canonical pdfTextService, DOCX via mammoth (§12).
        let resumeText = "";
        try {
            resumeText = await extractResumeText(req.file);
        } catch (exErr) {
            return res.status(422).json({ status: 'error', message: exErr.message || 'Could not read the résumé file.' });
        }
        if (!resumeText || resumeText.trim().length === 0) {
            return res.status(422).json({ status: 'error', message: 'No readable text was found. If it is a scanned image, upload a text-based PDF or DOCX.' });
        }

        // Persist the EXTRACTED artifact into uploaded_resumes (one row per user, UPDATE-in-
        // place — the same pattern the résumé builder + apply-time use), so analyzing your
        // résumé refreshes the parsed_text the AI scorer reads (§7.4/§18.5). Parsed-text-only:
        // the binary is NOT stored (Phase C). Non-fatal (invariant 0.1).
        try {
            const [upd] = await db.query(
                'UPDATE uploaded_resumes SET parsed_text = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [resumeText, req.file.originalname || 'resume', req.userId]
            );
            if (upd.affectedRows === 0) {
                await db.query('INSERT INTO uploaded_resumes (user_id, file_name, parsed_text) VALUES (?, ?, ?)', [req.userId, req.file.originalname || 'resume', resumeText]);
            }
        } catch (persistErr) {
            console.error('[Resume] parsed_text persist failed (non-fatal):', persistErr.message);
        }

        // AI extraction + profile shaping (shared with the offline validation harness).
        const { baseProfile } = await resumeAnalyzer.extractResumeProfile(resumeText, { userId: req.userId });

        await db.query(`
            INSERT INTO userprofiles (user_id, ai_profile_data, is_ai_profile_visible, ai_insights_data)
            VALUES (?, ?, ?, NULL)
            ON DUPLICATE KEY UPDATE 
            ai_profile_data = VALUES(ai_profile_data),
            is_ai_profile_visible = VALUES(is_ai_profile_visible),
            ai_insights_data = NULL
        `, [req.userId, JSON.stringify(baseProfile), true]);
        
        res.status(200).json({ status: 'success', profile: baseProfile });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.post('/insights/generate', aiLimiter, async (req, res) => {
    try {
        if (!aiClient.isAiConfigured()) throw new Error("No AI provider is configured.");

        const [rows] = await db.query('SELECT ai_profile_data FROM userprofiles WHERE user_id = ?', [req.userId]);
        if (!rows.length || !rows[0].ai_profile_data) {
            return res.status(400).json({ status: 'error', message: 'No AI profile found.' });
        }

        const profileDataString = rows[0].ai_profile_data;
        
        const reasoningPrompt = `
            You are an elite career trajectory AI. Analyze the following unified career profile JSON.
            Output ONLY valid JSON matching this exact structure:
            {
                "trajectory": "Short summary",
                "next_roles": ["Role 1", "Role 2", "Role 3"],
                "skill_gaps": ["Gap 1", "Gap 2", "Gap 3"],
                "recommended_jobs": [
                    { "title": "Target Role 1", "company": "Example Industry Leader", "match": 95 }
                ]
            }
            Profile Data:
            ${profileDataString}
        `;

        const insightsRaw = await aiClient.chat({
            messages: [{ role: "system", content: reasoningPrompt }],
            temperature: 0.2,
            tier: aiClient.TIER.CHAT,
            prefer: 'deepseek',
            extra: { response_format: { type: "json_object" } },
        });

        const insights = JSON.parse(insightsRaw);
        await db.query('UPDATE userprofiles SET ai_insights_data = ? WHERE user_id = ?', [JSON.stringify(insights), req.userId]);
        res.status(200).json({ status: 'success', insights });

    } catch (error) {
        console.error("❌ Insights Generation Error:", error.response?.data || error.message);
        res.status(500).json({ status: 'error', message: 'Failed to generate AI insights.' });
    }
});

/**
 * Import Past Applications — deterministic pipeline (Phase B of the data-processing
 * proposal). Replaces the old `/tracker/upload`, which used a fragile per-import AI
 * validation AND destructively `DELETE`d all of the user's tracked jobs before inserting.
 * The new flow APPENDS de-duplicated rows and never deletes existing data.
 *
 * POST /profile/import/preview  — multipart `file` (+ `import_id`), read-only: parse,
 *   validate, normalize, dedupe → returns a summary + the valid rows to review.
 * POST /profile/import/commit   — JSON { import_id, file_name, rows }: re-validates +
 *   re-dedupes authoritatively, enforces the daily + total limits, persists in ONE
 *   transaction, and records an import_batches audit row (idempotent per import_id).
 */
router.post('/import/preview', importUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
        const result = await importService.preview({
            userId: req.userId,
            buffer: req.file.buffer,
            fileName: req.file.originalname,
        });
        res.status(200).json({ status: 'success', ...result });
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error('[Import] preview failed:', error.message);
        res.status(status).json({ status: 'error', message: status >= 500 ? 'Failed to read the file.' : error.message });
    }
});

router.post('/import/commit', async (req, res) => {
    try {
        const { import_id, file_name, rows } = req.body || {};
        const result = await importService.commit({
            userId: req.userId,
            importId: import_id,
            fileName: file_name,
            rows,
        });
        res.status(200).json({ status: 'success', ...result });
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error('[Import] commit failed:', error.message);
        res.status(status).json({ status: 'error', message: status >= 500 ? 'Failed to import records.' : error.message });
    }
});

module.exports = router;