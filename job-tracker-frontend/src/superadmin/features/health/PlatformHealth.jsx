import React, { useState, useEffect, useCallback } from 'react';
import {
    Activity, Database, Mail, Cpu, FileCheck2, RefreshCw, Loader2,
    CheckCircle2, AlertTriangle, XCircle, Clock, Send, Sparkles,
} from 'lucide-react';
import API from '../../../api';
import { useNotification } from '../../../context/NotificationContext';

/**
 * PLATFORM HEALTH — the Super Administrator's live operational status board.
 *
 * Surfaces GET /admin/health, which probes each external dependency INDEPENDENTLY
 * and degrades a panel rather than 500-ing the page. This is the visual home for
 * the resilience work: mail provider failover (P0), the AI provider failover +
 * circuit breaker (P1), plus database latency, the referral-worker backlog, and
 * letter durability. Every probe reports its own ok/warn/critical state so what
 * needs attention reads at a glance.
 */

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

// Semantic status → colour + icon. Kept separate from any brand accent.
const TONE = {
    ok:       { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2, label: 'Healthy' },
    warn:     { dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     Icon: AlertTriangle, label: 'Attention' },
    critical: { dot: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',       Icon: XCircle,       label: 'Critical' },
    unknown:  { dot: 'bg-gray-400',    text: 'text-muted',        Icon: AlertTriangle, label: 'Unknown' },
};

const StatusCard = ({ icon, title, tone, headline, children }) => {
    const t = TONE[tone] || TONE.unknown;
    return (
        <div className="bg-surface/80 rounded-2xl border border-line shadow-sm p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5 text-content">
                    <span className="text-subtle">{icon}</span>
                    <h3 className="font-bold text-sm">{title}</h3>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${t.text}`}>
                    <span className={`w-2 h-2 rounded-full ${t.dot}`} /> {t.label}
                </span>
            </div>
            {headline && <p className="text-2xl font-black text-content tabular-nums leading-none mb-2">{headline}</p>}
            <div className="text-xs text-muted font-medium space-y-1.5 mt-auto">{children}</div>
        </div>
    );
};

// A labelled provider/row with its own ok/error dot.
const Row = ({ label, ok, detail }) => (
    <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span className="capitalize">{label}</span>
        </span>
        <span className={`font-semibold ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {detail || (ok ? 'OK' : 'Down')}
        </span>
    </div>
);

const PlatformHealth = () => {
    const { notify } = useNotification();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async ({ silent = false } = {}) => {
        if (silent) setRefreshing(true); else setLoading(true);
        try {
            const res = await API.get('/admin/health', getAuthConfig());
            setData(res.data?.data || null);
        } catch (error) {
            notify.error('Health check failed', 'Could not reach the health endpoint.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [notify]);

    useEffect(() => { load(); }, [load]);

    // ── Derive a tone per subsystem from the raw probe data ──────────────────
    const db = data?.database || {};
    const mail = data?.mail || {};
    const ai = data?.ai || {};
    const worker = data?.referralWorker || {};
    const letters = data?.letters || {};
    const emailOutbox = data?.emailOutbox || {};

    const dbTone = db.reachable ? (db.latencyMs > 800 ? 'warn' : 'ok') : 'critical';
    const mailProviders = Array.isArray(mail.providers) ? mail.providers : [];
    const mailTone = mail.healthy ? (mailProviders.some(p => !p.ok) ? 'warn' : 'ok') : 'critical';
    const aiProviders = Array.isArray(ai.providers) ? ai.providers : [];
    const aiConfigured = aiProviders.filter(p => p.configured);
    const aiTone = !ai.configured ? 'critical' : (aiProviders.some(p => p.circuitOpen) || aiConfigured.length < 2 ? 'warn' : 'ok');
    const workerTone = (worker.failed || 0) > 0 ? 'warn' : 'ok';
    const lettersTone = (letters.atRisk || 0) > 0 ? 'critical' : 'ok';
    // Email outbox (Phase 2C): failed rows or a long-waiting pending backlog is a
    // warn; if the worker is disabled the queue is intentionally idle, not a fault.
    const emailTone = (emailOutbox.failed || 0) > 0 || (emailOutbox.oldestPendingAgeMinutes || 0) > 30 ? 'warn' : 'ok';
    const jobAlerts = data?.jobAlerts || {};
    const jobAlertsTone = (jobAlerts.failed || 0) > 0 ? 'warn' : 'ok';

    if (loading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen flex items-center justify-center">
                <Loader2 className="animate-spin text-accent-text" size={36} />
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen animate-fade-scale-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-accent text-accent-contrast"><Activity size={22} /></div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Platform Health</h1>
                        <p className="text-muted text-sm font-medium mt-0.5">
                            Live status of every external dependency.
                            {data?.checkedAt && <span className="ml-1 inline-flex items-center gap-1"><Clock size={12} /> checked {new Date(data.checkedAt).toLocaleTimeString()}</span>}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => load({ silent: true })}
                    disabled={refreshing}
                    className="self-start inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-accent hover:bg-accent-hover shadow-sm transition-colors disabled:opacity-60"
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Re-check
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatusCard icon={<Database size={18} />} title="Database (TiDB)" tone={dbTone} headline={db.reachable ? `${db.latencyMs ?? '—'} ms` : 'Unreachable'}>
                    <Row label="Reachability" ok={!!db.reachable} detail={db.reachable ? 'Connected' : 'Down'} />
                    {db.reachable && <p className="text-subtle">Query round-trip latency.</p>}
                </StatusCard>

                <StatusCard icon={<Mail size={18} />} title="Email delivery" tone={mailTone} headline={`${mail.configured ?? 0} provider${(mail.configured ?? 0) === 1 ? '' : 's'}`}>
                    {mailProviders.length > 0
                        ? mailProviders.map(p => <Row key={p.name} label={p.name} ok={p.ok} detail={p.ok ? 'Verified' : 'Failed'} />)
                        : <p>No email provider configured.</p>}
                    <p className="text-subtle pt-1">Failover sends via the first healthy provider.</p>
                </StatusCard>

                <StatusCard icon={<Cpu size={18} />} title="AI providers" tone={aiTone} headline={`${aiConfigured.length}/2 configured`}>
                    {aiProviders.map(p => (
                        <Row
                            key={p.name}
                            label={p.name}
                            ok={p.configured && !p.circuitOpen}
                            detail={!p.configured ? 'Not set' : p.circuitOpen ? 'Circuit open' : 'Ready'}
                        />
                    ))}
                    <p className="text-subtle pt-1">Failover across providers; a tripped breaker self-clears.</p>
                </StatusCard>

                <StatusCard icon={<RefreshCw size={18} />} title="Referral worker" tone={workerTone} headline={`${worker.outbox ?? 0} queued`}>
                    <Row label="Stuck (reclaimable)" ok={(worker.stuck || 0) === 0} detail={`${worker.stuck ?? 0}`} />
                    <Row label="Dead-lettered" ok={(worker.failed || 0) === 0} detail={`${worker.failed ?? 0}`} />
                    <p className="text-subtle pt-1">Failed jobs are replayable from Failed Referrals.</p>
                </StatusCard>

                <StatusCard icon={<Send size={18} />} title="Email delivery queue" tone={emailTone} headline={emailOutbox.enabled ? `${emailOutbox.pending ?? 0} pending` : 'Disabled'}>
                    <Row label="Dead-lettered" ok={(emailOutbox.failed || 0) === 0} detail={`${emailOutbox.failed ?? 0}`} />
                    <Row label="Oldest pending" ok={(emailOutbox.oldestPendingAgeMinutes || 0) <= 30} detail={`${emailOutbox.oldestPendingAgeMinutes ?? 0} min`} />
                    {emailOutbox.enabled
                        ? <p className="text-subtle pt-1">Failed emails are resendable from Email Delivery.</p>
                        : <p className="text-subtle pt-1">Outbox off — senders send inline.</p>}
                </StatusCard>

                <StatusCard icon={<Sparkles size={18} />} title="AI job alerts" tone={jobAlertsTone} headline={jobAlerts.enabled ? `${jobAlerts.pending ?? 0} pending` : 'Disabled'}>
                    <Row label="Dead-lettered" ok={(jobAlerts.failed || 0) === 0} detail={`${jobAlerts.failed ?? 0}`} />
                    <Row label="Staged for digest" ok detail={`${jobAlerts.staged ?? 0}`} />
                    {jobAlerts.enabled
                        ? <p className="text-subtle pt-1">Matching new vacancies to seekers.</p>
                        : <p className="text-subtle pt-1">Off — set JOB_ALERTS_ENABLED to activate.</p>}
                </StatusCard>

                <StatusCard icon={<FileCheck2 size={18} />} title="Referral letters" tone={lettersTone} headline={`${letters.durable ?? 0}/${letters.total ?? 0} durable`}>
                    <Row label="Stored in DB (durable)" ok={(letters.atRisk || 0) === 0} detail={`${letters.durable ?? 0}`} />
                    {(letters.atRisk || 0) > 0
                        ? <p className="text-rose-500 font-semibold">{letters.atRisk} letter(s) only on ephemeral disk — regenerate.</p>
                        : <p className="text-subtle">All letters stored durably as base64.</p>}
                </StatusCard>
            </div>
        </div>
    );
};

export default PlatformHealth;
