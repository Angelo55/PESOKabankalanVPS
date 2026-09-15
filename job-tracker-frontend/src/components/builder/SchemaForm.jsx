import React from 'react';
import { Plus, Trash2, Sparkles, Loader2, RefreshCw, Check, X, User, Wand2 } from 'lucide-react';
import API from '../../api';
import { getPath, setPath } from './documentSchemas';

// Unified Document Builder — renders the editable form from a document schema. One
// implementation serves all three doc types (resume/cover/resignation): group sections,
// repeater sections (experience/education), a photo control (résumé), and inline AI
// (a per-field "Improve" with accept/redo/discard, and a section-level "Generate").

const input = 'w-full p-2.5 rounded-lg text-sm bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/40 transition-all font-medium';

// Downscale + square-crop client-side (no server image lib) — small draft, crisp header.
const compressPhoto = (file, size = 320, quality = 0.82) => new Promise((resolve, reject) => {
	const reader = new FileReader();
	reader.onerror = () => reject(new Error('read failed'));
	reader.onload = () => {
		const img = new Image();
		img.onerror = () => reject(new Error('decode failed'));
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = size; canvas.height = size;
			const ctx = canvas.getContext('2d');
			const scale = Math.max(size / img.width, size / img.height);
			const w = img.width * scale, h = img.height * scale;
			ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
			resolve(canvas.toDataURL('image/jpeg', quality));
		};
		img.src = reader.result;
	};
	reader.readAsDataURL(file);
});

function Field({ field, value, onChange }) {
	const common = { 'aria-label': field.label, value: value || '', onChange: (e) => onChange(e.target.value) };
	if (field.type === 'textarea') {
		return <textarea {...common} placeholder={field.placeholder || field.label} className={`${input} ${field.big ? 'min-h-[180px]' : 'min-h-[84px]'} resize-y`} />;
	}
	if (field.type === 'select') {
		return (
			<select {...common} className={`${input} cursor-pointer`}>
				{(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
			</select>
		);
	}
	return <input type={field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : 'text'} {...common} placeholder={field.placeholder || field.label} className={input} />;
}

function PhotoControl({ data, setData, notify }) {
	const photo = data.personal?.photo || '';
	const setPhoto = (v) => setData((d) => setPath(d, 'personal.photo', v));
	const onSelect = async (e) => {
		const file = e.target.files?.[0]; e.target.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) return notify.warning('Invalid file', 'Choose a JPG or PNG image.');
		if (file.size > 10 * 1024 * 1024) return notify.warning('Too large', 'Choose an image under 10MB.');
		try { setPhoto(await compressPhoto(file)); } catch { notify.error('Photo error', 'Could not process that image.'); }
	};
	const useAccount = async () => {
		try {
			const res = await API.get('/profile');
			if (res.data?.avatar_url) { setPhoto(res.data.avatar_url); notify.success('Photo applied', 'Your account photo is on your resume.'); }
			else notify.info('No account photo', 'Upload one on your profile, or add one here.');
		} catch { notify.error('Error', 'Could not load your account photo.'); }
	};
	return (
		<div className="flex flex-col sm:flex-row items-center gap-5 mb-5 p-4 rounded-2xl bg-sunken/50 border border-line">
			<div className="w-20 h-20 shrink-0 rounded-full overflow-hidden border-2 border-surface shadow-sm bg-sunken flex items-center justify-center">
				{photo ? <img src={photo} alt="Resume" className="w-full h-full object-cover" /> : <User size={32} className="text-subtle" />}
			</div>
			<div className="flex-1 text-center sm:text-left">
				<p className="text-sm font-bold text-content">Profile Photo <span className="text-subtle font-medium">(optional)</span></p>
				<p className="text-xs text-muted mt-0.5 mb-3">Omit it for a strict ATS-only export.</p>
				<div className="flex flex-wrap gap-2 justify-center sm:justify-start">
					<label className="cursor-pointer px-3.5 py-2 bg-accent text-accent-contrast text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors flex items-center gap-1.5">
						<Plus size={14} /> {photo ? 'Replace' : 'Upload'}
						<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onSelect} />
					</label>
					<button type="button" onClick={useAccount} className="px-3.5 py-2 bg-surface border border-line text-muted text-xs font-bold rounded-lg hover:bg-sunken transition-colors">Use Account Photo</button>
					{photo ? <button type="button" onClick={() => setPhoto('')} className="px-3.5 py-2 text-rose-500 hover:bg-rose-500/10 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"><Trash2 size={14} /> Remove</button> : null}
				</div>
			</div>
		</div>
	);
}

