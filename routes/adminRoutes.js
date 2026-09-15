/**
 * SUPER ADMINISTRATOR API — platform governance.
 *
 * WHAT: everything the Super Administrator can do that no other role can —
 * platform metrics, account management, role administration, job moderation,
 * the audit trail, system settings, and operational health.
 *
 * WHO: `admin` only. Note that the STORED role value for a Super Administrator
 * is literally 'admin', which is not the same thing as a PESO Administrator
 * ('peso_administrator'). Comparing raw strings here is how the account matrix
 * ended up mislabelling every PESO Administrator — always normalizeRole().
 *
 * ── WHY THESE ENDPOINTS ARE NOT OWNER-SCOPED ───────────────────────────────
 * Every other admin surface in this system filters by owner: a PESO
 * Administrator sees only their own vacancies and applicants. These endpoints
 * deliberately do not, because platform governance means seeing everything.
 * The role check IS the whole access control, which is why it must be exact.
 *
 * ── AUDITING ───────────────────────────────────────────────────────────────
 * Destructive and privilege-affecting actions record an entry through
 * services/adminAuditService. Before that service existed, exactly one action
 * on the platform wrote an audit entry; suspending an account and deleting a
 * job posting left no trace. If you add an action here that affects a real
 * person, record it.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────
 * Role administration lives in services/roleAdminService and is the single
 * most dangerous operation in the platform: there are two Super Administrators
 * and no way to create one except promotion by an existing one. Read that
 * file's header before touching it.
 */

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const { requireRole, ROLE_KEYS, ROLE_ALIASES, getRoleLabel, normalizeRole } = require('../middleware/rbac');
const { getPageParams } = require('../utils/pagination');

// Canonical role key -> every stored `users.role` value that maps to it (incl.
// the legacy 'employer' alias for PESO Administrator), so a role filter matches
// old rows too. Superset is safe: an alias that was never stored just never hits.
const storedRoleValues = (roleKey) =>
    Object.keys(ROLE_ALIASES).filter((k) => ROLE_ALIASES[k] === roleKey);
const adminAudit = require('../services/adminAuditService');
const roleAdmin = require('../services/roleAdminService');
const systemSettings = require('../services/systemSettingsService');
const { referralService } = require('../services/referralService');
const { buildAccomplishmentExport } = require('../services/reportingService');
const emailOutboxService = require('../services/emailOutboxService');
const smsOutboxService = require('../services/smsOutboxService');
const { notifyUser } = require('../services/notificationService');
const { appUrl } = require('../utils/appUrl');
const applicationScoringService = require('../services/applicationScoringService');
const jobAlertsService = require('../services/jobAlertsService');
const proactiveReferralService = require('../services/proactiveReferralService');

const router = express.Router();
// --- Featured image upload (job postings) ---------------------------------
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const storageService = require('../services/storageService');

/**
 * Standardized account status-change email (item 4). Returned as an emailOutboxService
 * payload; the caller enqueues it (durable, retryable, best-effort). PESO office contact
 * is stated so the user knows how to appeal/enquire.
 */
