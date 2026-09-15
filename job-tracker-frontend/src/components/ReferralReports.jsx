import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Download, Loader2, ChevronDown, AlertCircle } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import API from '../api';
import AccomplishmentReport from './common/AccomplishmentReport';

/**
 * Referral reporting for PESO administrators — the monthly count, the list of
 * names, and the placement rate that DOLE asks for.
 *
 * Collapsed by default. The Referral Register's job is finding one letter; this
 * answers a different question and would otherwise push the register down the
 * page for everyone who is not filing a report today.
 *
 * The date range filters on the date a referral was ISSUED, not on when its
 * outcome was recorded, so a hire reported in August against a July referral
 * counts toward July. That keeps the placement rate's numerator and denominator
 * describing the same cohort (see referralRepository.reportRows).
 */

const Stat = ({ label, value, hint, tone = 'default' }) => {
	const tones = {
		default: 'text-content',
		good: 'text-emerald-600 dark:text-emerald-400',
		muted: 'text-subtle',
	};
	return (
		<div className="p-4 rounded-2xl border border-line bg-surface/60">
			<p className="text-[11px] font-black uppercase tracking-wider text-subtle">{label}</p>
			<p className={`text-2xl font-black mt-1 ${tones[tone]}`}>{value}</p>
			{hint && <p className="text-[11px] font-medium text-subtle mt-1 leading-snug">{hint}</p>}
		</div>
	);
};

const ReferralReports = () => {
	const { notify } = useNotification();

	const [open, setOpen] = useState(false);
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [report, setReport] = useState(null);
	const [loading, setLoading] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams();
			if (from) params.set('from', from);
			if (to) params.set('to', to);
			const res = await API.get(`/referrals/reports/summary?${params}`);
			setReport(res.data?.data || null);
		} catch (err) {
			setError(err.response?.data?.message || 'Could not build the report.');
		} finally {
			setLoading(false);
		}
	}, [from, to]);

	// Load once on first expand; afterwards the user drives it with Apply.
	useEffect(() => { if (open && !report) load(); }, [open, report, load]);

	/**
	 * CSV download. Fetched as a blob with the auth header rather than opened as
	 * a URL: the export contains citizens' names and emails, so the endpoint is
	 * authenticated and a plain window.open cannot attach the bearer token —
	 * the same reason ATS resume downloads work this way.
	 */
	const exportCsv = async () => {
		setExporting(true);
		try {
			const params = new URLSearchParams();
			if (from) params.set('from', from);
			if (to) params.set('to', to);

			const res = await API.get(`/referrals/reports/export?${params}`, { responseType: 'blob' });
			const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = `peso-referrals-${from || 'all'}-to-${to || new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			notify.success('Export Ready', 'The referral report has been downloaded.');
		} catch (err) {
			notify.error('Export Failed', err.response?.data?.message || 'Please try again.');
		} finally {
			setExporting(false);
		}
	};

	return (
		<>
		{/* DOLE accomplishment report (aggregate + demographic + PDF/CSV) — owner-scoped. */}
		<AccomplishmentReport endpoint="/referrals/reports/accomplishment" />
		<div className="mb-5 bg-raised/80 backdrop-blur-xl rounded-3xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-sunken transition-colors"
			>
				<span className="flex items-center gap-3 min-w-0">
					<span className="w-9 h-9 shrink-0 rounded-lg bg-accent/10 dark:bg-accent-text/15 text-accent-text flex items-center justify-center">
						<BarChart3 size={18} />
					</span>
					<span className="min-w-0">
						<span className="block font-bold text-sm text-content">Reports &amp; Export</span>
						<span className="block text-xs text-muted font-medium truncate">Monthly counts, placement rate, and a CSV of referred applicants.</span>
					</span>
				</span>
				<ChevronDown size={18} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>

			{open && (
				<div className="px-4 sm:px-5 pb-5 border-t border-line pt-4 space-y-5">
					<div className="flex flex-col sm:flex-row sm:items-end gap-3">
						<div className="flex-1">
							<label htmlFor="rep_from" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">From</label>
							<input id="rep_from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
								className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
						</div>
						<div className="flex-1">
							<label htmlFor="rep_to" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">To</label>
							<input id="rep_to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
								className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
						</div>
						<div className="flex gap-2">
							<button type="button" onClick={load} disabled={loading}
								className="px-5 py-2.5 sm:py-3 rounded-xl text-sm font-black text-white bg-accent hover:bg-accent-hover shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
								{loading ? <Loader2 size={16} className="animate-spin" /> : null} Apply
							</button>
							<button type="button" onClick={exportCsv} disabled={exporting}
								className="px-4 py-2.5 sm:py-3 rounded-xl text-sm font-bold text-accent-text bg-accent/10 dark:bg-accent-text/10 hover:bg-accent/20 dark:hover:bg-accent-text/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
								{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} CSV
							</button>
						</div>
					</div>

					{error && (
						<p className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-400">
							<AlertCircle size={16} /> {error}
						</p>
					)}

					{report && !error && (
						<>
							<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
								<Stat label="Referred" value={report.total_referrals} />
								<Stat label="Hired" value={report.hired} tone="good" />
								<Stat label="No outcome yet" value={report.unknown} tone="muted" hint="Not counted as failures" />
								<Stat
									label="Placement rate"
									value={report.placement_rate.of_all === null ? '—' : `${report.placement_rate.of_all}%`}
									hint={report.placement_rate.of_known !== null ? `${report.placement_rate.of_known}% of the ${report.decided} with a recorded outcome` : undefined}
								/>
							</div>

							{/* Both denominators are stated because neither rate is
							    defensible alone: "of all" counts unfollowed-up
							    referrals as failures, "of known" reads 100% off a
							    handful of records. */}
							<p className="text-xs font-medium text-muted bg-sunken/40 rounded-xl px-4 py-3 leading-relaxed">
								<span className="font-bold">Basis:</span> {report.placement_rate.basis}. Recording outcomes for the
								remaining referrals is what makes this figure meaningful.
							</p>

							{report.monthly.length > 0 && (
								<div className="overflow-x-auto">
									<table className="w-full text-sm min-w-[420px]">
										<thead>
											<tr className="text-left border-b border-line">
												<th className="py-2 pr-4 text-[11px] font-black uppercase tracking-wider text-subtle">Month</th>
												<th className="py-2 pr-4 text-[11px] font-black uppercase tracking-wider text-subtle text-right">Referred</th>
												<th className="py-2 pr-4 text-[11px] font-black uppercase tracking-wider text-subtle text-right">Hired</th>
												<th className="py-2 text-[11px] font-black uppercase tracking-wider text-subtle text-right">Rate</th>
											</tr>
										</thead>
										<tbody>
											{report.monthly.map((m) => (
												<tr key={m.month} className="border-b border-line/50 last:border-0">
													<td className="py-2 pr-4 font-bold text-content">{m.month}</td>
													<td className="py-2 pr-4 text-right font-medium text-muted">{m.referrals}</td>
													<td className="py-2 pr-4 text-right font-medium text-muted">{m.hired}</td>
													<td className="py-2 text-right font-bold text-content">{m.placement_rate === null ? '—' : `${m.placement_rate}%`}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</>
					)}
				</div>
			)}
		</div>
		</>
	);
};

export default ReferralReports;
