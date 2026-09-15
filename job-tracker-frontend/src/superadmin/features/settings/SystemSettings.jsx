import React, { useState, useEffect, useCallback } from 'react';
import {
    Settings as SettingsIcon, Shield, Loader, Save, RotateCcw,
    Activity, CheckCircle2, AlertTriangle, XCircle, Database, Mail, Cpu, FileText
} from 'lucide-react';
import API from '../../../api';
import { useAuth } from '../../../context/AuthContext';
import { useNotification } from '../../../context/NotificationContext';

/**
 * SYSTEM SETTINGS & PLATFORM HEALTH.
 *
 * WHAT: platform configuration a Super Administrator can change without a
 * redeploy, plus a live view of whether the platform is actually working.
 *
 * WHY IT REPLACED A STUB: this page previously showed the administrator their
 * own name in three disabled inputs and nothing else. Every tunable in the
 * system — the AI referral threshold, the signup domain allow-list, the
 * verification code lifetime — lived in environment variables, so a routine
 * policy decision needed a deployment.
 *
 * ── "CUSTOM" vs "DEFAULT" ──────────────────────────────────────────────────
 * Each setting reports whether its value came from an administrator's override
 * or was inherited from the environment. Without that, a field showing 60 is
 * ambiguous — nobody can tell whether it was chosen or merely inherited, and
 * the Reset button would look like it does nothing.
 *
 * ── HEALTH IS THE PART THAT COULD NOT BE SEEN AT ALL ───────────────────────
 * The referral worker runs in-process and silently. If it stalls, letters stop
 * being delivered and the only symptom is referrals sitting in "Queued" that
 * nobody is watching. The letters row counts PDFs that exist only on the
 * ephemeral filesystem — one deploy from being unrecoverable, which is the
 * exact failure that nearly cost 27 signed government documents.
 */

const StatusRow = ({ icon: Icon, label, ok, warn, detail }) => {
    const tone = ok ? 'text-emerald-600 dark:text-emerald-400'
        : warn ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400';
    const Badge = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;

    return (
        <div className="flex items-start gap-3 py-3 border-b border-line last:border-0">
            <Icon size={18} className="shrink-0 mt-0.5 text-subtle" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-content">{label}</p>
                {detail && <p className="text-xs text-muted font-medium mt-0.5 leading-relaxed">{detail}</p>}
            </div>
            <Badge size={18} className={`shrink-0 ${tone}`} />
        </div>
    );
};

