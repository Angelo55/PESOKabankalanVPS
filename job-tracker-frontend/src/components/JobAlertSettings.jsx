import React, { useState, useEffect } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';

/**
 * JOB ALERT SETTINGS (Enhancement D.2) — a job seeker's control over AI job-alert
 * emails: frequency (immediate / daily digest / off) and an optional personal
 * minimum match score. Backed by GET/PUT /job-alerts/preferences. Auto-saves on
 * change (a single preference, low stakes).
 */

const getAuthConfig = () => {
    const t = sessionStorage.getItem('jobTrackerToken');
    return t ? { headers: { Authorization: `Bearer ${t}` } } : {};
};

const FREQ = [
    { value: 'daily', label: 'Daily digest', hint: 'One email a day summarizing new matches.' },
    { value: 'immediate', label: 'Immediate', hint: 'An email as soon as a strong match is posted.' },
    { value: 'off', label: 'Off', hint: 'No job-alert emails.' },
];

const JobAlertSettings = () => {
    const { notify } = useNotification();
    const [frequency, setFrequency] = useState('daily');
    const [minScore, setMinScore] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        API.get('/job-alerts/preferences', getAuthConfig())
            .then((res) => { const d = res.data?.data || {}; setFrequency(d.frequency || 'daily'); setMinScore(d.min_score ?? ''); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const save = async (nextFreq, nextMin) => {
        setSaving(true);
        try {
            await API.put('/job-alerts/preferences', { frequency: nextFreq, min_score: nextMin === '' ? null : Number(nextMin) }, getAuthConfig());
        } catch {
            notify.error('Save failed', 'Could not update your job-alert settings.');
        } finally {
            setSaving(false);
        }
    };

    const onFreq = (v) => { setFrequency(v); save(v, minScore); };
    const onMin = (v) => { setMinScore(v); save(frequency, v); };

    if (loading) return <div className="p-4 flex justify-center"><Loader2 className="animate-spin text-accent-text" size={20} /></div>;

    return (
        <div className="p-4 sm:p-5 border-t border-line/60">
            <div className="flex items-center gap-2 mb-1">
                <Bell size={16} className="text-accent-text" />
                <h3 className="font-bold text-content text-sm">AI Job Alerts (email)</h3>
                {saving && <Loader2 size={13} className="animate-spin text-subtle ml-1" />}
            </div>
            <p className="text-xs text-muted mb-3">Get emailed when a new vacancy matches your resume above the AI threshold.</p>
            <div className="space-y-2">
                {FREQ.map((f) => (
                    <label key={f.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${frequency === f.value ? 'border-accent bg-accent/5' : 'border-line hover:bg-sunken/50'}`}>
                        <input type="radio" name="jobAlertFreq" checked={frequency === f.value} onChange={() => onFreq(f.value)} className="mt-0.5 accent-[#1a4a38]" />
                        <span>
                            <span className="block text-sm font-bold text-content">{f.label}</span>
                            <span className="block text-xs text-muted">{f.hint}</span>
                        </span>
                    </label>
                ))}
            </div>
            {frequency !== 'off' && (
                <div className="mt-3 flex items-center gap-2">
                    <label className="text-xs font-bold text-muted">Only alert me above</label>
                    <select value={minScore} onChange={(e) => onMin(e.target.value)} aria-label="Minimum match score" className="appearance-none px-3 py-1.5 rounded-lg border border-line bg-surface text-sm font-semibold text-content cursor-pointer">
                        <option value="">Platform default</option>
                        <option value="70">70% match</option>
                        <option value="80">80% match</option>
                        <option value="90">90% match</option>
                    </select>
                </div>
            )}
        </div>
    );
};

export default JobAlertSettings;
