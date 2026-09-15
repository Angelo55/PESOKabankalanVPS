import React, { useState, useRef, useEffect } from 'react';
import { FileSpreadsheet, UploadCloud, ScanSearch, Database, CheckCircle2, AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react';
import API from '../../api';
import ProcessingModal from '../dataflow/ProcessingModal';
import StepProgress from '../dataflow/StepProgress';
import useUsage from '../../hooks/useUsage';
import UsageMeter from '../common/UsageMeter';

/**
 * ImportPastApplicationsModal — the Phase-B import pipeline UI (docs/data-processing-
 * modules-proposal.md). Multi-step, backend-authoritative:
 *   Select CSV/XLSX → Validate & Preview (POST /profile/import/preview) → Review summary
 *   (valid / duplicate / invalid, preview table) → Confirm (POST /profile/import/commit)
 *   → Import summary.
 *
 * The backend does the real validation/dedupe/limits; this modal is UX. A per-file
 * `import_id` makes the commit idempotent (guards double-submit / retry). Reuses the
 * shared ProcessingModal (backdrop-close guarded while busy) + StepProgress.
 *
 * Props: open, onClose, onImported (refresh callback after a successful commit).
 */
const genId = () => (globalThis.crypto?.randomUUID?.() || `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const Stat = ({ label, value, tone }) => {
    const tones = { emerald: 'text-emerald-600 dark:text-emerald-400', amber: 'text-amber-600 dark:text-amber-400', rose: 'text-rose-600 dark:text-rose-400' };
    return (
        <div className="p-3 rounded-xl bg-sunken/60 border border-line text-center">
            <p className={`text-2xl font-black tabular-nums ${tones[tone] || 'text-content'}`}>{value}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted mt-0.5">{label}</p>
        </div>
    );
};

const ImportPastApplicationsModal = ({ open, onClose, onImported }) => {
    const [step, setStep] = useState('select'); // select | previewing | review | committing | done | error
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const importId = useRef(null);
    const inputRef = useRef(null);

    // Live import allowance (imports today / total tracked) so the limit is visible
    // BEFORE the user tries to import — the same caps importService enforces.
    const usage = useUsage('seeker', { auto: false });
    useEffect(() => { if (open) usage.refresh(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    const importsDaily = usage.byKey('imports_daily');
    const trackedApps = usage.byKey('tracked_applications');

    const busy = step === 'previewing' || step === 'committing';

    const reset = () => {
        setStep('select'); setFile(null); setPreview(null); setResult(null); setError('');
        importId.current = null;
        if (inputRef.current) inputRef.current.value = '';
    };
    const close = () => { if (busy) return; reset(); onClose?.(); };

    const onSelect = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f); setError(''); setPreview(null); setStep('select');
        importId.current = genId();
    };

    const runPreview = async () => {
        if (!file || busy) return;
        setStep('previewing'); setError('');
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('import_id', importId.current);
            const res = await API.post('/profile/import/preview', fd);
            setPreview(res.data);
            setStep('review');
        } catch (err) {
            setError(err.response?.data?.message || 'Could not read that file.');
            setStep('error');
        }
    };

    const runCommit = async () => {
        if (busy || !preview) return;
        setStep('committing'); setError('');
        try {
            const res = await API.post('/profile/import/commit', {
                import_id: importId.current,
                file_name: file?.name,
                rows: preview.rows,
            });
            setResult(res.data);
            setStep('done');
            onImported?.();
            usage.refresh(); // reflect the just-consumed import + new tracked total
        } catch (err) {
            setError(err.response?.data?.message || 'Could not import the records.');
            setStep('error');
        }
    };

    return (
        <ProcessingModal
            open={open}
            onClose={close}
            title="Import Past Applications"
            icon={<FileSpreadsheet size={24} />}
            iconWrapClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            busy={busy}
            size="lg"
        >
            {step === 'previewing' && (
                <StepProgress icon={<ScanSearch className="w-16 h-16 text-emerald-500" />} title="Validating…" subtitle="Reading columns and checking for duplicates" barClass="bg-emerald-500" />
            )}
            {step === 'committing' && (
                <StepProgress icon={<Database className="w-16 h-16 text-emerald-500" />} title="Importing…" subtitle="Saving your applications" barClass="bg-emerald-500" />
            )}

            {(step === 'select' || step === 'error') && (
                <>
                    <p className="text-muted text-sm mb-4 font-medium leading-relaxed">
                        Upload a <b>.csv</b> or <b>.xlsx</b> of your past job applications. We auto-detect
                        <b> Company</b>, <b>Job Title</b>, <b>Date</b> and <b>Status</b>, skip duplicates, and
                        import only valid rows (max 2&nbsp;MB / 500 rows).
                    </p>
                    {(importsDaily || trackedApps) && (
                        <div className="mb-5 rounded-2xl border border-line bg-sunken/50 px-4 py-2 divide-y divide-line">
                            {importsDaily && <UsageMeter resource={importsDaily} compact />}
                            {trackedApps && <UsageMeter resource={trackedApps} compact />}
                        </div>
                    )}
                    {error && (
                        <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                            <AlertTriangle size={16} className="shrink-0" /> {error}
                        </div>
                    )}
                    <div
                        onClick={() => inputRef.current?.click()}
                        className={`border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${file ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/20' : 'border-line bg-sunken/50 hover:bg-sunken/70'}`}
                    >
                        <input type="file" accept=".xlsx,.csv" className="hidden" ref={inputRef} onChange={onSelect} />
                        <UploadCloud size={48} className={file ? 'text-emerald-500 mb-4' : 'text-subtle mb-4'} />
                        {file ? (
                            <div>
                                <p className="text-emerald-700 dark:text-emerald-400 font-bold">{file.name}</p>
                                <p className="text-xs mt-1 text-emerald-600/70 dark:text-emerald-500/70">{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-muted font-bold">Click to browse or drag file here</p>
                                <p className="text-xs mt-1 text-subtle">.xlsx or .csv</p>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-3 mt-6">
                        <button onClick={close} className="flex-1 py-3.5 bg-sunken hover:bg-line text-muted font-bold rounded-xl transition-colors">Cancel</button>
                        <button onClick={runPreview} disabled={!file} className="flex-1 py-3.5 bg-accent text-accent-contrast font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 flex items-center justify-center gap-2">
                            Validate &amp; Preview <ArrowRight size={16} />
                        </button>
                    </div>
                </>
            )}

            {step === 'review' && preview && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        <Stat label="Rows" value={preview.summary.totalRows} />
                        <Stat label="Will import" value={preview.summary.willImport} tone="emerald" />
                        <Stat label="Duplicates" value={preview.summary.duplicates} tone="amber" />
                        <Stat label="Invalid" value={preview.summary.invalid} tone="rose" />
                    </div>
                    {preview.summary.cappedOut > 0 && (
                        <p className="mb-3 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            {preview.summary.cappedOut} row(s) exceed your {preview.summary.capacity}-record limit and won't be imported.
                        </p>
                    )}
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-line divide-y divide-line mb-5">
                        {preview.rows.length === 0 ? (
                            <p className="p-4 text-sm text-muted">No new records to import — everything is already tracked or invalid.</p>
                        ) : (
                            preview.rows.slice(0, 100).map((r, i) => (
                                <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                                    <span className="font-bold text-content truncate flex-1">{r.job_title}</span>
                                    <span className="text-muted truncate flex-1">{r.company}</span>
                                    <span className="text-xs text-subtle shrink-0">{r.date_applied || '—'}</span>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={reset} className="flex-1 py-3.5 bg-sunken hover:bg-line text-muted font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                            <RotateCcw size={16} /> Choose another
                        </button>
                        <button onClick={runCommit} disabled={preview.summary.willImport === 0} className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0">
                            Import {preview.summary.willImport} record{preview.summary.willImport === 1 ? '' : 's'}
                        </button>
                    </div>
                </>
            )}

            {step === 'done' && result && (
                <div className="text-center py-8">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h3 className="text-2xl font-black text-content mb-1">
                        {result.alreadyImported ? 'Already imported' : `Imported ${result.imported} record${result.imported === 1 ? '' : 's'}`}
                    </h3>
                    <p className="text-muted font-medium">Your applications are now in your dashboard.</p>
                    <button onClick={close} className="mt-6 px-8 py-3 bg-accent text-accent-contrast font-bold rounded-xl">Done</button>
                </div>
            )}
        </ProcessingModal>
    );
};

export default ImportPastApplicationsModal;