function buildStatusEmail({ to, name, suspended, reason = null, endsAt = null }) {
    const CONTACT = 'the PESO Kabankalan office (City Hall, Kabankalan City) or reply to this email';
    const greeting = name ? `Hello ${name},` : 'Hello,';
    if (suspended) {
        const dateStr = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
        const endStr = endsAt ? new Date(endsAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : null;
        const rows = [
            ['Account status', 'Suspended'],
            ['Effective date', dateStr],
            reason ? ['Reason', reason] : null,
            endStr ? ['Review / end date', endStr] : null,
        ].filter(Boolean);
        const rowsHtml = rows.map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:bold;color:#374151;">${k}</td><td style="padding:6px 12px;color:#111827;">${v}</td></tr>`).join('');
        const rowsText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
        return {
            to, category: 'security_alert',
            subject: 'Your PESO Kabankalan account has been suspended',
            html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <div style="background:#003631;padding:22px;color:#fff;text-align:center;"><h2 style="margin:0;font-size:18px;">PESO Kabankalan Employment System</h2><p style="margin:6px 0 0;font-size:13px;opacity:.85;">Account Status Notice</p></div>
                <div style="padding:24px;"><p>${greeting}</p><p>Your account has been <strong>suspended</strong> and you will not be able to sign in until it is reactivated.</p>
                <table style="border-collapse:collapse;margin:14px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;width:100%;">${rowsHtml}</table>
                <p style="font-size:14px;">If you believe this is a mistake or want to appeal, please contact ${CONTACT}.</p></div>
                <div style="background:#f9fafb;padding:12px 24px;font-size:12px;color:#9ca3af;text-align:center;">Public Employment Service Office &mdash; Kabankalan City</div></div>`,
            text: `${greeting}\n\nYour PESO Kabankalan account has been SUSPENDED and you cannot sign in until it is reactivated.\n\n${rowsText}\n\nIf you believe this is a mistake or want to appeal, please contact ${CONTACT}.\n`,
        };
    }
    // Direct sign-in link so the user can return immediately. It is a plain app URL —
    // auth is still enforced (no token, no auto-login); a logged-out click hits sign-in.
    const signInUrl = appUrl('/');
    return {
        to, category: 'security_alert',
        subject: 'Your PESO Kabankalan account has been reactivated',
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <div style="background:#003631;padding:22px;color:#fff;text-align:center;"><h2 style="margin:0;font-size:18px;">PESO Kabankalan Employment System</h2><p style="margin:6px 0 0;font-size:13px;opacity:.85;">Account Status Notice</p></div>
            <div style="padding:24px;"><p>${greeting}</p><p>Good news — your account has been <strong>reactivated</strong>. You can sign in again and use PESO Kabankalan as normal.</p>
            <div style="text-align:center;margin:22px 0 6px;"><a href="${signInUrl}" style="display:inline-block;background:#4F7942;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 28px;border-radius:10px;">Sign in to your account</a></div>
            <p style="font-size:12px;color:#6b7280;text-align:center;">Or open: <a href="${signInUrl}" style="color:#4F7942;">${signInUrl}</a></p></div>
            <div style="background:#f9fafb;padding:12px 24px;font-size:12px;color:#9ca3af;text-align:center;">Public Employment Service Office &mdash; Kabankalan City</div></div>`,
        text: `${greeting}\n\nGood news — your PESO Kabankalan account has been REACTIVATED. You can sign in again and use the platform as normal.\n\nSign in: ${signInUrl}\n`,
    };
}

const jobImageUpload = multer({
	// Memory storage → the route hands the buffer to the centralized storageService
	// (local uploads/ in dev, Cloudflare R2 in production). Validation stays here.
	storage: multer.memoryStorage(),
	limits: { fileSize: 8 * 1024 * 1024 },
	fileFilter: (req, file, cb) => {
		const allowed = ['image/jpeg', 'image/png', 'image/webp'];
		if (!allowed.includes(file.mimetype)) {
			return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
		}
		cb(null, true);
	}
});
router.use(requireAuth);
router.use(requireRole(ROLE_KEYS.SUPER_ADMINISTRATOR));

const safeQuery = async (queryText, params, defaultResponse) => {
    try {
        const [rows] = await db.query(queryText, params);
        return rows;
    } catch (error) {
        console.warn(`[SafeQuery Warning] Gracefully skipping query: ${error.message}`);
        return defaultResponse;
    }
};

/**
 * GET /api/admin/reports/accomplishment?from=&to=&format=json|pdf|csv
 * Super Administrator only (router-level guard). OFFICE-WIDE (ownerId=null) — the DOLE
 * PESO Accomplishment Report across all administrators. Same builder as the PESO-admin
 * owner-scoped version in referralRoutes, differing only in scope.
 */
router.get('/reports/accomplishment', async (req, res) => {
    try {
        const format = ['pdf', 'csv'].includes(req.query.format) ? req.query.format : 'json';
        const out = await buildAccomplishmentExport({ ownerId: null, from: req.query.from, to: req.query.to, format });
        if (format === 'json') return res.status(200).json({ status: 'success', data: out.body });
        res.setHeader('Content-Type', out.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
        return res.send(out.body);
    } catch (error) {
        const code = error.statusCode || 500;
        return res.status(code).json({ status: 'error', message: error.message || 'Failed to build the report.' });
    }
});

// Job Seeker Verification decommissioned (2026-08-01): the getJobSeekerVerification
// Rows helper and the /verifications/* admin endpoints that fed the review queue
// were removed by product decision. job_seeker_verifications / verification_history
// are left dormant (not dropped on live TiDB, §0.7).

// ==========================================
// 1. DASHBOARD METRICS AGGREGATION
// ==========================================
router.get('/metrics', async (req, res) => {
    try {
        const users = await safeQuery(`SELECT COUNT(*) as total, SUM(CASE WHEN role = 'applicant' THEN 1 ELSE 0 END) AS job_seeker_count, SUM(CASE WHEN role = 'employer' THEN 1 ELSE 0 END) AS employer_count FROM users`, [], [{ total: 0, job_seeker_count: 0, employer_count: 0 }]);
        const jobs = await safeQuery(`SELECT COUNT(*) as active FROM pesoadmin_job_posts WHERE status IN ('Open', 'Published')`, [], [{ active: 0 }]);
        const applications = await safeQuery(`SELECT COUNT(*) as total FROM job_applications`, [], [{ total: 0 }]);

        res.status(200).json({
            status: 'success',
            data: {
                users: {
                    total: users[0]?.total || 0,
                    // Keys mirror what AdminDashboard.jsx reads.
                    job_seekers: users[0]?.job_seeker_count || 0,
                    employers: users[0]?.employer_count || 0
                },
                // Job Seeker Verification was decommissioned (2026-08-01); the
                // Pending Verification metric and its dashboard card were removed.
                jobs: { active: jobs[0]?.active || 0 },
                applications: { total: applications[0]?.total || 0 }
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to aggregate dashboard metrics.' });
    }
});

// Job Seeker Verification MANAGEMENT endpoints removed (2026-08-01) — the
// approval workflow (GET /verifications/job-seekers, GET /verifications/employers,
// PATCH /verifications/:userId) is decommissioned. The Super Admin verification
// queue that consumed them is gone with it.

// ==========================================
// PLATFORM ACTIVITY FEED 
// ==========================================
router.get('/activity-feed', async (req, res) => {
    try {
        const query = `
            SELECT 'user' AS type, name AS entity_name, role AS detail, created_at AS timestamp 
            FROM users
            
            UNION ALL
            
            SELECT 'job' AS type, title AS entity_name, company AS detail, created_at AS timestamp 
            FROM pesoadmin_job_posts
            
            UNION ALL
            
            SELECT 'application' AS type, 
                   COALESCE((SELECT name FROM users WHERE id = ja.applicant_id), 'Unknown Applicant') AS entity_name, 
                   COALESCE((SELECT title FROM pesoadmin_job_posts WHERE id = ja.job_id), 'Unknown Job') AS detail, 
                   applied_at AS timestamp 
            FROM job_applications ja
            
            ORDER BY timestamp DESC 
            LIMIT 20
        `;
        const feed = await safeQuery(query, [], []);
        const labeledFeed = feed.map(item => ({
            ...item,
            detail_label: item.type === 'user' ? getRoleLabel(item.detail) : item.detail
        }));
        res.status(200).json({ status: 'success', data: labeledFeed });
    } catch (error) {
        console.error("Admin Activity Feed Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch activity feed.' });
    }
});

// ==========================================
// LOGS, USERS & JOB MANAGEMENT 
// ==========================================
/**
 * GET /api/admin/logs
 * The dashboard's recent-activity panel. Ten most recent entries, no filters.
 *
 * The inline CREATE TABLE that used to sit here has been removed. It declared
 * FEWER columns than the live table (no target_id, no action_details), and
 * because CREATE TABLE IF NOT EXISTS silently skips a table that already
 * exists with a different shape, it never ran and never complained -- while
 * documenting a schema that was wrong. Schema belongs in migrations.
 */
router.get('/logs', async (req, res) => {
    try {
        const { rows } = await adminAudit.list({ limit: 10 });
        res.status(200).json({ status: 'success', data: rows });
    } catch (error) { res.status(500).json({ status: 'error', message: 'Failed to fetch audit logs.' }); }
});

/**
 * GET /api/admin/audit-logs?action=&adminId=&from=&to=&limit=&offset=
 *
 * The full, filterable audit trail. The endpoint above is capped at 10 because
 * it feeds a dashboard panel -- which meant the rest of the history had no way
 * of being read at all. For a government platform the trail is the
 * accountability record, so it needs to be searchable, not just recent.
 */
router.get('/audit-logs', async (req, res) => {
    try {
        const result = await adminAudit.list({
            action: req.query.action || null,
            adminId: req.query.adminId || null,
            from: req.query.from || null,
            to: req.query.to || null,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        res.status(200).json({ status: 'success', ...result });
    } catch (error) {
        console.error('[Admin] Audit log query failed:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch audit logs.' });
    }
});

/** GET /api/admin/audit-logs/actions — distinct action names, for the filter. */
router.get('/audit-logs/actions', async (req, res) => {
    try {
        res.status(200).json({ status: 'success', data: await adminAudit.listActions() });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to load actions.' });
    }
});

// ==========================================
// SYSTEM SETTINGS
// ==========================================

/** GET /api/admin/settings — every setting, its effective value and metadata. */
router.get('/settings', async (req, res) => {
    try {
        res.status(200).json({ status: 'success', data: await systemSettings.getAll() });
    } catch (error) {
        console.error('[Admin] Settings read failed:', error);
        res.status(500).json({ status: 'error', message: 'Failed to load settings.' });
    }
});

/**
 * PUT /api/admin/settings/:key
 *
 * Validation lives in systemSettingsService, not here: setting_value is TEXT,
 * so the database accepts anything, and a threshold of "abc" would silently
 * become NaN and stop the referral queue filling with no error anywhere.
 */
router.put('/settings/:key', async (req, res) => {
    try {
        const value = await systemSettings.set(req.params.key, req.body?.value, req.userId);

        await adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.SETTING_CHANGED,
            targetEntity: req.params.key,
            details: `Set to "${value}".`,
        });

        res.status(200).json({ status: 'success', message: 'Setting saved.', data: { key: req.params.key, value } });
    } catch (error) {
        if (error instanceof systemSettings.SettingsError) {
            return res.status(error.status).json({ status: 'error', message: error.message });
        }
        console.error('[Admin] Settings write failed:', error);
        res.status(500).json({ status: 'error', message: 'Failed to save setting.' });
    }
});

/** DELETE /api/admin/settings/:key — drop the override, restore the default. */
router.delete('/settings/:key', async (req, res) => {
    try {
        const value = await systemSettings.reset(req.params.key);

        await adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.SETTING_CHANGED,
            targetEntity: req.params.key,
            details: `Reset to the system default ("${value}").`,
        });

        res.status(200).json({ status: 'success', message: 'Setting reset to default.', data: { key: req.params.key, value } });
    } catch (error) {
        if (error instanceof systemSettings.SettingsError) {
            return res.status(error.status).json({ status: 'error', message: error.message });
        }
        res.status(500).json({ status: 'error', message: 'Failed to reset setting.' });
    }
});

// ==========================================
// OPERATIONAL HEALTH
// ==========================================

/**
 * GET /api/admin/health
 *
 * Answers "is the platform actually working right now?" — a question nothing
 * in the system could answer before. The referral worker in particular runs
 * in-process and silently: if it stalls, letters stop being delivered and the
 * only visible symptom is referrals sitting in "Queued" that nobody is
 * watching.
 *
 * Every probe is wrapped independently. A failing check reports itself as
 * unhealthy rather than 500-ing the page an administrator opened to find out
 * what is wrong -- the same reason safeQuery exists for the dashboards.
 */
router.get('/health', async (req, res) => {
    const probe = async (fn, fallback) => {
        try { return await fn(); } catch (error) { return { ...fallback, error: error.message }; }
    };

    const [outbox, deadLettered, mail, letters, database, emailOutbox, applicationScoring, jobAlerts, proactiveReferral, smsOutbox] = await Promise.all([
        probe(async () => {
            const [rows] = await db.query(
                `SELECT status, COUNT(*) AS count FROM referral_jobs GROUP BY status`
            );
            return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
        }, { unavailable: true }),

        probe(async () => {
            // Stuck = claimed but not advanced for 15 minutes. The worker
            // reclaims these on boot, so a non-zero count that persists means
            // the worker is not running at all.
            const [[{ stuck }]] = await db.query(
                `SELECT COUNT(*) AS stuck FROM referral_jobs
                  WHERE status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
            );
            const [[{ failed }]] = await db.query(
                `SELECT COUNT(*) AS failed FROM referral_jobs WHERE status = 'failed'`
            );
            return { stuck: Number(stuck), failed: Number(failed) };
        }, { unavailable: true }),

        probe(async () => {
            // Live per-provider reachability (primary + optional failover), so the
            // health page shows exactly which sender is up — not just whether mail
            // is configured. `healthy` is true if AT LEAST ONE provider verifies,
            // which matches the failover contract in sendMail.
            const { getMailHealth } = require('../services/mailService');
            return await getMailHealth();
        }, { configured: 0, providers: [], healthy: false }),

        probe(async () => {
            const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM referral_letters');
            const [[{ durable }]] = await db.query('SELECT COUNT(*) AS durable FROM referral_letter_files');
            // A gap here means letters exist whose PDF is only on the ephemeral
            // filesystem -- one deploy from being unrecoverable.
            return { total: Number(total), durable: Number(durable), atRisk: Number(total) - Number(durable) };
        }, { unavailable: true }),

        probe(async () => {
            const started = Date.now();
            await db.query('SELECT 1');
            return { reachable: true, latencyMs: Date.now() - started };
        }, { reachable: false }),

        // Generic email outbox (Phase 2C). Reports whether the worker is enabled,
        // how many rows are waiting, how many dead-lettered, and how long the
        // oldest pending row has waited (a rising age = the worker stalled/off).
        // Independent probe so a query blip here degrades this card, not the page.
        probe(async () => emailOutboxService.getHealth(), { enabled: false, pending: 0, failed: 0, oldestPendingAgeMinutes: 0, unavailable: true }),

        // Application re-scoring backlog (Enhancement B). Independent probe so a
        // query blip degrades this card, not the whole page.
        probe(async () => applicationScoringService.getHealth(), { enabled: false, pending: 0, failed: 0, unavailable: true }),

        // AI job-alert matching backlog + digest staging (Enhancement D).
        probe(async () => jobAlertsService.getHealth(), { enabled: false, pending: 0, failed: 0, staged: 0, unavailable: true }),

        // Proactive AI Referral matching backlog + queue depth (Phase 1). Independent
        // probe so a query blip degrades this card, not the whole page.
        probe(async () => proactiveReferralService.getHealth(), { enabled: false, pending: 0, failed: 0, suggested: 0, unavailable: true }),

        // SMS delivery backlog (#8). Reports whether a provider is configured and how
        // many texts are waiting / dead-lettered. Independent probe so a query blip
        // degrades this card, not the page.
        probe(async () => smsOutboxService.getHealth(), { configured: false, pending: 0, failed: 0, oldestPendingAgeMinutes: 0, unavailable: true }),
    ]);

    res.status(200).json({
        status: 'success',
        data: {
            database,
            mail,
            emailOutbox,
            applicationScoring,
            jobAlerts,
            proactiveReferral,
            smsOutbox,
            // Per-provider AI status + circuit-breaker state (P1 aiClient), so the
            // health page shows which provider is primary/fallback and whether a
            // breaker has tripped — not just "a key exists".
            ai: require('../services/aiClient').getAiHealth(),
            aiConfigured: Boolean(process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY),
            referralWorker: { outbox, ...deadLettered },
            letters,
            checkedAt: new Date().toISOString(),
        },
    });
});

// ── Workflow automation (Make.com) monitor + replay ─────────────────────────
// Platform-wide view for the Super Administrator: whether the automation webhook
// is configured, how many referrals dispatched / are undispatched / failed /
// pending, and the undispatched list. Replay re-queues ONLY the automation dispatch
// step (never the letter). The automation (Make.com; the self-hosted n8n it replaced
// is retired, §70) is a downstream consumer, so an undispatched referral is a sync
// gap to recover, never a failed referral (invariant 0.10). The persisted audit
// action stays `N8N_REPLAY` and the step key `dispatch_n8n` (§59 — do not rename).
router.get('/automation', async (req, res) => {
    try {
        const data = await referralService.getAutomationStatus();
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error('[Admin] automation status failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load automation status.' });
    }
});

router.post('/automation/replay', async (req, res) => {
    try {
        const ids = (Array.isArray(req.body?.queueIds) ? req.body.queueIds : [])
            .map((n) => parseInt(n, 10))
            .filter(Number.isInteger);
        if (ids.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No referrals selected to replay.' });
        }

        const result = await referralService.replayN8nDispatch(ids, req.userId);

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.N8N_REPLAY,
            targetEntity: 'referral_queue',
            targetId: null,
            details: `Re-queued automation (Make.com) dispatch for ${result.requeued} referral(s) (${result.skipped} skipped).`,
        });

        res.status(200).json({
            status: 'success',
            message: `Re-queued ${result.requeued} referral${result.requeued === 1 ? '' : 's'} for automation dispatch.`,
            data: result,
        });
    } catch (error) {
        console.error('[Admin] automation replay failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to re-queue dispatch.' });
    }
});

// ── Email delivery monitor + resend (Phase 2C generic outbox) ────────────────
// Platform-wide view of every transactional email (password reset, contact,
// OTP, security alerts): pending / sent / failed counts and the recent rows,
// with a resend for dead-lettered ones. Mirrors the Workflow Automation surface
// above. This is a SEPARATE channel from in-app notifications (invariant 0.11).
router.get('/email', async (req, res) => {
    try {
        const data = await emailOutboxService.getStatus();
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error('[Admin] email status failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load email delivery status.' });
    }
});

router.post('/email/resend', async (req, res) => {
    try {
        const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
            .map((n) => parseInt(n, 10))
            .filter(Number.isInteger);
        if (ids.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No emails selected to resend.' });
        }

        const result = await emailOutboxService.resend(ids);

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.EMAIL_RESEND,
            targetEntity: 'email_outbox',
            targetId: null,
            details: `Re-queued ${result.requeued} email(s) for delivery (${result.skipped} skipped).`,
        });

        res.status(200).json({
            status: 'success',
            message: `Re-queued ${result.requeued} email${result.requeued === 1 ? '' : 's'} for delivery.`,
            data: result,
        });
    } catch (error) {
        console.error('[Admin] email resend failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to re-queue email delivery.' });
    }
});

// ── SMS delivery monitor + resend (#8 SMS outbox) ───────────────────────────
// Platform-wide view of the SMS channel: whether a provider is configured, the
// pending / sent / failed counts and recent rows, with a resend for dead-lettered
// ones. Mirrors the Email Delivery surface. A SEPARATE channel from in-app + email
// (invariant 0.11); recipient numbers are masked before they cross the wire.
const maskNumber = (n) => {
    const s = String(n || '');
    return s.length > 4 ? `${s.slice(0, s.length - 4).replace(/\d/g, '•')}${s.slice(-4)}` : s;
};

router.get('/sms', async (req, res) => {
    try {
        const data = await smsOutboxService.getStatus();
        // Do not expose full mobile numbers on the monitor — mask all but the last 4.
        if (Array.isArray(data.recent)) {
            data.recent = data.recent.map((r) => ({ ...r, to_number: maskNumber(r.to_number) }));
        }
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error('[Admin] sms status failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load SMS delivery status.' });
    }
});

router.post('/sms/resend', async (req, res) => {
    try {
        const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
            .map((n) => parseInt(n, 10))
            .filter(Number.isInteger);
        if (ids.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No messages selected to resend.' });
        }

        const result = await smsOutboxService.resend(ids);

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.SMS_RESEND,
            targetEntity: 'sms_outbox',
            targetId: null,
            details: `Re-queued ${result.requeued} SMS message(s) for delivery (${result.skipped} skipped).`,
        });

        res.status(200).json({
            status: 'success',
            message: `Re-queued ${result.requeued} message${result.requeued === 1 ? '' : 's'} for delivery.`,
            data: result,
        });
    } catch (error) {
        console.error('[Admin] sms resend failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to re-queue SMS delivery.' });
    }
});

// AI job-alert monitor (Enhancement D): whether the worker is on + backlog/sent/staged.
router.get('/job-alerts', async (req, res) => {
    try {
        res.status(200).json({ status: 'success', data: await jobAlertsService.getStatus() });
    } catch (error) {
        console.error('[Admin] job-alerts status failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load job-alert status.' });
    }
});

// Proactive AI Referral monitor (Phase 4): worker/sub-flag state + queue depth
// (pending/failed match tasks, suggested/promoted/dismissed candidates).
router.get('/proactive', async (req, res) => {
    try {
        res.status(200).json({ status: 'success', data: await proactiveReferralService.getStatus() });
    } catch (error) {
        console.error('[Admin] proactive status failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load proactive referral status.' });
    }
});

// Per-route latency (p95/max/avg), slowest first — the measured baseline for the
// performance work. Backed by the in-process requestTiming middleware (resets on
// restart). ?reset=1 clears the counters to start a fresh measurement window.
router.get('/timing', (req, res) => {
    try {
        const { getTimingSummary, resetTimingStats } = require('../middleware/requestTiming');
        if (String(req.query.reset) === '1') { resetTimingStats(); return res.status(200).json({ status: 'success', message: 'Timing stats reset.' }); }
        res.status(200).json({ status: 'success', data: getTimingSummary() });
    } catch (error) {
        console.error('[Admin] timing summary failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load timing stats.' });
    }
});

router.get('/users', async (req, res) => {
    try {
        // SERVER-SIDE pagination + search + role filter (Phase 1). The account
        // matrix grows unbounded (every account on the platform), so search and
        // paging moved off the client — the browser no longer receives, or filters,
        // the whole table. Response gains { total, page, limit } alongside `data`.
        const { limit, page, offset } = getPageParams(req.query, { defaultLimit: 20, maxLimit: 100 });
        const q = String(req.query.q || '').trim();
        const roleKey = String(req.query.role || '').trim();
        const statusFilter = String(req.query.status || '').trim();   // Active | Suspended (item 4)
        const sort = String(req.query.sort || '').trim();             // joined_desc(default)|joined_asc|name_asc|name_desc

        const where = [];
        const params = [];
        if (q) { const like = `%${q}%`; where.push('(name LIKE ? OR email LIKE ?)'); params.push(like, like); }
        if (roleKey && Object.values(ROLE_KEYS).includes(roleKey)) {
            const stored = storedRoleValues(roleKey);
            if (stored.length) { where.push('role IN (?)'); params.push(stored); }
        }
        // Account-status filter. 'Active' includes legacy NULL rows (pre-suspension
        // feature accounts have a NULL account_status but are functionally active).
        if (statusFilter === 'Suspended') { where.push(`account_status = 'Suspended'`); }
        else if (statusFilter === 'Active') { where.push(`(account_status = 'Active' OR account_status IS NULL)`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        // Whitelisted sort (never interpolate raw user input into ORDER BY).
        const ORDER_BY = {
            joined_desc: 'created_at DESC',
            joined_asc: 'created_at ASC',
            name_asc: 'name ASC',
            name_desc: 'name DESC',
        };
        const orderSql = ORDER_BY[sort] || ORDER_BY.joined_desc;

        // avatar_thumb, never avatar_url: full-size avatars are base64 data URIs
        // averaging ~319KB, so selecting them for a list would cost megabytes.
        // COALESCE falls back to the original for rows uploaded before thumbnails.
        const [users] = await db.query(`
            SELECT id, name, email, role, account_status, created_at,
                   suspended_at, suspension_reason, suspension_ends_at,
                   COALESCE(avatar_thumb, avatar_url) AS avatar_url
            FROM users
            ${whereSql}
            ORDER BY ${orderSql}
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);

        res.status(200).json({
            status: 'success',
            data: users.map(user => ({ ...user, role_label: getRoleLabel(user.role) })),
            total: Number(total), page, limit,
        });
    } catch (error) { res.status(500).json({ status: 'error', message: 'Failed to fetch users.' }); }
});

/**
 * PUT /api/admin/users/:id/role
 *
 * THE MOST DANGEROUS ENDPOINT IN THE PLATFORM. All of the reasoning, the
 * last-Super-Administrator guard, the self-demotion guard and the transactional
 * audit entry live in services/roleAdminService.js — read its header before
 * changing anything here.
 *
 * This handler only parses, delegates, and translates errors.
 */
router.put('/users/:id/role', async (req, res) => {
	const targetUserId = Number.parseInt(req.params.id, 10);

	if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
		return res.status(400).json({ status: 'error', message: 'A valid user ID is required.' });
	}

	try {
		const result = await roleAdmin.changeUserRole({
			targetUserId,
			nextRoleInput: req.body?.role,
			actingAdminId: req.userId,
			reason: req.body?.reason,
		});

		return res.status(200).json({
			status: 'success',
			message: `${result.name} is now a ${result.newRoleLabel}.`,
			data: result,
		});
	} catch (error) {
		if (error instanceof roleAdmin.RoleAdminError) {
			return res.status(error.status).json({ status: 'error', message: error.message });
		}
		console.error('[Admin] Role change failed:', error);
		return res.status(500).json({ status: 'error', message: 'Could not change that role.' });
	}
});

/**
 * GET /api/admin/roles
 * The roles that can be assigned, plus how many Super Administrators exist —
 * so the UI can warn BEFORE an action is attempted rather than only rejecting
 * it afterwards.
 */
router.get('/roles', async (req, res) => {
	try {
		const superAdminCount = await roleAdmin.countSuperAdmins();
		return res.status(200).json({
			status: 'success',
			data: {
				assignable: roleAdmin.ASSIGNABLE_ROLES.map((key) => ({ key, label: getRoleLabel(key) })),
				superAdminCount,
			},
		});
	} catch (error) {
		return res.status(500).json({ status: 'error', message: 'Could not load roles.' });
	}
});

router.put('/users/:id/status', async (req, res) => {
    try {
        const { status, reason, endsAt } = req.body;

        // Allow-list. account_status is a plain VARCHAR, so an unchecked value
        // would be stored happily and then match neither the "Active" nor the
        // "Suspended" branch anywhere in the app -- an account in a state no
        // screen can represent and no query can filter.
        if (!['Active', 'Suspended'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Status must be Active or Suspended.' });
        }

        const [rows] = await db.query('SELECT id, name, email, role FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'That account no longer exists.' });
        }

        // A suspended Super Administrator cannot sign in to undo it, and with
        // two of them a mistake here is one step from locking the platform.
        if (status === 'Suspended' && normalizeRole(rows[0].role) === ROLE_KEYS.SUPER_ADMINISTRATOR) {
            return res.status(409).json({ status: 'error', message: 'Super Administrator accounts cannot be suspended.' });
        }

        // Suspension metadata (migration 046) — captured on Suspend, CLEARED on
        // reactivation. suspension_ends_at is INFORMATIONAL only (the platform does not
        // auto-reactivate; a passed end date changes nothing until an admin reactivates).
        const cleanReason = status === 'Suspended' ? (String(reason || '').trim().slice(0, 500) || null) : null;
        let endsAtValue = null;
        if (status === 'Suspended' && endsAt) {
            const d = new Date(endsAt);
            if (!Number.isNaN(d.getTime())) endsAtValue = d;
        }

        if (status === 'Suspended') {
            await db.query(
                `UPDATE users SET account_status = 'Suspended', suspended_at = NOW(),
                        suspension_reason = ?, suspension_ends_at = ?, suspended_by = ?
                 WHERE id = ?`,
                [cleanReason, endsAtValue, req.userId, req.params.id]
            );
        } else {
            await db.query(
                `UPDATE users SET account_status = 'Active', suspended_at = NULL,
                        suspension_reason = NULL, suspension_ends_at = NULL, suspended_by = NULL
                 WHERE id = ?`,
                [req.params.id]
            );
        }

        // Best-effort: suspending an abusive account must not be blocked by a
        // logging failure. Never throws (see adminAuditService).
        await adminAudit.record({
            adminId: req.userId,
            action: status === 'Suspended'
                ? adminAudit.AUDIT_ACTIONS.ACCOUNT_SUSPENDED
                : adminAudit.AUDIT_ACTIONS.ACCOUNT_REACTIVATED,
            targetEntity: rows[0].name || rows[0].email,
            targetId: rows[0].id,
            details: status === 'Suspended'
                ? `Account suspended.${cleanReason ? ` Reason: ${cleanReason}.` : ''}${endsAtValue ? ` Until ${endsAtValue.toISOString().slice(0, 10)}.` : ''}`
                : 'Account reactivated.',
        });

        // Notify the affected user across the available channels (item 4). All
        // best-effort — a delivery failure never blocks the status change (0.1):
        //   • In-app  — notifyUser (ACCOUNT_SUSPENDED/REACTIVATED); the channel router
        //               also fans a suspension out to SMS IF sms is enabled + the phone
        //               is verified & opted-in (never a hard dependency).
        //   • Email   — enqueued with the full standardized notice.
        // (A suspended user can't open the app to see the in-app row until reactivated;
        //  email/SMS are the real reach. The row is still written for the record.)
        try {
            const io = req.app.get('io');
            if (status === 'Suspended') {
                await notifyUser(io, {
                    userId: rows[0].id,
                    type: 'ACCOUNT_SUSPENDED',
                    title: 'Your account has been suspended',
                    body: cleanReason
                        ? `Reason: ${cleanReason}. Please contact the PESO Kabankalan office.`
                        : 'Please contact the PESO Kabankalan office for assistance.',
                });
                emailOutboxService.enqueue(buildStatusEmail({
                    to: rows[0].email, name: rows[0].name, suspended: true,
                    reason: cleanReason, endsAt: endsAtValue,
                }));
            } else {
                await notifyUser(io, {
                    userId: rows[0].id,
                    type: 'ACCOUNT_REACTIVATED',
                    title: 'Your account has been reactivated',
                    body: 'You can sign in again and use PESO Kabankalan as normal.',
                    link: '/',
                });
                emailOutboxService.enqueue(buildStatusEmail({ to: rows[0].email, name: rows[0].name, suspended: false }));
            }
        } catch (notifyErr) {
            console.warn('[Admin] Status-change notification skipped:', notifyErr.message);
        }

        res.status(200).json({ status: 'success', message: `Account is now ${status}.` });
    } catch (error) { res.status(500).json({ status: 'error', message: 'Failed to update status.' }); }
});

router.get('/jobs', async (req, res) => {
    try {
        // SERVER-SIDE pagination + search + status filter (Phase 1). Job Moderation
        // lists every posting on the platform; search/paging moved off the client.
        const { limit, page, offset } = getPageParams(req.query, { defaultLimit: 18, maxLimit: 100 });
        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '').trim();

        const where = [];
        const params = [];
        if (q) { const like = `%${q}%`; where.push('(pj.title LIKE ? OR pj.company LIKE ? OR u.name LIKE ?)'); params.push(like, like, like); }
        if (status) { where.push('pj.status = ?'); params.push(status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [jobs] = await db.query(`
            SELECT pj.*, u.name as employer_name, u.email as employer_email,
                   (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = pj.id) as application_count
            FROM pesoadmin_job_posts pj
            JOIN users u ON pj.peso_admin_id = u.id
            ${whereSql}
            ORDER BY pj.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const [[{ total }]] = await db.query(`
            SELECT COUNT(*) AS total
            FROM pesoadmin_job_posts pj JOIN users u ON pj.peso_admin_id = u.id
            ${whereSql}
        `, params);

        res.status(200).json({ status: 'success', data: jobs, total: Number(total), page, limit });
    } catch (error) { res.status(500).json({ status: 'error', message: 'Failed to fetch jobs.' }); }
});

router.delete('/jobs/:id', async (req, res) => {
    try {
        // Read before deleting: once the row is gone there is nothing left to
        // name in the audit entry, and "job 47 was deleted" is not an
        // accountability record anyone can act on months later.
        const [rows] = await db.query(
            'SELECT id, title, company FROM pesoadmin_job_posts WHERE id = ?', [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'That job posting no longer exists.' });
        }

        await db.query('DELETE FROM pesoadmin_job_posts WHERE id = ?', [req.params.id]);

        await adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.JOB_DELETED,
            targetEntity: rows[0].title,
            targetId: rows[0].id,
            details: `Removed "${rows[0].title}" at ${rows[0].company || 'an unnamed employer'}.`,
        });

        res.status(200).json({ status: 'success', message: 'Job posting removed.' });
    } catch (error) { res.status(500).json({ status: 'error', message: 'Failed to delete job posting.' }); }
});

// POST: Set / replace a job posting's featured image
router.post('/jobs/:id/image', (req, res, next) => {
	jobImageUpload.single('image')(req, res, (err) => {
		if (err) return res.status(400).json({ status: 'error', message: err.message });
		next();
	});
}, async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ status: 'error', message: 'No image file was provided.' });
		}

		const [rows] = await db.query('SELECT featured_image FROM pesoadmin_job_posts WHERE id = ?', [req.params.id]);
		if (rows.length === 0) {
			return res.status(404).json({ status: 'error', message: 'Job posting not found.' });
		}

		const ext = (path.extname(req.file.originalname || '').toLowerCase()) || '.jpg';
		const key = `job-featured/job-${req.params.id}-${Date.now()}${ext}`;
		const publicPath = await storageService.save(key, req.file.buffer, req.file.mimetype);
		await db.query('UPDATE pesoadmin_job_posts SET featured_image = ? WHERE id = ?', [publicPath, req.params.id]);

		// Best-effort cleanup of the previously stored image (local or R2).
		await storageService.remove(rows[0].featured_image);

		res.status(200).json({ status: 'success', message: 'Featured image updated.', featured_image: publicPath });
	} catch (error) {
		console.error('Job Image Upload Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to update the featured image.' });
	}
});

// DELETE: Remove a job posting's featured image
router.delete('/jobs/:id/image', async (req, res) => {
	try {
		const [rows] = await db.query('SELECT featured_image FROM pesoadmin_job_posts WHERE id = ?', [req.params.id]);
		if (rows.length === 0) {
			return res.status(404).json({ status: 'error', message: 'Job posting not found.' });
		}

		const previous = rows[0].featured_image;
		await db.query('UPDATE pesoadmin_job_posts SET featured_image = NULL WHERE id = ?', [req.params.id]);

		await storageService.remove(previous);

		res.status(200).json({ status: 'success', message: 'Featured image removed.' });
	} catch (error) {
		console.error('Job Image Remove Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to remove the featured image.' });
	}
});

router.get('/reports', async (req, res) => {
    try {
        const appStats = await safeQuery(`SELECT status, COUNT(*) as count FROM job_applications GROUP BY status`, [], []);
        const userStats = await safeQuery(`SELECT role, COUNT(*) as count FROM users WHERE role IN ('applicant','employer','peso_administrator','admin') GROUP BY role`, [], []);
        res.status(200).json({
            status: 'success',
            data: {
                applications: appStats,
                users: userStats.map(row => ({ ...row, role_label: getRoleLabel(row.role) }))
            }
        });
    } catch (error) { res.status(500).json({ status: 'error', message: 'Failed to fetch reports.' }); }
});

module.exports = router;