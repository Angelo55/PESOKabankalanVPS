import React, { useState, useEffect } from 'react';
import { Send, Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { featureFlag } from '../utils/featureFlags';
import API from '../api';

/**
 * Issues or rejects a PESO referral for a single application.
 *
 * STATE SOURCE OF TRUTH: the database, not this component. `initialStatus` and
 * `initialReference` are hydrated by the parent from GET /referrals/jobs/:jobId,
 * so a refresh, a re-login, or another admin's decision all render correctly.
 * Local state exists only to reflect a decision made in THIS session before the
 * parent refetches.
 */
const ReferralActionButton = ({ applicationId, applicantName, initialStatus, initialReference, onDecided, referredCount, positionsAvailable }) => {
	const { notify } = useNotification();

	const [submitting, setSubmitting] = useState(false);
	const [decision, setDecision] = useState(initialStatus || null);
	const [referenceNumber, setReferenceNumber] = useState(initialReference || null);
	const [showRejectModal, setShowRejectModal] = useState(false);
	const [rejectReason, setRejectReason] = useState('');

	/**
	 * React reuses component instances across re-renders when the position in
	 * the tree is stable. Switching jobs swaps the applicant list underneath us,
	 * so without this the previous job's referral state would persist into the
	 * new one. Re-sync whenever the server-provided state changes.
	 */
	useEffect(() => {
		setDecision(initialStatus || null);
		setReferenceNumber(initialReference || null);
	}, [applicationId, initialStatus, initialReference]);

	const handleApprove = async () => {
		// D6 soft-warn: when vacancy closure is PESO-verified (manual-fill), a referral
		// past the employer's stated headcount is ALLOWED — but flag it so the admin
		// confirms deliberately. Only fires when the count data is known and a specific
		// headcount is set (an unspecified/NULL vacancy has no cap to exceed).
		if (
			featureFlag('vacancyManualFill') &&
			positionsAvailable != null &&
			referredCount != null &&
			Number(referredCount) >= Number(positionsAvailable)
		) {
			const cap = Number(positionsAvailable);
			const proceed = window.confirm(
				`This vacancy already has ${referredCount} of ${cap} stated position${cap === 1 ? '' : 's'} referred. ` +
				`Refer ${applicantName} anyway? (The vacancy stays open until PESO confirms it filled.)`
			);
			if (!proceed) return;
		}

		setSubmitting(true);

		try {
			// No auto-generated remark. `remarks` is the administrator's own note and
			// is PRINTED ON THE LETTER -- filler text does not belong on an official
			// endorsement. A proper remarks input is a Phase 7 refinement.
			const response = await API.post(`/referrals/applications/${applicationId}/approve`, {});

			const reference = response.data?.data?.referenceNumber;

			setDecision('Approved');
			setReferenceNumber(reference);

			notify.success('Referral Issued', `${reference} - queued for delivery to ${applicantName}.`);

			if (onDecided) onDecided(applicationId, 'Approved', reference);
		} catch (error) {
			const status = error.response?.status;
			const message = error.response?.data?.message || 'Could not reach the server.';

			if (status === 409) {
				// The database rejected a duplicate. Our local view was stale --
				// trust the server and correct ourselves.
				setDecision('Approved');
				notify.warning('Already Referred', message);
			} else {
				notify.error(`Referral Failed (${status || 'network'})`, message);
			}
		} finally {
			setSubmitting(false);
		}
	};

	const handleReject = async () => {
		if (!rejectReason.trim()) {
			return notify.warning('Reason Required', 'State why this applicant is not being referred.');
		}

		setSubmitting(true);

		try {
			await API.post(`/referrals/applications/${applicationId}/reject`, {
				remarks: rejectReason.trim()
			});

			setDecision('Rejected');
			setShowRejectModal(false);
			setRejectReason('');

			notify.success('Referral Rejected', `Decision recorded for ${applicantName}.`);

			if (onDecided) onDecided(applicationId, 'Rejected', null);
		} catch (error) {
			const status = error.response?.status;
			const message = error.response?.data?.message || 'Could not reach the server.';
			notify.error(`Rejection Failed (${status || 'network'})`, message);
		} finally {
			setSubmitting(false);
		}
	};

	if (decision === 'Approved') {
		return (
			<div
				className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-black rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-center gap-2 text-xs"
				title={referenceNumber ? `Referral ${referenceNumber}` : 'A referral already exists for this application.'}
			>
				<CheckCircle2 size={16} />
				<span className="whitespace-nowrap">{referenceNumber || 'Referred'}</span>
			</div>
		);
	}

	if (decision === 'Rejected') {
		return (
			<div className="flex-1 sm:flex-none px-4 py-2.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-black rounded-xl border border-red-200 dark:border-red-800 flex items-center justify-center gap-2 text-xs">
				<XCircle size={16} />
				<span className="whitespace-nowrap">Not Referred</span>
			</div>
		);
	}

	return (
		<>
			<div className="flex w-full sm:w-auto gap-2">
				<button
					onClick={handleApprove}
					disabled={submitting}
					className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 text-white font-black rounded-xl hover:bg-emerald-700 hover:-translate-y-0.5 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
					title="Issue an official PESO referral letter"
				>
					{submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
					<span className="text-xs whitespace-nowrap">Refer</span>
				</button>

				<button
					onClick={() => setShowRejectModal(true)}
					disabled={submitting}
					className="flex-1 sm:flex-none p-2.5 rounded-xl bg-sunken text-muted hover:bg-red-50 hover:text-red-600 dark:bg-surface dark:hover:bg-red-900/30 transition-colors flex items-center justify-center disabled:opacity-50"
					title="Decline to refer this applicant"
				>
					<XCircle size={18} />
				</button>
			</div>

			{showRejectModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
					<div className="bg-surface rounded-[1.5rem] border border-line shadow-2xl w-full max-w-md p-6 animate-fade-scale-in">
						<div className="flex justify-between items-start mb-4">
							<div>
								<h3 className="text-lg font-black text-content">Decline Referral</h3>
								<p className="text-sm text-muted font-medium mt-1">{applicantName}</p>
							</div>
							<button onClick={() => setShowRejectModal(false)} className="p-1 rounded-lg text-subtle hover:bg-line">
								<X size={20} />
							</button>
						</div>

						<label className="block text-xs font-black uppercase tracking-wider text-muted mb-2">
							Reason (required)
						</label>
						<textarea
							value={rejectReason}
							onChange={(e) => setRejectReason(e.target.value)}
							rows={4}
							placeholder="e.g. Does not meet the minimum experience requirement for this vacancy."
							className="w-full px-4 py-3 bg-sunken border border-line rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30 dark:text-white transition-all resize-none"
						/>
						<p className="text-[11px] text-subtle font-medium mt-2">
							This reason is permanently recorded in the referral audit log.
						</p>

						<div className="flex gap-3 mt-5">
							<button
								onClick={() => setShowRejectModal(false)}
								className="flex-1 px-4 py-2.5 rounded-xl font-bold text-sm text-muted bg-sunken hover:bg-line transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={handleReject}
								disabled={submitting}
								className="flex-1 px-4 py-2.5 rounded-xl font-black text-sm text-white bg-red-600 hover:bg-red-700 transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
							>
								{submitting ? <Loader2 size={16} className="animate-spin" /> : null}
								Confirm
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

export default ReferralActionButton;