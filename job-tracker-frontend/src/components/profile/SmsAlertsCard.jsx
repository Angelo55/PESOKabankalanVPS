import React, { useState, useEffect, useCallback } from 'react';
import { Phone, ShieldCheck, Loader2, CheckCircle2, MessageSquare } from 'lucide-react';
import API from '../../api';
import { useNotification } from '../../context/NotificationContext';

/**
 * SmsAlertsCard — the Job Seeker's SMS-channel controls (#8).
 *
 * Self-contained: reads its own state from GET /profile (which returns phone /
 * phone_verified_at / sms_opt_in) so the parent Profile page needs only to render it,
 * gated on the smsNotifications feature flag. Two steps mirror the email-OTP UX:
 *   1. verify the mobile number (an OTP is TEXTED, then confirmed), then
 *   2. opt in to receive referral SMS alerts.
 * A seeker who verifies but does not opt in still receives nothing — both are required
 * by the channel router. Rendered only when the office has enabled the SMS channel.
 */
const inputCls = 'w-full p-2.5 sm:p-3 rounded-lg text-sm bg-sunken border border-line outline-none focus-visible:ring-2 focus-visible:ring-accent font-medium text-content transition-all';

const SmsAlertsCard = () => {
    const { notify } = useNotification();
    const [state, setState] = useState({ phone: '', verified: false, optedIn: false });
    const [loading, setLoading] = useState(true);
    const [phone, setPhone] = useState('');
    const [step, setStep] = useState('idle'); // idle | code
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await API.get('/profile');
            const d = res.data?.data || {};
            const next = {
                phone: d.phone || '',
                verified: !!d.phone_verified_at,
                optedIn: !!Number(d.sms_opt_in),
            };
            setState(next);
            setPhone(next.phone);
        } catch (_) { /* card just stays in its default state */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const sendCode = async () => {
        setBusy(true);
        try {
            const res = await API.post('/profile/phone/verify/start', { phone });
            notify?.success?.('Code sent', res.data?.message || 'Check your phone for the code.');
            setStep('code');
        } catch (err) {
            notify?.error?.('Could not send code', err.response?.data?.message || 'Please try again.');
        } finally { setBusy(false); }
    };

    const confirm = async () => {
        setBusy(true);
        try {
            await API.post('/profile/phone/verify/confirm', { code });
            notify?.success?.('Verified', 'Your mobile number is verified.');
            setStep('idle'); setCode('');
            await load();
        } catch (err) {
            notify?.error?.('Verification failed', err.response?.data?.message || 'Check the code and try again.');
        } finally { setBusy(false); }
    };

    const toggleOptIn = async () => {
        const next = !state.optedIn;
        setBusy(true);
        try {
            await API.put('/profile/phone/opt-in', { optIn: next });
            setState((s) => ({ ...s, optedIn: next }));
            notify?.success?.(next ? 'SMS alerts on' : 'SMS alerts off', next ? 'You will get referral updates by text.' : 'You will no longer get texts.');
        } catch (err) {
            notify?.error?.('Could not update', err.response?.data?.message || 'Please try again.');
        } finally { setBusy(false); }
    };

    if (loading) return null;

    return (
        <div className="rounded-2xl bg-surface border border-line shadow-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-accent-soft text-accent-text"><MessageSquare size={20} /></span>
                <div>
                    <h3 className="text-base sm:text-lg font-black text-content">SMS Alerts</h3>
                    <p className="text-xs text-muted">Get referral updates by text — useful if you don't always have email access.</p>
                </div>
            </div>

            {state.verified ? (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={16} /> {state.phone || 'Your number'} is verified
                    </div>
                    <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-sunken border border-line cursor-pointer">
                        <span className="text-sm font-semibold text-content">Receive referral updates by SMS</span>
                        <button
                            type="button"
                            onClick={toggleOptIn}
                            disabled={busy}
                            aria-pressed={state.optedIn}
                            aria-label="Toggle SMS alerts"
                            className={`relative w-12 h-6 rounded-full transition-colors ${state.optedIn ? 'bg-accent' : 'bg-line'} disabled:opacity-50`}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${state.optedIn ? 'translate-x-6' : ''}`} />
                        </button>
                    </label>
                    <button type="button" onClick={() => { setStep('idle'); setState((s) => ({ ...s, verified: false })); }} className="text-xs font-bold text-accent-text hover:underline">
                        Use a different number
                    </button>
                </div>
            ) : step === 'code' ? (
                <div className="space-y-3">
                    <p className="text-xs text-muted">Enter the 6-digit code we texted to <span className="font-bold text-content">{phone}</span>.</p>
                    <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className={`${inputCls} tracking-[0.4em] text-center font-mono`} />
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setStep('idle')} className="flex-1 py-2.5 rounded-xl bg-surface border border-line text-content font-bold text-sm hover:bg-sunken">Back</button>
                        <button type="button" onClick={confirm} disabled={busy || code.length !== 6} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-contrast font-bold text-sm hover:bg-accent-hover disabled:opacity-50 flex items-center justify-center gap-2">
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Verify
                        </button>
                    </div>
                    <button type="button" onClick={sendCode} disabled={busy} className="text-xs font-bold text-accent-text hover:underline">Resend code</button>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" className={`${inputCls} pl-9`} />
                    </div>
                    <button type="button" onClick={sendCode} disabled={busy || !phone.trim()} className="w-full py-2.5 rounded-xl bg-accent text-accent-contrast font-bold text-sm hover:bg-accent-hover disabled:opacity-50 flex items-center justify-center gap-2">
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={16} />} Verify my number
                    </button>
                    <p className="text-[11px] text-subtle">We'll text you a 6-digit code to confirm the number is yours. Standard message rates may apply.</p>
                </div>
            )}
        </div>
    );
};

export default SmsAlertsCard;
