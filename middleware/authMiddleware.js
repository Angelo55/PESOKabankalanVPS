/**
 * JWT AUTHENTICATION GATE.
 *
 * WHAT: verifies the bearer token on an incoming request and attaches the
 * caller's identity to it — `req.userId` and `req.userRole` — which every
 * downstream route, service and ownership filter depends on.
 *
 * WHEN: mounted at the top of each protected router (`router.use(requireAuth)`),
 * so it runs before any handler in that file.
 *
 * HOW: the token is issued at login/registration-verify and stored in the
 * browser's sessionStorage, then sent as `Authorization: Bearer <token>`.
 * Signed with JWT_SECRET, 7-day expiry.
 *
 * WHY sessionStorage rather than a long-lived cookie: the session ends when the
 * tab closes, which suits shared and public-terminal use — a realistic scenario
 * for a municipal employment office where citizens use office machines.
 *
 * CONSEQUENCE FOR DOWNLOADS: a plain `window.open()` cannot attach this header,
 * so authenticated files (referral letters, ATS resumes, CSV exports) are
 * fetched as a blob and opened from an object URL instead. That is why those
 * download paths look more involved than a simple link.
 */

const jwt = require('jsonwebtoken');
const db = require('../db');
const { normalizeRole, getRoleLabel, getPermissions } = require('./rbac');

/**
 * SUSPENSION ENFORCEMENT (item 4) — server-side, on EVERY authenticated request.
 *
 * A valid JWT lives 7 days. Without this, an account suspended AFTER login kept full
 * access until its token expired — hiding frontend routes/buttons is not enough. So
 * after the token verifies, we confirm the account is not Suspended in the DB (one
 * PK lookup) and reject with a machine-readable 403 the client turns into a forced
 * logout + suspension notice. This closes the "existing session / direct route /
 * raw API request" bypasses the same way for all of them, because every protected
 * router mounts requireAuth.
 *
 * FAIL-OPEN on a lookup ERROR (logged): a transient DB blip must not 403 every user
 * at once, and the login gate (authRoutes) already blocks a suspended sign-in — this
 * per-request check is defense-in-depth. It fails CLOSED only on a definitive
 * 'Suspended' row. The suspension detail columns come from migration 046; before it
 * is applied the SELECT throws and we fail open (so the middleware is deploy-safe).
 */
async function assertNotSuspended(req, res) {
    try {
        const [rows] = await db.query(
            'SELECT account_status, suspension_reason, suspended_at, suspension_ends_at FROM users WHERE id = ?',
            [req.userId]
        );
        if (rows.length === 0) {
            res.status(401).json({ status: 'error', message: 'Account no longer exists.' });
            return false;
        }
        const u = rows[0];
        if (u.account_status === 'Suspended') {
            res.status(403).json({
                status: 'error',
                code: 'ACCOUNT_SUSPENDED',
                message: 'Your account has been suspended.',
                suspension: {
                    reason: u.suspension_reason || null,
                    suspendedAt: u.suspended_at || null,
                    endsAt: u.suspension_ends_at || null,
                },
            });
            return false;
        }
        return true;
    } catch (error) {
        // Fail-open: never mass-lock users over a DB hiccup or a pre-migration schema.
        console.error(`[Auth] Suspension check skipped on ${req.originalUrl}:`, error.message);
        return true;
    }
}

const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error(`[Auth Blocked] Missing/Invalid Header on route ${req.originalUrl}. Header received: ${authHeader}`);
        return res.status(401).json({ message: 'Authentication required. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    // 🚨 Safe block against literal strings like "undefined"
    if (!token || token === 'undefined' || token === 'null') {
        return res.status(401).json({ message: 'Authentication required. Invalid token format.' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        console.error(`[Auth Blocked] JWT Error on ${req.originalUrl}:`, error.message);
        return res.status(401).json({ message: 'Unauthorized. Invalid or expired token.' });
    }

    req.userId = decoded.userId || decoded.id;
    req.userRole = normalizeRole(decoded.role);
    req.roleLabel = getRoleLabel(req.userRole);
    req.permissions = getPermissions(req.userRole);

    // Block a suspended account even with a still-valid token (see header).
    if (!(await assertNotSuspended(req, res))) return;

    next();
};

module.exports = requireAuth;
