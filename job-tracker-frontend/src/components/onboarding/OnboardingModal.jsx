/**
 * POST-REGISTRATION ONBOARDING / ACCOUNT-COMPLETION FLOW (2026-09)
 *
 * Register → Verify → Welcome → Identity & Profile Setup (required) → Résumé (optional)
 * → Dashboard. A job seeker must complete the mandatory identity/DOLE fields before the
 * Apply action unlocks; a résumé is optional to FINISH onboarding but required to apply.
 *
 * Enforcement is server-side (POST /applications re-checks `onboardingService.evaluate`);
 * this modal is the guided UX + a soft gate. The state is DERIVED from the DB (AuthContext
 * → GET /profile/onboarding), so refresh/logout can't bypass it. Shown for job seekers
 * only: auto-opens once for an incomplete profile, and can be force-opened from the Apply
 * button. Saving reuses the existing PUT /profile (full prefilled payload → no field wiped,
 * which matters for walk-in accounts that already have skills/preferences).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Sparkles, User, FileText, CheckCircle2, ArrowRight, Loader2, X, AlertCircle, MapPin, Phone, Calendar, GraduationCap, Globe } from 'lucide-react';
import API from '../../api';
import { useAuth } from '../../context/AuthContext';
import { normalizeRole, ROLE_KEYS } from '../../utils/roles';

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const EDUCATION_OPTIONS = ['High School Graduate', 'College Undergraduate', 'College Graduate', 'Vocational / Technical', 'Postgraduate'];

// The six mandatory identity/DOLE fields (must agree with services/onboardingService.js).
const REQUIRED = [
    { key: 'name', label: 'Full name', type: 'text', icon: User, placeholder: 'Juan Dela Cruz' },
    { key: 'phone', label: 'Contact number', type: 'tel', icon: Phone, placeholder: '09XXXXXXXXX' },
    { key: 'location', label: 'Address / location', type: 'text', icon: MapPin, placeholder: 'Barangay, Kabankalan City' },
    { key: 'gender', label: 'Sex', type: 'select', icon: User, options: GENDER_OPTIONS },
    { key: 'dob', label: 'Date of birth', type: 'date', icon: Calendar },
    { key: 'educational_attainment', label: 'Educational attainment', type: 'select', icon: GraduationCap, options: EDUCATION_OPTIONS },
];

// Every profile column PUT /profile writes — round-tripped so an untouched field is
// never nulled (PUT does a full UPDATE SET, not a partial patch).
const PROFILE_FIELDS = ['name', 'gender', 'dob', 'phone', 'location', 'availability', 'educational_attainment', 'languages', 'skills', 'preferred_roles', 'experience_level', 'career_goals'];

const toDateInput = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const StepDots = ({ index, total }) => (
    <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-accent' : 'w-1.5 bg-line'}`} />
        ))}
    </div>
);

const OnboardingModal = () => {
    const { user, onboarding, onboardingOpen, openOnboarding, closeOnboarding, refreshOnboarding, updateUser } = useAuth();
    const navigate = useNavigate();
    const isSeeker = user && normalizeRole(user.role) === ROLE_KEYS.JOB_SEEKER;

    const [step, setStep] = useState('welcome'); // welcome | profile | resume | done
    const [form, setForm] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState({});
    const [localHasResume, setLocalHasResume] = useState(false);
    const dismissedRef = useRef(false);

    // Auto-open ONCE for an incomplete seeker. A manual close sets dismissedRef so it
    // doesn't nag again this session — but the Apply button can force it open again.
    useEffect(() => {
        if (isSeeker && onboarding && !onboarding.profileComplete && !onboardingOpen && !dismissedRef.current) {
            openOnboarding();
        }
    }, [isSeeker, onboarding, onboardingOpen, openOnboarding]);

    // On open: choose the entry step + prefill the whole profile.
    useEffect(() => {
        if (!onboardingOpen) return;
        setErrors({});
        setLocalHasResume(!!onboarding?.hasResume);
        setStep(onboarding && !onboarding.profileComplete ? 'welcome' : 'resume');
        let active = true;
        setLoading(true);
        API.get('/profile')
            .then((res) => {
                if (!active) return;
                const d = res.data?.data || res.data || {};
                const next = {};
                PROFILE_FIELDS.forEach((k) => { next[k] = k === 'dob' ? toDateInput(d[k]) : (d[k] ?? ''); });
                setForm(next);
            })
            .catch(() => { if (active) setForm((f) => f || Object.fromEntries(PROFILE_FIELDS.map((k) => [k, '']))); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onboardingOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Escape closes (soft) — the gate is still enforced at Apply.
    useEffect(() => {
        if (!onboardingOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onboardingOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!isSeeker || !onboardingOpen) return null;

    const setField = (k, v) => { setForm((f) => ({ ...(f || {}), [k]: v })); setErrors((e) => ({ ...e, [k]: undefined, _submit: undefined })); };

    const validate = () => {
        const e = {};
        REQUIRED.forEach(({ key, label }) => { if (!form || !String(form[key] ?? '').trim()) e[key] = `${label} is required.`; });
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    // Persist the FULL profile (identity + optional details) via the existing PUT /profile —
    // one source of truth, no parallel model. `validateRequired` runs only on the identity
    // step; `next(state)` decides where to advance. An empty field is saved as null (skip =
    // preserved), while a prefilled required field is never nulled.
    const persist = async ({ validateRequired, next }) => {
        if (validateRequired && !validate()) return;
        setSaving(true);
        try {
            const payload = {};
            PROFILE_FIELDS.forEach((k) => { payload[k] = (form[k] === '' || form[k] == null) ? null : form[k]; });
            REQUIRED.forEach(({ key }) => { if (form[key] != null && String(form[key]).trim()) payload[key] = String(form[key]).trim(); });
            await API.put('/profile', payload);
            updateUser({ name: payload.name });
            const state = await refreshOnboarding();
            if (state) setLocalHasResume(!!state.hasResume);
            next(state);
        } catch (err) {
            setErrors((e) => ({ ...e, _submit: err?.response?.data?.message || 'Could not save your details. Please try again.' }));
        } finally { setSaving(false); }
    };

    const resumeStep = (state) => ((state ? state.hasResume : localHasResume) ? 'done' : 'resume');
    const saveIdentity = () => persist({ validateRequired: true, next: () => setStep('details') });
    const saveDetails = () => persist({ validateRequired: false, next: (state) => setStep(resumeStep(state)) });
    const skipDetails = () => setStep(resumeStep(null));

    const dismiss = () => { dismissedRef.current = true; closeOnboarding(); };
    const goTo = (path) => { dismissedRef.current = true; closeOnboarding(); navigate(path); };

    const stepIndex = { welcome: 0, profile: 1, details: 2, resume: 3, done: 4 }[step] ?? 0;

    return createPortal(
        <div
            className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Complete your account setup"
                className="w-full max-w-lg bg-raised rounded-3xl border border-line shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="relative px-6 pt-6 pb-4 border-b border-line">
                    <button onClick={dismiss} aria-label="Close" className="absolute top-4 right-4 p-1.5 rounded-full text-subtle hover:text-content hover:bg-sunken transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        <X size={18} />
                    </button>
                    <div className="flex items-center gap-2 text-accent-text mb-2">
                        <Sparkles size={18} />
                        <span className="text-xs font-black uppercase tracking-wider">Account Setup</span>
                    </div>
                    <StepDots index={stepIndex} total={5} />
                </div>

                {/* Body */}
                <div className="px-6 py-5 overflow-y-auto">
                    {step === 'welcome' && (
                        <div className="text-center py-4">
                            <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 dark:bg-accent-text/10 mb-4"><User size={30} className="text-accent-text" /></span>
                            <h2 className="text-xl font-black text-content">Welcome{user?.name ? `, ${String(user.name).split(' ')[0]}` : ''}! 🎉</h2>
                            <p className="text-sm text-muted mt-2 leading-relaxed">
                                Before you can apply to a vacancy, PESO needs a few identity details to prepare your
                                referral and reporting. It takes about a minute — your résumé can wait until later.
                            </p>
                        </div>
                    )}

                    {step === 'profile' && (
                        <div>
                            <h2 className="text-lg font-black text-content mb-1">Identity &amp; Profile</h2>
                            <p className="text-xs text-muted mb-4">All fields are required to apply. You can edit them anytime in your profile.</p>
                            {loading || !form ? (
                                <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent-text" /></div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {REQUIRED.map(({ key, label, type, options, placeholder }) => (
                                        <div key={key} className={type === 'select' || key === 'location' || key === 'name' ? 'sm:col-span-2' : ''}>
                                            <label className="block text-xs font-bold text-muted mb-1">{label} <span className="text-rose-500">*</span></label>
                                            {type === 'select' ? (
                                                <select
                                                    value={form[key] ?? ''}
                                                    onChange={(e) => setField(key, e.target.value)}
                                                    aria-label={label}
                                                    className={`w-full p-2.5 rounded-lg border bg-sunken text-sm font-medium text-content outline-none focus:ring-2 focus:ring-accent/50 ${errors[key] ? 'border-rose-400' : 'border-line'}`}
                                                >
                                                    <option value="">Select…</option>
                                                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            ) : (
                                                <input
                                                    type={type}
                                                    value={form[key] ?? ''}
                                                    onChange={(e) => setField(key, e.target.value)}
                                                    placeholder={placeholder}
                                                    aria-label={label}
                                                    max={type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
                                                    className={`w-full p-2.5 rounded-lg border bg-sunken text-sm font-medium text-content outline-none focus:ring-2 focus:ring-accent/50 ${errors[key] ? 'border-rose-400' : 'border-line'}`}
                                                />
                                            )}
                                            {errors[key] && <p className="text-[11px] text-rose-500 font-semibold mt-1">{errors[key]}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {errors._submit && (
                                <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertCircle size={14} /> {errors._submit}</p>
                            )}
                        </div>
                    )}

                    {step === 'details' && (
                        <div>
                            <h2 className="text-lg font-black text-content mb-1">A bit more about you</h2>
                            <p className="text-xs text-muted mb-4">Optional — these help employers and our AI match you to the right roles. You can skip and add them later from your profile.</p>
                            {loading || !form ? (
                                <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent-text" /></div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-muted mb-1 flex items-center gap-1.5"><Globe size={13} /> Languages Spoken</label>
                                        <textarea value={form.languages ?? ''} onChange={(e) => setField('languages', e.target.value)} placeholder="e.g., English, Tagalog, Hiligaynon (comma separated)" aria-label="Languages Spoken" className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium min-h-[64px] outline-none focus:ring-2 focus:ring-accent/50 text-content" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-muted mb-1 flex items-center gap-1.5"><Sparkles size={13} /> Core Skillsets</label>
                                        <textarea value={form.skills ?? ''} onChange={(e) => setField('skills', e.target.value)} placeholder="e.g., Communication, Data Entry, Customer Service (comma separated)" aria-label="Core Skillsets" className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium min-h-[64px] outline-none focus:ring-2 focus:ring-accent/50 text-content" />
                                    </div>
                                    <div className="pt-1">
                                        <p className="text-[11px] font-black uppercase tracking-wider text-subtle mb-2">Work Preferences</p>
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs font-bold text-muted mb-1">Preferred Job Roles</label>
                                                <input value={form.preferred_roles ?? ''} onChange={(e) => setField('preferred_roles', e.target.value)} placeholder="e.g., IT Support, Admin Assistant" aria-label="Preferred Job Roles" className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium text-content outline-none focus:ring-2 focus:ring-accent/50" />
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Experience Level</label>
                                                    <select value={form.experience_level ?? ''} onChange={(e) => setField('experience_level', e.target.value)} aria-label="Experience Level" className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium text-content outline-none focus:ring-2 focus:ring-accent/50">
                                                        <option value="">Select…</option>
                                                        <option value="Entry Level">Entry Level (0-2 years)</option>
                                                        <option value="Mid Level">Mid Level (3-5 years)</option>
                                                        <option value="Senior Level">Senior Level (5+ years)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Availability</label>
                                                    <select value={form.availability ?? ''} onChange={(e) => setField('availability', e.target.value)} aria-label="Availability" className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium text-content outline-none focus:ring-2 focus:ring-accent/50">
                                                        <option value="">Select…</option>
                                                        <option value="Full-time">Full-time</option>
                                                        <option value="Part-time">Part-time</option>
                                                        <option value="Night-shift">Night-shift</option>
                                                        <option value="Freelance/Contract">Freelance / Contract</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-muted mb-1">Career Goals &amp; Objectives</label>
                                                <textarea value={form.career_goals ?? ''} onChange={(e) => setField('career_goals', e.target.value)} placeholder="What are you looking to achieve in your next professional position?" aria-label="Career Goals and Objectives" className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium min-h-[72px] outline-none focus:ring-2 focus:ring-accent/50 text-content" />
                                            </div>
                                        </div>
                                    </div>
                                    {errors._submit && (<p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertCircle size={14} /> {errors._submit}</p>)}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 'resume' && (
                        <div className="text-center py-4">
                            <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 dark:bg-accent-text/10 mb-4"><FileText size={30} className="text-accent-text" /></span>
                            <h2 className="text-lg font-black text-content">Add your résumé</h2>
                            <p className="text-sm text-muted mt-2 leading-relaxed">
                                A résumé is <span className="font-bold text-content">required to apply</span>, but optional right now —
                                you can add it later from your dashboard. Build one in minutes, or upload an existing PDF.
                            </p>
                            <div className="mt-5 flex flex-col gap-2">
                                <button onClick={() => goTo('/builder')} className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm transition-colors inline-flex items-center justify-center gap-2">
                                    <FileText size={16} /> Build my résumé
                                </button>
                                <button onClick={() => goTo('/profile')} className="w-full py-2.5 rounded-xl bg-sunken hover:bg-line text-content font-bold text-sm transition-colors">
                                    Upload a résumé from my profile
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'done' && (
                        <div className="text-center py-6">
                            <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-4"><CheckCircle2 size={32} className="text-emerald-600 dark:text-emerald-400" /></span>
                            <h2 className="text-xl font-black text-content">You're all set!</h2>
                            <p className="text-sm text-muted mt-2 leading-relaxed">
                                {localHasResume
                                    ? 'Your profile is complete and you can now apply to vacancies. Good luck!'
                                    : 'Your identity details are saved. Add a résumé whenever you’re ready — you’ll need one to apply.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-3 bg-surface/50">
                    {step === 'welcome' && (
                        <>
                            <button onClick={dismiss} className="text-xs font-bold text-muted hover:text-content transition-colors">Later</button>
                            <button onClick={() => setStep('profile')} className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm transition-colors inline-flex items-center gap-2">Get started <ArrowRight size={16} /></button>
                        </>
                    )}
                    {step === 'profile' && (
                        <>
                            <button onClick={dismiss} className="text-xs font-bold text-muted hover:text-content transition-colors">Later</button>
                            <button onClick={saveIdentity} disabled={saving || loading} className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm transition-colors inline-flex items-center gap-2 disabled:opacity-60">
                                {saving && <Loader2 size={16} className="animate-spin" />} Save &amp; continue
                            </button>
                        </>
                    )}
                    {step === 'details' && (
                        <>
                            <button onClick={skipDetails} disabled={saving} className="text-xs font-bold text-muted hover:text-content transition-colors disabled:opacity-50">Skip for now</button>
                            <button onClick={saveDetails} disabled={saving || loading} className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm transition-colors inline-flex items-center gap-2 disabled:opacity-60">
                                {saving && <Loader2 size={16} className="animate-spin" />} Save &amp; continue
                            </button>
                        </>
                    )}
                    {step === 'resume' && (
                        <>
                            <button onClick={dismiss} className="text-xs font-bold text-muted hover:text-content transition-colors">I'll do this later</button>
                            <button onClick={() => setStep('done')} className="px-5 py-2.5 rounded-xl bg-sunken hover:bg-line text-content font-bold text-sm transition-colors">Skip for now</button>
                        </>
                    )}
                    {step === 'done' && (
                        <button onClick={dismiss} className="ml-auto px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm transition-colors">Go to dashboard</button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default OnboardingModal;
