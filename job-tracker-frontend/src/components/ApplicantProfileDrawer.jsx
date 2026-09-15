import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Loader2, FileText, Mail, Phone, MapPin, Calendar, GraduationCap,
    Briefcase, Languages, Target, Sparkles, User as UserIcon, Award, Clock, AlertTriangle,
} from 'lucide-react';
import API from '../api';
import Avatar from './common/Avatar';
import { useNotification } from '../context/NotificationContext';
import useFocusTrap from '../hooks/useFocusTrap';

/**
 * UNIFIED APPLICANT PROFILE (Enhancement A) — a slide-over giving the PESO
 * Administrator the whole applicant from one place: the SUBMITTED package
 * (personal info as applied, AI compatibility, resume) plus the applicant's
 * CURRENT profile (contact, education, skills, experience) and AI Resume Analysis.
 *
 * The distinction is surfaced, not hidden: "As submitted" vs "Current profile",
 * because an application is a point-in-time record. Backed by the single
 * owner-scoped GET /peso-admin/ats/applications/:id/profile. Documents are
 * streamed on demand (blob-fetch, since a bearer token can't ride window.open).
 */

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const humanize = (k) => String(k).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

// A labelled field row; renders an em-dash when empty so nothing looks broken.
const Field = ({ icon, label, value }) => (
    <div className="flex items-start gap-2.5 py-1.5">
        {icon && <span className="text-subtle mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-subtle">{label}</p>
            <p className="text-sm font-semibold text-content break-words">{value || value === 0 ? value : '—'}</p>
        </div>
    </div>
);

const Section = ({ icon, title, subtitle, children }) => (
    <section className="bg-surface/70 rounded-2xl border border-line shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
            <span className="text-accent-text">{icon}</span>
            <h3 className="font-bold text-content text-sm">{title}</h3>
            {subtitle && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-subtle">{subtitle}</span>}
        </div>
        {children}
    </section>
);

// A 0–100 sub-score as a labelled bar.
const ScoreBar = ({ label, value }) => {
    const v = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;
    return (
        <div className="mb-2.5 last:mb-0">
            <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-muted">{label}</span>
                <span className="text-muted tabular-nums">{v === null ? 'N/A' : `${v}%`}</span>
            </div>
            <div className="h-2 rounded-full bg-sunken overflow-hidden">
                <div className="h-full rounded-full bg-accent dark:bg-[#4f8a1f]" style={{ width: `${v ?? 0}%` }} />
            </div>
        </div>
    );
};

// Skills / education / experience ratings (the AI returns High/Medium/Low strings,
// or occasionally numbers) as chips — a bar can't render "High".
const Ratings = ({ a }) => {
    if (!a) return null;
    const rows = [['Skills', a.skills], ['Education', a.education], ['Experience', a.experience]]
        .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'Unknown');
    if (rows.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 mt-2">
            {rows.map(([l, v]) => (
                <span key={l} className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-sunken text-muted">
                    {l}: {typeof v === 'number' ? `${v}%` : v}
                </span>
            ))}
        </div>
    );
};

// Render an arbitrary JSON blob (resume insights / snapshot) as readable rows,
// so the drawer never breaks on a shape it doesn't recognise.
const KeyValues = ({ data }) => {
    if (!data || typeof data !== 'object') {
        return <p className="text-sm text-muted">{data ? String(data) : 'Not provided.'}</p>;
    }
    const entries = Object.entries(data).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (entries.length === 0) return <p className="text-sm text-muted">Not provided.</p>;
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {entries.map(([k, v]) => (
                <Field key={k} label={humanize(k)} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
        </div>
    );
};

const STATUS_TONE = {
    Applied: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'Under Review': 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    Shortlisted: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    Referred: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    'Not Referred': 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    Interview: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    Hired: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    Rejected: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

const ApplicantProfileDrawer = ({ applicationId, applicantName, onClose }) => {
    const { notify } = useNotification();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const trapRef = useFocusTrap(true); // C1: trap + restore focus (WCAG 2.4.3)

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await API.get(`/peso-admin/ats/applications/${applicationId}/profile`, getAuthConfig());
            setData(res.data?.data || null);
        } catch (error) {
            notify.error('Load failed', error.response?.data?.message || 'Could not load the applicant profile.');
            onClose();
        } finally {
            setLoading(false);
        }
    }, [applicationId, notify, onClose]);

    useEffect(() => { load(); }, [load]);

    // Close on Escape.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Owner-scoped blob fetch (a bearer token can't ride window.open). Shared by
    // the resume and every certificate.
    const viewBlob = async (url, mime = 'application/pdf') => {
        try {
            const res = await API.get(url, { ...getAuthConfig(), responseType: 'blob' });
            const objUrl = URL.createObjectURL(new Blob([res.data], { type: mime }));
            window.open(objUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
        } catch (error) {
            notify.error('Could not open file', error?.response?.data?.message || 'The file could not be loaded.');
        }
    };
    const viewResume = () => viewBlob(`/peso-admin/ats/applications/${applicationId}/resume`, 'application/pdf');

    const app = data?.application || {};
    const profile = data?.profile || {};
    const submitted = data?.submitted || {};
    const ai = data?.aiCompatibility || null;       // apply-time (immutable)
    const live = data?.liveCompatibility || null;   // live (Enhancement B)
    const insights = data?.resumeInsights || null;

    return createPortal(
        <div className="fixed inset-0 z-[9998] flex justify-end bg-gray-900/50 dark:bg-black/70 backdrop-blur-sm animate-fade-scale-in" onClick={onClose}>
            <div
                ref={trapRef}
                tabIndex={-1}
                className="w-full max-w-2xl h-full bg-sunken shadow-2xl flex flex-col focus:outline-none"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Applicant profile${applicantName ? ` for ${applicantName}` : ''}`}
            >
                {/* Header */}
                <div className="shrink-0 bg-surface border-b border-line p-4 sm:p-5 flex items-start gap-3">
                    <Avatar user={{ id: profile.id, name: profile.name || applicantName, avatar_url: profile.avatar_url }} size={52} className="shadow-sm" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-black text-content truncate">{profile.name || applicantName || 'Applicant'}</h2>
                        <p className="text-xs text-muted font-medium truncate">{profile.email || '—'}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                            {app.status && <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${STATUS_TONE[app.status] || 'bg-sunken text-muted'}`}>{app.status}</span>}
                            {app.job_title && <span className="text-[10px] font-bold text-muted flex items-center gap-1"><Briefcase size={11} /> {app.job_title}</span>}
                            <span className="text-[10px] font-bold text-subtle flex items-center gap-1"><Clock size={11} /> Applied {fmtDate(app.applied_at)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="shrink-0 p-2 text-subtle hover:text-content bg-sunken hover:bg-line rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="animate-spin text-accent-text" size={32} />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                        {/* AI compatibility — BOTH the live score (used for ranking) and
                            the immutable apply-time snapshot, clearly distinguished. */}
                        <Section icon={<Sparkles size={16} />} title="AI Compatibility">
                            {/* Current (live) — drives ranking */}
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[11px] font-black uppercase tracking-wider text-accent-text">Current · used for ranking</p>
                                    {app.scored_at && <span className="text-[10px] font-bold text-subtle">recalculated {fmtDate(app.scored_at)}</span>}
                                </div>
                                {typeof app.current_match_score === 'number' ? (
                                    <>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-3xl font-black text-accent-text tabular-nums">{app.current_match_score}%</span>
                                            <span className="text-xs font-bold text-subtle">live match</span>
                                        </div>
                                        <Ratings a={live} />
                                        {live && (live.summary || live.reason || live.notes) && (
                                            <p className="text-sm text-muted mt-2 leading-relaxed">{live.summary || live.reason || live.notes}</p>
                                        )}
                                        {live?.provenance?.model && (
                                            <p className="text-[10px] text-subtle mt-1.5">
                                                {live.provenance.model} · {live.provenance.provider} · prompt {live.provenance.promptVersion}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm text-muted">Not yet recalculated — the ranking is using the apply-time score below.</p>
                                )}
                            </div>

                            {/* Apply-time — immutable snapshot */}
                            <div className="pt-3 border-t border-line/60">
                                <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[11px] font-black uppercase tracking-wider text-subtle">Apply-time · immutable snapshot</p>
                                    {app.ai_scored_at && <span className="text-[10px] font-bold text-subtle">scored {fmtDate(app.ai_scored_at)}</span>}
                                </div>
                                {ai || typeof app.match_score === 'number' ? (
                                    <>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-2xl font-black text-content tabular-nums">{typeof app.match_score === 'number' ? `${app.match_score}%` : (typeof ai?.overall === 'number' ? `${ai.overall}%` : 'N/A')}</span>
                                            <span className="text-xs font-bold text-subtle">at submission</span>
                                        </div>
                                        <Ratings a={ai} />
                                        {ai && (ai.summary || ai.reason || ai.notes) && (
                                            <p className="text-sm text-muted mt-2 leading-relaxed">{ai.summary || ai.reason || ai.notes}</p>
                                        )}
                                        {ai?.provenance?.model && (
                                            <p className="text-[10px] text-subtle mt-1.5">
                                                {ai.provenance.model} · {ai.provenance.provider} · prompt {ai.provenance.promptVersion}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm text-muted flex items-center gap-2"><AlertTriangle size={14} className="text-amber-500" /> Not scored at submission — manual review.</p>
                                )}
                            </div>
                        </Section>

                        {/* Documents */}
                        <Section icon={<FileText size={16} />} title="Documents">
                            {data?.documents?.hasResume ? (
                                <button onClick={viewResume} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-accent-text bg-accent-soft hover:bg-accent/15 transition-colors">
                                    <FileText size={15} /> View submitted resume
                                </button>
                            ) : (
                                <p className="text-sm text-muted">No resume on file for this application.</p>
                            )}

                            {(data?.documents?.certificates || []).length > 0 && (
                                <div className="mt-4 space-y-2">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-subtle">Supporting certificates ({data.documents.certificates.length})</p>
                                    {data.documents.certificates.map((c) => (
                                        <button
                                            key={c.id}
                                            onClick={() => viewBlob(c.url, c.mime_type)}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-sunken hover:bg-line transition-colors text-left"
                                        >
                                            <Award size={16} className="text-accent-text shrink-0" />
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-semibold text-content truncate">{c.title || c.file_name}</span>
                                                {c.category && <span className="block text-[11px] text-subtle">{c.category}</span>}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Section>

                        {/* Submitted personal info */}
                        <Section icon={<UserIcon size={16} />} title="Personal Information" subtitle="As submitted">
                            <KeyValues data={submitted} />
                        </Section>

                        {/* Current profile — contact + education + experience */}
                        <Section icon={<UserIcon size={16} />} title="Contact & Details" subtitle="Current profile">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                                <Field icon={<Mail size={14} />} label="Email" value={profile.email} />
                                <Field icon={<Phone size={14} />} label="Phone" value={profile.phone} />
                                <Field icon={<MapPin size={14} />} label="Location" value={profile.location} />
                                <Field icon={<Calendar size={14} />} label="Date of Birth" value={profile.dob ? fmtDate(profile.dob) : null} />
                                <Field icon={<UserIcon size={14} />} label="Gender" value={profile.gender} />
                                <Field icon={<Clock size={14} />} label="Availability" value={profile.availability} />
                                <Field icon={<Clock size={14} />} label="Member Since" value={profile.member_since ? fmtDate(profile.member_since) : null} />
                            </div>
                        </Section>

                        <Section icon={<GraduationCap size={16} />} title="Education & Skills" subtitle="Current profile">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                                <Field icon={<GraduationCap size={14} />} label="Educational Attainment" value={profile.educational_attainment} />
                                <Field icon={<Languages size={14} />} label="Languages" value={profile.languages} />
                            </div>
                            <div className="mt-1">
                                <Field icon={<Sparkles size={14} />} label="Skills" value={profile.skills} />
                                <Field icon={<Target size={14} />} label="Preferred Roles" value={profile.preferred_roles} />
                            </div>
                        </Section>

                        <Section icon={<Briefcase size={16} />} title="Experience & Goals" subtitle="Current profile">
                            <Field icon={<Briefcase size={14} />} label="Experience Level" value={profile.experience_level} />
                            <Field icon={<Target size={14} />} label="Career Goals" value={profile.career_goals} />
                        </Section>

                        {/* AI Resume Analysis (respects the applicant's visibility choice) */}
                        <Section icon={<Sparkles size={16} />} title="Resume Insights" subtitle="AI analysis">
                            {data?.aiResumeVisible === false ? (
                                <p className="text-sm text-muted">The applicant has hidden their AI resume analysis.</p>
                            ) : insights ? (
                                <KeyValues data={insights} />
                            ) : (
                                <p className="text-sm text-muted">No AI resume analysis on file.</p>
                            )}
                        </Section>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default ApplicantProfileDrawer;
