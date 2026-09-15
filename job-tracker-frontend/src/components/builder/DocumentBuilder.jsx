import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, CheckCircle, LayoutTemplate, Download, FileType2, Globe, Sparkles, FileText, Eye, PencilLine } from 'lucide-react';
import { useNotification } from '../../context/NotificationContext';
import { getSchema } from './documentSchemas';
import { useDocumentDraft } from './useDocumentDraft';
import { useDocumentAI } from './useDocumentAI';
import SchemaForm from './SchemaForm';
import TemplateGallery from './TemplateGallery';
import LivePreview, { exportPdf } from './LivePreview';
import { exportDocx } from './docxExport';

// Unified Document Builder — ONE shell for résumé, cover letter, and resignation letter.
// Flow: Template Gallery → editor (structured forms + live A4 preview) with AI woven in
// (prefill / generate / improve / translate) → export PDF (client react-pdf). Replaces the
// three near-duplicate wizards and the AI/Manual intermediate modal (blueprint §5).

export default function DocumentBuilder({ docType, user }) {
	const schema = getSchema(docType);
	const navigate = useNavigate();
	const { notify, confirm } = useNotification();

	const { data, setData, isLoaded, isSaving, savedAt, flush, wipe, newItemId } = useDocumentDraft({ schema, user });
	const ai = useDocumentAI({ schema, data, setData, notify });

	const [view, setView] = useState('gallery'); // 'gallery' | 'editor'
	const [mobilePane, setMobilePane] = useState('edit'); // 'edit' | 'preview'
	const [exporting, setExporting] = useState(null); // 'pdf' | 'docx' | null
	const [pageSize, setPageSize] = useState('A4'); // 'A4' | 'letter' — per-export, not persisted

	const templateId = data.templateId || schema.defaultTemplateId;

	const chooseTemplate = (id) => { setData((d) => ({ ...d, templateId: id })); setView('editor'); };

	const doExport = async (format) => {
		setExporting(format);
		try {
			await flush(); // persist the latest content first (no-op if unchanged)
			const filename = schema.export.filename(data);
			if (format === 'docx') { await exportDocx(docType, data, filename, pageSize); notify.success('Exported', `Your ${schema.docLabel} was downloaded as a Word document.`); }
			else { await exportPdf(docType, templateId, data, filename, pageSize); notify.success('Exported', `Your ${schema.docLabel} was downloaded as a PDF.`); }
		} catch (e) {
			notify.error('Export failed', e.message || 'Could not generate the file.');
		} finally {
			setExporting(null);
		}
	};

	const handleWipe = async () => {
		if (!(await confirm('Clear Draft?', `This resets your ${schema.docLabel}. Continue?`))) return;
		await wipe();
		notify.success('Cleared', 'Your draft has been reset.');
	};

	if (!isLoaded) {
		return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;
	}

	// ── Gallery step ──────────────────────────────────────────────────────────────
	if (view === 'gallery') {
		return (
			<div className="p-3 sm:p-5 lg:p-6 max-w-7xl mx-auto">
				<button onClick={() => navigate('/')} className="flex items-center gap-2 text-sm font-bold text-muted hover:text-accent-text transition-colors mb-4 group">
					<ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Dashboard
				</button>
				<TemplateGallery docType={docType} title={schema.title} selectedId={templateId} onSelect={chooseTemplate} />
			</div>
		);
	}

	// ── Editor step ─────────────────────────────────────────────────────────────
	return (
		<div className="p-3 sm:p-5 lg:p-6 max-w-7xl mx-auto">
			{/* Header */}
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
				<div>
					<button onClick={() => navigate('/')} className="flex items-center gap-2 text-sm font-bold text-muted hover:text-accent-text transition-colors mb-3 group">
						<ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Dashboard
					</button>
					<h2 className="text-2xl sm:text-3xl font-black text-content tracking-tight flex items-center gap-2"><FileText size={26} className="text-accent-text" /> {schema.title} Builder</h2>
				</div>
				<div className="flex items-center gap-2 flex-wrap">
					<span className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-line rounded-xl text-sm font-bold text-content">
						{isSaving ? <Loader2 size={15} className="animate-spin" /> : savedAt ? <CheckCircle size={15} className="text-emerald-500" /> : <Save size={15} className="text-subtle" />}
						{isSaving ? 'Saving…' : savedAt ? 'Saved' : 'Auto-save on'}
					</span>
					<button onClick={() => setView('gallery')} className="px-3 py-2 bg-surface border border-line text-content text-sm font-bold rounded-xl hover:bg-sunken transition-colors flex items-center gap-1.5"><LayoutTemplate size={15} /> Change Template</button>
					<button onClick={handleWipe} className="px-3 py-2 text-rose-500 text-sm font-bold rounded-xl hover:bg-rose-500/10 transition-colors">Clear</button>
				</div>
			</div>

			{/* AI + export toolbar */}
			<div className="flex items-center gap-2 flex-wrap mb-4 p-2.5 bg-surface/70 border border-line rounded-2xl">
				{ai.hasPrefill ? (
					<button onClick={ai.prefill} disabled={ai.busy === 'prefill'} className="px-3 py-2 text-sm font-bold text-accent-text bg-accent-soft rounded-xl hover:bg-accent/15 transition-colors flex items-center gap-1.5 disabled:opacity-60">
						{ai.busy === 'prefill' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Prefill from my profile
					</button>
				) : null}
				{ai.hasTranslate ? (
					<div className="flex items-center gap-1.5 px-2 py-1 bg-sunken rounded-xl">
						<Globe size={15} className="text-accent-text" />
						<select
							aria-label="Translate document"
							value={data.language || 'en'}
							onChange={(e) => ai.translate(e.target.value)}
							disabled={ai.busy === 'translate'}
							className="bg-transparent text-sm font-bold text-content outline-none cursor-pointer py-1"
						>
							{Object.entries(ai.LANG_MAP).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
						</select>
						{ai.busy === 'translate' ? <Loader2 size={14} className="animate-spin text-muted" /> : null}
					</div>
				) : null}
				<div className="flex items-center gap-1 px-1 py-1 bg-sunken rounded-xl" role="group" aria-label="Page size">
					{['A4', 'letter'].map((sz) => (
						<button key={sz} onClick={() => setPageSize(sz)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${pageSize === sz ? 'bg-accent text-accent-contrast' : 'text-muted hover:bg-surface'}`}>
							{sz === 'A4' ? 'A4' : 'Letter'}
						</button>
					))}
				</div>
				<div className="flex-1" />
				<button onClick={() => doExport('docx')} disabled={!!exporting} className="px-4 py-2.5 bg-surface border border-line text-content font-bold rounded-xl hover:bg-sunken transition-colors flex items-center gap-2 disabled:opacity-60">
					{exporting === 'docx' ? <Loader2 size={18} className="animate-spin" /> : <FileType2 size={18} />} DOCX
				</button>
				<button onClick={() => doExport('pdf')} disabled={!!exporting} className="px-5 py-2.5 bg-accent text-accent-contrast font-black rounded-xl hover:bg-accent-hover shadow-sm transition-colors flex items-center gap-2 disabled:opacity-60">
					{exporting === 'pdf' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />} Export PDF
				</button>
			</div>

			{/* Mobile pane switch */}
			<div className="lg:hidden flex gap-2 mb-3 p-1 bg-sunken rounded-xl">
				<button onClick={() => setMobilePane('edit')} className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${mobilePane === 'edit' ? 'bg-accent text-accent-contrast' : 'text-muted'}`}><PencilLine size={15} /> Edit</button>
				<button onClick={() => setMobilePane('preview')} className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${mobilePane === 'preview' ? 'bg-accent text-accent-contrast' : 'text-muted'}`}><Eye size={15} /> Preview</button>
			</div>

			<div className="grid lg:grid-cols-2 gap-5">
				<div className={`${mobilePane === 'edit' ? 'block' : 'hidden'} lg:block`}>
					<div className="bg-surface/70 border border-line rounded-2xl p-4 sm:p-6">
						<SchemaForm schema={schema} data={data} setData={setData} ai={ai} notify={notify} newItemId={newItemId} />
					</div>
				</div>
				<div className={`${mobilePane === 'preview' ? 'block' : 'hidden'} lg:block`}>
					<div className="lg:sticky lg:top-4 h-[70vh] lg:h-[calc(100vh-2rem)]">
						<LivePreview docType={docType} templateId={templateId} data={data} pageSize={pageSize} />
					</div>
				</div>
			</div>
		</div>
	);
}
