const crypto = require('crypto');
const db = require('../db');
const jobAlertsRepository = require('../repositories/jobAlertsRepository');
const systemSettings = require('./systemSettingsService');
const emailOutboxService = require('./emailOutboxService');
const { scoreApplication } = require('./aiScoringService');

/**
 * AI job-alert business logic (Enhancement D).
 *
 * Turns a newly published vacancy into targeted, bounded, deduped alerts:
 *   candidate generation (cheap SQL) → AI score the shortlist → threshold →
 *   deliver (immediate email via the P2C outbox, or stage for the daily digest).
 *
 * Invariants: publishing never waits on this (it enqueues; §0.1); the AI returns a
 * real score or NULL (0.2 — a NULL candidate is simply skipped); email rides the
 * durable outbox (0.11); tunables are per-call system settings (§7.12); dedup means
 * a seeker is never alerted twice for one job.
 */

const FRONTEND = () => process.env.FRONTEND_URL || 'http://localhost:5173';
const API_BASE = () => process.env.PUBLIC_API_URL || process.env.FRONTEND_URL || 'http://localhost:5000';

function jobLink(job) { return `${FRONTEND()}/job-board/${job.id}`; }
function unsubLink(token) { return `${API_BASE()}/api/job-alerts/unsubscribe?token=${token}`; }

// ── Enqueue on publish (non-fatal) ──────────────────────────────────────────

async function enqueueForJob(jobId) {
	if (!jobId) return;
	try { await jobAlertsRepository.enqueueMatch(jobId); }
	catch (error) { console.error(`[JobAlerts] Could not enqueue match for job ${jobId}:`, error.message); }
}

// ── Preferences + unsubscribe ───────────────────────────────────────────────

/** Effective prefs for a seeker: stored, or the system defaults. */
async function getPreferences(userId) {
	const stored = await jobAlertsRepository.getPreferences(userId);
	const defaultFrequency = await systemSettings.get('job_alert_default_frequency');
	return {
		frequency: stored?.frequency || defaultFrequency,
		min_score: stored?.min_score ?? null,
		isDefault: !stored,
	};
}

async function setPreferences(userId, { frequency, minScore }) {
	const freq = ['immediate', 'daily', 'off'].includes(String(frequency)) ? String(frequency) : 'daily';
	let min = parseInt(minScore, 10);
	min = Number.isInteger(min) && min >= 0 && min <= 100 ? min : null;
	await jobAlertsRepository.upsertPreferences({ userId, frequency: freq, minScore: min });
	return { frequency: freq, min_score: min };
}

/** Ensure the seeker has an unsubscribe token, minting one on first use. */
async function ensureUnsubscribeToken(userId) {
	const prefs = await jobAlertsRepository.getPreferences(userId);
	if (prefs && prefs.unsubscribe_token) return prefs.unsubscribe_token;
	const token = crypto.randomBytes(24).toString('hex');
	const defaultFrequency = await systemSettings.get('job_alert_default_frequency');
	await jobAlertsRepository.upsertPreferences({
		userId,
		frequency: prefs?.frequency || defaultFrequency,
		minScore: prefs?.min_score ?? null,
		unsubscribeToken: token,
	});
	return token;
}

async function handleUnsubscribe(token) {
	if (!token) return false;
	const userId = await jobAlertsRepository.findUserByUnsubscribeToken(token);
	if (!userId) return false;
	await jobAlertsRepository.upsertPreferences({ userId, frequency: 'off', minScore: null, unsubscribeToken: token });
	return true;
}

// ── Email building ──────────────────────────────────────────────────────────

