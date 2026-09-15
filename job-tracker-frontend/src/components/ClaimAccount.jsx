/**
 * ClaimAccount — the public page where a walk-in Job Seeker claims the account PESO
 * encoded for them (#7). PUBLIC (pre-auth): the claim CODE is the credential.
 *
 * Flow: enter code → (if a phone is on file + SMS is on) enter the texted OTP →
 * set your own email + password → the SAME existing account is linked and you are
 * signed in. Never creates a second profile. An expired/invalid code tells the seeker
 * to ask PESO to reissue one.
 *
 * A `?code=` query param pre-fills the code (so a texted link can carry it).
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, Loader2, ShieldCheck, Mail, Lock, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import API from '../api';
import { useAuth } from '../context/AuthContext';

const inputCls = 'w-full p-3 rounded-xl text-sm bg-white border border-gray-300 outline-none focus:ring-2 focus:ring-[#1a4a38]/40 font-medium text-gray-900';

const ClaimAccount = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();

    const [step, setStep] = useState('code'); // code | details | done
    const [claimCode, setClaimCode] = useState('');
    const [requiresOtp, setRequiresOtp] = useState(false);
    const [maskedPhone, setMaskedPhone] = useState('');
    const [name, setName] = useState('');
    const [form, setForm] = useState({ email: '', password: '', phoneOtp: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const c = params.get('code');
        if (c) setClaimCode(c);
    }, [params]);

    const start = async (e) => {
        e?.preventDefault();
        setBusy(true); setError('');
        try {
            const res = await API.post('/auth/claim/start', { claimCode: claimCode.trim() });
            const d = res.data?.data || {};
            setRequiresOtp(!!d.requiresPhoneOtp);
            setMaskedPhone(d.maskedPhone || '');
            setName(d.name || '');
            setStep('details');
        } catch (err) {
            setError(err.response?.data?.message || 'Could not verify that code. Please try again.');
        } finally { setBusy(false); }
    };

    const complete = async (e) => {
        e?.preventDefault();
        setBusy(true); setError('');
        try {
            const res = await API.post('/auth/claim/complete', {
                claimCode: claimCode.trim(),
                email: form.email.trim(),
                password: form.password,
                phoneOtp: requiresOtp ? form.phoneOtp.trim() : undefined,
            });
            const { token, user } = res.data || {};
            if (token && user) {
                login(user, token);
                setStep('done');
                setTimeout(() => navigate('/'), 1200);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Could not complete the claim. Please try again.');
        } finally { setBusy(false); }
    };

    return (
        <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-6">
                    <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1a4a38] text-white mb-3"><KeyRound size={26} /></span>
                    <h1 className="text-2xl font-black tracking-tight">Claim your PESO account</h1>
                    <p className="text-sm text-gray-600 mt-1">PESO Kabankalan created an account for you. Enter the claim code they gave you to activate it.</p>
                </div>

                <div className="rounded-3xl bg-white border border-gray-200 shadow-lg p-6">
                    {error && (
                        <div className="mb-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                        </div>
                    )}

                    {step === 'code' && (
                        <form onSubmit={start} className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Claim code</label>
                                <input value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())} placeholder="XXXX-XXX-XXX" className={`${inputCls} mt-1 tracking-widest font-mono text-center`} autoFocus />
                            </div>
                            <button type="submit" disabled={busy || !claimCode.trim()} className="w-full py-3 rounded-xl bg-[#1a4a38] text-white font-black hover:bg-[#123528] disabled:opacity-50 flex items-center justify-center gap-2">
                                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />} Continue
                            </button>
                            <p className="text-xs text-gray-500 text-center">Don't have a code? Visit the PESO Kabankalan office to register.</p>
                        </form>
                    )}

                    {step === 'details' && (
                        <form onSubmit={complete} className="space-y-4">
                            {name && <p className="text-sm text-gray-700">Welcome, <span className="font-bold">{name}</span>. Set up your sign-in details below.</p>}

                            {requiresOtp && (
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Code texted to {maskedPhone}</label>
                                    <input inputMode="numeric" maxLength={6} value={form.phoneOtp} onChange={(e) => setForm((f) => ({ ...f, phoneOtp: e.target.value.replace(/\D/g, '') }))} placeholder="6-digit code" className={`${inputCls} mt-1 tracking-[0.3em] text-center font-mono`} />
                                    <p className="text-[11px] text-gray-500 mt-1">We texted a code to your number on file to confirm it's you.</p>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Your email</label>
                                <div className="relative mt-1">
                                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@gmail.com" className={`${inputCls} pl-9`} />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Create a password</label>
                                <div className="relative mt-1">
                                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" className={`${inputCls} pl-9`} />
                                </div>
                            </div>

                            <button type="submit" disabled={busy || !form.email.trim() || form.password.length < 8 || (requiresOtp && form.phoneOtp.length !== 6)} className="w-full py-3 rounded-xl bg-[#1a4a38] text-white font-black hover:bg-[#123528] disabled:opacity-50 flex items-center justify-center gap-2">
                                {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />} Activate my account
                            </button>
                            <button type="button" onClick={() => { setStep('code'); setError(''); }} className="w-full text-xs font-bold text-gray-500 hover:text-gray-700">Use a different code</button>
                        </form>
                    )}

                    {step === 'done' && (
                        <div className="text-center py-6">
                            <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 mb-3"><CheckCircle2 size={32} /></span>
                            <h2 className="text-xl font-black">You're all set!</h2>
                            <p className="text-sm text-gray-600 mt-1">Taking you to your dashboard…</p>
                        </div>
                    )}
                </div>

                <p className="text-center text-xs text-gray-500 mt-5">
                    Already have an account? <Link to="/home" className="font-bold text-[#1a4a38] hover:underline">Sign in</Link>
                </p>
            </div>
        </div>
    );
};

export default ClaimAccount;
