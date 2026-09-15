import React, { useState, useEffect } from 'react';
import { User, Lock, Link as LinkIcon, ShieldCheck, Loader2, CheckCircle, AlertCircle, Handshake, Check, X, Zap, ShieldOff, Gauge } from 'lucide-react';
import API from '../api';
import UsagePanel from './common/UsagePanel';
import { useAuth } from '../context/AuthContext';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';

const AccountSettings = ({ user }) => {
    const isJobSeeker = normalizeRole(user?.role) === ROLE_KEYS.JOB_SEEKER;
    // Honest Linked-Accounts state: the account is Google-linked only when the server
    // says so (users.oauth_provider === 'google'), not for every account (see the
    // settings audit). Populated by /auth/me, /login, /google.
    const googleLinked = (user?.oauth_provider || '').toLowerCase() === 'google';
    // updateUser propagates a changed field into the shared auth user so the
    // top-header name, every <Avatar>, and any other context consumer update in the
    // same tick — no refetch, no page refresh (AuthContext §3b).
    const { updateUser, refreshUser } = useAuth();
    const [activeTab, setActiveTab] = useState('profile');
    // Google account-link (Linked Accounts) flow state.
    const [linkBusy, setLinkBusy] = useState(false);
    const [unlinkBusy, setUnlinkBusy] = useState(false);
    const [confirmUnlink, setConfirmUnlink] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    // Profile Info — the editable Full Name is CONTROLLED, and we keep the FULL
    // current profile so the save can send a complete payload. PUT /profile
    // COALESCEs only `name`; the other columns are set directly, so a partial body
    // would NULL gender/dob/phone/skills/etc. (§43). We therefore load the whole
    // profile first and merge the edited name into it before saving.
    const [fullName, setFullName] = useState(user?.name || '');
    const [profileData, setProfileData] = useState(null);
    const [profileLoading, setProfileLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        API.get('/profile')
            .then((res) => {
                if (!alive) return;
                const d = res.data?.data || {};
                setProfileData(d);
                setFullName((d.name ?? user?.name ?? '').toString());
            })
            .catch(() => { if (alive) setFullName(user?.name || ''); })
            .finally(() => { if (alive) setProfileLoading(false); });
        return () => { alive = false; };
        // Load once on mount; `user` is the initial fallback only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // NEW: Real State for Security Tab
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');

    // Referral automation preference (Job Seeker only).
    const [referralMode, setReferralMode] = useState('manual');
    const [referralLoaded, setReferralLoaded] = useState(false);
    const [referralSaving, setReferralSaving] = useState(false);
    const [pendingMode, setPendingMode] = useState(null); // an automation choice awaiting confirmation

    useEffect(() => {
        if (!isJobSeeker) return;
        let alive = true;
        API.get('/profile/referral-preference')
            .then((res) => { if (alive) setReferralMode(res.data?.data?.mode || 'manual'); })
            .catch(() => { /* keep default 'manual' */ })
            .finally(() => { if (alive) setReferralLoaded(true); });
        return () => { alive = false; };
    }, [isJobSeeker]);

    // Manual is always safe to set directly; enabling an automation asks first.
    const chooseReferralMode = (mode) => {
        if (mode === referralMode) return;
        if (mode === 'manual') { saveReferralMode('manual'); return; }
        setPendingMode(mode); // show confirm step
    };

    const saveReferralMode = async (mode) => {
        setReferralSaving(true);
        setPendingMode(null);
        setMessage({ type: '', text: '' });
        try {
            const res = await API.put('/profile/referral-preference', { mode });
            setReferralMode(res.data?.data?.mode || mode);
            setMessage({ type: 'success', text: 'Referral preference saved.' });
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Could not save your referral preference.' });
        } finally {
            setReferralSaving(false);
        }
    };

    // Handle the return from the Google account-link redirect
    // (…/settings?link=google&status=success|duplicate|cancelled|error). The Connected
    // state is AUTHORITATIVE — on success we re-pull /auth/me rather than trust the URL.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('link') !== 'google') return;
        const status = params.get('status');
        setActiveTab('integrations');
        const MAP = {
            success: { type: 'success', text: 'Google account connected successfully.' },
            duplicate: { type: 'error', text: 'That Google account is already linked to another PESO account. Sign in with it directly, or connect a different Google account.' },
            cancelled: { type: 'error', text: 'Google connection was cancelled — nothing changed.' },
            error: { type: 'error', text: 'Could not connect your Google account. Please try again.' },
        };
        setMessage(MAP[status] || MAP.error);
        // Strip the query so a refresh doesn't replay the toast.
        window.history.replaceState({}, document.title, window.location.pathname);
        if (status === 'success') refreshUser();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Start the Google connect flow. The start endpoint is an AUTHED XHR that returns
    // the Google consent URL; we then navigate the tab to it. We never treat this as
    // "connected" — that only comes from the backend after the callback (the effect above).
    const onConnectGoogle = async () => {
        setLinkBusy(true);
        setMessage({ type: '', text: '' });
        try {
            const res = await API.get('/auth/google/link/start');
            const url = res.data?.url;
            if (!url) throw new Error('No authorization URL returned.');
            window.location.href = url;
        } catch (error) {
            setLinkBusy(false);
            setMessage({ type: 'error', text: error.response?.data?.message || 'Could not start the Google connection. Please try again.' });
        }
    };

    // Disconnect Google. The backend refuses when Google is the only sign-in method
    // (no local password), redirecting the user to set one first — so this can never
    // lock anyone out, and it never deletes the account.
    const onDisconnectGoogle = async () => {
        setUnlinkBusy(true);
        setMessage({ type: '', text: '' });
        try {
            await API.post('/auth/google/unlink');
            updateUser({ oauth_provider: null, google_email: null });
            await refreshUser(); // reseed from the authoritative record
            setConfirmUnlink(false);
            setMessage({ type: 'success', text: 'Google has been disconnected from your account.' });
        } catch (error) {
            const code = error.response?.data?.code;
            setConfirmUnlink(false);
            setMessage({ type: 'error', text: error.response?.data?.message || 'Could not disconnect Google.' });
            if (code === 'NO_PASSWORD') setActiveTab('security'); // send them to set a password
        } finally {
            setUnlinkBusy(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setMessage({ type: '', text: '' });
        
        try {
            if (activeTab === 'security') {
                if (!newPassword || newPassword.length < 8) {
                    setMessage({ type: 'error', text: 'New password must be at least 8 characters long.' });
                    setIsLoading(false);
                    return;
                }

                // Send the actual API request to our new route
                await API.put('/auth/update-password', { currentPassword, newPassword });
                
                setMessage({ type: 'success', text: 'Password successfully updated. A security alert has been emailed to you.' });
                setCurrentPassword('');
                setNewPassword('');
            } else if (activeTab === 'profile') {
                // Real, server-confirmed persistence (was previously a fake setTimeout
                // success that never hit the API). Validate, then PUT the FULL profile
                // so the direct-set columns are preserved, and only report success
                // AFTER the server commits.
                const trimmed = fullName.trim();
                if (!trimmed) {
                    setMessage({ type: 'error', text: 'Full name cannot be empty.' });
                    setIsLoading(false);
                    return;
                }
                if (!profileData) {
                    // The current profile hasn't loaded yet — saving a name-only body
                    // would null the other columns, so refuse rather than risk data loss.
                    setMessage({ type: 'error', text: 'Still loading your profile — please wait a moment and try again.' });
                    setIsLoading(false);
                    return;
                }
                const dob = profileData.dob ? String(profileData.dob).slice(0, 10) : '';
                const payload = {
                    name: trimmed,
                    gender: profileData.gender ?? '',
                    dob,
                    phone: profileData.phone ?? '',
                    location: profileData.location ?? '',
                    availability: profileData.availability ?? '',
                    educational_attainment: profileData.educational_attainment ?? '',
                    languages: profileData.languages ?? '',
                    skills: profileData.skills ?? '',
                    preferred_roles: profileData.preferred_roles ?? '',
                    experience_level: profileData.experience_level ?? '',
                    career_goals: profileData.career_goals ?? '',
                };
                await API.put('/profile', payload); // throws on non-2xx → caught below, no success shown
                setProfileData((p) => ({ ...(p || {}), name: trimmed }));
                setFullName(trimmed);
                updateUser({ name: trimmed }); // propagate to the top-header + every Avatar/name consumer
                setMessage({ type: 'success', text: 'Full name updated.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to update settings.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-8 w-full min-h-screen animate-slide-up-fade motion-reduce:animate-none">
            
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl">
                    <User className="text-indigo-600 dark:text-indigo-400" size={28} />
                </div>
                <div>
                    <h2 className="text-3xl font-black text-content tracking-tight">Account Settings</h2>
                    <p className="text-muted font-medium mt-1">Manage your profile, security, and connected integrations.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                
                {/* SETTINGS SIDEBAR NAV */}
                <div className="md:col-span-1 space-y-2">
                    <button onClick={() => { setActiveTab('profile'); setMessage({}); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${activeTab === 'profile' ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm border border-line' : 'text-muted hover:bg-surface/50 dark:hover:bg-surface/50'}`}>
                        <User size={18} /> Profile Info
                    </button>
                    <button onClick={() => { setActiveTab('security'); setMessage({}); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${activeTab === 'security' ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm border border-line' : 'text-muted hover:bg-surface/50 dark:hover:bg-surface/50'}`}>
                        <Lock size={18} /> Security
                    </button>
                    <button onClick={() => { setActiveTab('integrations'); setMessage({}); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${activeTab === 'integrations' ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm border border-line' : 'text-muted hover:bg-surface/50 dark:hover:bg-surface/50'}`}>
                        <LinkIcon size={18} /> Linked Accounts
                    </button>
                    {isJobSeeker && (
                        <button onClick={() => { setActiveTab('referrals'); setMessage({}); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${activeTab === 'referrals' ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm border border-line' : 'text-muted hover:bg-surface/50 dark:hover:bg-surface/50'}`}>
                            <Handshake size={18} /> Referrals
                        </button>
                    )}
                    {isJobSeeker && (
                        <button onClick={() => { setActiveTab('usage'); setMessage({}); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${activeTab === 'usage' ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm border border-line' : 'text-muted hover:bg-surface/50 dark:hover:bg-surface/50'}`}>
                            <Gauge size={18} /> Usage & Limits
                        </button>
                    )}
                </div>

                {/* SETTINGS CONTENT AREA */}
                <div className="md:col-span-3 bg-surface/70 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line/50">
                    
                    {message.text && (
                        <div className={`mb-6 p-4 rounded-2xl flex items-center gap-3 font-bold text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-100 dark:border-green-800' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-100 dark:border-red-800'}`}>
                            {message.type === 'success' ? <CheckCircle size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
                            {message.text}
                        </div>
                    )}

                    <form onSubmit={handleSave} className="space-y-6">
                        
                        {activeTab === 'profile' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                    <label className="block text-sm font-bold text-muted mb-2">Full Name</label>
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        disabled={profileLoading}
                                        maxLength={120}
                                        placeholder={profileLoading ? 'Loading…' : 'Your full name'}
                                        className="w-full px-5 py-3.5 bg-sunken border border-line rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all dark:text-white font-medium disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-muted mb-2">Email Address</label>
                                    <input type="email" defaultValue={user?.email || ''} disabled className="w-full px-5 py-3.5 bg-sunken border border-line rounded-2xl outline-none text-muted cursor-not-allowed font-medium" />
                                </div>
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                    <label className="block text-sm font-bold text-muted mb-2">Current Password</label>
                                    <input 
                                        type="password" 
                                        placeholder="Enter current password" 
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        className="w-full px-5 py-3.5 bg-sunken border border-line rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all dark:text-white" 
                                        required 
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-muted mb-2">New Password</label>
                                    <input 
                                        type="password" 
                                        placeholder="Enter new strong password" 
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full px-5 py-3.5 bg-sunken border border-line rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all dark:text-white" 
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {activeTab === 'integrations' && (
                            <div className="space-y-4 animate-in fade-in duration-300">
                                {/* Google — Connected is derived from the backend record
                                    (users.oauth_provider === 'google'), never a local flip.
                                    Connect = redirect to Google; Disconnect = safe unlink. */}
                                <div className="p-4 bg-sunken border border-line rounded-2xl">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="p-2 bg-surface rounded-xl shadow-sm shrink-0"><ShieldCheck className={googleLinked ? 'text-blue-500' : 'text-muted'} /></div>
                                            <div className="min-w-0">
                                                <h4 className="font-bold text-content">Google</h4>
                                                <p className="text-xs text-muted font-medium truncate">
                                                    {googleLinked
                                                        ? <>Connected as {user?.google_email || user?.email}</>
                                                        : <>Not connected — link Google for one-tap sign-in</>}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-2">
                                            {googleLinked ? (
                                                <>
                                                    <span className="hidden sm:inline px-3 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs font-bold rounded-lg border border-green-200 dark:border-green-800">Connected</span>
                                                    {!confirmUnlink && (
                                                        <button type="button" onClick={() => setConfirmUnlink(true)} className="px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 bg-surface hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">
                                                            Disconnect
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <button type="button" onClick={onConnectGoogle} disabled={linkBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-accent-contrast bg-accent hover:bg-accent-hover shadow-sm transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                                    {linkBusy ? <><Loader2 size={14} className="animate-spin" /> Redirecting…</> : <><LinkIcon size={14} /> Connect</>}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Safe-unlink confirmation (inline, matches the Referrals-tab confirm pattern). */}
                                    {googleLinked && confirmUnlink && (
                                        <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-2 animate-in fade-in duration-200">
                                            <span className="text-xs font-semibold text-content/80 flex-1 min-w-[200px]">
                                                Disconnect Google from this account? You can reconnect anytime — your PESO account and data are not affected.
                                            </span>
                                            <button type="button" onClick={onDisconnectGoogle} disabled={unlinkBusy} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                                {unlinkBusy ? <Loader2 size={13} className="animate-spin" /> : <ShieldOff size={13} />} Disconnect
                                            </button>
                                            <button type="button" onClick={() => setConfirmUnlink(false)} disabled={unlinkBusy} className="px-3 py-1.5 rounded-lg bg-surface border border-line text-xs font-bold text-muted flex items-center gap-1">
                                                <X size={13} /> Cancel
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <p className="text-xs text-muted px-1 leading-relaxed">
                                    Connecting Google lets you sign in with one tap. Disconnecting is safe — it never deletes your account, and it's blocked when you have no password set (so you can't lock yourself out). To revoke Google's own access, manage it from your Google Account security settings.
                                </p>
                            </div>
                        )}

                        {activeTab === 'referrals' && isJobSeeker && (
                            <div className="space-y-5 animate-in fade-in duration-300">
                                <div>
                                    <h3 className="text-lg font-black text-content">Incoming referral handling</h3>
                                    <p className="text-sm text-muted font-medium mt-1">
                                        Choose what happens when PESO Kabankalan refers you to an employer. Manual review
                                        is the default — you decide on each referral yourself.
                                    </p>
                                </div>

                                {!referralLoaded ? (
                                    <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-muted" size={24} /></div>
                                ) : (
                                    <div className="space-y-3" role="radiogroup" aria-label="Referral handling preference">
                                        {[
                                            { mode: 'manual', icon: ShieldCheck, title: 'Manual review (recommended)', desc: 'Every referral waits for you to accept or decline it in My Referrals.', tone: 'text-emerald-600 dark:text-emerald-400' },
                                            { mode: 'auto_accept', icon: Zap, title: 'Auto-accept referrals', desc: 'Referrals are accepted automatically on your behalf — the official letter is issued right away.', tone: 'text-blue-600 dark:text-blue-400' },
                                            { mode: 'auto_decline', icon: ShieldOff, title: 'Auto-decline referrals', desc: 'Referrals are declined automatically. Use this if you are not currently looking.', tone: 'text-rose-600 dark:text-rose-400' },
                                        ].map(({ mode, icon: Icon, title, desc, tone }) => {
                                            const selected = referralMode === mode;
                                            const confirming = pendingMode === mode;
                                            return (
                                                <div key={mode} className={`rounded-2xl border transition-all ${selected ? 'border-accent bg-accent-soft/40' : 'border-line bg-sunken hover:border-accent/40'}`}>
                                                    <button
                                                        type="button" role="radio" aria-checked={selected} disabled={referralSaving}
                                                        onClick={() => chooseReferralMode(mode)}
                                                        className="w-full text-left p-4 flex items-start gap-3 disabled:opacity-60"
                                                    >
                                                        <span className={`mt-0.5 shrink-0 ${selected ? tone : 'text-muted'}`}><Icon size={20} /></span>
                                                        <span className="flex-1">
                                                            <span className="flex items-center gap-2 font-bold text-content">{title}{selected && <Check size={16} className="text-accent" />}</span>
                                                            <span className="block text-xs text-muted font-medium mt-0.5">{desc}</span>
                                                        </span>
                                                    </button>
                                                    {confirming && (
                                                        <div className="px-4 pb-4 -mt-1 flex flex-wrap items-center gap-2 animate-in fade-in duration-200">
                                                            <span className="text-xs font-semibold text-content/80 flex-1 min-w-[180px]">
                                                                {mode === 'auto_accept'
                                                                    ? 'Turn on auto-accept? Future referrals will be accepted without your review.'
                                                                    : 'Turn on auto-decline? Future referrals will be declined without your review.'}
                                                            </span>
                                                            <button type="button" onClick={() => saveReferralMode(mode)} disabled={referralSaving} className="px-3 py-1.5 rounded-lg bg-accent text-accent-contrast text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                                                {referralSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm
                                                            </button>
                                                            <button type="button" onClick={() => setPendingMode(null)} className="px-3 py-1.5 rounded-lg bg-surface border border-line text-xs font-bold text-muted flex items-center gap-1">
                                                                <X size={13} /> Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'usage' && isJobSeeker && (
                            <div className="animate-in fade-in duration-300">
                                <UsagePanel
                                    scope="seeker"
                                    title="Usage & Limits"
                                    description="Your current usage across records, storage, imports, and uploads. The system enforces the limits marked as caps; the rest are shown for your reference."
                                />
                            </div>
                        )}

                        {!['integrations', 'referrals', 'usage'].includes(activeTab) && (
                            <div className="pt-6 border-t border-line">
                                <button type="submit" disabled={isLoading || (activeTab === 'profile' && profileLoading)} className="px-8 py-3.5 bg-accent hover:bg-accent-hover text-white rounded-2xl font-bold shadow-lg shadow-accent/30 flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 disabled:opacity-50">
                                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : 'Save Changes'}
                                </button>
                            </div>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AccountSettings;