function alertEmail({ name, job, score, reason, token }) {
	const link = jobLink(job);
	const unsub = unsubLink(token);
	const html = `
		<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
			<div style="background-color:#1a4a38;padding:20px;text-align:center;color:#fff;"><h2 style="margin:0;font-size:18px;">A job that matches your profile</h2></div>
			<div style="padding:22px 24px;">
				<p style="margin:0 0 12px;">Hello ${name || 'there'},</p>
				<p style="margin:0 0 6px;">PESO Kabankalan found a new vacancy that fits your resume:</p>
				<div style="background:#f0f5f3;border-radius:10px;padding:16px;margin:12px 0;">
					<p style="margin:0;font-size:16px;font-weight:bold;color:#14231c;">${job.title}</p>
					<p style="margin:4px 0 0;color:#3d4f45;">${job.company || 'PESO Kabankalan'}${job.location ? ` · ${job.location}` : ''}</p>
					<p style="margin:10px 0 0;font-size:13px;color:#2c6a4c;font-weight:bold;">AI match: ${score}%</p>
					${reason ? `<p style="margin:6px 0 0;font-size:13px;color:#4b5563;">${reason}</p>` : ''}
				</div>
				<a href="${link}" style="display:inline-block;padding:11px 22px;background:#1a4a38;color:#99e742;text-decoration:none;border-radius:8px;font-weight:bold;">View &amp; apply</a>
				<p style="margin:18px 0 0;font-size:11px;color:#9ca3af;">You receive these because job alerts are on for your account. <a href="${unsub}" style="color:#6b7280;">Unsubscribe</a>.</p>
			</div>
		</div>`;
	const text = `Hello ${name || 'there'},\n\nA new vacancy matches your resume:\n${job.title} — ${job.company || 'PESO Kabankalan'}${job.location ? ` (${job.location})` : ''}\nAI match: ${score}%\n${reason || ''}\n\nView & apply: ${link}\n\nUnsubscribe: ${unsub}`;
	return { subject: `New job match: ${job.title} (${score}% match)`, html, text };
}

function digestEmail({ name, matches, token }) {
	const unsub = unsubLink(token);
	const rows = matches.map((m) => `
		<div style="border-bottom:1px solid #eef3ec;padding:12px 0;">
			<a href="${FRONTEND()}/job-board/${m.job_id}" style="font-weight:bold;color:#1a4a38;text-decoration:none;">${m.title}</a>
			<span style="color:#2c6a4c;font-weight:bold;font-size:13px;"> · ${m.match_score}% match</span>
			<div style="color:#3d4f45;font-size:13px;">${m.company || 'PESO Kabankalan'}</div>
			${m.reason ? `<div style="color:#6b7280;font-size:12px;margin-top:2px;">${m.reason}</div>` : ''}
		</div>`).join('');
	const html = `
		<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
			<div style="background-color:#1a4a38;padding:20px;text-align:center;color:#fff;"><h2 style="margin:0;font-size:18px;">${matches.length} new job${matches.length === 1 ? '' : 's'} matching your profile</h2></div>
			<div style="padding:22px 24px;">
				<p style="margin:0 0 8px;">Hello ${name || 'there'},</p>
				${rows}
				<p style="margin:18px 0 0;font-size:11px;color:#9ca3af;">Daily job-alert digest. <a href="${unsub}" style="color:#6b7280;">Unsubscribe</a>.</p>
			</div>
		</div>`;
	const text = `Hello ${name || 'there'},\n\n${matches.length} new matching job(s):\n${matches.map((m) => `- ${m.title} (${m.match_score}%) — ${m.company || 'PESO Kabankalan'}: ${FRONTEND()}/job-board/${m.job_id}`).join('\n')}\n\nUnsubscribe: ${unsub}`;
	return { subject: `${matches.length} new job match${matches.length === 1 ? '' : 'es'} for you`, html, text };
}

// ── Matching (called by the worker) ─────────────────────────────────────────

