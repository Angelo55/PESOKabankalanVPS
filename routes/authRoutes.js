/**
 * AUTHENTICATION — registration, sign-in, password recovery, Google OAuth.
 *
 * WHAT: every way an account is created or a session begins.
 *
 * ── REGISTRATION IS TWO STEPS ──────────────────────────────────────────────
 *   POST /register         validate, hash the password, stage the signup in
 *   (or /register/start)   email_verifications, email a 6-digit code.
 *                          NO users row is created. Responds 202.
 *   POST /register/verify  check the code -> the account is created HERE.
 *   POST /register/resend   re-send a code for a staged signup.
 *
 * Registration never issues a session. The user signs in afterwards, which is
 * the behaviour that existed before verification was added and is preserved.
 *
 * WHY THE PENDING SIGNUP IS NOT A users ROW WITH verified = 0: that still
 * creates the account. It burns the email address, appears in every COUNT(*) on
 * the landing page and admin metrics, and leaves a password hash for an address
 * nobody has proven they own. A staged signup simply expires instead.
 *
 * BACKWARD COMPATIBILITY: this applies to NEW accounts only. `email_verified_at`
 * is informational and nothing in /login reads it; existing rows keep NULL
 * forever and are never asked to verify. If a future change ever gates on that
 * column it MUST grandfather NULL as "legacy, trusted".
 *
 * ── EMAIL FAILURE IS NO LONGER FATAL HERE ──────────────────────────────────
 * The code is still the primary action, but mailService now fails over across
 * providers and — if every provider is down — the staged signup is preserved
 * rather than discarded. /register then returns verification_required with
 * `deliveryPending: true`, so a mail outage no longer blocks new registrations;
 * the user resends once mail recovers. Rules live in services/otpService.js.
 *
 * ── SIGN-IN ────────────────────────────────────────────────────────────────
 * bcrypt comparison, then a 7-day JWT. The response carries name, role, avatar
 * and permissions because AuthContext seeds the whole session from this payload
 * and does NOT re-fetch /auth/me — omitting the avatar once left the header
 * showing a placeholder until the next full page refresh. Keep /login,
 * /auth/me and /google returning the same user shape.
 *
 * ── PROVIDERS ──────────────────────────────────────────────────────────────
 * Email/password and Google only. A Google signup skips the OTP because Google
 * has already proven control of the address. GitHub OAuth was fully removed;
 * former GitHub users recover through "Forgot Password". Do not reintroduce it.
 *
 * ── RATE LIMITING ──────────────────────────────────────────────────────────
 * Per-IP limiters on login, password reset, registration and the OTP endpoints
 * sit ON TOP of the per-address pacing inside otpService. The per-address rules
 * stop one inbox being spammed; the per-IP rules stop one host cycling through
 * many addresses. Verify is given more headroom than send, so a legitimate user
 * mistyping a code is not locked out of their own signup by an IP-wide counter.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios'); 
const querystring = require('querystring');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const db = require('../db');
const emailOutboxService = require('../services/emailOutboxService');
const requireAuth = require('../middleware/authMiddleware');
const { normalizeRole, getRoleLabel, getPermissions, ROLE_KEYS } = require('../middleware/rbac');
const otpService = require('../services/otpService');
const walkInService = require('../services/walkInService');

const router = express.Router();

// Zero-crash boot: ensure the OAuth-linkage columns exist so a deploy is never ahead
// of migrations 052/053 (the auth SELECTs + the link flow reference them). Idempotent;
// the migrations own the canonical schema (incl. the unique index) + the one-time
// backfill. Fire-and-forget on boot.
(async () => {
    try { await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20) NULL"); } catch (e) { /* exists / race — fine */ }
    try { await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64) NULL"); } catch (e) { /* exists / race — fine */ }
    try { await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255) NULL"); } catch (e) { /* exists / race — fine */ }
})();

// Extended Google Client to support redirection flows. Secrets come ONLY from the
// environment — no hardcoded fallback (a committed client secret is a leaked credential;
// the previous inline fallback must be rotated in Google Cloud Console, see the security
// runbook). Google sign-in requires GOOGLE_CLIENT_ID/SECRET to be set in the deploy env.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
router.use(helmet());

