import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, CheckCircle2, X, Inbox, TrendingUp, AlertTriangle } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import API from '../api';
import useMultiSelect from './jobs/useMultiSelect';
import EmptyState from './common/EmptyState';
import { SelectCheckbox } from './jobs/SelectionBar';
import { BulkActionBar } from './common/AdminUI';

/**
 * AI Recommended referral queue (PESO Administrator).
 *
 * Lists applicants the AI staged at 'Pending Review', ranked by match score.
 * The admin reads the AI's reasoning and either APPROVES (runs the full
 * referral delivery pipeline) or DISMISSES (records a rejection).
 *
 * This panel invents NO new decision logic. Approve and Dismiss call the exact
 * same endpoints the ATS Refer/Decline buttons use, so every safeguard already
 * tested -- ownership checks, duplicate prevention, the transactional outbox --
 * applies unchanged.
 */

const scoreTone = (score) => {
	const value = Number(score);
	if (value >= 80) return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800';
	if (value >= 65) return 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800';
	return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800';
};

const AiRecommendedPanel = () => {
	const { notify } = useNotification();

	const [recommendations, setRecommendations] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [processingId, setProcessingId] = useState(null);
	const [bulkBusy, setBulkBusy] = useState(false);

	const ms = useMultiSelect(recommendations.map(r => r.application_id));

	const fetchRecommendations = async () => {
		setLoading(true);
		setError(null);

		try {
			const response = await API.get('/referrals/recommended');
			setRecommendations(response.data?.data || []);
		} catch (err) {
			setError(err.response?.data?.message || 'Could not load AI recommendations.');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchRecommendations();
	}, []);

	/**
	 * Removes a card from the list once it has been decided. Avoids a full
	 * refetch -- the row is gone from the 'Pending Review' set the moment the
	 * server responds, so dropping it locally keeps the UI in step.
	 */
	const removeCard = (applicationId) => {
		setRecommendations((prev) => prev.filter((r) => r.application_id !== applicationId));
	};

	const handleApprove = async (rec) => {
		setProcessingId(rec.application_id);

		try {
			const response = await API.post(`/referrals/applications/${rec.application_id}/approve`, {});
			const reference = response.data?.data?.referenceNumber;

			notify.success('Referral Issued', `${reference} - queued for delivery to ${rec.applicant_name}.`);
			removeCard(rec.application_id);
		} catch (err) {
			const status = err.response?.status;
			const message = err.response?.data?.message || 'Could not approve this referral.';

			// If it was already decided elsewhere, drop it from the queue anyway.
			if (status === 409) {
				notify.warning('Already Decided', message);
				removeCard(rec.application_id);
			} else {
				notify.error(`Approval Failed (${status || 'network'})`, message);
			}
		} finally {
			setProcessingId(null);
		}
	};

	const handleDismiss = async (rec) => {
		setProcessingId(rec.application_id);

		try {
			// reject requires a reason; supply a default for a one-click dismissal.
			await API.post(`/referrals/applications/${rec.application_id}/reject`, {
				remarks: 'AI recommendation reviewed and dismissed by PESO administrator.'
			});

			notify.success('Recommendation Dismissed', `${rec.applicant_name} will not be referred.`);
			removeCard(rec.application_id);
		} catch (err) {
			const status = err.response?.status;
			const message = err.response?.data?.message || 'Could not dismiss this recommendation.';

			if (status === 409) {
				notify.warning('Already Decided', message);
				removeCard(rec.application_id);
			} else {
				notify.error(`Dismiss Failed (${status || 'network'})`, message);
			}
		} finally {
			setProcessingId(null);
		}
	};

	/**
	 * Approve or dismiss the whole selection in one request. The server loops the
	 * single-item service calls, so each approval STILL runs its own vacancy-cap
	 * transaction — a batch that would over-fill a vacancy approves the ones that
	 * fit and returns the rest as failed (e.g. 409 full). We drop only the cards
	 * that actually succeeded and leave the others in place with a summary.
	 */
	const handleBulk = async (decision) => {
		if (ms.count === 0) return;
		setBulkBusy(true);
		const ids = ms.ids;
		try {
			const res = await API.post(`/referrals/applications/bulk/${decision}`, {
				applicationIds: ids,
				remarks: decision === 'reject'
					? 'AI recommendation reviewed and dismissed by PESO administrator.'
					: undefined,
			});
			const { results = [], succeeded = 0, failed = 0 } = res.data?.data || {};
			const okIds = new Set(results.filter(r => r.ok).map(r => r.applicationId));
			setRecommendations(prev => prev.filter(r => !okIds.has(r.application_id)));
			ms.clear();

			const verb = decision === 'approve' ? 'approved' : 'dismissed';
			if (failed === 0) {
				notify.success(decision === 'approve' ? 'Referrals Issued' : 'Recommendations Dismissed', `${succeeded} ${verb} and processed.`);
			} else {
				notify.warning('Partially Completed', `${succeeded} ${verb}; ${failed} could not be (vacancy full or already decided) and remain in the queue.`);
			}
		} catch (err) {
			notify.error('Bulk Action Failed', err.response?.data?.message || 'Could not process the selection.');
		} finally {
			setBulkBusy(false);
		}
	};

	const renderBody = () => {
		if (loading) {
			return (
				<div className="flex justify-center p-20">
					<Loader2 className="animate-spin text-accent-text" size={32} />
				</div>
			);
		}

		if (error) {
			return (
				<div className="flex flex-col items-center justify-center p-20 text-center">
					<AlertTriangle size={48} className="text-red-300 mb-4" />
					<h3 className="text-lg font-bold text-muted">Could not load recommendations</h3>
					<p className="text-sm text-muted mt-1">{error}</p>
				</div>
			);
		}

		if (recommendations.length === 0) {
			return (
				<EmptyState
					variant="success"
					icon={CheckCircle2}
					title="No referrals awaiting review"
					description="You're all caught up — there are no AI-recommended applicants pending right now. When an applicant's AI compatibility score meets the referral threshold, they'll appear here for you to approve or reject."
					primaryAction={{ label: 'Open Applicant Pipeline', to: '/peso-admin/ats' }}
				/>
			);
		}

		return (
			<>
			{ms.selectMode && (
				<BulkActionBar
					count={ms.count}
					nouns={{ singular: 'recommendation', plural: 'recommendations' }}
					allSelected={ms.allSelected}
					onToggleAll={ms.toggleAll}
					onCancel={ms.clear}
					busy={bulkBusy}
				>
					<button
						type="button"
						onClick={() => handleBulk('approve')}
						disabled={bulkBusy}
						className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
					>
						<CheckCircle2 size={13} /> Approve all
					</button>
					<button
						type="button"
						onClick={() => handleBulk('reject')}
						disabled={bulkBusy}
						className="px-3.5 py-1.5 rounded-xl bg-surface border border-line text-muted text-xs font-black hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
					>
						<X size={13} /> Dismiss all
					</button>
				</BulkActionBar>
			)}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				{recommendations.map((rec) => {
					const isProcessing = processingId === rec.application_id;
					const selected = ms.isSelected(rec.application_id);

					return (
						<div key={rec.id} className={`bg-surface rounded-[1.5rem] border shadow-sm p-6 flex flex-col transition-all ${selected ? 'border-accent ring-2 ring-accent/30' : 'border-line'}`}>
							<div className="flex items-start justify-between gap-3 mb-4">
								<div className="flex items-start gap-3 min-w-0">
									<SelectCheckbox
										checked={selected}
										selectMode={ms.selectMode}
										onToggle={() => (ms.selectMode ? ms.toggle(rec.application_id) : ms.enterWith(rec.application_id))}
										className="mt-1"
									/>
									<div className="min-w-0">
										<h3 className="font-black text-content truncate">{rec.applicant_name}</h3>
										<p className="text-sm text-muted font-medium truncate">{rec.job_title}</p>
										<p className="text-xs text-subtle truncate">{rec.company_name}</p>
									</div>
								</div>

								<div className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border ${scoreTone(rec.match_score)}`}>
									<TrendingUp size={14} />
									<span className="text-lg font-black leading-none mt-1">{rec.match_score}%</span>
								</div>
							</div>

							<div className="flex items-start gap-2 bg-indigo-50/50 dark:bg-indigo-900/20 rounded-xl p-3 mb-5 flex-1">
								<Sparkles size={16} className="text-indigo-500 shrink-0 mt-0.5" />
								<p className="text-xs text-muted leading-relaxed">
									{rec.ai_recommendation || 'The AI flagged this applicant as a strong match for this vacancy.'}
								</p>
							</div>

							<div className="flex gap-2 mt-auto">
								<button
									onClick={() => handleApprove(rec)}
									disabled={isProcessing}
									className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-black text-xs rounded-xl hover:bg-emerald-700 transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
								>
									{isProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
									Approve &amp; Refer
								</button>

								<button
									onClick={() => handleDismiss(rec)}
									disabled={isProcessing}
									className="px-4 py-2.5 bg-sunken text-muted font-black text-xs rounded-xl hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
								>
									<X size={14} /> Dismiss
								</button>
							</div>
						</div>
					);
				})}
			</div>
			</>
		);
	};

	return (
		<div className="p-8 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
			<header className="mb-8">
				<div className="flex items-center gap-3">
					<div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-md">
						<Sparkles size={22} />
					</div>
					<div>
						<h1 className="text-3xl font-black text-content tracking-tight">AI Recommended</h1>
						<p className="text-muted mt-1 font-medium text-sm">
							Applicants the AI flagged as strong matches. Review the reasoning, then approve or dismiss.
						</p>
					</div>
				</div>
			</header>

			{renderBody()}
		</div>
	);
};

export default AiRecommendedPanel;


