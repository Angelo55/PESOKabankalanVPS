import React, { useState, useEffect } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Inbox, CheckCircle2 } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import API from '../api';
import EmptyState from './common/EmptyState';

/**
 * Failed Referral Recovery (PESO Administrator).
 *
 * Surfaces referrals whose delivery exhausted all retries -- otherwise invisible
 * without a direct DB query. Each shows which step failed and the error, so the
 * admin can decide whether a retry will help (a transient SMTP outage: yes; a
 * missing applicant email: fix the data first).
 *
 * Retry re-arms the outbox row; the existing worker delivers it on its next
 * tick. No new delivery logic -- this is a control surface over the pipeline
 * that already exists.
 */

const stepLabel = {
	generate_pdf: 'PDF generation',
	send_email: 'Email delivery',
	notify: 'Notification',
	dispatch_n8n: 'Automation reporting'
};

const FailedReferralsPanel = () => {
	const { notify } = useNotification();

	const [failed, setFailed] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [retryingId, setRetryingId] = useState(null);

	const fetchFailed = async () => {
		setLoading(true);
		setError(null);

		try {
			const response = await API.get('/referrals/failed');
			setFailed(response.data?.data || []);
		} catch (err) {
			setError(err.response?.data?.message || 'Could not load failed referrals.');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchFailed();
	}, []);

	const handleRetry = async (item) => {
		setRetryingId(item.queue_id);

		try {
			await API.post(`/referrals/${item.queue_id}/retry`, {});
			notify.success('Re-queued', `${item.reference_number || 'Referral'} will be retried within moments.`);

			// Drop it from the failed list -- it is no longer failed.
			setFailed((prev) => prev.filter((f) => f.queue_id !== item.queue_id));
		} catch (err) {
			const status = err.response?.status;
			notify.error(`Retry Failed (${status || 'network'})`, err.response?.data?.message || 'Could not re-queue this referral.');
		} finally {
			setRetryingId(null);
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
					<h3 className="text-lg font-bold text-muted">Could not load failed referrals</h3>
					<p className="text-sm text-muted mt-1">{error}</p>
				</div>
			);
		}

		if (failed.length === 0) {
			return (
				<EmptyState
					variant="success"
					icon={CheckCircle2}
					title="All referrals delivered"
					description="Every referral letter has been delivered successfully — nothing needs a retry right now. If a delivery ever exhausts its automatic retries, it will show up here with the failed step and the reason, ready to re-queue."
				/>
			);
		}

		return (
			<div className="divide-y divide-gray-100 dark:divide-gray-700">
				{failed.map((item) => {
					const isRetrying = retryingId === item.queue_id;

					return (
						<div key={item.queue_id} className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
							<div className="flex items-start gap-4 min-w-0 flex-1">
								<div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-500 flex items-center justify-center shrink-0 border border-red-100 dark:border-red-800">
									<AlertTriangle size={22} />
								</div>

								<div className="min-w-0">
									<h3 className="font-bold text-content truncate">
										{item.applicant_name} — {item.job_title}
									</h3>
									<p className="text-sm text-muted font-medium truncate">{item.company_name}</p>

									<div className="flex flex-wrap items-center gap-2 mt-2">
										{item.reference_number ? (
											<span className="font-mono text-[11px] font-bold bg-sunken text-muted px-2.5 py-1 rounded-lg border border-line">
												{item.reference_number}
											</span>
										) : null}
										<span className="text-[11px] font-black uppercase tracking-wider bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2.5 py-1 rounded-lg border border-red-100 dark:border-red-800/50">
											Failed at {stepLabel[item.step] || item.step}
										</span>
										<span className="text-[11px] font-bold text-subtle">
											{item.attempts}/{item.max_attempts} attempts
										</span>
									</div>

									{item.last_error ? (
										<p className="text-xs text-red-500/80 mt-2 font-mono break-words">{item.last_error}</p>
									) : null}
								</div>
							</div>

							<div className="shrink-0">
								<button
									onClick={() => handleRetry(item)}
									disabled={isRetrying}
									className="px-4 py-2.5 bg-accent text-accent-contrast font-black text-xs rounded-xl hover:bg-accent-hover transition-colors shadow-md inline-flex items-center gap-2 disabled:opacity-50"
								>
									{isRetrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
									Retry Delivery
								</button>
							</div>
						</div>
					);
				})}
			</div>
		);
	};

	return (
		<div className="p-8 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
			<header className="mb-8">
				<div className="flex items-center gap-3">
					<div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 text-white flex items-center justify-center shadow-md">
						<AlertTriangle size={22} />
					</div>
					<div>
						<h1 className="text-3xl font-black text-content tracking-tight">Failed Referrals</h1>
						<p className="text-muted mt-1 font-medium text-sm">
							Referrals whose delivery exhausted all automatic retries. Fix the cause if needed, then retry.
						</p>
					</div>
				</div>
			</header>

			<div className="bg-raised/80 backdrop-blur-xl rounded-[2rem] border border-line shadow-sm overflow-hidden">
				{renderBody()}
			</div>
		</div>
	);
};

export default FailedReferralsPanel;