const auditLog = (req, res, next) => {
    console.info(`[AUDIT] ${new Date().toISOString()} | IP: ${req.ip} | Route: ${req.originalUrl}`);
    next();
};
router.use(auditLog);

// Now that `trust proxy` makes this PER CLIENT IP (server.js), 5/15min was too tight for a
// shared connection (e.g. several PESO staff behind the office NAT — one forgotten password
// could lock out the whole office). 15/15min still crushes online brute force (bcrypt +
// password strength are the real defense) while tolerating a shared LAN.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { status: 'error', message: 'Too many login attempts.' } });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { status: 'error', message: 'Too many reset requests.' } });
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { status: 'error', message: 'Too many accounts created.' } });

// Per-IP ceilings for the OTP endpoints. These sit ON TOP of the per-address
// pacing inside otpService: the service stops one inbox being spammed, these
// stop one host cycling through many addresses. Verify is allowed more room
// than send because a legitimate user mistyping a code must not be locked out
// of their own signup by an IP-wide counter.
const otpSendLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { status: 'error', message: 'Too many verification requests from this device. Please try again later.' }
});
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { status: 'error', message: 'Too many verification attempts. Please try again later.' }
});

const sendSecurityAlert = async (email, req) => {
    try {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'Unknown IP';
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const timestamp = new Date().toUTCString();

        // Phase 2C: durable, retryable delivery via the email outbox instead of a
        // private nodemailer transport (folds the "two transports drift" note in
        // mailService). With EMAIL_OUTBOX_ENABLED off this sends inline through
        // mailService (which has provider failover); with it on it is queued and
        // retried. Best-effort either way — enqueue never throws.
        await emailOutboxService.enqueue({
            to: email,
            category: 'security_alert',
            subject: 'Security Alert: Your Password Was Changed',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #1a4a38; padding: 20px; text-align: center; color: white;">
                        <h2 style="margin: 0;">Security Alert</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p>Hello,</p>
                        <p>We are writing to formally confirm that the password for your Career Dashboard account was recently changed.</p>
                        <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li style="margin-bottom: 10px;"><strong>Time:</strong> ${timestamp}</li>
                                <li style="margin-bottom: 10px;"><strong>IP Address:</strong> ${ip}</li>
                                <li><strong>Device / Browser:</strong> ${userAgent}</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `
        });
    } catch (error) {
        console.error("[BACKGROUND WORKER ERROR] Failed to send security alert email:", error.message);
    }
};

router.get('/me', requireAuth, async (req, res) => {
    try {
        // avatar_url powers the persistent profile menu in the top header. It is
        // added lazily by the profile module, so fall back gracefully if a very
        // old row predates the column.
        let users;
        try {
            // avatar_thumb too: the client prefers the thumbnail for the header
            // and list rows, which keeps this response small instead of shipping
            // a ~319KB full-size avatar on every session bootstrap.
            [users] = await db.query('SELECT id, name, email, role, avatar_url, avatar_thumb, oauth_provider, google_email FROM users WHERE id = ?', [req.userId]);
        } catch (e) {
            [users] = await db.query('SELECT id, name, email, role, oauth_provider, google_email FROM users WHERE id = ?', [req.userId]);
        }
        if (users.length === 0) return res.status(404).json({ message: 'User not found.' });
        const user = users[0];
        res.status(200).json({
            status: 'success',
            user: {
                ...user,
                role: normalizeRole(user.role),
                role_label: getRoleLabel(user.role),
                permissions: getPermissions(user.role)
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Server error fetching profile.' });
    }
});

router.post('/logout', (req, res) => {
    res.status(200).json({ status: 'success', message: 'Logged out successfully' });
});

// ==========================================
// REGISTRATION — OTP EMAIL VERIFICATION (2 STEPS)
// ==========================================
//
// Step 1 POST /register (or /register/start) stages the signup and emails a
//        6-digit code. NO users row is written.
// Step 2 POST /register/verify presents the code; ONLY here is the account
//        created. Manual login is still enforced afterwards, unchanged.
//        POST /register/resend re-sends a code for a staged signup.
//
// `/register` keeps its original path deliberately: it is the single entry
// point every client already calls, so repointing it — rather than adding a
// verified path beside it — is what actually closes the unverified-signup hole.
// The response now carries `status: 'verification_required'` (HTTP 202) instead
// of 201, which is the contract change clients must handle.
//
// EXISTING USERS ARE UNAFFECTED: nothing below reads or writes verification
// state for an account that already exists, and /login is untouched.

/** Translates an OtpError into its HTTP response; anything else is a real 500. */
const handleOtpError = (error, res, context) => {
    if (error instanceof otpService.OtpError) {
        const body = { status: 'error', message: error.message };
        if (error.retryAfterSeconds) body.retryAfterSeconds = error.retryAfterSeconds;
        if (typeof error.attemptsRemaining === 'number') body.attemptsRemaining = error.attemptsRemaining;
        return res.status(error.status).json(body);
    }
    console.error(`[Auth] ${context} failed:`, error);
    return res.status(500).json({ status: 'error', message: 'Server error during registration.' });
};

const startRegistration = async (req, res) => {
    try {
        const { name, email, password, role } = req.body || {};
        const result = await otpService.startVerification({ name, email, password, role });

        // Still verification_required either way — the account is staged and
        // gated on a real code. `delivered: false` means every mail provider was
        // down; the signup is preserved so the user can resend once mail recovers
        // (email is no longer a hard blocker for registration).
        res.status(202).json({
            status: 'verification_required',
            deliveryPending: result.delivered === false,
            message: result.delivered === false
                ? `Your details are saved, but we could not send the code just now — an email service issue on our side. Tap Resend on the next screen in a moment.`
                : `We sent a 6-digit verification code to ${result.email}. Enter it to finish creating your account.`,
            email: result.email,
            expiresInMinutes: result.expiresInMinutes,
            resendAvailableInSeconds: result.resendAvailableInSeconds
        });
    } catch (error) {
        handleOtpError(error, res, 'Registration start');
    }
};

router.post('/register', registrationLimiter, startRegistration);
router.post('/register/start', otpSendLimiter, startRegistration);

router.post('/register/resend', otpSendLimiter, async (req, res) => {
    try {
        const result = await otpService.resendVerification({ email: (req.body || {}).email });
        res.status(200).json({
            status: 'success',
            deliveryPending: result.delivered === false,
            message: result.delivered === false
                ? `We still could not send the code — the email service looks down. Please try again shortly.`
                : `A new verification code was sent to ${result.email}.`,
            email: result.email,
            expiresInMinutes: result.expiresInMinutes,
            resendAvailableInSeconds: result.resendAvailableInSeconds
        });
    } catch (error) {
        handleOtpError(error, res, 'Verification resend');
    }
});

router.post('/register/verify', otpVerifyLimiter, async (req, res) => {
    try {
        const { email, code } = req.body || {};
        const user = await otpService.verifyAndCreateAccount({ email, code });

        console.log(`[Register] Verified signup created account ${user.email} as ${user.role}`);

        // Same contract as before the OTP step: the account exists, the user
        // signs in manually. No session is issued from registration.
        res.status(201).json({
            status: 'success',
            message: 'Email verified and account created. Please sign in using your credentials to continue.'
        });
    } catch (error) {
        handleOtpError(error, res, 'Verification');
    }
});

// ==========================================
// WALK-IN ACCOUNT CLAIM (#7) — public, pre-auth
// ==========================================
// A staff-encoded walk-in seeker claims their EXISTING account with the code PESO
// gave them: the code is the bearer proof, and when a phone is on file (+ SMS is
// configured) a texted OTP is required as a second ownership factor. Completing the
// claim links the seeker to the SAME users row (never a second profile) and signs
// them in. Deliberately NOT gated by walk_in_registration_enabled: an already-issued
// code must remain claimable even if the office pauses new encoding.
const claimLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { status: 'error', message: 'Too many attempts. Please wait a few minutes and try again.' } });

router.post('/claim/start', claimLimiter, async (req, res) => {
    try {
        const data = await walkInService.startClaim({ claimCode: req.body?.claimCode });
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        const status = error.status || 500;
        if (status === 500) console.error('[Claim] start failed:', error.message);
        res.status(status).json({ status: 'error', message: status === 500 ? 'Could not start the claim. Please try again.' : error.message });
    }
});

router.post('/claim/complete', claimLimiter, async (req, res) => {
    try {
        const { claimCode, email, password, phoneOtp } = req.body || {};
        const user = await walkInService.completeClaim({ claimCode, email, password, phoneOtp });

        // Sign the newly-claimed seeker straight in — same session contract as /login.
        const token = jwt.sign(
            { userId: user.id, role: normalizeRole(user.role) },
            process.env.JWT_SECRET || 'fallback_secret_key',
            { expiresIn: '7d' }
        );
        res.cookie('jobTrackerToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

        console.log(`[Claim] Walk-in account ${user.email} claimed and linked.`);
        res.status(200).json({
            status: 'success',
            message: 'Your account is now active. Welcome!',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: normalizeRole(user.role),
                role_label: getRoleLabel(user.role),
                permissions: getPermissions(user.role),
                avatar_url: user.avatar_url || null,
                avatar_thumb: user.avatar_thumb || null,
            },
        });
    } catch (error) {
        const status = error.status || 500;
        if (status === 500) console.error('[Claim] complete failed:', error.message);
        res.status(status).json({ status: 'error', message: status === 500 ? 'Could not complete the claim. Please try again.' : error.message, ...(error.attemptsRemaining != null ? { attemptsRemaining: error.attemptsRemaining } : {}) });
    }
});

// ==========================================
// AUTHENTICATION WORKFLOW
// ==========================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ status: 'error', message: 'Email and password are required.' });
        }
        
        // Explicit columns (was SELECT *): only what login needs — the bcrypt hash,
        // the JWT/response fields, and both avatar variants the client seeds from.
        // Avoids dragging every other users column (reset_token, location, dates…)
        // over the TiDB round-trip on the auth hot path.
        const [users] = await db.query(
            'SELECT id, name, email, password, role, avatar_url, avatar_thumb, oauth_provider, google_email, account_status, suspension_reason, suspended_at, suspension_ends_at FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            console.log(`[Login Failed] No account found for email: ${email}`);
            return res.status(400).json({ status: 'error', message: 'Invalid email or password.' });
        }

        const user = users[0];

        if (!user.password) {
            console.log(`[Login Failed] Account requires local password setup: ${email}`);
            return res.status(400).json({ 
                status: 'error', 
                message: 'This account uses Google Sign-In. Please log in with your provider, or click "Forgot Password" to create a local password.'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log(`[Login Failed] Incorrect password entered for: ${email}`);
            return res.status(400).json({ status: 'error', message: 'Invalid email or password.' });
        }

        // SUSPENSION GATE (item 4). Verified credentials, but a Suspended account may
        // NOT enter the app — return the standardized notice (status/reason/dates +
        // office contact) instead of a token, so the client shows it in place of the
        // dashboard. Checked AFTER the password so we never reveal account state to a
        // wrong-password guess. requireAuth enforces the same for already-issued tokens.
        if (user.account_status === 'Suspended') {
            console.log(`[Login Blocked] Suspended account attempted sign-in: ${email}`);
            return res.status(403).json({
                status: 'error',
                code: 'ACCOUNT_SUSPENDED',
                message: 'Your account has been suspended.',
                suspension: {
                    reason: user.suspension_reason || null,
                    suspendedAt: user.suspended_at || null,
                    endsAt: user.suspension_ends_at || null,
                },
            });
        }

        const token = jwt.sign(
            { userId: user.id, role: normalizeRole(user.role) }, 
            process.env.JWT_SECRET || 'fallback_secret_key', 
            { expiresIn: '7d' }
        );

        res.cookie('jobTrackerToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 
        });

        console.log(`[Login Success] ${user.email} successfully logged in as ${user.role.toUpperCase()}`);

        res.status(200).json({
            status: 'success',
            token: token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: normalizeRole(user.role),
                role_label: getRoleLabel(user.role),
                permissions: getPermissions(user.role),
                // MUST be included: AuthContext seeds the session straight from
                // this payload and does NOT re-fetch /auth/me after login, so
                // omitting the avatar left the header showing a placeholder until
                // the next full page refresh. Keep this in sync with /auth/me.
                avatar_url: user.avatar_url || null,
                avatar_thumb: user.avatar_thumb || null,
                oauth_provider: user.oauth_provider || null,
                google_email: user.google_email || null
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ status: 'error', message: 'Server error during login.' });
    }
});

router.put('/update-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const normalizedNew = (newPassword || '').trim();

    // Server-side validation — the client checks this too, but the server is the
    // authority (a non-standard client must not be able to set a weak password).
    if (normalizedNew.length < 8) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters long.' });
    }

    try {
        const [users] = await db.query('SELECT id, email, password FROM users WHERE id = ?', [req.userId]);
        if (users.length === 0) return res.status(404).json({ message: 'User not found.' });
        const user = users[0];

        if (user.password) {
            const isMatch = await bcrypt.compare((currentPassword || '').trim(), user.password);
            if (!isMatch) return res.status(400).json({ message: 'Incorrect current password.' });
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(normalizedNew, salt);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

        sendSecurityAlert(user.email, req);

        res.status(200).json({ status: 'success', message: 'Password updated successfully.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to update password.' });
    }
});

router.post('/forgot-password', resetLimiter, async (req, res) => {
    const { email } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const genericResponse = { status: 'success', message: 'If an account exists with that email, a password reset link has been sent.' };

    try {
        const [users] = await db.query('SELECT id, email FROM users WHERE email = ?', [normalizedEmail]);
        if (users.length === 0) return res.status(200).json(genericResponse);

        const user = users[0];
        const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
        await db.query('UPDATE users SET reset_token = ? WHERE id = ?', [resetToken, user.id]);

        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
        // Phase 2C: the highest-value rewire. Password reset was pure best-effort
        // through its own transport, so a provider hiccup silently lost the only
        // link a locked-out user has. Now durable + retryable via the outbox; the
        // dedupe key (the reset token) makes a retried send idempotent. enqueue
        // never throws, so an SMTP failure no longer 500s this endpoint — the user
        // still gets the generic response and the worker keeps trying.
        await emailOutboxService.enqueue({
            to: user.email,
            category: 'password_reset',
            dedupeKey: `pwreset:${resetToken}`,
            subject: 'Password Reset Request',
            html: `
                <h2>Password Reset</h2>
                <p>You requested a password reset. This secure link is only valid for 15 minutes.</p>
                <a href="${resetLink}" style="padding: 10px 20px; background: #1a4a38; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
            `
        });

        res.status(200).json(genericResponse);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Internal server error while sending email.' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    const normalizedPassword = (newPassword || '').trim();

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [users] = await db.query('SELECT id, email FROM users WHERE id = ? AND reset_token = ?', [decoded.id, token]);
        
        if (users.length === 0) return res.status(400).json({ status: 'error', message: 'Invalid or expired token.' });
        const user = users[0];

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(normalizedPassword, salt);
        await db.query('UPDATE users SET password = ?, reset_token = NULL WHERE id = ?', [hashedPassword, user.id]);

        sendSecurityAlert(user.email, req);

        res.status(200).json({ status: 'success', message: 'Password has been successfully reset.' });
    } catch (error) {
        // A malformed / tampered / truncated token throws JsonWebTokenError; an expired one
        // throws TokenExpiredError. BOTH mean "bad link," not a server fault — return a friendly
        // 400 the frontend can show, rather than a 500 that reads as "the site is broken." Only a
        // genuine unexpected error (e.g. a DB failure) should reach the 500 below.
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(400).json({ status: 'error', message: 'This reset link is invalid or has expired. Please request a new one.' });
        }
        console.error('[Auth] reset-password failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to reset password.' });
    }
});

// ==========================================
// GOOGLE OAUTH 2.0
// ==========================================

/**
 * Google has already proven the user controls the address, so an OAuth signup
 * skips the OTP step and is stamped as verified directly.
 *
 * Best-effort by design (SKILL §0.1): `email_verified_at` is an audit signal,
 * not a gate, so a host that has not yet run migration 020 must still be able
 * to sign in with Google. The stamp is simply skipped there.
 */
const markGoogleEmailVerified = async (userId) => {
    try {
        await db.query('UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email_verified_at IS NULL', [userId]);
    } catch (error) {
        console.warn('[Auth] Could not stamp email_verified_at for Google signup:', error.message);
    }
};
router.post('/google', async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const { email, name, sub: googleSub } = ticket.getPayload();
        const normalizedEmail = email.toLowerCase();

        // Match the linked identity (google_sub) first, then email (first-time sign-in).
        let [users] = await db.query('SELECT * FROM users WHERE google_sub = ? LIMIT 1', [googleSub]);
        if (users.length === 0) [users] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
        let user;

        if (users.length === 0) {
            const [result] = await db.query('INSERT INTO users (name, email, role, oauth_provider, google_sub, google_email) VALUES (?, ?, ?, ?, ?, ?)', [name, normalizedEmail, 'applicant', 'google', googleSub, normalizedEmail]);
            user = { id: result.insertId, name, email: normalizedEmail, role: 'applicant', oauth_provider: 'google', google_email: normalizedEmail };
            await markGoogleEmailVerified(user.id);
        } else {
            user = users[0];
            // A successful Google sign-in proves the account is linked to Google —
            // stamp the linkage + identity if not already recorded (idempotent) so
            // Linked Accounts is honest. Wrapped so a unique-index race never breaks login.
            try {
                await db.query("UPDATE users SET oauth_provider = 'google', google_sub = COALESCE(google_sub, ?), google_email = COALESCE(google_email, ?) WHERE id = ?", [googleSub, normalizedEmail, user.id]);
                user.oauth_provider = 'google';
                if (!user.google_email) user.google_email = normalizedEmail;
            } catch (e) { /* column may lag boot ALTER — non-fatal */ }
        }

        const jwtToken = jwt.sign({ userId: user.id, role: normalizeRole(user.role) }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({
            status: 'success',
            token: jwtToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: normalizeRole(user.role),
                role_label: getRoleLabel(user.role),
                permissions: getPermissions(user.role),
                // Same contract as /auth/login — the client seeds the session
                // from this payload without calling /auth/me.
                avatar_url: user.avatar_url || null,
                oauth_provider: user.oauth_provider || 'google',
                google_email: user.google_email || normalizedEmail
            }
        });
    } catch (error) {
        res.status(401).json({ status: 'error', message: 'Invalid Google token' });
    }
});

router.get('/google/login', (req, res) => {
    try {
        const role = normalizeRole(req.query.role || ROLE_KEYS.JOB_SEEKER);
        const authorizeUrl = client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
            state: role 
        });
        res.redirect(authorizeUrl);
    } catch (error) {
        console.error("Google Auth Generation Error:", error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/?error=google_auth_failed`);
    }
});

