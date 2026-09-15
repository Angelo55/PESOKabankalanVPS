import React, { useState, useEffect, useMemo } from 'react';
import {
	FileText, Loader2, Clock, CheckCircle2, XCircle, AlertTriangle, Inbox,
	Search, X, ArrowDownWideNarrow, ChevronDown, LayoutGrid, List, Download,
	Target, Save, History, Ban, Info
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';
import { useNotification } from '../context/NotificationContext';
import ReferralReports from './ReferralReports';
import ReferralActivity from './ReferralActivity';
import Pagination from './common/Pagination';
import EmptyState from './common/EmptyState';
import SearchDropdown from './common/SearchDropdown';
import useRecentSearches from '../hooks/useRecentSearches';
import useClientPagination from '../hooks/useClientPagination';
import API from '../api';

/**
 * Referral register — presented as a DOCUMENT LIBRARY.
 *
 * A referral is, to the citizen holding it, a signed PDF. So this page is built
 * like a file explorer (name / reference / status / date / open) rather than a
 * card wall: it scans vertically, sorts by column semantics, and keeps dozens of
 * letters readable at a glance. A grid ("tiles") view is offered for the same
 * data, mirroring the Drive-style list⇄grid toggle people already know.
 *
 * PESO Administrator -> GET /api/referrals        (referrals for their vacancies)
 * Job Seeker         -> GET /api/referrals/mine   (their own, approved only)
 *
 * The backend enforces both scopes. The role here only picks the URL --
 * authorization is never a frontend decision.
 */

/**
 * Single source of truth for delivery state. The status PILL and the status
 * FILTER both read this, so a referral can never render as "Delivered" while
 * being excluded by the "Delivered" filter.
 *
 * Until a referral's outbox row is drained it reports "Queued" -- never "Sent".
 * A UI that claimed "Sent" with no worker running would be lying to a PESO
 * administrator about an official document.
 */
const STATE = {
	VOIDED: 'voided',
	NOT_REFERRED: 'not_referred',
	DECLINED: 'declined',
	AWAITING_ACCEPTANCE: 'awaiting_acceptance',
	DELIVERED: 'delivered',
	FAILED: 'failed',
	PROCESSING: 'processing',
	QUEUED: 'queued',
};

const deliveryState = (referral) => {
	// Voided outranks every delivery state: the letter may well have been sent
	// and received, but the referral no longer stands, and that is the fact an
	// administrator needs to see first. Kept in lockstep with the backend rules in
	// services/deliveryState.js (§14) — including the seeker-acceptance states.
	if (referral.status === 'Voided') return STATE.VOIDED;
	if (referral.status === 'Rejected') return STATE.NOT_REFERRED;
	if (referral.status === 'Declined') return STATE.DECLINED;
	if (referral.status === 'Pending Seeker Acceptance') return STATE.AWAITING_ACCEPTANCE;
	if (referral.email_status === 'Sent') return STATE.DELIVERED;
	if (referral.job_status === 'failed' || referral.email_status === 'Failed') return STATE.FAILED;
	if (referral.job_status === 'processing') return STATE.PROCESSING;
	return STATE.QUEUED;
};

const STATE_META = {
	[STATE.DELIVERED]:    { label: 'Delivered',    Icon: CheckCircle2, classes: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50' },
	[STATE.FAILED]:       { label: 'Failed',       Icon: AlertTriangle, classes: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/50' },
	[STATE.PROCESSING]:   { label: 'Processing',   Icon: Loader2,      classes: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/50' },
	[STATE.QUEUED]:       { label: 'Queued',       Icon: Clock,        classes: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50' },
	[STATE.AWAITING_ACCEPTANCE]: { label: 'Awaiting Your Response', Icon: Clock, classes: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/50' },
	[STATE.DECLINED]:     { label: 'Declined',     Icon: XCircle,      classes: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/50' },
	[STATE.VOIDED]:       { label: 'Cancelled',    Icon: Ban,          classes: 'bg-line/60 text-muted border-line' },
	[STATE.NOT_REFERRED]: { label: 'Not Referred', Icon: XCircle,      classes: 'bg-sunken text-muted border-line' },
};

/**
 * Placement outcome — what happened AFTER the letter was delivered.
 *
 * Deliberately a separate axis from delivery state: "Delivered" answers did the
 * letter go out, "Hired" answers did the person get the job. Collapsing them
 * into one pill is exactly the conflation that had the landing page reporting
 * emailed letters as successful placements.
 *
 * Order matches the ENUM on referral_outcomes (migration 023).
 */
const OUTCOMES = [
	'Issued',
	'Employer Acknowledged',
	'Interview Scheduled',
	'Hired',
	'Not Hired',
	'Withdrawn',
	'No Response',
];

const OUTCOME_META = {
	'Hired':                 { classes: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700/60' },
	'Interview Scheduled':   { classes: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800/50' },
	'Employer Acknowledged': { classes: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/50' },
	'Not Hired':             { classes: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/50' },
	'Withdrawn':             { classes: 'bg-sunken text-muted border-line' },
	'No Response':           { classes: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50' },
	'Issued':                { classes: 'bg-sunken text-muted border-line' },
};

/**
 * 'Issued' means "letter sent, nothing heard back yet" — the honest default for
 * a referral nobody has followed up. It is rendered muted and labelled
 * "Awaiting outcome" so it reads as an open item rather than a result.
 */
const OutcomePill = ({ referral }) => {
	const outcome = referral.outcome || 'Issued';
	const meta = OUTCOME_META[outcome] || OUTCOME_META['Issued'];
	const isPending = outcome === 'Issued';

	return (
		<span
			className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ${meta.classes}`}
			title={referral.outcome_notes || undefined}
		>
			<Target size={12} /> {isPending ? 'Awaiting outcome' : outcome}
		</span>
	);
};

/**
 * Records a placement outcome.
 *
 * A MODAL RATHER THAN AN INLINE DROPDOWN, on purpose. A dropdown would have to
 * assume the event happened today, but employers email PESO days after the fact
 * — and `outcome_at` is the exact field the DOLE placement report is computed
 * from. Defaulting it silently would corrupt the one number this feature exists
 * to produce. The date is prefilled to today and stays editable.
 */
const OutcomeModal = ({ referral, onClose, onSaved }) => {
	const { notify } = useNotification();
	const today = new Date().toISOString().slice(0, 10);

	const [outcome, setOutcome] = useState(referral.outcome || 'Issued');
	const [outcomeAt, setOutcomeAt] = useState(
		referral.outcome_at ? String(referral.outcome_at).slice(0, 10) : today
	);
	const [notes, setNotes] = useState(referral.outcome_notes || '');
	const [saving, setSaving] = useState(false);

	// A job seeker may have REPORTED an outcome they heard from the employer. It is
	// only a suggestion (never in the official record until confirmed here), so we
	// surface the most recent one still awaiting confirmation with a one-click
	// prefill. The admin stays the sole author of the official outcome (0.14).
	const [pendingSuggestion, setPendingSuggestion] = useState(null);
	useEffect(() => {
		let active = true;
		API.get(`/referrals/${referral.id}/outcome/history`)
			.then((res) => {
				if (!active) return;
				const rows = res.data?.data || [];
				let lastOfficial = 0;
				rows.forEach((r) => { if (r.is_official) lastOfficial = Math.max(lastOfficial, new Date(r.created_at).getTime()); });
				const pend = [...rows].reverse().find((r) => !r.is_official && new Date(r.created_at).getTime() > lastOfficial);
				setPendingSuggestion(pend || null);
			})
			.catch(() => { /* non-critical: just no suggestion banner */ });
		return () => { active = false; };
	}, [referral.id]);

	const useSuggestion = () => {
		if (!pendingSuggestion) return;
		setOutcome(pendingSuggestion.outcome);
		if (pendingSuggestion.outcome_at) setOutcomeAt(String(pendingSuggestion.outcome_at).slice(0, 10));
		if (pendingSuggestion.notes) setNotes(pendingSuggestion.notes);
	};

	const submit = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			await API.put(`/referrals/${referral.id}/outcome`, {
				outcome,
				outcome_at: outcomeAt || null,
				notes: notes.trim() || null,
			});
			notify.success('Outcome Recorded', `${referral.applicant_name || 'Referral'}: ${outcome}.`);
			onSaved();
			onClose();
		} catch (err) {
			notify.error('Could Not Save', err.response?.data?.message || 'Please try again.');
		} finally {
			setSaving(false);
		}
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in"
			onClick={() => !saving && onClose()}
			role="dialog"
			aria-modal="true"
			aria-label="Record referral outcome"
		>
			<form
				onSubmit={submit}
				onClick={(e) => e.stopPropagation()}
				className="bg-surface rounded-3xl w-full max-w-md shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95"
			>
				<div className="flex items-start justify-between gap-4 p-5 border-b border-line">
					<div className="min-w-0">
						<h3 className="text-lg font-black text-content">Record Outcome</h3>
						<p className="text-xs text-muted font-medium mt-0.5 truncate">
							{referral.applicant_name} &middot; {referral.job_title}
						</p>
						<p className="font-mono text-[11px] font-bold text-subtle mt-1">{referral.reference_number}</p>
					</div>
					<button type="button" onClick={onClose} disabled={saving} aria-label="Close"
						className="p-2 rounded-lg text-subtle hover:text-muted dark:hover:text-gray-200 hover:bg-line transition-colors disabled:opacity-40">
						<X size={18} />
					</button>
				</div>

				<div className="p-5 space-y-4">
					{pendingSuggestion && (
						<div className="rounded-xl border border-sky-200 dark:border-sky-800/50 bg-sky-50 dark:bg-sky-900/20 px-4 py-3">
							<p className="text-sm font-bold text-sky-800 dark:text-sky-300">
								{referral.applicant_name || 'The job seeker'} reported: {pendingSuggestion.outcome}
								{pendingSuggestion.outcome_at ? ` (${String(pendingSuggestion.outcome_at).slice(0, 10)})` : ''}
							</p>
							{pendingSuggestion.notes && (
								<p className="text-xs text-sky-700/90 dark:text-sky-300/80 font-medium mt-1 italic">“{pendingSuggestion.notes}”</p>
							)}
							<p className="text-[11px] text-sky-700/80 dark:text-sky-300/70 font-medium mt-1.5">
								This is the seeker's report and is NOT yet on record. Review it, then Save to make it official.
							</p>
							<button type="button" onClick={useSuggestion}
								className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black bg-sky-600 hover:bg-sky-700 text-white transition-colors">
								Use this report
							</button>
						</div>
					)}
					<div>
						<label htmlFor="outcome" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">What happened?</label>
						<select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35">
							{OUTCOMES.map((o) => (
								<option key={o} value={o}>{o === 'Issued' ? 'Issued — no news yet' : o}</option>
							))}
						</select>
					</div>

					<div>
						<label htmlFor="outcome_at" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">Date it happened</label>
						<input id="outcome_at" type="date" value={outcomeAt} max={today}
							onChange={(e) => setOutcomeAt(e.target.value)}
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
						<p className="text-[11px] text-subtle font-medium mt-1.5">
							The date the employer reported, not today's date. Reports use this.
						</p>
					</div>

					<div>
						<label htmlFor="outcome_notes" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">Notes <span className="normal-case font-medium text-subtle">(optional)</span></label>
						<textarea id="outcome_notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
							placeholder="e.g. Employer emailed 20 July, starts Monday."
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35 resize-none" />
					</div>
				</div>

				<div className="p-5 border-t border-line flex gap-3">
					<button type="button" onClick={onClose} disabled={saving}
						className="flex-1 py-2.5 rounded-xl text-sm font-bold text-muted bg-sunken hover:bg-line transition-colors disabled:opacity-50">
						Cancel
					</button>
					<button type="submit" disabled={saving}
						className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-accent hover:bg-accent-hover shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
						{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
					</button>
				</div>
			</form>
		</div>,
		document.body
	);
};

/** Outcomes a job seeker can report — 'Issued' (the "no news" default) is not one. */
const SUGGESTABLE_OUTCOMES = OUTCOMES.filter((o) => o !== 'Issued');

/**
 * A JOB SEEKER reports an outcome they heard directly from the employer.
 *
 * This is a SUGGESTION, not the official record. It never touches the placement
 * statistics — a PESO administrator confirms it before it counts (invariant 0.14).
 * The copy is careful to say so, so the seeker understands PESO still verifies it.
 * Mirrors OutcomeModal's shape; posts to the flag-gated /outcome/suggest endpoint.
 */
const SuggestOutcomeModal = ({ referral, onClose, onSaved }) => {
	const { notify } = useNotification();
	const today = new Date().toISOString().slice(0, 10);

	const [outcome, setOutcome] = useState('Interview Scheduled');
	const [outcomeAt, setOutcomeAt] = useState(today);
	const [notes, setNotes] = useState('');
	const [saving, setSaving] = useState(false);

	const submit = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			await API.post(`/referrals/${referral.id}/outcome/suggest`, {
				outcome,
				outcome_at: outcomeAt || null,
				notes: notes.trim() || null,
			});
			notify.success('Update sent', 'Thanks — PESO Kabankalan will confirm this with the employer.');
			onSaved();
			onClose();
		} catch (err) {
			notify.error('Could Not Send', err.response?.data?.message || 'Please try again.');
		} finally {
			setSaving(false);
		}
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in"
			onClick={() => !saving && onClose()}
			role="dialog"
			aria-modal="true"
			aria-label="Report a referral update"
		>
			<form
				onSubmit={submit}
				onClick={(e) => e.stopPropagation()}
				className="bg-surface rounded-3xl w-full max-w-md shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95"
			>
				<div className="flex items-start justify-between gap-4 p-5 border-b border-line">
					<div className="min-w-0">
						<h3 className="text-lg font-black text-content">Report an update</h3>
						<p className="text-xs text-muted font-medium mt-0.5 truncate">
							{referral.job_title} &middot; {referral.company_name}
						</p>
					</div>
					<button type="button" onClick={onClose} disabled={saving} aria-label="Close"
						className="p-2 rounded-lg text-subtle hover:text-muted dark:hover:text-gray-200 hover:bg-line transition-colors disabled:opacity-40">
						<X size={18} />
					</button>
				</div>

				<div className="p-5 space-y-4">
					<div className="text-sm text-muted font-medium bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/40 rounded-xl px-4 py-3 leading-relaxed">
						Heard back from the employer? Let PESO know. This is added as your report and
						<span className="font-bold"> PESO confirms it before it becomes official</span> — it does not change your records on its own.
					</div>

					<div>
						<label htmlFor="suggest_outcome" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">What did the employer say?</label>
						<select id="suggest_outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35">
							{SUGGESTABLE_OUTCOMES.map((o) => (<option key={o} value={o}>{o}</option>))}
						</select>
					</div>

					<div>
						<label htmlFor="suggest_at" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">When did it happen?</label>
						<input id="suggest_at" type="date" value={outcomeAt} max={today}
							onChange={(e) => setOutcomeAt(e.target.value)}
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
					</div>

					<div>
						<label htmlFor="suggest_notes" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">Details <span className="normal-case font-medium text-subtle">(optional)</span></label>
						<textarea id="suggest_notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
							placeholder="e.g. Interview set for next Tuesday at 10am."
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35 resize-none" />
					</div>
				</div>

				<div className="p-5 border-t border-line flex gap-3">
					<button type="button" onClick={onClose} disabled={saving}
						className="flex-1 py-2.5 rounded-xl text-sm font-bold text-muted bg-sunken hover:bg-line transition-colors disabled:opacity-50">
						Cancel
					</button>
					<button type="submit" disabled={saving}
						className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-accent hover:bg-accent-hover shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
						{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Send to PESO
					</button>
				</div>
			</form>
		</div>,
		document.body
	);
};

/**
 * Cancels a referral issued in error and frees its position.
 *
 * A REASON IS REQUIRED. The record is kept forever, so "cancelled" with no
 * explanation is a permanent unanswered question in the audit trail.
 *
 * The wording is careful about one thing: the applicant already has the letter
 * in their inbox and cancelling cannot take it back. The dialog says so, because
 * an administrator who assumes otherwise will skip the phone call that actually
 * resolves it.
 */
const VoidModal = ({ referral, onClose, onSaved }) => {
	const { notify } = useNotification();
	const [reason, setReason] = useState('');
	const [saving, setSaving] = useState(false);

	const submit = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			const res = await API.post(`/referrals/${referral.id}/void`, { reason: reason.trim() });
			notify.success('Referral Cancelled', res.data?.message || 'The position is available again.');
			onSaved();
			onClose();
		} catch (err) {
			notify.error('Could Not Cancel', err.response?.data?.message || 'Please try again.');
		} finally {
			setSaving(false);
		}
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in"
			onClick={() => !saving && onClose()}
			role="dialog"
			aria-modal="true"
			aria-label="Cancel referral"
		>
			<form
				onSubmit={submit}
				onClick={(e) => e.stopPropagation()}
				className="bg-surface rounded-3xl w-full max-w-md shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95"
			>
				<div className="flex items-start justify-between gap-4 p-5 border-b border-line">
					<div className="min-w-0">
						<h3 className="text-lg font-black text-content">Cancel this referral?</h3>
						<p className="text-xs text-muted font-medium mt-0.5 truncate">
							{referral.applicant_name} &middot; {referral.job_title}
						</p>
						<p className="font-mono text-[11px] font-bold text-subtle mt-1">{referral.reference_number}</p>
					</div>
					<button type="button" onClick={onClose} disabled={saving} aria-label="Close"
						className="p-2 rounded-lg text-subtle hover:text-muted dark:hover:text-gray-200 hover:bg-line transition-colors disabled:opacity-40">
						<X size={18} />
					</button>
				</div>

				<div className="p-5 space-y-4">
					<div className="text-sm text-muted font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 leading-relaxed">
						This frees up the position so you can refer someone else. The referral stays on record as cancelled.
						<span className="block mt-2 font-bold">{referral.applicant_name || 'The applicant'} already has the letter by email — cancelling here does not take it back. Please let them know.</span>
					</div>

					<div>
						<label htmlFor="void_reason" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">Why is it being cancelled?</label>
						<textarea id="void_reason" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. Sent to the wrong applicant. / Employer withdrew the vacancy."
							className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-rose-500/35 resize-none" />
					</div>
				</div>

				<div className="p-5 border-t border-line flex gap-3">
					<button type="button" onClick={onClose} disabled={saving}
						className="flex-1 py-2.5 rounded-xl text-sm font-bold text-muted bg-sunken hover:bg-line transition-colors disabled:opacity-50">
						Keep it
					</button>
					<button type="submit" disabled={saving || reason.trim().length < 5}
						className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-rose-600 hover:bg-rose-700 shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
						{saving ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />} Cancel referral
					</button>
				</div>
			</form>
		</div>,
		document.body
	);
};

/** Only offered for a referral that is still approved — nothing else can be cancelled. */
const VoidAction = ({ referral, onVoid }) => {
	if (referral.status !== 'Approved') return null;
	return (
		<button
			type="button"
			onClick={() => onVoid(referral)}
			title="Cancel this referral and free the position"
			className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border border-line text-muted hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
		>
			<Ban size={12} /> Cancel
		</button>
	);
};

/**
 * Opens the audit trail. Shown to EVERYONE, not just administrators — a citizen
 * is entitled to see what was done with their own referral and when. The server
 * scopes access; this button only decides what is offered.
 */
const ActivityAction = ({ referral, onView }) => (
	<button
		type="button"
		onClick={() => onView(referral)}
		title="View activity trail"
		className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border border-line text-muted hover:border-accent/50 hover:text-accent-text transition-colors"
	>
		<History size={12} /> History
	</button>
);

/** Compact trigger, PESO administrators only. */
const OutcomeAction = ({ referral, onEdit }) => (
	<button
		type="button"
		onClick={() => onEdit(referral)}
		className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border border-line text-muted hover:border-accent/50 hover:text-accent-text transition-colors"
	>
		<Target size={12} /> {referral.outcome && referral.outcome !== 'Issued' ? 'Update' : 'Record'}
	</button>
);

/** Job seekers only: report an outcome heard from the employer (a suggestion PESO confirms). */
const SuggestAction = ({ referral, onSuggest }) => (
	<button
		type="button"
		onClick={() => onSuggest(referral)}
		title="Tell PESO what you heard from the employer"
		className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border border-line text-muted hover:border-accent/50 hover:text-accent-text transition-colors"
	>
		<Target size={12} /> Report update
	</button>
);

const StatusPill = ({ referral }) => {
	const state = deliveryState(referral);
	const { label, Icon, classes } = STATE_META[state];
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ${classes}`}
			title={state === STATE.FAILED ? (referral.last_error || 'Delivery failed.') : undefined}
		>
			<Icon size={12} className={state === STATE.PROCESSING ? 'animate-spin' : ''} /> {label}
		</span>
	);
};

/**
 * The download action.
 *
 * The letter is behind an authenticated route, so a plain <a href> cannot fetch
 * it -- a browser navigation carries no Authorization header. We fetch it as a
 * blob through the API client (which attaches the bearer token), then hand the
 * browser an object URL. The PII never sits behind a guessable public link.
 */
const LetterAction = ({ referral, compact = false }) => {
	const [downloading, setDownloading] = useState(false);
	const { notify } = useNotification();

	const handleDownload = async (e) => {
		e.stopPropagation();
		setDownloading(true);

		try {
			const response = await API.get(`/referrals/${referral.id}/letter`, { responseType: 'blob' });
			const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
			window.open(blobUrl, '_blank');
			// Release the object URL once the new tab has taken it. Without this,
			// the blob is pinned in memory for the life of the page.
			setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
		} catch (error) {
			const status = error.response?.status;
			notify.error(
				`Download Failed (${status || 'network'})`,
				status === 404 ? 'The letter is not available yet.' : 'Could not retrieve the referral letter.'
			);
		} finally {
			setDownloading(false);
		}
	};

	if (referral.pdf_path) {
		return (
			<button
				onClick={handleDownload}
				disabled={downloading}
				className={`bg-accent hover:bg-accent-hover text-white font-black rounded-xl transition-colors shadow-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${compact ? 'w-full px-3 py-2 text-xs' : 'px-3.5 py-2 text-xs'}`}
			>
				{downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
				Open
			</button>
		);
	}

	if (referral.status === 'Approved') {
		return <span className="px-3 py-2 bg-sunken text-subtle font-bold text-xs rounded-xl inline-block whitespace-nowrap">Pending</span>;
	}

	return <span className="text-xs text-subtle font-medium">—</span>;
};

/** The AI compatibility score behind the referral, when one was recorded. Small,
 *  muted metadata — it explains WHY the candidate was surfaced, alongside the
 *  source badge and the reason (remarks). */
const ScoreChip = ({ referral }) => {
	const n = referral.match_score;
	if (n === null || n === undefined || n === '') return null;
	return (
		<span
			className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-sunken text-muted px-2 py-0.5 rounded-md border border-line"
			title="AI compatibility score at the time of referral"
		>
			<Target size={10} /> {Number(n)}% AI
		</span>
	);
};

/** Marks a referral PESO initiated proactively — the seeker never applied. */
const ProactiveBadge = ({ referral }) =>
	referral.origin === 'admin_referral' ? (
		<span
			className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-accent/10 dark:bg-accent-text/15 text-accent-text px-2 py-0.5 rounded-md border border-accent/20 dark:border-accent/25"
			title="PESO proactively referred you to this employer based on your qualifications and AI evaluation."
		>
			Referred by PESO
		</span>
	) : null;

/**
 * Seeker ACCEPT / DECLINE for a personalized referral awaiting their response
 * (#6). Rendered only when the acceptance feature is ON and the referral is in
 * 'Pending Seeker Acceptance'. Accepting issues the official letter; declining
 * keeps the record. Both refresh the list via onDone.
 */
const AcceptanceActions = ({ referral, enabled, busy, onAccept, onDecline }) => {
	if (!enabled || referral.status !== 'Pending Seeker Acceptance') return null;
	return (
		<div className="flex items-center gap-2">
			<button
				onClick={() => onAccept(referral)}
				disabled={busy}
				className="px-3 py-2 bg-accent hover:bg-accent-hover text-white font-black text-xs rounded-xl inline-flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 transition-colors"
			>
				<CheckCircle2 size={13} /> Accept
			</button>
			<button
				onClick={() => onDecline(referral)}
				disabled={busy}
				className="px-3 py-2 bg-surface border border-line text-content hover:bg-sunken font-bold text-xs rounded-xl inline-flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 transition-colors"
			>
				<XCircle size={13} /> Decline
			</button>
		</div>
	);
};

/** A referral rendered as a file row. */
const ReferralRow = ({ referral, subtitle, dateLabel, canRecordOutcome, canSuggest, onSuggest, onEditOutcome, onViewActivity, onVoid, acceptanceEnabled, actionBusy, onAccept, onDecline }) => (
	<div className="px-4 sm:px-5 py-3 grid gap-2 md:gap-4 items-center grid-cols-1 md:grid-cols-[minmax(0,1fr)_150px_140px_110px_auto] hover:bg-sunken dark:hover:bg-gray-900/30 transition-colors group">
		<div className="flex items-center gap-3 min-w-0">
			<span className="w-9 h-9 shrink-0 rounded-lg bg-accent/10 dark:bg-accent-text/15 text-accent-text flex items-center justify-center">
				<FileText size={18} />
			</span>
			<div className="min-w-0">
				<p className="font-bold text-sm text-content truncate">{referral.job_title}</p>
				<p className="text-xs text-muted font-medium truncate">{subtitle}</p>
			</div>
		</div>

		{/* md:contents dissolves this wrapper on desktop so the three cells land in
		    their own columns; on mobile they stay a single wrapped meta row. */}
		<div className="flex flex-wrap items-center gap-2 pl-12 md:pl-0 md:contents">
			<span className="font-mono text-[11px] font-bold text-muted truncate">
				{referral.reference_number || '—'}
			</span>
			<StatusPill referral={referral} />
			<OutcomePill referral={referral} />
			<ProactiveBadge referral={referral} />
			<ScoreChip referral={referral} />
			<span className="text-[11px] font-bold text-subtle whitespace-nowrap">{dateLabel}</span>
		</div>

		<div className="pl-12 md:pl-0 md:text-right flex items-center gap-2 md:justify-end">
			<AcceptanceActions referral={referral} enabled={acceptanceEnabled} busy={actionBusy} onAccept={onAccept} onDecline={onDecline} />
			{canRecordOutcome && <OutcomeAction referral={referral} onEdit={onEditOutcome} />}
			{canSuggest && <SuggestAction referral={referral} onSuggest={onSuggest} />}
			<ActivityAction referral={referral} onView={onViewActivity} />
			{canRecordOutcome && <VoidAction referral={referral} onVoid={onVoid} />}
			<LetterAction referral={referral} />
		</div>

		{referral.remarks && (
			<p className="text-xs text-muted italic pl-12 md:pl-0 md:col-span-5">{referral.remarks}</p>
		)}
	</div>
);

/** The same referral as a document tile. */
const ReferralTile = ({ referral, subtitle, dateLabel, canRecordOutcome, canSuggest, onSuggest, onEditOutcome, onViewActivity, onVoid, acceptanceEnabled, actionBusy, onAccept, onDecline }) => (
	<div className="p-4 rounded-2xl border border-line bg-surface/60 shadow-[0_1px_4px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_22px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:border-accent/35 transition-all duration-300 flex flex-col">
		<div className="flex items-start gap-3 mb-3">
			<span className="w-10 h-10 shrink-0 rounded-xl bg-accent/10 dark:bg-accent-text/15 text-accent-text flex items-center justify-center">
				<FileText size={20} />
			</span>
			<div className="min-w-0">
				<p className="font-black text-sm text-content leading-snug line-clamp-2">{referral.job_title}</p>
				<p className="text-xs text-muted font-medium truncate mt-0.5">{subtitle}</p>
			</div>
		</div>

		<p className="font-mono text-[11px] font-bold text-muted truncate mb-2">
			{referral.reference_number || '—'}
		</p>

		<div className="mb-3 flex flex-wrap gap-2">
			<StatusPill referral={referral} />
			<OutcomePill referral={referral} />
			<ProactiveBadge referral={referral} />
			<ScoreChip referral={referral} />
		</div>

		<AcceptanceActions referral={referral} enabled={acceptanceEnabled} busy={actionBusy} onAccept={onAccept} onDecline={onDecline} />

		<div className="mt-auto pt-3 border-t border-line flex items-center justify-between gap-2">
			<span className="text-[11px] font-bold text-subtle whitespace-nowrap">{dateLabel}</span>
			<div className="flex items-center gap-2 min-w-0">
				{canRecordOutcome && <OutcomeAction referral={referral} onEdit={onEditOutcome} />}
				{canSuggest && <SuggestAction referral={referral} onSuggest={onSuggest} />}
				<ActivityAction referral={referral} onView={onViewActivity} />
				{canRecordOutcome && <VoidAction referral={referral} onVoid={onVoid} />}
				<LetterAction referral={referral} />
			</div>
		</div>
	</div>
);

const SORTS = [
	{ value: 'newest', label: 'Newest first' },
	{ value: 'oldest', label: 'Oldest first' },
	{ value: 'az', label: 'Name (A–Z)' },
	{ value: 'za', label: 'Name (Z–A)' },
	{ value: 'reference', label: 'Reference no.' },
];

// No padding-left here: each control adds its own (`pl-3.5` plain, `pl-10` when
// a leading icon sits inside). Carrying both would let Tailwind's stylesheet
// order decide, and the losing case draws the label under its own icon.
const controlClass =
	'appearance-none pr-9 py-2.5 rounded-2xl text-sm font-bold outline-none transition-all cursor-pointer border border-line/50 bg-surface/70 text-content shadow-[0_1px_4px_rgba(15,23,42,0.04)] focus:ring-2 focus:ring-accent/35';

/**
 * Local mirror of the server-side view preference.
 *
 * The DATABASE remains authoritative (it is what survives a new device or a
 * cleared browser). This cache exists purely to make the FIRST PAINT correct:
 * reading localStorage is synchronous, so a returning user's grid layout is
 * already in place before React's initial render, instead of flashing the
 * 'list' default while the API call is in flight.
 *
 * Refreshed from every server read and every user change, so it can only ever
 * lag by one session — and even then the hydration gate below prevents the
 * stale value from ever being painted as content.
 */
const VIEW_CACHE_KEY = 'peso.referralsView';
const isView = (v) => v === 'list' || v === 'grid';

const readCachedView = () => {
	try {
		const cached = localStorage.getItem(VIEW_CACHE_KEY);
		return isView(cached) ? cached : 'list';
	} catch (e) {
		return 'list'; // private mode / storage disabled
	}
};

const cacheView = (value) => {
	try { localStorage.setItem(VIEW_CACHE_KEY, value); } catch (e) { /* non-critical */ }
};

const Referrals = () => {
	const { user, features } = useAuth();
	const { outcomeRefreshTrigger } = useChat();
	const isPesoAdmin = normalizeRole(user?.role) === ROLE_KEYS.PESO_ADMINISTRATOR;
	// The collaborative "report an update" affordance is seeker-only and gated by
	// the runtime feature flag — dark until an administrator switches it on.
	const canSuggest = !isPesoAdmin && Boolean(features?.referralLifecycleSync);

	const [referrals, setReferrals] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	// Discovery state — mirrors the Public Job Board's search / filter / sort model.
	// Search / status / sort are intentionally session-scoped: they answer "what am
	// I looking for right now". The VIEW is a durable presentation choice, so it is
	// persisted per user (see below).
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');
	const [sort, setSort] = useState('newest');

	// Server-side pagination for the PESO-admin register (Phase 1). The register
	// grows unbounded, so search / status / sort / paging all run on the server for
	// the admin. `statusCounts` feeds the filter chips with FULL-set totals. The
	// job-seeker "My Referrals" view stays client-side (it is small and scoped to
	// their own approved referrals). `debouncedSearch` is what actually hits the API.
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [statusCounts, setStatusCounts] = useState([]);
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [limit, setLimit] = useState(10);

	useEffect(() => {
		const t = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(t);
	}, [search]);

	// A new search / status / sort always returns to page 1 (admin server-side).
	useEffect(() => { setPage(1); }, [debouncedSearch, status, sort]);
	// Seeded SYNCHRONOUSLY from the local mirror, so the first render already
	// uses the returning user's layout — no list→grid flash.
	const [view, setView] = useState(readCachedView); // 'list' | 'grid'

	// `viewReady` does two jobs:
	//   1. gates the first SAVE — without it the seeded value would be written
	//      back before the stored preference arrives, overwriting the real choice;
	//   2. gates the first PAINT (see `hydrating`) — so a device with no cache
	//      never renders the wrong layout while the server value is in flight.
	const [viewReady, setViewReady] = useState(false);

	useEffect(() => {
		let cancelled = false;

		API.get('/preferences')
			.then((res) => {
				const stored = res.data?.data?.referralsView;
				if (!cancelled && isView(stored)) {
					setView(stored);
					cacheView(stored); // keep the mirror in step with the server
				}
			})
			.catch(() => { /* non-critical: keep the cached/seeded value */ })
			.finally(() => { if (!cancelled) setViewReady(true); });

		return () => { cancelled = true; };
	}, []);

	// Persist the choice. Fire-and-forget: the toggle has already updated the UI,
	// and a failed write must not interrupt browsing — it just means the server
	// keeps the previous value until the next successful change.
	const changeView = (next) => {
		setView(next);
		cacheView(next);
		if (!viewReady) return;
		API.put('/preferences/referralsView', { value: next }).catch(() => {});
	};

	// Which referral the outcome modal is editing. null = closed.
	const [outcomeTarget, setOutcomeTarget] = useState(null);
	// Which referral's audit trail is open. null = closed.
	const [activityTarget, setActivityTarget] = useState(null);
	// Which referral is being cancelled. null = closed.
	const [voidTarget, setVoidTarget] = useState(null);
	// Which referral the seeker is reporting an update on. null = closed.
	const [suggestTarget, setSuggestTarget] = useState(null);
	// Completed referrals that never reached n8n. Advisory only; a failure to
	// load it must never block the register, so the error is swallowed.
	const [undispatched, setUndispatched] = useState([]);
	// Bumped after a save to re-run the fetch. Cheaper to reason about than
	// patching one row in place, and the list is small.
	const [refreshKey, setRefreshKey] = useState(0);

	// #6 — the seeker ACCEPT / DECLINE step for a personalized referral. Gated by
	// the runtime flag (dark until an administrator switches it on).
	const [actionBusy, setActionBusy] = useState(false);
	const acceptanceEnabled = !isPesoAdmin && Boolean(features?.referralAcceptance);
	const handleAccept = async (referral) => {
		if (actionBusy) return;
		setActionBusy(true);
		try {
			await API.post(`/referrals/${referral.id}/accept`);
			setRefreshKey((k) => k + 1);
		} catch (e) {
			setError(e.response?.data?.message || 'Could not accept the referral.');
		} finally { setActionBusy(false); }
	};
	const handleDecline = async (referral) => {
		if (actionBusy) return;
		const reason = window.prompt('Optionally tell PESO why you are declining (or leave blank):', '');
		if (reason === null) return; // dialog cancelled
		setActionBusy(true);
		try {
			await API.post(`/referrals/${referral.id}/decline`, { reason: reason || null });
			setRefreshKey((k) => k + 1);
		} catch (e) {
			setError(e.response?.data?.message || 'Could not decline the referral.');
		} finally { setActionBusy(false); }
	};

	// A referral outcome moved somewhere (an admin recorded one, or a seeker
	// reported a suggestion). ChatContext relays the socket push; refetch silently
	// so both parties converge on the same state without a manual reload. The DB is
	// the source of truth (0.3), so a missed push just costs immediacy.
	useEffect(() => {
		if (outcomeRefreshTrigger === 0) return;
		setRefreshKey((k) => k + 1);
	}, [outcomeRefreshTrigger]);

	useEffect(() => {
		const fetchReferrals = async () => {
			setLoading(true);
			setError(null);

			try {
				if (isPesoAdmin) {
					// Server-side: search / status / sort / page all go to the API.
					const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
					if (debouncedSearch) params.set('q', debouncedSearch);
					if (status) params.set('status', status);
					const response = await API.get(`/referrals?${params.toString()}`);
					setReferrals(response.data?.data || []);
					setTotal(response.data?.total || 0);
					setStatusCounts(response.data?.statusCounts || []);
				} else {
					// Job seeker: their own approved referrals; small, filtered client-side.
					const response = await API.get('/referrals/mine');
					setReferrals(response.data?.data || []);
				}
			} catch (err) {
				setError(err.response?.data?.message || 'Could not load referrals.');
			} finally {
				setLoading(false);
			}
		};

		fetchReferrals();
	}, [isPesoAdmin, refreshKey, page, limit, debouncedSearch, status, sort]);

	useEffect(() => {
		if (!isPesoAdmin) return;
		let cancelled = false;
		API.get('/referrals/undispatched')
			.then((res) => { if (!cancelled) setUndispatched(res.data?.data || []); })
			.catch(() => { /* advisory only -- never block the register */ });
		return () => { cancelled = true; };
	}, [isPesoAdmin, refreshKey]);

	// Only offer statuses that actually occur in the data, with live counts —
	// an empty filter option is a dead end.
	const statusOptions = useMemo(() => {
		// Admin: full-set counts from the server (independent of the current page).
		// Seeker: derived from their small client-side list.
		const counts = isPesoAdmin
			? statusCounts.reduce((acc, r) => { acc[r.state] = r.count; return acc; }, {})
			: referrals.reduce((acc, r) => {
				const s = deliveryState(r);
				acc[s] = (acc[s] || 0) + 1;
				return acc;
			}, {});
		return Object.keys(STATE_META)
			.filter(key => counts[key])
			.map(key => ({ value: key, label: STATE_META[key].label, count: counts[key] }));
	}, [isPesoAdmin, statusCounts, referrals]);

	const visible = useMemo(() => {
		const term = search.trim().toLowerCase();

		const filtered = referrals.filter((r) => {
			if (status && deliveryState(r) !== status) return false;
			if (!term) return true;
			return [r.job_title, r.company_name, r.applicant_name, r.reference_number]
				.filter(Boolean)
				.some(field => String(field).toLowerCase().includes(term));
		});

		const byDate = (r) => new Date(r.created_at || 0).getTime();
		const byName = (r) => String(r.job_title || '').toLowerCase();

		const sorted = [...filtered];
		switch (sort) {
			case 'oldest':    sorted.sort((a, b) => byDate(a) - byDate(b)); break;
			case 'az':        sorted.sort((a, b) => byName(a).localeCompare(byName(b))); break;
			case 'za':        sorted.sort((a, b) => byName(b).localeCompare(byName(a))); break;
			case 'reference': sorted.sort((a, b) => String(a.reference_number || '').localeCompare(String(b.reference_number || ''))); break;
			default:          sorted.sort((a, b) => byDate(b) - byDate(a));
		}
		return sorted;
	}, [referrals, search, status, sort]);

	// Admin rows arrive already filtered/sorted/paged from the server, so render
	// them as-is. The seeker path paginates the client-side `visible` list (their
	// own small referral set) with the same pager UX.
	const seekerPager = useClientPagination(visible);
	const list = isPesoAdmin ? referrals : seekerPager.pageItems;

	const activeFilters = (search.trim() ? 1 : 0) + (status ? 1 : 0);
	const resetFilters = () => { setSearch(''); setStatus(''); };

	// Unified search dropdown for the register: recent history, the delivery-state
	// filters as one-tap quick filters, and live matching referrals while typing.
	const { recent: recentSearches, record: recordSearch, remove: removeSearch, clear: clearSearches } = useRecentSearches('referral-register');
	useEffect(() => {
		const q = search.trim();
		if (!q) return;
		const id = setTimeout(() => recordSearch(q), 900);
		return () => clearTimeout(id);
	}, [search, recordSearch]);
	const referralResults = search.trim()
		? visible.slice(0, 6).map((r) => ({
			key: r.reference_number || r.queue_id || r.id,
			label: r.job_title || 'Referral',
			sublabel: [r.applicant_name, r.reference_number].filter(Boolean).join(' · '),
		}))
		: [];
	const statusQuickFilters = statusOptions.map((o) => ({
		key: o.value, label: o.label, active: status === o.value,
		onToggle: () => setStatus(status === o.value ? '' : o.value),
	}));

	const heading = isPesoAdmin ? 'Referral Register' : 'My Referrals';
	const subheading = isPesoAdmin
		? 'Every referral letter issued against your vacancies, with live delivery status.'
		: 'Official PESO Kabankalan endorsements issued on your behalf.';
	const emptyMessage = isPesoAdmin
		? 'Issue a referral from the Applicant Pipeline to see it here.'
		: 'When PESO endorses you for a vacancy, the referral will appear here.';

	const decorate = (referral) => ({
		subtitle: isPesoAdmin && referral.applicant_name
			? `${referral.company_name} · ${referral.applicant_name}`
			: referral.company_name,
		dateLabel: referral.created_at ? new Date(referral.created_at).toLocaleDateString() : '',
	});

	// Content waits for BOTH the referrals and the confirmed view preference.
	// Gating on `loading` alone still allowed a flash: if the preference request
	// resolved after the referrals request, the list had already painted and then
	// swapped to grid. Both fire in parallel on mount, so this costs no real time
	// — it only guarantees the first painted layout is the correct one.
	const hydrating = loading || !viewReady;

	const renderBody = () => {
		if (hydrating) {
			// Skeleton that STRUCTURALLY mirrors the loaded body — and matches the
			// ACTIVE view (grid vs list, known synchronously from the cached pref) so
			// a returning grid user never flashes list rows. Same containers,
			// dimensions, column grid, status/date/action placeholders and responsive
			// behaviour as ReferralTile / ReferralRow, so nothing shifts on load.
			if (view === 'grid') {
				return (
					<div className="p-4 sm:p-5 grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]" aria-hidden="true">
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} className="p-4 rounded-2xl border border-line bg-surface/60 shadow-[0_1px_4px_rgba(15,23,42,0.04)] flex flex-col animate-pulse">
								<div className="flex items-start gap-3 mb-3">
									<span className="w-10 h-10 shrink-0 rounded-xl bg-sunken" />
									<div className="min-w-0 flex-1 space-y-1.5">
										<div className="h-3.5 w-3/4 rounded bg-sunken" />
										<div className="h-3 w-1/2 rounded bg-sunken" />
									</div>
								</div>
								<div className="h-3 w-24 rounded bg-sunken mb-2" />
								<div className="mb-3 flex flex-wrap gap-2">
									<div className="h-5 w-20 rounded-full bg-sunken" />
									<div className="h-5 w-16 rounded-full bg-sunken" />
								</div>
								<div className="mt-auto pt-3 border-t border-line flex items-center justify-between gap-2">
									<div className="h-3 w-14 rounded bg-sunken" />
									<div className="flex items-center gap-2">
										<div className="h-7 w-7 rounded-lg bg-sunken" />
										<div className="h-7 w-16 rounded-lg bg-sunken" />
									</div>
								</div>
							</div>
						))}
					</div>
				);
			}
			return (
				<div aria-hidden="true">
					{/* Column-header echo (desktop only), matching the real list header. */}
					<div className="hidden md:grid grid-cols-[minmax(0,1fr)_150px_140px_110px_auto] gap-4 px-5 py-2.5 bg-sunken/40 border-b border-line">
						{['w-20', 'w-16', 'w-14', 'w-12', 'w-14'].map((w, i) => (
							<div key={i} className={`h-2.5 ${w} rounded bg-sunken ${i === 4 ? 'ml-auto' : ''}`} />
						))}
					</div>
					<div className="divide-y divide-gray-100 dark:divide-gray-700/60">
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} className="px-4 sm:px-5 py-3 grid gap-2 md:gap-4 items-center grid-cols-1 md:grid-cols-[minmax(0,1fr)_150px_140px_110px_auto] animate-pulse">
								{/* Document cell (icon + title/subtitle) */}
								<div className="flex items-center gap-3 min-w-0">
									<span className="w-9 h-9 shrink-0 rounded-lg bg-sunken" />
									<div className="min-w-0 flex-1 space-y-1.5">
										<div className="h-3.5 w-2/3 max-w-[220px] rounded bg-sunken" />
										<div className="h-3 w-1/2 max-w-[150px] rounded bg-sunken" />
									</div>
								</div>
								{/* Desktop cells — reference, status, date */}
								<div className="hidden md:block h-3 w-20 rounded bg-sunken" />
								<div className="hidden md:block h-5 w-24 rounded-full bg-sunken" />
								<div className="hidden md:block h-3 w-16 rounded bg-sunken" />
								{/* Desktop actions cell */}
								<div className="hidden md:flex items-center gap-2 justify-end">
									<div className="h-7 w-7 rounded-lg bg-sunken" />
									<div className="h-7 w-7 rounded-lg bg-sunken" />
									<div className="h-7 w-16 rounded-lg bg-sunken" />
								</div>
								{/* Mobile meta + actions (the stacked single-column layout) */}
								<div className="flex md:hidden flex-wrap items-center gap-2 pl-12">
									<div className="h-3 w-16 rounded bg-sunken" />
									<div className="h-5 w-20 rounded-full bg-sunken" />
									<div className="h-3 w-12 rounded bg-sunken" />
								</div>
								<div className="flex md:hidden items-center gap-2 pl-12">
									<div className="h-7 w-7 rounded-lg bg-sunken" />
									<div className="h-7 w-16 rounded-lg bg-sunken" />
								</div>
							</div>
						))}
					</div>
				</div>
			);
		}

		if (error) {
			return (
				<div className="flex flex-col items-center justify-center p-16 text-center">
					<AlertTriangle size={40} className="text-red-300 mb-3" />
					<h3 className="text-lg font-black text-content">Could not load referrals</h3>
					<p className="text-sm text-muted mt-1">{error}</p>
				</div>
			);
		}

		if (referrals.length === 0) {
			return (
				<EmptyState
					icon={FileText}
					title="No referrals yet"
					description={isPesoAdmin
						? 'This is your referral register. Every official PESO letter you issue from the Applicant Pipeline is recorded here with its live delivery status and placement outcome.'
						: 'This is where your official PESO Kabankalan endorsements live. When the office refers you for a vacancy, the signed referral letter appears here — you can open it, track its delivery, and follow its outcome.'}
					primaryAction={isPesoAdmin
						? { label: 'Open Applicant Pipeline', to: '/peso-admin/ats' }
						: { label: 'Explore Vacancies', to: '/job-board' }}
				/>
			);
		}

		if (list.length === 0) {
			return (
				<EmptyState
					variant="search"
					title="No referrals match your search"
					description="No referral letters match your current keywords or filters. Try a different search term, or clear the filters to see the full register."
					primaryAction={{ label: 'Clear filters', onClick: resetFilters }}
				/>
			);
		}

		if (view === 'grid') {
			return (
				<div className="p-4 sm:p-5 grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
					{list.map((referral) => {
						const { subtitle, dateLabel } = decorate(referral);
						return <ReferralTile key={referral.id} referral={referral} subtitle={subtitle} dateLabel={dateLabel} canRecordOutcome={isPesoAdmin} canSuggest={canSuggest} onSuggest={setSuggestTarget} onEditOutcome={setOutcomeTarget} onViewActivity={setActivityTarget} onVoid={setVoidTarget} acceptanceEnabled={acceptanceEnabled} actionBusy={actionBusy} onAccept={handleAccept} onDecline={handleDecline} />;
					})}
				</div>
			);
		}

		return (
			<>
				{/* Column headers — the file-explorer cue. Desktop only; on mobile
				    each row carries its own inline meta instead. */}
				<div className="hidden md:grid grid-cols-[minmax(0,1fr)_150px_140px_110px_auto] gap-4 px-5 py-2.5 bg-sunken/40 border-b border-line text-[11px] font-black uppercase tracking-wider text-muted">
					<span>Document</span>
					<span>Reference</span>
					<span>Status</span>
					<span>Date</span>
					<span className="text-right">Letter</span>
				</div>
				<div className="divide-y divide-gray-100 dark:divide-gray-700/60">
					{list.map((referral) => {
						const { subtitle, dateLabel } = decorate(referral);
						return <ReferralRow key={referral.id} referral={referral} subtitle={subtitle} dateLabel={dateLabel} canRecordOutcome={isPesoAdmin} canSuggest={canSuggest} onSuggest={setSuggestTarget} onEditOutcome={setOutcomeTarget} onViewActivity={setActivityTarget} onVoid={setVoidTarget} acceptanceEnabled={acceptanceEnabled} actionBusy={actionBusy} onAccept={handleAccept} onDecline={handleDecline} />;
					})}
				</div>
			</>
		);
	};

	// max-w-7xl opts this page into the sidebar-aware widening in index.css
	// (1536px expanded → 1740px collapsed, ≥1280px only). Extra width goes to the
	// document-name column in list view and to more tiles per row in grid view,
	// so both modes benefit.
	return (
		<div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
			<header className="mb-6">
				<h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">{heading}</h1>
				<p className="text-muted mt-1 font-medium text-sm">{subheading}</p>
			</header>

			{/* PESO administrators only: a job seeker has no reporting obligation
			    and must never see other citizens' names in an export. */}
			{isPesoAdmin && <ReferralReports />}

			{/* Advisory, not an alarm. These referrals completed correctly and the
			    applicants have their letters -- only the downstream n8n step was
			    missed. Styled as information rather than an error so it does not
			    read as "something is broken". */}
			{isPesoAdmin && undispatched.length > 0 && (
				<div className="mb-5 flex items-start gap-3 px-4 py-3 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20">
					<Info size={18} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
					<div className="min-w-0 text-sm">
						<p className="font-bold text-amber-900 dark:text-amber-200">
							{undispatched.length} referral{undispatched.length === 1 ? '' : 's'} did not reach the reporting system
						</p>
						<p className="text-amber-800/80 dark:text-amber-300/80 font-medium mt-0.5 leading-relaxed">
							The letters were sent and the applicants were notified — only the automatic record-keeping step was missed.
							Nothing needs fixing for the applicant.
							<span className="block mt-1 font-mono text-[11px] font-bold">
								{undispatched.map((r) => r.reference_number).filter(Boolean).join(', ')}
							</span>
						</p>
					</div>
				</div>
			)}

			{/* Toolbar skeleton — the real toolbar waits for hydration (its view toggle
			    would flash the wrong active state), so echo its row here to prevent the
			    toolbar popping in and shifting the body down on load. */}
			{hydrating && (
				<div className="flex flex-wrap items-center gap-3 mb-5" aria-hidden="true">
					<div className="h-11 flex-1 min-w-[220px] rounded-2xl bg-sunken animate-pulse" />
					<div className="h-11 w-36 rounded-2xl bg-sunken animate-pulse" />
					<div className="h-11 w-40 rounded-2xl bg-sunken animate-pulse" />
					<div className="h-11 w-[4.75rem] rounded-2xl bg-sunken animate-pulse" />
					<div className="h-3.5 w-28 rounded bg-sunken animate-pulse" />
				</div>
			)}

			{/* Toolbar — search / status / sort / view, same model as the job board */}
			{/* Toolbar also waits: its list/grid toggle shows an active state, which
			    would otherwise highlight the wrong option for a frame. */}
			{!hydrating && referrals.length > 0 && (
				<div className="flex flex-wrap items-center gap-3 mb-5">
					<SearchDropdown
						className="flex-1 min-w-[220px]"
						value={search}
						onChange={setSearch}
						onSubmit={(term) => { setSearch(term); if (term) recordSearch(term); }}
						placeholder={isPesoAdmin ? 'Search job, company, applicant, or reference' : 'Search job, company, or reference'}
						ariaLabel="Search referrals"
						recent={recentSearches}
						onRemoveRecent={removeSearch}
						onClearRecent={clearSearches}
						results={referralResults}
						quickFilters={statusQuickFilters}
					/>

					<div className="relative">
						<select value={status} onChange={(e) => setStatus(e.target.value)} className={`${controlClass} pl-3.5`} aria-label="Filter by status">
							<option value="">All statuses</option>
							{statusOptions.map(o => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
						</select>
						<ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
					</div>

					<div className="relative">
						<ArrowDownWideNarrow size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
						<select value={sort} onChange={(e) => setSort(e.target.value)} className={`${controlClass} pl-10`} aria-label="Sort referrals">
							{SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
						</select>
						<ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
					</div>

					{/* List / grid toggle */}
					<div className="flex items-center p-1 rounded-2xl border border-line/50 bg-surface/70 shadow-[0_1px_4px_rgba(15,23,42,0.04)]">
						<button
							onClick={() => changeView('list')}
							aria-pressed={view === 'list'}
							aria-label="List view"
							className={`p-1.5 rounded-xl transition-colors ${view === 'list' ? 'bg-accent text-white' : 'text-muted hover:text-content dark:hover:text-gray-200'}`}
						>
							<List size={16} />
						</button>
						<button
							onClick={() => changeView('grid')}
							aria-pressed={view === 'grid'}
							aria-label="Grid view"
							className={`p-1.5 rounded-xl transition-colors ${view === 'grid' ? 'bg-accent text-white' : 'text-muted hover:text-content dark:hover:text-gray-200'}`}
						>
							<LayoutGrid size={16} />
						</button>
					</div>

					<div className="flex items-center gap-3 w-full sm:w-auto text-xs font-bold text-muted">
						<span>{list.length} of {isPesoAdmin ? total : referrals.length} document{(isPesoAdmin ? total : referrals.length) === 1 ? '' : 's'}</span>
						{activeFilters > 0 && (
							<button onClick={resetFilters} className="flex items-center gap-1 text-rose-500 hover:text-rose-600 transition-colors">
								<X size={14} /> Clear
							</button>
						)}
					</div>
				</div>
			)}

			{isPesoAdmin && !loading && (
				<Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} position="top" />
			)}
			{!isPesoAdmin && !loading && visible.length > 0 && (
				<Pagination page={seekerPager.page} limit={seekerPager.limit} total={seekerPager.total} onPage={seekerPager.setPage} onLimitChange={seekerPager.onLimitChange} position="top" />
			)}

			<div className="bg-raised/80 backdrop-blur-xl rounded-3xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] overflow-hidden">
				{renderBody()}
			</div>

			{!isPesoAdmin && !loading && visible.length > 0 && (
				<Pagination page={seekerPager.page} limit={seekerPager.limit} total={seekerPager.total} onPage={seekerPager.setPage} onLimitChange={seekerPager.onLimitChange} />
			)}
			{isPesoAdmin && !loading && (
				<Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
			)}

			{outcomeTarget && (
				<OutcomeModal
					referral={outcomeTarget}
					onClose={() => setOutcomeTarget(null)}
					onSaved={() => setRefreshKey((k) => k + 1)}
				/>
			)}

			{activityTarget && (
				<ReferralActivity
					referral={activityTarget}
					onClose={() => setActivityTarget(null)}
				/>
			)}

			{voidTarget && (
				<VoidModal
					referral={voidTarget}
					onClose={() => setVoidTarget(null)}
					onSaved={() => setRefreshKey((k) => k + 1)}
				/>
			)}

			{suggestTarget && (
				<SuggestOutcomeModal
					referral={suggestTarget}
					onClose={() => setSuggestTarget(null)}
					onSaved={() => setRefreshKey((k) => k + 1)}
				/>
			)}
		</div>
	);
};

export default Referrals;