function SuggestionReview({ ai }) {
	return (
		<div className="mt-3 p-4 rounded-2xl border-2 border-accent/30 bg-accent-soft/40 animate-in fade-in slide-in-from-top-2">
			<div className="flex items-center gap-2 mb-2"><Sparkles size={15} className="text-accent-text" /><h5 className="text-sm font-bold text-accent-text">AI suggestion</h5></div>
			<p className="text-sm text-content leading-relaxed whitespace-pre-wrap mb-3">{ai.suggestion.text}</p>
			<div className="flex flex-wrap gap-2">
				<button onClick={ai.acceptSuggestion} className="px-4 py-2 bg-accent text-accent-contrast text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors flex items-center gap-1.5"><Check size={14} /> Accept</button>
				<button onClick={() => ai.runField('improve')} disabled={ai.busy === 'improve'} className="px-4 py-2 bg-surface border border-line text-muted text-xs font-bold rounded-lg hover:bg-sunken transition-colors flex items-center gap-1.5"><RefreshCw size={14} className={ai.busy === 'improve' ? 'animate-spin' : ''} /> Redo</button>
				<button onClick={ai.discardSuggestion} className="px-4 py-2 text-muted text-xs font-bold rounded-lg hover:bg-sunken transition-colors flex items-center gap-1.5"><X size={14} /> Discard</button>
			</div>
		</div>
	);
}

export default function SchemaForm({ schema, data, setData, ai, notify, newItemId }) {
	const setFieldAt = (path) => (value) => setData((d) => setPath(d, path, value));
	const updateItem = (repeater, id, name, value) => setData((d) => ({ ...d, [repeater]: (d[repeater] || []).map((it) => (it.id === id ? { ...it, [name]: value } : it)) }));
	const addItem = (repeater, itemFields) => setData((d) => ({ ...d, [repeater]: [...(d[repeater] || []), { id: newItemId(repeater), ...Object.fromEntries(itemFields.map((f) => [f.name, ''])) }] }));
	const removeItem = (repeater, id) => setData((d) => ({ ...d, [repeater]: (d[repeater] || []).filter((it) => it.id !== id) }));

	return (
		<div className="space-y-7">
			{schema.sections.map((sec) => {
				const Icon = sec.icon;
				return (
					<section key={sec.id}>
						<div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
							<h3 className="text-base font-bold text-content flex items-center gap-2"><Icon size={18} className="text-accent-text" /> {sec.title}</h3>
							{sec.repeater ? (
								<button onClick={() => addItem(sec.repeater, sec.itemFields)} className="text-sm font-bold text-accent-text bg-accent-soft px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-accent/15 transition-colors"><Plus size={16} /> {sec.addLabel}</button>
							) : null}
							{sec.generate && ai.hasGenerate ? (
								<button onClick={() => ai.runField('generate')} disabled={ai.busy === 'generate'} className="text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-60">
									{ai.busy === 'generate' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} {ai.generateLabel}
								</button>
							) : null}
						</div>

						{sec.photo ? <PhotoControl data={data} setData={setData} notify={notify} /> : null}

						{sec.repeater ? (
							<div className="space-y-4">
								{(data[sec.repeater] || []).length === 0 ? <p className="text-muted text-sm italic">Nothing added yet.</p> : null}
								{(data[sec.repeater] || []).map((item) => (
									<div key={item.id} className="relative p-4 bg-surface border border-line rounded-2xl shadow-sm">
										<button onClick={() => removeItem(sec.repeater, item.id)} className="absolute top-3 right-3 text-subtle hover:text-rose-500 transition-colors" aria-label="Remove"><Trash2 size={18} /></button>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-8">
											{sec.itemFields.map((f) => (
												<div key={f.name} className={f.full ? 'md:col-span-2' : ''}>
													<Field field={f} value={item[f.name]} onChange={(v) => updateItem(sec.repeater, item.id, f.name, v)} />
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
								{sec.fields.map((f) => {
									const path = `${sec.path ? sec.path + '.' : ''}${f.name}`;
									const showReview = ai.suggestion && ai.suggestion.field === path;
									return (
										<div key={f.name} className={f.full ? 'md:col-span-2' : ''}>
											{f.ai === 'improve' && ai.hasImprove ? (
												<div className="flex items-center justify-between mb-1">
													<span className="text-xs font-bold text-muted pl-1">{f.label}</span>
													<button onClick={() => ai.runField('improve')} disabled={ai.busy === 'improve'} className="text-xs font-bold text-accent-text hover:underline flex items-center gap-1 disabled:opacity-50">
														{ai.busy === 'improve' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {ai.improveLabel}
													</button>
												</div>
											) : null}
											<Field field={f} value={getPath(data, path)} onChange={setFieldAt(path)} />
											{showReview ? <SuggestionReview ai={ai} /> : null}
										</div>
									);
								})}
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}