// ── ACCOUNT LINKING (authenticated Job Seeker connects Google from Settings) ──
// Reuses the SAME redirect URI + callback as login (no extra Google Console config):
// the LINK intent is carried in a SIGNED `state` JWT ({ uid, purpose:'link' }), which
// the callback distinguishes from the login `state` (a plain role string). The start
// endpoint is an AUTHED XHR (the Bearer token can't ride a top-level redirect), and
// returns the Google consent URL for the client to navigate to.
const LINK_RESULT = (fe, status) => `${fe}/settings?link=google&status=${status}`;

router.get('/google/link/start', requireAuth, (req, res) => {
    try {
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
            return res.status(503).json({ status: 'error', message: 'Google sign-in is not configured on the server.' });
        }
        // Short-lived, signed link ticket — proves WHICH account initiated the link and
        // cannot be forged (same secret as the session JWT). 10-min TTL bounds replay.
        const linkState = jwt.sign({ uid: req.userId, purpose: 'link' }, process.env.JWT_SECRET, { expiresIn: '10m' });
        const url = client.generateAuthUrl({
            access_type: 'online',            // identity only — no offline API access, no refresh token stored
            prompt: 'select_account',         // let the user explicitly choose which Google account to link
            scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
            state: linkState,
        });
        res.json({ status: 'success', url });
    } catch (error) {
        console.error('Google link start error:', error);
        res.status(500).json({ status: 'error', message: 'Could not start the Google connection.' });
    }
});