const SystemSettings = () => {
    const { user } = useAuth();
    const { notify } = useNotification();

    const [settings, setSettings] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState(null);
    const [health, setHealth] = useState(null);

    const loadSettings = useCallback(async () => {
        setLoading(true);
        try {
            const res = await API.get('/admin/settings');
            const data = res.data?.data || [];
            setSettings(data);
            setDrafts(Object.fromEntries(data.map((s) => [s.key, s.value])));
        } catch {
            notify.error('Could Not Load Settings', 'Please try again.');
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => { loadSettings(); }, [loadSettings]);

    // Advisory: a health probe failure must never blank the settings form the
    // administrator came here to use.
    useEffect(() => {
        API.get('/admin/health').then((res) => setHealth(res.data?.data || null)).catch(() => {});
    }, []);

    const save = async (key) => {
        setSavingKey(key);
        try {
            await API.put(`/admin/settings/${key}`, { value: drafts[key] });
            notify.success('Saved', 'The setting has been applied.');
            await loadSettings();
        } catch (err) {
            notify.error('Could Not Save', err.response?.data?.message || 'Please try again.');
        } finally {
            setSavingKey(null);
        }
    };

    const reset = async (key) => {
        setSavingKey(key);
        try {
            await API.delete(`/admin/settings/${key}`);
            notify.success('Reset', 'Restored the system default.');
            await loadSettings();
        } catch (err) {
            notify.error('Could Not Reset', err.response?.data?.message || 'Please try again.');
        } finally {
            setSavingKey(null);
        }
    };

    const worker = health?.referralWorker;
    const letters = health?.letters;

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-5xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight flex items-center gap-3">
                    <SettingsIcon className="text-muted" size={32} /> System Settings
                </h1>
                <p className="text-muted mt-2 font-medium">Platform configuration and operational status.</p>
            </header>

            <div className="bg-surface border border-line rounded-3xl p-4 sm:p-6 shadow-sm mb-5">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
                        <Shield size={28} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg sm:text-xl font-bold text-content truncate">{user?.name || 'Administrator'}</h2>
                        <span className="px-3 py-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400 text-xs font-black rounded-lg uppercase tracking-widest mt-1 inline-block">
                            Super Administrator
                        </span>
                    </div>
                </div>
            </div>

            <div className="bg-surface border border-line rounded-3xl p-4 sm:p-6 shadow-sm mb-5">
                <h2 className="text-base sm:text-lg font-black text-content mb-1 flex items-center gap-2">
                    <Activity size={20} className="text-emerald-500" /> Platform Health
                </h2>
                <p className="text-sm text-muted font-medium mb-4">Live status of the services this platform depends on.</p>

                {!health ? (
                    <div className="py-6 text-center"><Loader className="animate-spin text-subtle mx-auto" size={22} /></div>
                ) : (
                    <div>
                        <StatusRow
                            icon={Database}
                            label="Database"
                            ok={health.database?.reachable}
                            detail={health.database?.reachable ? `Responding in ${health.database.latencyMs}ms` : 'Not reachable'}
                        />
                        <StatusRow
                            icon={Mail}
                            label="Email delivery"
                            ok={health.mail?.configured}
                            detail={health.mail?.configured
                                ? 'Configured'
                                : 'Not configured — verification codes and referral letters cannot be sent'}
                        />
                        <StatusRow
                            icon={Cpu}
                            label="AI scoring"
                            ok={health.aiConfigured}
                            detail={health.aiConfigured
                                ? 'Configured'
                                : 'No API key — applications are still accepted, but without a match score'}
                        />
                        <StatusRow
                            icon={Activity}
                            label="Referral delivery"
                            ok={worker && worker.stuck === 0 && worker.failed === 0}
                            warn={Boolean(worker && (worker.stuck > 0 || worker.failed > 0))}
                            detail={
                                !worker ? 'Unavailable'
                                    : worker.stuck > 0
                                        ? `${worker.stuck} referral${worker.stuck === 1 ? '' : 's'} stuck — the background worker may not be running`
                                        : worker.failed > 0
                                            ? `${worker.failed} referral${worker.failed === 1 ? '' : 's'} could not be delivered`
                                            : 'All referrals delivered'
                            }
                        />
                        <StatusRow
                            icon={FileText}
                            label="Referral letters"
                            ok={letters && letters.atRisk === 0}
                            warn={Boolean(letters && letters.atRisk > 0)}
                            detail={
                                !letters ? 'Unavailable'
                                    : letters.atRisk > 0
                                        ? `${letters.atRisk} letter${letters.atRisk === 1 ? '' : 's'} not yet stored safely — these would be lost on the next deployment`
                                        : `All ${letters.total} letters stored safely`
                            }
                        />
                    </div>
                )}
            </div>

            <div className="bg-surface border border-line rounded-3xl p-4 sm:p-6 shadow-sm">
                <h2 className="text-base sm:text-lg font-black text-content mb-1">Platform Configuration</h2>
                <p className="text-sm text-muted font-medium mb-5">Changes take effect immediately. No restart needed.</p>

                {loading ? (
                    <div className="py-10 text-center"><Loader className="animate-spin text-indigo-500 mx-auto" size={28} /></div>
                ) : (
                    <div className="space-y-5">
                        {settings.map((s) => (
                            <div key={s.key} className="pb-5 border-b border-line last:border-0 last:pb-0">
                                <div className="flex items-start justify-between gap-3 mb-1.5">
                                    <label htmlFor={s.key} className="text-sm font-bold text-content">{s.label}</label>
                                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shrink-0 ${
                                        s.isOverridden
                                            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400'
                                            : 'bg-sunken text-muted dark:bg-surface dark:text-muted'
                                    }`}>
                                        {s.isOverridden ? 'Custom' : 'Default'}
                                    </span>
                                </div>
                                <p className="text-xs text-muted font-medium mb-2.5 leading-relaxed">{s.help}</p>

                                <div className="flex flex-col sm:flex-row gap-2">
                                    {s.type === 'boolean' ? (
                                        <select id={s.key} value={String(drafts[s.key])}
                                            onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value === 'true' }))}
                                            className="flex-1 p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-indigo-500/35">
                                            <option value="true">Enabled</option>
                                            <option value="false">Disabled</option>
                                        </select>
                                    ) : (
                                        <div className="relative flex-1">
                                            <input id={s.key} type={s.type === 'number' ? 'number' : 'text'} value={drafts[s.key] ?? ''}
                                                onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                                                className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-indigo-500/35" />
                                            {s.unit && (
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-subtle pointer-events-none">{s.unit}</span>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => save(s.key)} disabled={savingKey === s.key}
                                            className="px-4 py-2.5 sm:py-3 rounded-lg text-sm font-bold text-white bg-accent hover:bg-accent-hover flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
                                            {savingKey === s.key ? <Loader size={15} className="animate-spin" /> : <Save size={15} />} Save
                                        </button>
                                        {s.isOverridden && (
                                            <button type="button" onClick={() => reset(s.key)} disabled={savingKey === s.key}
                                                title="Restore the system default"
                                                className="px-3 py-2.5 sm:py-3 rounded-lg text-sm font-bold text-muted bg-sunken hover:bg-line transition-colors disabled:opacity-50">
                                                <RotateCcw size={15} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SystemSettings;
