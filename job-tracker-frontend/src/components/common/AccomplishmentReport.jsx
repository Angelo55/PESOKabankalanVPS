import React, { useState, useCallback } from 'react';
import { FileBarChart2, Download, Loader2, ChevronDown, AlertCircle, Info } from 'lucide-react';
import { useNotification } from '../../context/NotificationContext';
import API from '../../api';

/**
 * DOLE PESO Accomplishment Report (Phase A) — aggregate + demographic report over a
 * reporting period, shared by both the PESO-admin (owner-scoped) and Super-Admin
 * (office-wide) surfaces. Role-agnostic: the caller passes `endpoint` (the base path);
 * the component renders the on-screen tables (JSON) and downloads PDF/CSV via `?format=`.
 *
 * Downloads are authed blobs (the report is authenticated; window.open can't attach the
 * bearer token — same as referral letters / ATS resumes). Design-token styled (§24),
 * responsive (tables scroll inside overflow-x-auto), with loading/empty/error states.
 */
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-PH'));
const pct = (v) => (v == null ? '—' : `${v}%`);

const Stat = ({ label, value, tone = 'content' }) => (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
        <p className={`text-2xl font-black mt-0.5 ${tone === 'accent' ? 'text-accent-text' : 'text-content'}`}>{value}</p>
    </div>
);

const DemoTable = ({ caption, dimensionLabel, rows, totals }) => (
    <div>
        <h4 className="text-sm font-black text-content mb-2">{caption}</h4>
        <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-sunken text-muted text-xs uppercase tracking-wider">
                        <th className="text-left font-bold px-3 py-2">{dimensionLabel}</th>
                        <th className="text-right font-bold px-3 py-2">Registered</th>
                        <th className="text-right font-bold px-3 py-2">Referred</th>
                        <th className="text-right font-bold px-3 py-2">Placed</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.bucket} className="border-t border-line/70">
                            <td className="px-3 py-2 font-semibold text-content">{r.bucket}</td>
                            <td className="px-3 py-2 text-right text-content tabular-nums">{fmt(r.registered)}</td>
                            <td className="px-3 py-2 text-right text-content tabular-nums">{fmt(r.referred)}</td>
                            <td className="px-3 py-2 text-right text-content tabular-nums">{fmt(r.placed)}</td>
                        </tr>
                    ))}
                    <tr className="border-t-2 border-line bg-sunken/60 font-black text-content">
                        <td className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.registered)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.referred)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.placed)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
);

const AccomplishmentReport = ({ endpoint }) => {
    const { notify } = useNotification();
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(null);
    const [error, setError] = useState(null);

    const params = useCallback(() => {
        const p = new URLSearchParams();
        if (from) p.set('from', from);
        if (to) p.set('to', to);
        return p;
    }, [from, to]);

    const generate = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await API.get(`${endpoint}?${params()}`);
            setReport(res.data?.data || null);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to build the report.');
        } finally { setLoading(false); }
    }, [endpoint, params]);

    const download = async (format) => {
        setDownloading(format);
        try {
            const p = params(); p.set('format', format);
            const res = await API.get(`${endpoint}?${p}`, { responseType: 'blob' });
            const mime = format === 'pdf' ? 'application/pdf' : 'text/csv';
            const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `PESO_Accomplishment_Report_${new Date().toISOString().slice(0, 10)}.${format}`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
            notify.success('Download ready', `The ${format.toUpperCase()} report has been downloaded.`);
        } catch (err) {
            notify.error('Download failed', err.response?.data?.message || 'Please try again.');
        } finally { setDownloading(null); }
    };

    const s = report?.summary;
    return (
        <div className="mb-5 bg-raised/80 rounded-3xl border border-line shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-sunken transition-colors"
            >
                <span className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-accent/10 dark:bg-accent-text/15 text-accent-text flex items-center justify-center">
                        <FileBarChart2 size={18} />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-sm sm:text-base font-black text-content">DOLE Accomplishment Report</span>
                        <span className="block text-xs text-muted">Registered · solicited · referred · placed, by sex and education — with PDF / CSV</span>
                    </span>
                </span>
                <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="px-4 sm:px-5 pb-5 pt-1 space-y-5">
                    {/* Date range + generate */}
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <label className="text-xs font-bold text-muted flex flex-col gap-1">
                            From
                            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                                className="p-2.5 rounded-lg text-sm bg-surface border border-line text-content outline-none focus:ring-2 focus:ring-accent/30" />
                        </label>
                        <label className="text-xs font-bold text-muted flex flex-col gap-1">
                            To
                            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                                className="p-2.5 rounded-lg text-sm bg-surface border border-line text-content outline-none focus:ring-2 focus:ring-accent/30" />
                        </label>
                        <button onClick={generate} disabled={loading}
                            className="px-4 py-2.5 rounded-lg text-sm font-black bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
                            {loading ? <Loader2 size={16} className="animate-spin" /> : <FileBarChart2 size={16} />} Generate
                        </button>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400"><AlertCircle size={16} /> {error}</div>
                    )}

                    {!report && !loading && !error && (
                        <p className="text-sm text-muted">Choose a period (or leave both blank for all records) and press Generate.</p>
                    )}

                    {report && (
                        <div className="space-y-5">
                            {/* Summary */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                                <Stat label="Registered" value={fmt(s.registered)} />
                                <Stat label="Vacancies" value={fmt(s.vacancies_solicited)} />
                                <Stat label="Positions" value={fmt(s.positions_solicited)} />
                                <Stat label="Referred" value={fmt(s.referred)} />
                                <Stat label="Placed" value={fmt(s.placed)} tone="accent" />
                                <Stat label="Placement rate" value={pct(report.placement_rate.of_all)} tone="accent" />
                            </div>
                            <p className="text-xs text-muted -mt-2">{report.placement_rate.basis}. Of recorded outcomes: {pct(report.placement_rate.of_known)}.</p>

                            <DemoTable caption="By sex" dimensionLabel="Sex" rows={report.by_sex} totals={s} />
                            <DemoTable caption="By educational attainment" dimensionLabel="Educational attainment" rows={report.by_education} totals={s} />
                            {report.by_age_group && <DemoTable caption="By age group" dimensionLabel="Age group" rows={report.by_age_group} totals={s} />}

                            {/* Notes */}
                            {report.notes?.length > 0 && (
                                <div className="rounded-2xl bg-sunken/60 border border-line p-3.5 space-y-1.5">
                                    {report.notes.map((n, i) => (
                                        <p key={i} className="text-xs text-muted flex items-start gap-2"><Info size={13} className="shrink-0 mt-0.5" /> {n}</p>
                                    ))}
                                </div>
                            )}

                            {/* Downloads */}
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => download('pdf')} disabled={downloading === 'pdf'}
                                    className="px-4 py-2.5 rounded-lg text-sm font-bold bg-surface border border-line text-content hover:bg-sunken disabled:opacity-60 flex items-center gap-2">
                                    {downloading === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download PDF
                                </button>
                                <button onClick={() => download('csv')} disabled={downloading === 'csv'}
                                    className="px-4 py-2.5 rounded-lg text-sm font-bold bg-surface border border-line text-content hover:bg-sunken disabled:opacity-60 flex items-center gap-2">
                                    {downloading === 'csv' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download CSV
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AccomplishmentReport;
