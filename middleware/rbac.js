/**
 * ROLE-BASED ACCESS CONTROL — the authoritative definition of who is who.
 *
 * WHAT: canonical role keys, the aliases that map legacy values onto them, and
 * the `requireRole` guard that route files use.
 *
 * WHEN: `requireRole(...)` runs on every protected request, after `requireAuth`
 * has verified the JWT and set `req.userId` / `req.userRole`.
 *
 * ── THE TRAP THIS MODULE EXISTS TO PREVENT ─────────────────────────────────
 * The STORED role value is not the DISPLAY label and is not always the value
 * you would guess:
 *
 *   ROLE_KEY               stored value          display label
 *   JOB_SEEKER             'applicant'           Job Seeker
 *   PESO_ADMINISTRATOR     'peso_administrator'  PESO Administrator
 *   SUPER_ADMINISTRATOR    'admin'               Super Administrator
 *
 * 'employer' is a LEGACY ALIAS for peso_administrator, still present on old
 * rows and old tokens. Code that compared `user.role === 'employer'` therefore
 * never matched -- in the Messages Hub that made a PESO administrator see their
 * OWN name as the person they were chatting with, because the "am I the admin?"
 * branch was permanently false.
 *
 * So: NEVER compare req.user.role to a raw string. Always normalizeRole() first.
 * The frontend mirrors this file in src/utils/roles.js; the two must agree.
 *
 * WHY GUARDS ARE NOT ENOUGH: requireRole answers "is this person an
 * administrator?", never "is this THEIR record?". Every protected endpoint must
 * ALSO filter by ownership (peso_admin_id = req.userId, user_id = req.userId).
 * Authentication is not authorization.
 */

const db = require('../db');

const ROLE_KEYS = {
    JOB_SEEKER: 'applicant',
    PESO_ADMINISTRATOR: 'peso_administrator',
    // PESO Staff / Co-worker (e.g. the office's social-media publication staff).
    // A LIMITED PESO role: Job Publication Manager (+ events) ONLY, never referral
    // decisions, the ATS, or administrative modules. Deliberately a SEPARATE role
    // from PESO_ADMINISTRATOR so the existing Manager-only requireRole guards
    // exclude staff by default (deny-by-default); job routes opt staff IN. Stored
    // value is 'peso_staff' (users.role is VARCHAR since migration 003 — no enum).
    PESO_STAFF: 'peso_staff',
    SUPER_ADMINISTRATOR: 'admin'
};

const ROLE_LABELS = {
    [ROLE_KEYS.JOB_SEEKER]: 'Job Seeker',
    [ROLE_KEYS.PESO_ADMINISTRATOR]: 'PESO Administrator',
    [ROLE_KEYS.PESO_STAFF]: 'PESO Staff',
    [ROLE_KEYS.SUPER_ADMINISTRATOR]: 'Super Administrator'
};

const ROLE_PERMISSIONS = {
    [ROLE_KEYS.JOB_SEEKER]: [
        'profile:manage',
        'jobs:view',
        'jobs:apply',
        'verification:submit'
    ],
    [ROLE_KEYS.PESO_ADMINISTRATOR]: [
        'jobs:manage',
        'applicants:manage',
        'referrals:decide',
        'recruitment:communicate',
        'employment_analytics:view',
        'events:manage',
        'walkin:manage'
    ],
    // The co-worker set: publish/manage vacancies and (when authorised) events —
    // and nothing to do with referral decisions, applicants, or analytics.
    [ROLE_KEYS.PESO_STAFF]: [
        'jobs:manage',
        'events:manage'
    ],
    [ROLE_KEYS.SUPER_ADMINISTRATOR]: [
        'platform:admin',
        'users:manage',
        'verification:manage',
        'jobs:moderate',
        'reports:view',
        'settings:manage',
        'audit_logs:view',
        'security:manage'
    ]
};

const ROLE_ALIASES = {
    applicant: ROLE_KEYS.JOB_SEEKER,
    job_seeker: ROLE_KEYS.JOB_SEEKER,
    jobseeker: ROLE_KEYS.JOB_SEEKER,
    employer: ROLE_KEYS.PESO_ADMINISTRATOR,
    peso_administrator: ROLE_KEYS.PESO_ADMINISTRATOR,
    peso_admin: ROLE_KEYS.PESO_ADMINISTRATOR,
    peso_staff: ROLE_KEYS.PESO_STAFF,
    job_publication_staff: ROLE_KEYS.PESO_STAFF,
    publication_staff: ROLE_KEYS.PESO_STAFF,
    admin: ROLE_KEYS.SUPER_ADMINISTRATOR,
    super_administrator: ROLE_KEYS.SUPER_ADMINISTRATOR,
    super_admin: ROLE_KEYS.SUPER_ADMINISTRATOR
};

const normalizeRole = (role) => {
    const key = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ROLE_ALIASES[key] || ROLE_KEYS.JOB_SEEKER;
};

const getRoleLabel = (role) => ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS[ROLE_KEYS.JOB_SEEKER];

const getPermissions = (role) => ROLE_PERMISSIONS[normalizeRole(role)] || ROLE_PERMISSIONS[ROLE_KEYS.JOB_SEEKER];

/**
 * Guards a route by CAPABILITY rather than by a hard-coded role list, reading the
 * permission set from ROLE_PERMISSIONS. Prefer this when several roles may hold the
 * same capability (e.g. both the PESO Manager and PESO Staff have `events:manage`),
 * so the access rule lives in the RBAC map — not duplicated across route files.
 * Requires ALL listed permissions. Runs after requireAuth (needs req.userId).
 */
const requirePermission = (...required) => async (req, res, next) => {
    try {
        const [users] = await db.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        const currentRole = normalizeRole(users[0]?.role);
        const perms = getPermissions(currentRole);

        if (!users.length || !required.every((p) => perms.includes(p))) {
            return res.status(403).json({
                status: 'error',
                message: 'You do not have permission to perform this action.'
            });
        }

        req.userRole = currentRole;
        req.roleLabel = getRoleLabel(currentRole);
        req.permissions = perms;
        next();
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Authorization check failed.' });
    }
};

const requireRole = (...allowedRoles) => async (req, res, next) => {
    try {
        const allowed = allowedRoles.map(normalizeRole);
        const [users] = await db.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        const currentRole = normalizeRole(users[0]?.role);

        if (!users.length || !allowed.includes(currentRole)) {
            return res.status(403).json({
                status: 'error',
                message: `Forbidden. ${allowed.map(getRoleLabel).join(' or ')} access required.`
            });
        }

        req.userRole = currentRole;
        req.roleLabel = getRoleLabel(currentRole);
        req.permissions = getPermissions(currentRole);
        next();
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Authorization check failed.' });
    }
};

module.exports = {
    ROLE_KEYS,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    // Exported so callers that WRITE a role can check whether the input was
    // actually recognised. normalizeRole() cannot answer that: it maps anything
    // unknown to JOB_SEEKER, which is the right behaviour when reading a legacy
    // value and the wrong one when assigning a new role -- there, an
    // unrecognised token must be rejected, not silently turned into a demotion.
    ROLE_ALIASES,
    normalizeRole,
    getRoleLabel,
    getPermissions,
    requireRole,
    requirePermission
};