async function matchJob(jobId) {
	const job = await jobAlertsRepository.findJobForMatching(jobId);
	if (!job) return { matched: 0, reason: 'job not found' };
	if (!['Open', 'Published'].includes(job.status)) return { matched: 0, reason: `not published (${job.status})` };

	const [threshold, cap, maxPerDay, defaultFrequency] = await Promise.all([
		systemSettings.get('job_alert_ai_threshold'),
		systemSettings.get('job_alert_candidate_cap'),
		systemSettings.get('job_alert_max_per_day'),
		systemSettings.get('job_alert_default_frequency'),
	]);

	const candidates = await jobAlertsRepository.generateCandidates(jobId, {
		defaultFrequency, jobLocation: job.location || '', cap,
	});

	let matched = 0;
	for (const cand of candidates) {
		let score = null;
		try { score = await scoreApplication({ userId: cand.user_id, job }); }
		catch (e) { score = null; }
		if (!score || typeof score.overall !== 'number') continue;

		const floor = Math.max(Number(threshold) || 70, Number(cand.min_score) || 0);
		if (score.overall < floor) continue;

		const frequency = cand.frequency || defaultFrequency;
		const reason = score.summary || `Strong AI match (${score.overall}%) for ${job.title}.`;

		if (frequency === 'immediate') {
			const todayCount = await jobAlertsRepository.alertedTodayCount(cand.user_id);
			if (Number(maxPerDay) > 0 && todayCount >= Number(maxPerDay)) {
				// Over the daily cap → stage for the digest rather than drop.
				if (await jobAlertsRepository.recordMatch({ userId: cand.user_id, jobId, score: score.overall, reason, channel: 'digest', delivered: 0 })) matched += 1;
				continue;
			}
			// Record first (dedup guard), then queue the email.
			if (await jobAlertsRepository.recordMatch({ userId: cand.user_id, jobId, score: score.overall, reason, channel: 'email', delivered: 1 })) {
				matched += 1;
				try {
					const token = await ensureUnsubscribeToken(cand.user_id);
					const email = alertEmail({ name: cand.name, job, score: score.overall, reason, token });
					await emailOutboxService.enqueue({ to: cand.email, category: 'job_alert', subject: email.subject, html: email.html, text: email.text, dedupeKey: `jobalert:${jobId}:${cand.user_id}` });
				} catch (mailErr) {
					console.error(`[JobAlerts] Alert email enqueue failed for user ${cand.user_id}:`, mailErr.message);
				}
			}
		} else {
			// 'daily' → stage for the digest tick.
			if (await jobAlertsRepository.recordMatch({ userId: cand.user_id, jobId, score: score.overall, reason, channel: 'digest', delivered: 0 })) matched += 1;
		}
	}
	return { matched };
}

// ── Daily digest (D.2) ──────────────────────────────────────────────────────

async function runDigest() {
	const users = await jobAlertsRepository.listUsersWithStaged();
	let sent = 0;
	for (const u of users) {
		try {
			const matches = await jobAlertsRepository.listStagedForUser(u.user_id);
			if (matches.length === 0) continue;
			const token = await ensureUnsubscribeToken(u.user_id);
			const email = digestEmail({ name: u.name, matches, token });
			await emailOutboxService.enqueue({ to: u.email, category: 'job_alert_digest', subject: email.subject, html: email.html, text: email.text });
			await jobAlertsRepository.markStagedDelivered(matches.map((m) => m.id));
			sent += 1;
		} catch (error) {
			console.error(`[JobAlerts] Digest failed for user ${u.user_id}:`, error.message);
		}
	}
	return { sent };
}

// A DB-persisted marker paces the digest to once per calendar day (no cron), the
// same shape as the notification digest. markStagedDelivered also makes a re-run
// idempotent, so a restart mid-day cannot double-send.
const DIGEST_MARKER = 'job_alert_digest_last_run';
const today = () => new Date().toISOString().slice(0, 10);

async function digestLastRun() {
	try {
		const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = ?', [DIGEST_MARKER]);
		return rows[0]?.setting_value || null;
	} catch { return null; }
}
async function setDigestLastRun(day) {
	await db.query(
		'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
		[DIGEST_MARKER, day]
	);
}

/** Runs the daily digest at most once per calendar day. */
async function runDigestIfDue() {
	const day = today();
	if ((await digestLastRun()) === day) return { skipped: 'already-run-today' };
	await setDigestLastRun(day);
	return runDigest();
}

// ── Monitor / health ────────────────────────────────────────────────────────

async function getStatus() {
	const counts = await jobAlertsRepository.counts();
	return { enabled: process.env.JOB_ALERTS_ENABLED === 'true', counts };
}
async function getHealth() {
	const c = await jobAlertsRepository.counts();
	return { enabled: process.env.JOB_ALERTS_ENABLED === 'true', pending: c.pending, failed: c.failed, staged: c.staged };
}

module.exports = {
	enqueueForJob, matchJob, runDigest, runDigestIfDue,
	getPreferences, setPreferences, ensureUnsubscribeToken, handleUnsubscribe,
	getStatus, getHealth,
};
