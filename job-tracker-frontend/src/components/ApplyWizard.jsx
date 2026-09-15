/**
 * APPLY WIZARD — how a job seeker applies for a vacancy.
 *
 * WHAT: a three-step modal that collects everything one application needs, then
 * submits it to POST /api/applications.
 *
 *   1. Personal Info        name and contact details, prefilled from the profile
 *   2. Resume               EXACTLY TWO options: use the PESO Kabankalan builder resume,
 *                           or upload a PDF
 *   3. Additional Questions the employer's own screening questions, if any
 *
 * WHEN: opened from the Public Job Board or Saved Vacancies, for a job that is
 * still accepting applications.
 *
 * ── WHY THREE STEPS AND NOT ONE FORM ───────────────────────────────────────
 * Applying is the moment the platform exists for, and the highest-abandonment
 * point in the funnel. Three short screens with visible progress read as
 * achievable; the same fields on one long page read as a chore.
 *
 * ── WHY THERE IS NO COVER LETTER STEP ──────────────────────────────────────
 * It was removed by decision. PESO referrals are made on the strength of the
 * resume and the AI match, and the extra step cost completions without changing
 * outcomes. Do not reintroduce it.
 *
 * ── VALIDATION IS PER-STEP, ON PURPOSE ─────────────────────────────────────
 * Each step validates before advancing, so a missing field is reported next to
 * where it belongs rather than as a list of failures at the end of a flow the
 * user thought was finished. Submitting also re-checks required questions and
 * jumps BACK to step 3 rather than only showing an error.
 *
 * ── THE FILLED-VACANCY GUARD IS NOT THE REAL ONE ───────────────────────────
 * Entry is blocked client-side when a vacancy is full, but POST
 * /api/applications refuses it again server-side. The disabled button is
 * courtesy; the endpoint is enforcement. Never rely on this component to keep a
 * filled vacancy closed.
 *
 * ── WHAT HAPPENS AFTER SUBMIT ──────────────────────────────────────────────
 * The backend stores the application, snapshots the resume as an immutable
 * per-application PDF, extracts its text, scores it with AI, stages a referral
 * if the score clears the threshold, and notifies the administrator. All of
 * that is best-effort EXCEPT the application row itself — so this wizard
 * reports success as soon as the application exists, which is the only part the
 * applicant depends on.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import {
    User, FileText, HelpCircle, ChevronLeft, ChevronRight, CheckCircle,
    Loader2, X, Upload, Check
} from 'lucide-react';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const STEPS = [
    { n: 1, label: 'Personal Information', icon: User },
    { n: 2, label: 'Resume', icon: FileText },
    { n: 3, label: 'Additional Questions', icon: HelpCircle },
];

const inputClass =
    'w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/40 text-content';

// Reads a File into a bare base64 string (no data: prefix), for JSON transport.
const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result || '';
        const comma = String(result).indexOf(',');
        resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result));
    };
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
});

// Supporting-certificate limits (Enhancement C) — mirror the server-side caps.
const CERT_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const CERT_MAX_COUNT = 8;
const CERT_MAX_BYTES = 5 * 1024 * 1024;

const ApplyWizard = ({ job, onClose, onApplied }) => {
    const { notify } = useNotification();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [personal, setPersonal] = useState({
        name: '', email: '', phone: '', gender: '', dob: '',
        location: '', availability: '', educational_attainment: '', languages: '', skills: ''
    });
    const [updateProfile, setUpdateProfile] = useState(false);

    const [hasBuilderResume, setHasBuilderResume] = useState(false);
    const [resumeMode, setResumeMode] = useState('upload'); // 'builder' | 'upload'
    const [resumeFile, setResumeFile] = useState(null);

    // Supporting certificates (Enhancement C): fresh uploads [{ file_name, mime_type, base64, category, size }]
    const [certificates, setCertificates] = useState([]);
    // Reusable library (C.2): the applicant's saved certificates + which they picked.
    const [libraryCerts, setLibraryCerts] = useState([]);
    const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);

    const addCertificateFiles = async (fileList) => {
        const files = Array.from(fileList || []);
        let count = certificates.length;
        for (const file of files) {
            if (count >= CERT_MAX_COUNT) { notify.warning('Limit reached', `You can attach up to ${CERT_MAX_COUNT} certificates.`); break; }
            if (!CERT_ALLOWED_MIME.includes(file.type)) { notify.warning('Unsupported file', `${file.name}: PDF, JPG, PNG, or WEBP only.`); continue; }
            if (file.size > CERT_MAX_BYTES) { notify.warning('File too large', `${file.name} is over 5 MB.`); continue; }
            try {
                const base64 = await fileToBase64(file);
                setCertificates(prev => [...prev, { file_name: file.name, mime_type: file.type, base64, category: '', size: file.size }]);
                count += 1;
            } catch { notify.error('Read failed', `Could not read ${file.name}.`); }
        }
    };
    const removeCertificate = (idx) => setCertificates(prev => prev.filter((_, i) => i !== idx));

    const [questions, setQuestions] = useState([]);
    const [answers, setAnswers] = useState({});

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            const [profileRes, questionsRes, resumeDraftRes, certsRes] = await Promise.allSettled([
                API.get('/profile', getAuthConfig()),
                API.get(`/job-board/${job.id}/questions`, getAuthConfig()),
                API.get('/resume/draft', getAuthConfig()),
                API.get('/profile/certificates', getAuthConfig()),
            ]);
            if (alive && certsRes.status === 'fulfilled') setLibraryCerts(certsRes.value.data?.data || []);
            if (!alive) return;
            if (profileRes.status === 'fulfilled') {
                const d = profileRes.value.data?.data || profileRes.value.data?.user || profileRes.value.data || {};
                setPersonal(prev => ({
                    ...prev,
                    name: d.name || '', email: d.email || '', phone: d.phone || '', gender: d.gender || '',
                    dob: d.dob ? new Date(d.dob).toISOString().split('T')[0] : '',
                    location: d.location || '', availability: d.availability || '',
                    educational_attainment: d.educational_attainment || '', languages: d.languages || '', skills: d.skills || ''
                }));
            }
            if (questionsRes.status === 'fulfilled') {
                setQuestions(Array.isArray(questionsRes.value.data?.data) ? questionsRes.value.data.data : []);
            }
            if (resumeDraftRes.status === 'fulfilled' && resumeDraftRes.value.data?.data) {
                setHasBuilderResume(true);
                setResumeMode('builder');
            }
            setLoading(false);
        })();
        return () => { alive = false; };
    }, [job.id]);

    const setField = (key, value) => setPersonal(prev => ({ ...prev, [key]: value }));

    const handleResumeFile = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.type !== 'application/pdf') { notify.warning('PDF only', 'Please upload your resume as a PDF file.'); return; }
        if (file.size > 15 * 1024 * 1024) { notify.warning('File too large', 'Keep the resume under 15MB.'); return; }
        setResumeFile(file);
        setResumeMode('upload');
    };

    const requiredMissing = () => questions.filter(q => q.is_required && !(answers[q.id] ?? '').toString().trim());

    const step1Valid = personal.name.trim() !== '';
    const step2Valid = !(resumeMode === 'upload' && !resumeFile);

    const goNext = () => {
        if (step === 1 && !step1Valid) return notify.warning('Name required', 'Please provide your full name.');
        if (step === 2 && !step2Valid) return notify.warning('Resume needed', 'Choose a resume option or upload a file.');
        setStep(s => Math.min(3, s + 1));
    };

    const handleSubmit = async () => {
        const missing = requiredMissing();
        if (missing.length) { setStep(3); return notify.warning('Answer required questions', missing.map(m => m.question_text).join(', ')); }

        setSubmitting(true);
        try {
            // Resolve the chosen resume into what the application POST expects.
            // 'upload' ships the PDF bytes (base64); 'builder' is generated server-side.
            let resumeSource = 'builder';
            let resumeUrl = 'PESO Kabankalan Builder Resume';
            let resumeFileBase64 = null;
            let resumeFileName = null;
            if (resumeMode === 'upload') {
                if (!resumeFile) { setSubmitting(false); return notify.warning('Resume needed', 'Please choose a PDF to upload.'); }
                try {
                    resumeFileBase64 = await fileToBase64(resumeFile);
                } catch (e) {
                    setSubmitting(false);
                    return notify.error('Resume read failed', 'Could not read your resume file. Please try again.');
                }
                resumeSource = 'upload';
                resumeUrl = resumeFile.name;
                resumeFileName = resumeFile.name;
            }

            const answerPayload = questions.map(q => ({ question_id: q.id, answer_text: (answers[q.id] ?? '').toString() }));

            await API.post('/applications', {
                job_id: job.id,
                personal_info: personal,
                resume_url: resumeUrl,
                resume_source: resumeSource,
                resume_file_base64: resumeFileBase64,
                resume_file_name: resumeFileName,
                answers: answerPayload,
                update_profile: updateProfile,
                certificates: [
                    ...selectedLibraryIds.map(id => ({ user_certificate_id: id })),
                    ...certificates.map(c => ({ file_name: c.file_name, mime_type: c.mime_type, base64: c.base64, category: c.category || null })),
                ],
            }, getAuthConfig());

            notify.success('Application submitted!', 'Your application has been sent to the employer.');
            onApplied?.();
        } catch (error) {
            notify.error('Application Failed', error.response?.data?.message || 'Something went wrong.');
        } finally {
            setSubmitting(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in" onClick={onClose}>
            <div className="w-full max-w-3xl bg-surface rounded-[2rem] shadow-2xl border border-white/20 dark:border-line flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4" onClick={(e) => e.stopPropagation()}>

                {/* Header + stepper */}
                <div className="p-6 border-b border-line bg-sunken/60">
                    <div className="flex justify-between items-start mb-5">
                        <div>
                            <h2 className="text-2xl font-black text-content">Apply for this role</h2>
                            <p className="text-sm text-muted font-medium mt-0.5">{job.title} · {job.company}</p>
                        </div>
                        <button onClick={onClose} className="p-2 text-subtle hover:text-content dark:hover:text-white hover:bg-sunken/60 rounded-full transition-colors"><X size={22} /></button>
                    </div>
                    <div className="flex items-center">
                        {STEPS.map((s, i) => {
                            const Icon = s.icon;
                            const active = step === s.n;
                            const done = step > s.n;
                            return (
                                <React.Fragment key={s.n}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm transition-colors ${done ? 'bg-accent text-accent-contrast' : active ? 'bg-accent text-white' : 'bg-line text-muted'}`}>
                                            {done ? <Check size={16} /> : <Icon size={16} />}
                                        </div>
                                        <span className={`hidden sm:block text-xs font-bold ${active || done ? 'text-content' : 'text-subtle'}`}>{s.label}</span>
                                    </div>
                                    {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 rounded-full ${step > s.n ? 'bg-accent' : 'bg-line'}`} />}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 sm:p-8 overflow-y-auto custom-scrollbar flex-1">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16"><Loader2 size={32} className="animate-spin text-accent-text mb-3" /><p className="text-sm font-bold text-muted">Loading your details…</p></div>
                    ) : step === 1 ? (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                            <p className="text-sm text-muted font-medium">We pre-filled this from your Identity &amp; Profile. Review and edit anything before continuing — changes stay with this application unless you tick the box below.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Full Name *</label>
                                    <input value={personal.name} onChange={(e) => setField('name', e.target.value)} className={inputClass} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Email</label>
                                    <input value={personal.email} readOnly className={`${inputClass} opacity-70 cursor-not-allowed`} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Phone</label>
                                    <input value={personal.phone} onChange={(e) => setField('phone', e.target.value)} className={inputClass} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Gender</label>
                                    <select value={personal.gender} onChange={(e) => setField('gender', e.target.value)} className={inputClass}>
                                        <option value="">Select…</option>
                                        <option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Date of Birth</label>
                                    <input type="date" value={personal.dob} onChange={(e) => setField('dob', e.target.value)} className={inputClass} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Location / Address</label>
                                    <input value={personal.location} onChange={(e) => setField('location', e.target.value)} className={inputClass} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Availability</label>
                                    <select value={personal.availability} onChange={(e) => setField('availability', e.target.value)} className={inputClass}>
                                        <option value="">Select…</option>
                                        <option value="Full-time">Full-time</option><option value="Part-time">Part-time</option>
                                        <option value="Night-shift">Night-shift</option><option value="Freelance/Contract">Freelance / Contract</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted mb-1">Educational Attainment</label>
                                    <select value={personal.educational_attainment} onChange={(e) => setField('educational_attainment', e.target.value)} className={inputClass}>
                                        <option value="">Select…</option>
                                        <option>High School Graduate</option><option>College Undergraduate</option><option>College Graduate</option>
                                        <option>Vocational / Technical</option><option>Postgraduate</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-muted mb-1">Languages</label>
                                    <input value={personal.languages} onChange={(e) => setField('languages', e.target.value)} placeholder="e.g. English, Tagalog, Hiligaynon" className={inputClass} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-muted mb-1">Skills</label>
                                    <textarea value={personal.skills} onChange={(e) => setField('skills', e.target.value)} placeholder="e.g. Communication, Data Entry, Customer Service" className={`${inputClass} min-h-[70px]`} />
                                </div>
                            </div>
                            <label className="flex items-center gap-2.5 text-sm font-bold text-muted cursor-pointer select-none">
                                <input type="checkbox" checked={updateProfile} onChange={(e) => setUpdateProfile(e.target.checked)} className="w-4 h-4 accent-[#1a4a38]" />
                                Also save these changes to my profile
                            </label>
                        </div>
                    ) : step === 2 ? (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                            <section>
                                <h3 className="text-sm font-black text-content uppercase tracking-wide mb-3">Resume</h3>
                                <div className="space-y-3">
                                    {hasBuilderResume && (
                                        <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${resumeMode === 'builder' ? 'border-accent bg-accent/5' : 'border-line hover:bg-sunken/50'}`}>
                                            <input type="radio" name="resumeMode" checked={resumeMode === 'builder'} onChange={() => setResumeMode('builder')} className="mt-1 accent-[#1a4a38]" />
                                            <div><p className="font-bold text-content text-sm">Use my PESO Kabankalan resume</p><p className="text-xs text-muted">The resume you created in the Resume Assistant — we'll attach it as a PDF.</p></div>
                                        </label>
                                    )}
                                    <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${resumeMode === 'upload' ? 'border-accent bg-accent/5' : 'border-line hover:bg-sunken/50'}`}>
                                        <input type="radio" name="resumeMode" checked={resumeMode === 'upload'} onChange={() => setResumeMode('upload')} className="mt-1 accent-[#1a4a38]" />
                                        <div className="flex-1">
                                            <p className="font-bold text-content text-sm">Upload a new resume (PDF)</p>
                                            <p className="text-xs text-muted mb-2">We'll attach it and use it for AI matching.</p>
                                            <label className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-line rounded-lg text-xs font-black cursor-pointer hover:bg-sunken transition-colors text-content">
                                                <Upload size={14} /> Choose PDF
                                                <input type="file" accept="application/pdf" className="hidden" onChange={handleResumeFile} />
                                            </label>
                                            {resumeFile && <span className="ml-2 text-xs font-bold text-accent-text">{resumeFile.name}</span>}
                                        </div>
                                    </label>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-sm font-black text-content uppercase tracking-wide mb-1">
                                    Supporting Certificates <span className="text-subtle font-bold normal-case">(optional)</span>
                                </h3>
                                <p className="text-xs text-muted mb-3">
                                    Attach TESDA certifications, licences, training or seminar certificates. PDF, JPG, PNG, or WEBP — up to 5&nbsp;MB each, {CERT_MAX_COUNT} max.
                                </p>
                                {libraryCerts.length > 0 && (
                                    <div className="mb-3 space-y-1.5">
                                        <p className="text-[11px] font-bold uppercase tracking-wider text-subtle">From your library</p>
                                        {libraryCerts.map(lc => {
                                            const checked = selectedLibraryIds.includes(lc.id);
                                            return (
                                                <label key={lc.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line cursor-pointer hover:bg-sunken/50">
                                                    <input type="checkbox" checked={checked} onChange={() => setSelectedLibraryIds(prev => checked ? prev.filter(i => i !== lc.id) : [...prev, lc.id])} className="accent-[#1a4a38]" />
                                                    <span className="flex-1 min-w-0 text-xs font-semibold text-content truncate">{lc.title || lc.file_name}</span>
                                                    {lc.category && <span className="text-[10px] text-subtle shrink-0">{lc.category}</span>}
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                                <label className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-line rounded-lg text-xs font-black cursor-pointer hover:bg-sunken transition-colors text-content">
                                    <Upload size={14} /> Add certificates
                                    <input
                                        type="file"
                                        multiple
                                        accept="application/pdf,image/jpeg,image/png,image/webp"
                                        className="hidden"
                                        onChange={(e) => { addCertificateFiles(e.target.files); e.target.value = ''; }}
                                    />
                                </label>
                                {certificates.length > 0 && (
                                    <ul className="mt-3 space-y-2">
                                        {certificates.map((c, idx) => (
                                            <li key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sunken border border-line">
                                                <FileText size={15} className="text-accent-text shrink-0" />
                                                <span className="flex-1 min-w-0 text-xs font-semibold text-content truncate">{c.file_name}</span>
                                                <span className="text-[10px] text-subtle shrink-0">{(c.size / 1024).toFixed(0)} KB</span>
                                                <button type="button" onClick={() => removeCertificate(idx)} className="text-subtle hover:text-rose-500 shrink-0" aria-label={`Remove ${c.file_name}`}><X size={14} /></button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                            {questions.length === 0 ? (
                                <div className="py-12 text-center">
                                    <HelpCircle size={36} className="mx-auto text-subtle mb-3" />
                                    <p className="text-sm font-bold text-muted">No additional questions for this job.</p>
                                    <p className="text-xs text-muted mt-1">You're all set — submit your application.</p>
                                </div>
                            ) : (
                                questions.map((q, idx) => (
                                    <div key={q.id}>
                                        <label className="block text-sm font-bold text-content mb-2">
                                            {idx + 1}. {q.question_text} {q.is_required && <span className="text-rose-500">*</span>}
                                        </label>
                                        {q.question_type === 'textarea' ? (
                                            <textarea value={answers[q.id] ?? ''} onChange={(e) => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} className={`${inputClass} min-h-[100px]`} />
                                        ) : q.question_type === 'boolean' ? (
                                            <div className="flex gap-3">
                                                {['Yes', 'No'].map(opt => (
                                                    <button key={opt} type="button" onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))} className={`px-5 py-2.5 rounded-xl font-bold text-sm border transition-colors ${answers[q.id] === opt ? 'bg-accent text-accent-contrast border-accent' : 'bg-surface border-line text-content'}`}>{opt}</button>
                                                ))}
                                            </div>
                                        ) : q.question_type === 'select' ? (
                                            <select value={answers[q.id] ?? ''} onChange={(e) => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} className={inputClass}>
                                                <option value="">Select…</option>
                                                {(q.options || []).map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
                                            </select>
                                        ) : (
                                            <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} className={inputClass} />
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-line flex items-center justify-between gap-3 bg-sunken/60">
                    <button
                        onClick={() => (step === 1 ? onClose() : setStep(s => s - 1))}
                        disabled={submitting}
                        className="px-5 py-3 font-bold text-muted bg-surface border border-line rounded-xl hover:bg-line transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        <ChevronLeft size={16} /> {step === 1 ? 'Cancel' : 'Back'}
                    </button>

                    {step < 3 ? (
                        <button onClick={goNext} disabled={loading} className="px-6 py-3 font-black text-white bg-accent hover:bg-accent-hover rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50">
                            Continue <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button onClick={handleSubmit} disabled={submitting} className="px-6 py-3 font-black text-accent-contrast bg-accent hover:bg-accent-hover rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50">
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} Submit Application
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ApplyWizard;