// Disconnect Google. SAFE: refuses if Google is the ONLY way in (no local password),
// so a user can never lock themselves out; never deletes the account.
router.post('/google/unlink', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT password, oauth_provider FROM users WHERE id = ?', [req.userId]);
        const u = rows[0];
        if (!u) return res.status(404).json({ status: 'error', message: 'User not found.' });
        if (u.oauth_provider !== 'google') {
            return res.status(400).json({ status: 'error', code: 'NOT_LINKED', message: 'Google is not connected to this account.' });
        }
        if (!u.password) {
            return res.status(400).json({ status: 'error', code: 'NO_PASSWORD', message: 'Set a password first (Security tab) so you can still sign in — then you can disconnect Google.' });
        }
        await db.query('UPDATE users SET oauth_provider = NULL, google_sub = NULL, google_email = NULL WHERE id = ?', [req.userId]);
        res.json({ status: 'success', message: 'Google disconnected.' });
    } catch (error) {
        console.error('Google unlink error:', error);
        res.status(500).json({ status: 'error', message: 'Could not disconnect Google.' });
    }
});

router.get('/google/callback', async (req, res) => {
    const FE = process.env.FRONTEND_URL || 'http://localhost:5173';
    const { code, state, error: providerError } = req.query;

    // Detect an account-LINK attempt: a signed JWT state with purpose 'link'. The login
    // flow's state is a plain role WORD (e.g. 'applicant'), never a 3-segment JWT — so a
    // JWT-shaped state is unambiguously a link ticket, even if it fails to verify.
    let linkState = null;
    const looksLikeLinkTicket = !!state && String(state).split('.').length === 3;
    if (state) {
        try { const d = jwt.verify(state, process.env.JWT_SECRET); if (d && d.purpose === 'link' && d.uid) linkState = d; } catch (_) { /* expired/tampered link ticket, or a login role */ }
    }
    const isLinkAttempt = looksLikeLinkTicket || !!linkState;

    // User cancelled / denied consent at Google.
    if (providerError) {
        return res.redirect(isLinkAttempt ? LINK_RESULT(FE, 'cancelled') : `${FE}/?error=google_auth_failed`);
    }
    if (!code) {
        return res.redirect(isLinkAttempt ? LINK_RESULT(FE, 'error') : `${FE}/?error=google_auth_failed`);
    }
    // A JWT-shaped state that did NOT verify is an EXPIRED/tampered link ticket — do NOT
    // silently fall through to the login path (which could sign the user into a different
    // Google account). Fail the link cleanly instead.
    if (looksLikeLinkTicket && !linkState) {
        return res.redirect(LINK_RESULT(FE, 'error'));
    }

    try {
        const { tokens } = await client.getToken(code);
        // Identity ONLY: verify the id_token, read sub/email/name, then discard the
        // tokens. We never store Google access/refresh tokens (no API calls on the
        // user's behalf), which is the least-privilege, most-secure handling.
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const googleSub = payload.sub;
        const googleEmail = (payload.email || '').toLowerCase();
        const name = payload.name;

        if (linkState) {
            // ── LINK PATH ────────────────────────────────────────────────
            const [acctRows] = await db.query('SELECT id FROM users WHERE id = ?', [linkState.uid]);
            if (acctRows.length === 0) return res.redirect(LINK_RESULT(FE, 'error'));
            // Duplicate protection: this Google identity must not already be linked to a
            // DIFFERENT PESO account (the UNIQUE index on google_sub is the DB backstop).
            const [dupe] = await db.query('SELECT id FROM users WHERE google_sub = ? AND id <> ?', [googleSub, linkState.uid]);
            if (dupe.length) return res.redirect(LINK_RESULT(FE, 'duplicate'));
            await db.query(
                "UPDATE users SET oauth_provider = 'google', google_sub = ?, google_email = ? WHERE id = ?",
                [googleSub, googleEmail, linkState.uid]
            );
            return res.redirect(LINK_RESULT(FE, 'success'));
        }

        // ── LOGIN PATH (existing behaviour; now also records sub/email) ──
        // Match the LINKED identity first (google_sub), so a Google account linked to a
        // PESO account with a DIFFERENT email still signs into the correct account instead
        // of creating a duplicate; fall back to email for a first-time Google sign-in.
        const role = normalizeRole(state || ROLE_KEYS.JOB_SEEKER);
        let [users] = await db.query('SELECT * FROM users WHERE google_sub = ? LIMIT 1', [googleSub]);
        if (users.length === 0) [users] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [googleEmail]);
        let user;
        if (users.length === 0) {
            const [result] = await db.query(
                'INSERT INTO users (name, email, role, oauth_provider, google_sub, google_email) VALUES (?, ?, ?, ?, ?, ?)',
                [name, googleEmail, role, 'google', googleSub, googleEmail]
            );
            user = { id: result.insertId, role };
            await markGoogleEmailVerified(user.id);
        } else {
            user = users[0];
            // Idempotently stamp linkage + identity for an existing account signing in
            // via Google (COALESCE keeps an already-linked sub; wrapped so a unique-index
            // race can never break login).
            try {
                await db.query(
                    "UPDATE users SET oauth_provider = 'google', google_sub = COALESCE(google_sub, ?), google_email = COALESCE(google_email, ?) WHERE id = ?",
                    [googleSub, googleEmail, user.id]
                );
            } catch (e) { /* non-fatal — login must not fail on a linkage-stamp hiccup */ }
        }

        const jwtToken = jwt.sign({ userId: user.id, role: normalizeRole(user.role) }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.redirect(`${FE}/dashboard?auth_token=${jwtToken}`);
    } catch (error) {
        console.error("Google Callback Error:", error);
        res.redirect(linkState ? LINK_RESULT(FE, 'error') : `${FE}/?error=google_auth_failed`);
    }
});

