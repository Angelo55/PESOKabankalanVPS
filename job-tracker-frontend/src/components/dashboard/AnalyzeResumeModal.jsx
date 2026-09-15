import React, { useState, useRef } from 'react';
import { FileText, UploadCloud, Cpu, CheckCircle2, AlertTriangle, Sparkles, Briefcase } from 'lucide-react';
import API from '../../api';
import ProcessingModal from '../dataflow/ProcessingModal';
import StepProgress from '../dataflow/StepProgress';

/**
 * AnalyzeResumeModal — the Phase-C résumé pipeline UI (docs/data-processing-modules-
 * proposal.md). Controlled workflow on the shared ProcessingModal:
 *   Select (PDF/DOCX ≤5MB) → Upload → Extract + AI Analyze (POST /profile/upload) →
 *   Review the extracted skills/experiences → Done (Unified Career Profile refreshed).
 *
 * The three artifacts stay distinct server-side: the original file is NOT stored
 * (parsed-text-only), the extracted text persists to uploaded_resumes (feeding AI
 * scoring), and the AI analysis persists to userprofiles. Props: open, onClose,
 * onAnalyzed (refresh callback).
 */
const MAX_BYTES = 5 * 1024 * 1024;
const isResumeFile = (f) => /\.(pdf|docx)$/i.test(f?.name || '') || f?.type === 'application/pdf' || String(f?.type || '').includes('wordprocessingml');

const AnalyzeResumeModal = ({ open, onClose, onAnalyzed }) => {
    const [step, setStep] = useState('select'); // select | analyzing | done | error
    const [file, setFile] = useState(null);
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    const busy = step === 'analyzing';

    const reset = () => { setStep('select'); setFile(null); setProfile(null); setError(''); if (inputRef.current) inputRef.current.value = ''; };
    const close = () => { if (busy) return; reset(); onClose?.(); };

    const onSelect = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!isResumeFile(f)) { setError('Please choose a PDF or DOCX file.'); setStep('error'); setFile(null); return; }
        if (f.size > MAX_BYTES) { setError('That file is over 5 MB. Please upload a smaller résumé.'); setStep('error'); setFile(null); return; }
        setError(''); setFile(f); setStep('select');
    };

    const submit = async () => {
        if (!file || busy) return;
        setStep('analyzing'); setError('');
        try {
            const fd = new FormData();
            fd.append('resume', file);
            const res = await API.post('/profile/upload', fd);
            setProfile(res.data?.profile || null);
            setStep('done');
            onAnalyzed?.();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not analyze that résumé.');
            setStep('error');
        }
    };

    const history = profile?.canonical_history || [];
    const skills = history[0]?.hrflow_explicit_data?.skills || [];
    const experiences = history.map((h) => ({ title: h.job_title, company: h?.hrflow_explicit_data?.company })).filter((e) => e.title || e.company);

    return (
        <ProcessingModal
            open={open}
            onClose={close}
            title="AI Resume Analysis"
            icon={<FileText size={24} />}
            iconWrapClass="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
            busy={busy}
            size="lg"
        >
            {step === 'analyzing' && (
                <StepProgress icon={<Cpu className="w-16 h-16 text-indigo-500" />} title="Reading &amp; analyzing…" subtitle="Extracting your career history and skills" barClass="bg-indigo-500" />
            )}

            {(step === 'select' || step === 'error') && (
                <>
                    <p className="text-muted text-sm mb-5 font-medium leading-relaxed">
                        Share your résumé (<b>PDF</b> or <b>DOCX</b>, max 5&nbsp;MB). Our AI reads it, extracts your
                        career history and skills, and builds your Unified Career Profile. Your file isn't stored —
                        only the extracted text and insights are kept.
                    </p>
                    {error && (
                        <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                            <AlertTriangle size={16} className="shrink-0" /> {error}
                        </div>
                    )}
                    <div
                        onClick={() => inputRef.current?.click()}
                        className={`border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${file ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20' : 'border-line bg-sunken/50 hover:bg-sunken/70'}`}
                    >
                        <input type="file" accept=".pdf,.docx" className="hidden" ref={inputRef} onChange={onSelect} />
                        <UploadCloud size={48} className={file ? 'text-indigo-500 mb-4' : 'text-subtle mb-4'} />
                        {file ? (
                            <div>
                                <p className="text-indigo-700 dark:text-indigo-400 font-bold">{file.name}</p>
                                <p className="text-xs mt-1 text-indigo-600/70 dark:text-indigo-500/70">{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-muted font-bold">Click to browse or drag file here</p>
                                <p className="text-xs mt-1 text-subtle">.pdf or .docx</p>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-3 mt-6">
                        <button onClick={close} className="flex-1 py-3.5 bg-sunken hover:bg-line text-muted font-bold rounded-xl transition-colors">Cancel</button>
                        <button onClick={submit} disabled={!file} className="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 flex items-center justify-center gap-2">
                            <Sparkles size={16} /> Analyze
                        </button>
                    </div>
                </>
            )}

            {step === 'done' && (
                <div className="py-2">
                    <div className="text-center mb-5">
                        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
                        <h3 className="text-2xl font-black text-content">Profile updated</h3>
                        <p className="text-muted font-medium text-sm mt-1">Here's what we read from your résumé.</p>
                    </div>
                    {skills.length > 0 && (
                        <div className="mb-4">
                            <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-2">Skills</p>
                            <div className="flex flex-wrap gap-2">
                                {skills.slice(0, 20).map((s, i) => (
                                    <span key={i} className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">{s}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {experiences.length > 0 && (
                        <div className="mb-5">
                            <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-2">Experience</p>
                            <div className="rounded-xl border border-line divide-y divide-line max-h-40 overflow-y-auto">
                                {experiences.slice(0, 10).map((e, i) => (
                                    <div key={i} className="px-4 py-2 flex items-center gap-2 text-sm">
                                        <Briefcase size={14} className="text-subtle shrink-0" />
                                        <span className="font-bold text-content truncate">{e.title || '—'}</span>
                                        <span className="text-muted truncate">· {e.company || '—'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {skills.length === 0 && experiences.length === 0 && (
                        <p className="text-sm text-muted text-center mb-5">Your profile was refreshed. Open your Unified Career Profile to review it.</p>
                    )}
                    <button onClick={close} className="w-full py-3 bg-accent text-accent-contrast font-bold rounded-xl">Done</button>
                </div>
            )}
        </ProcessingModal>
    );
};

export default AnalyzeResumeModal;
