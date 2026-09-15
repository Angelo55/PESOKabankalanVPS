/**
 * WalkInRegistration.jsx — PESO staff encode an applicant who visits the office in
 * person into the SAME centralized Job Seeker model (a claimable users row), and
 * manage the CLAIM codes for applicants who haven't activated yet. #7.
 *
 * Encode flow: fill the applicant's details + record Data-Privacy consent → submit.
 * If the office may already have this person (same phone/email/name), the backend
 * returns possible matches to review before creating a duplicate. On success a CLAIM
 * CODE is shown once — PESO gives it to the applicant (in person, and optionally by
 * SMS) so they can later claim the account at /claim.
 *
 * Manage flow: a panel lists still-unclaimed walk-ins so staff can REISSUE a fresh
 * code (for a lost/expired one), optionally texting it.
 *
 * Design-token styled (§24). Manager capability (walkin:manage), gated by the
 * walkInRegistration feature flag.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Loader2, CheckCircle, AlertTriangle, Copy, ShieldCheck, MessageSquare, RefreshCw, Clock } from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';

const empty = {
	name: '', email: '', phone: '', gender: '', location: '',
	educational_attainment: '', experience_level: '', skills: '', preferred_roles: '', consent: false, sendSms: false,
};

const inputCls = 'w-full p-2.5 sm:p-3 rounded-lg text-sm bg-sunken border border-line outline-none focus-visible:ring-2 focus-visible:ring-accent font-medium text-content transition-all';
const Field = ({ label, children, hint }) => (
	<div className="space-y-1.5">
		<label className="text-xs font-bold text-muted uppercase tracking-wide">{label}</label>
		{children}
		{hint && <p className="text-[11px] text-subtle">{hint}</p>}
	</div>
);

const WalkInRegistration = () => {
	const { notify } = useNotification();
	const { features } = useAuth();
	const smsOn = !!features?.smsNotifications;

	const [form, setForm] = useState(empty);
	const [busy, setBusy] = useState(false);
	const [duplicates, setDuplicates] = useState(null);
	const [created, setCreated] = useState(null); // { claimCode, claimUrl, smsSent, ... }

	const [pending, setPending] = useState([]);
	const [pendingLoading, setPendingLoading] = useState(false);
	const [reissued, setReissued] = useState(null); // { id, claimCode, claimUrl, smsSent }

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

	const loadPending = useCallback(async () => {
		setPendingLoading(true);
		try {
			const res = await API.get('/peso-admin/walk-in/unclaimed');
			setPending(res.data?.data || []);
		} catch (_) { /* leave the panel empty on error */ }
		finally { setPendingLoading(false); }
	}, []);

	useEffect(() => { loadPending(); }, [loadPending]);

	const submit = async (force = false) => {
		if (!form.name.trim()) return notify?.warning?.('Name required', 'Enter the applicant name.');
		if (!form.consent) return notify?.warning?.('Consent required', 'Record the applicant\'s data-privacy consent.');
		setBusy(true);
		try {
			const res = await API.post('/peso-admin/walk-in', { ...form, force });
			if (res.data?.status === 'duplicates') {
				setDuplicates(res.data.data || []);
			} else {
				setCreated(res.data?.data || {});
				setDuplicates(null);
				notify?.success?.('Registered', 'Walk-in applicant added to the seeker records.');
				loadPending();
			}
		} catch (err) {
			notify?.error?.('Could not register', err.response?.data?.message || 'Please try again.');
		} finally { setBusy(false); }
	};

	const copy = (text, label = 'Claim code') => {
		if (text) navigator.clipboard?.writeText(text).then(() => notify?.success?.('Copied', `${label} copied.`)).catch(() => {});
	};

	const reissue = async (row) => {
		setReissued({ id: row.id, loading: true });
		try {
			const res = await API.post(`/peso-admin/walk-in/${row.id}/reissue`, { name: row.name, sendSms: smsOn && !!row.phone });
			setReissued({ id: row.id, ...(res.data?.data || {}) });
			notify?.success?.('Reissued', 'A fresh claim code was generated.');
			loadPending();
		} catch (err) {
			setReissued(null);
			notify?.error?.('Could not reissue', err.response?.data?.message || 'Please try again.');
		}
	};

	const reset = () => { setForm(empty); setDuplicates(null); setCreated(null); };

	// ── Success (just-created) view ─────────────────────────────────────────
	if (created) {
		return (
			<div className="max-w-2xl mx-auto p-3 sm:p-5 lg:p-6">
				<div className="rounded-3xl bg-surface border border-line shadow-card p-6 text-center">
					<span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mb-4"><CheckCircle size={32} /></span>
					<h2 className="text-xl font-black text-content">Walk-in applicant registered</h2>
					<p className="text-sm text-muted mt-1">They are now in the centralized Job Seeker records and can be referred like any online applicant.</p>
					{created.claimCode && (
						<div className="mt-5 p-4 rounded-2xl bg-sunken border border-line text-left">
							<p className="text-xs font-black uppercase tracking-wider text-accent-text mb-1">Account claim code</p>
							<p className="text-[11px] text-muted mb-2">Give this to the applicant. They activate the account at <span className="font-bold text-content">{created.claimUrl || '/claim'}</span>{created.expiresInDays ? ` — it expires in ${created.expiresInDays} days.` : '.'}</p>
							<div className="flex items-center gap-2">
								<code className="flex-1 min-w-0 truncate text-base font-mono font-black bg-surface border border-line rounded-lg px-3 py-2 text-content tracking-widest">{created.claimCode}</code>
								<button onClick={() => copy(created.claimCode)} className="p-2 rounded-lg bg-surface border border-line text-muted hover:text-content hover:bg-sunken"><Copy size={16} /></button>
							</div>
							{created.smsSent && (
								<p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold mt-2 flex items-center gap-1"><MessageSquare size={13} /> Also texted to the applicant's mobile.</p>
							)}
						</div>
					)}
					<button onClick={reset} className="mt-5 w-full py-2.5 rounded-xl bg-accent text-accent-contrast font-bold hover:bg-accent-hover transition-colors">Register another</button>
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-3xl mx-auto p-3 sm:p-5 lg:p-6">
			<div className="mb-6">
				<h1 className="text-2xl sm:text-3xl font-black tracking-tight text-content flex items-center gap-2"><UserPlus size={26} className="text-accent-text" /> Register Walk-In Applicant</h1>
				<p className="text-sm font-medium text-muted mt-1">Encode an applicant who visited the office and has no online account yet. They join the same Job Seeker records and can later claim the account.</p>
			</div>

			{duplicates && (
				<div className="mb-5 rounded-2xl border border-amber-300/60 bg-amber-50/60 dark:bg-amber-900/20 dark:border-amber-800/50 p-4">
					<p className="flex items-center gap-2 text-sm font-black text-amber-700 dark:text-amber-400 mb-2"><AlertTriangle size={16} /> Possible existing accounts</p>
					<p className="text-xs text-amber-700/90 dark:text-amber-300/90 mb-3">The office may already have this person. Review before creating a duplicate.</p>
					<ul className="space-y-1.5 mb-3">
						{duplicates.map((d) => (
							<li key={d.id} className="text-xs bg-surface border border-line rounded-lg px-3 py-2 flex items-center justify-between gap-2">
								<span className="truncate"><span className="font-bold text-content">{d.name}</span> <span className="text-muted">· {d.phone || 'no phone'} · {String(d.email || '').includes('walk-in.peso') ? 'no email' : d.email}</span></span>
								<span className={`shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${d.match === 'strong' ? 'bg-rose-500/15 text-rose-600' : 'bg-sunken text-muted'}`}>{d.match} match</span>
							</li>
						))}
					</ul>
					<div className="flex gap-2">
						<button onClick={() => setDuplicates(null)} className="flex-1 py-2 rounded-xl bg-surface border border-line text-content font-bold text-sm hover:bg-sunken">Back to form</button>
						<button onClick={() => submit(true)} disabled={busy} className="flex-1 py-2 rounded-xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-50">Create anyway</button>
					</div>
				</div>
			)}

			<form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="rounded-3xl bg-surface border border-line shadow-card p-5 sm:p-6 space-y-5">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<Field label="Full Name *"><input required value={form.name} onChange={set('name')} placeholder="Applicant's full name" className={inputCls} /></Field>
					<Field label="Email" hint="Optional — leave blank if they have none yet."><input type="email" value={form.email} onChange={set('email')} placeholder="name@gmail.com" className={inputCls} /></Field>
					<Field label="Phone / Mobile"><input value={form.phone} onChange={set('phone')} placeholder="09XX XXX XXXX" className={inputCls} /></Field>
					<Field label="Gender">
						<select aria-label="Gender" value={form.gender} onChange={set('gender')} className={`${inputCls} cursor-pointer`}>
							<option value="">Prefer not to say</option><option value="Male">Male</option><option value="Female">Female</option>
						</select>
					</Field>
					<Field label="Address / Location"><input value={form.location} onChange={set('location')} placeholder="Barangay, Kabankalan City" className={inputCls} /></Field>
					<Field label="Highest Education"><input value={form.educational_attainment} onChange={set('educational_attainment')} placeholder="e.g., High School Graduate" className={inputCls} /></Field>
					<Field label="Experience Level"><input value={form.experience_level} onChange={set('experience_level')} placeholder="e.g., 2 years retail" className={inputCls} /></Field>
					<Field label="Preferred Roles"><input value={form.preferred_roles} onChange={set('preferred_roles')} placeholder="e.g., Cashier, Utility" className={inputCls} /></Field>
					<div className="md:col-span-2">
						<Field label="Skills & Qualifications"><textarea value={form.skills} onChange={set('skills')} placeholder="Skills, certifications, licenses…" className={`${inputCls} min-h-[70px]`} /></Field>
					</div>
				</div>

				<label className="flex items-start gap-3 p-3.5 rounded-2xl bg-sunken border border-line cursor-pointer">
					<input type="checkbox" checked={form.consent} onChange={set('consent')} className="mt-0.5 w-4 h-4 rounded accent-accent" />
					<span className="text-xs text-muted flex items-center gap-1.5"><ShieldCheck size={14} className="text-accent-text shrink-0" /> The applicant consents to PESO Kabankalan collecting and processing their personal information for employment-facilitation purposes (Data Privacy Act of 2012).</span>
				</label>

				{smsOn && (
					<label className="flex items-center gap-3 p-3.5 rounded-2xl bg-sunken border border-line cursor-pointer">
						<input type="checkbox" checked={form.sendSms} onChange={set('sendSms')} className="w-4 h-4 rounded accent-accent" />
						<span className="text-xs text-muted flex items-center gap-1.5"><MessageSquare size={14} className="text-accent-text shrink-0" /> Also text the claim code/link to the applicant's mobile (if provided).</span>
					</label>
				)}

				<button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-accent text-accent-contrast font-black hover:bg-accent-hover flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
					{busy ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />} Register Applicant
				</button>
			</form>

			{/* ── Pending claims (reissue) ──────────────────────────────────── */}
			<div className="mt-8 rounded-3xl bg-surface border border-line shadow-card p-5 sm:p-6">
				<div className="flex items-center justify-between mb-3">
					<h2 className="text-base sm:text-lg font-black text-content flex items-center gap-2"><Clock size={18} className="text-accent-text" /> Applicants awaiting claim</h2>
					<button onClick={loadPending} className="p-2 rounded-lg text-muted hover:text-content hover:bg-sunken" aria-label="Refresh"><RefreshCw size={16} className={pendingLoading ? 'animate-spin' : ''} /></button>
				</div>
				<p className="text-xs text-muted mb-4">Walk-ins who haven't activated their account yet. Reissue a fresh code if they lost it or it expired.</p>

				{pending.length === 0 ? (
					<p className="text-sm text-subtle py-4 text-center">No walk-ins are waiting to be claimed.</p>
				) : (
					<ul className="space-y-2">
						{pending.map((row) => (
							<li key={row.id} className="rounded-xl bg-sunken border border-line p-3">
								<div className="flex items-center justify-between gap-2">
									<div className="min-w-0">
										<p className="font-bold text-content text-sm truncate">{row.name}</p>
										<p className="text-xs text-muted truncate">
											{row.phone || 'no phone'} ·{' '}
											{row.is_expired
												? <span className="text-rose-600 font-bold">code expired</span>
												: (row.claim_token_expires_at ? `expires ${new Date(row.claim_token_expires_at).toLocaleDateString()}` : 'active code')}
											{row.claim_reissue_count > 0 ? ` · reissued ${row.claim_reissue_count}×` : ''}
										</p>
									</div>
									<button onClick={() => reissue(row)} disabled={reissued?.id === row.id && reissued?.loading} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50">
										{reissued?.id === row.id && reissued?.loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Reissue
									</button>
								</div>
								{reissued?.id === row.id && reissued?.claimCode && (
									<div className="mt-2 flex items-center gap-2">
										<code className="flex-1 min-w-0 truncate text-sm font-mono font-black bg-surface border border-line rounded-lg px-3 py-1.5 text-content tracking-widest">{reissued.claimCode}</code>
										<button onClick={() => copy(reissued.claimCode)} className="p-2 rounded-lg bg-surface border border-line text-muted hover:text-content"><Copy size={14} /></button>
										{reissued.smsSent && <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1"><MessageSquare size={12} /> texted</span>}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};

export default WalkInRegistration;