// ==========================================
// INDEED OAUTH
// ==========================================
router.get('/indeed', requireAuth, (req, res) => {
    const scope = 'openid profile email'; 
    const authUrl = `https://secure.indeed.com/oauth/v2/authorize?${querystring.stringify({
        client_id: process.env.INDEED_CLIENT_ID,
        redirect_uri: process.env.INDEED_REDIRECT_URI,
        response_type: 'code', scope: scope, state: req.userId 
    })}`;
    res.redirect(authUrl);
});

router.get('/indeed/callback', async (req, res) => {
    const { code, state } = req.query;
    try {
        const tokenResponse = await axios.post('https://secure.indeed.com/oauth/v2/tokens', querystring.stringify({
            grant_type: 'authorization_code', code: code, client_id: process.env.INDEED_CLIENT_ID,
            client_secret: process.env.INDEED_CLIENT_SECRET, redirect_uri: process.env.INDEED_REDIRECT_URI
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);
        const profileResponse = await axios.get('https://secure.indeed.com/v1/m/oauth2/userinfo', { headers: { Authorization: `Bearer ${access_token}` } });
        
        await db.query(`
            INSERT INTO linked_accounts (user_id, provider, external_id, access_token, refresh_token, expires_at, scopes) 
            VALUES (?, 'indeed', ?, ?, ?, ?, 'openid profile email')
            ON DUPLICATE KEY UPDATE 
            access_token = VALUES(access_token), refresh_token = VALUES(refresh_token), expires_at = VALUES(expires_at), last_sync = CURRENT_TIMESTAMP
        `, [state, profileResponse.data.sub, access_token, refresh_token, expiresAt]);

        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?link_success=true`);
    } catch (error) {
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?link_error=true`);
    }
});

module.exports = router;
