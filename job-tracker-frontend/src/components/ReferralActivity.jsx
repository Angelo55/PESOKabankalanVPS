import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
	X, Loader2, CheckCircle2, FileText, Mail, Bell, Send, AlertTriangle,
	RotateCcw, Sparkles, Target, Briefcase, RefreshCw, History, AlertCircle
} from 'lucide-react';
import API from '../api';

/**
 * The audit trail for one referral, as a timeline.
 *
 * referral_activity_log has been written faithfully since the module was built
 * and nothing ever read it back. For a workflow whose defensibility rests on
 * "a named administrator approved every one", the evidence was write-only.
 * This is the screen that makes it evidence.
 *
 * Visible to the job seeker the referral names as well as to administrators —
 * a citizen is entitled to see what was done with their own referral. The
 * server enforces that; the role is not checked here.
 */

/**
 * Icon + tone per action. Actions written by the WORKER (no actor_id) are
 * styled the same as human ones on purpose: the timeline's job is to show what
 * happened, and the "by" line already distinguishes a person from the system.
 */
const ACTION_META = {
	REFERRAL_APPROVED:  { Icon: CheckCircle2,  label: 'Referral approved',      tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
	REFERRAL_REJECTED:  { Icon: X,             label: 'Referral rejected',      tone: 'text-rose-600 dark:text-rose-400 bg-rose-500/10' },
	AI_RECOMMENDED:     { Icon: Sparkles,      label: 'AI recommended',         tone: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
	PDF_GENERATED:      { Icon: FileText,      label: 'Letter generated',       tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10' },
	LETTER_REGENERATED: { Icon: RefreshCw,     label: 'Letter regenerated',     tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10' },
	EMAIL_SENT:         { Icon: Mail,          label: 'Letter emailed',         tone: 'text-sky-600 dark:text-sky-400 bg-sky-500/10' },
	NOTIFICATION_SENT:  { Icon: Bell,          label: 'Applicant notified',     tone: 'text-sky-600 dark:text-sky-400 bg-sky-500/10' },
	N8N_DISPATCHED:     { Icon: Send,          label: 'Dispatched downstream',  tone: 'text-muted bg-gray-500/10' },
	DELIVERY_FAILED:    { Icon: AlertTriangle, label: 'Delivery failed',        tone: 'text-red-600 dark:text-red-400 bg-red-500/10' },
	DELIVERY_RETRIED:   { Icon: RotateCcw,     label: 'Delivery retried',       tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
	RETRY_REQUESTED:    { Icon: RotateCcw,     label: 'Retry requested',        tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
	JOB_FILLED:         { Icon: Briefcase,     label: 'Vacancy filled',         tone: 'text-teal-600 dark:text-teal-400 bg-teal-500/10' },
	OUTCOME_RECORDED:   { Icon: Target,        label: 'Outcome recorded',       tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
};

// An unmapped action still renders rather than vanishing: a new action type
// added server-side must never make an audit entry invisible.
const DEFAULT_META = { Icon: History, label: 'Activity', tone: 'text-muted bg-gray-500/10' };

const formatStamp = (value) => {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString([], {
		year: 'numeric', month: 'short', day: 'numeric',
		hour: '2-digit', minute: '2-digit'
	});
};

const ReferralActivity = ({ referral, onClose }) => {
	const [entries, setEntries] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		let cancelled = false;

		API.get(`/referrals/${referral.id}/activity`)
			.then((res) => { if (!cancelled) setEntries(res.data?.data || []); })
			.catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load the activity trail.'); })
			.finally(() => { if (!cancelled) setLoading(false); });

		return () => { cancelled = true; };
	}, [referral.id]);

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-label="Referral activity trail"
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="bg-surface rounded-3xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95"
			>
				<div className="flex items-start justify-between gap-4 p-5 border-b border-line">
					<div className="min-w-0">
						<h3 className="text-lg font-black text-content">Activity Trail</h3>
						<p className="text-xs text-muted font-medium mt-0.5 truncate">
							{referral.applicant_name || referral.job_title}
						</p>
						<p className="font-mono text-[11px] font-bold text-subtle mt-1">{referral.reference_number || '—'}</p>
					</div>
					<button type="button" onClick={onClose} aria-label="Close"
						className="p-2 rounded-lg text-subtle hover:text-muted dark:hover:text-gray-200 hover:bg-line transition-colors">
						<X size={18} />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-5">
					{loading && (
						<div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-subtle" /></div>
					)}

					{error && !loading && (
						<p className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-400">
							<AlertCircle size={16} /> {error}
						</p>
					)}

					{!loading && !error && entries.length === 0 && (
						<p className="text-sm text-muted font-medium text-center py-8">
							No activity has been recorded for this referral.
						</p>
					)}

					{!loading && !error && entries.length > 0 && (
						<ol className="relative space-y-4">
							{entries.map((entry, i) => {
								const meta = ACTION_META[entry.action] || DEFAULT_META;
								const { Icon } = meta;
								const isLast = i === entries.length - 1;

								return (
									<li key={entry.id} className="relative flex gap-3">
										{/* Connector, drawn behind the icons. Omitted on the
										    last item so the line does not dangle. */}
										{!isLast && (
											<span aria-hidden="true" className="absolute left-[15px] top-8 bottom-[-1rem] w-px bg-line" />
										)}

										<span className={`relative z-10 w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${meta.tone}`}>
											<Icon size={15} />
										</span>

										<div className="min-w-0 pb-1">
											<p className="text-sm font-bold text-content leading-snug">{meta.label}</p>
											{entry.detail && (
												<p className="text-xs text-muted font-medium mt-0.5 leading-relaxed break-words">{entry.detail}</p>
											)}
											<p className="text-[11px] font-bold text-subtle mt-1">
												{formatStamp(entry.created_at)}
												{' · '}
												{/* No actor means the worker did it, not that
												    nobody is accountable. Say so explicitly. */}
												{entry.actor_name || 'System'}
											</p>
										</div>
									</li>
								);
							})}
						</ol>
					)}
				</div>
			</div>
		</div>,
		document.body
	);
};

export default ReferralActivity;
