import React from 'react';
import { Check, ShieldCheck, FileText } from 'lucide-react';
import { getTemplates } from './templates';

// Unified Document Builder — the Template Gallery. Reads the docType's template registry
// and shows a card per template (thumbnail placeholder, name, description, recommended use
// case, ATS-friendly badge, Modern/Professional category). Selecting one sets templateId
// and enters the editor. Reuses the app card system + design tokens (§10, §24).

// A lightweight layout hint (real static thumbnails are a Phase 4 polish item). It nods at
// the template family without the cost of rendering a live PDF per card.
function MiniPreview({ category }) {
	const modern = category === 'Modern';
	return (
		<div className="h-40 rounded-xl bg-white border border-line overflow-hidden p-3 flex flex-col gap-1.5">
			<div className={`h-3 rounded ${modern ? 'w-1/2 bg-accent' : 'w-2/3 bg-gray-800 self-center'}`} />
			<div className={`h-1 rounded bg-gray-300 ${modern ? 'w-1/3' : 'w-1/2 self-center'}`} />
			<div className="h-0.5 bg-accent/70 rounded my-1" />
			{[...Array(3)].map((_, i) => <div key={i} className="h-1 rounded bg-gray-200" style={{ width: `${90 - i * 12}%` }} />)}
			<div className="h-1 rounded bg-accent/40 w-1/4 mt-1" />
			{[...Array(2)].map((_, i) => <div key={i} className="h-1 rounded bg-gray-200" style={{ width: `${80 - i * 20}%` }} />)}
			{modern ? (
				<div className="flex gap-1 mt-auto">{[...Array(4)].map((_, i) => <div key={i} className="h-2.5 w-6 rounded bg-accent/20" />)}</div>
			) : (
				<div className="h-1 rounded bg-gray-200 w-full mt-auto" />
			)}
		</div>
	);
}

export default function TemplateGallery({ docType, title, selectedId, onSelect }) {
	const templates = getTemplates(docType);
	return (
		<div>
			<div className="mb-5">
				<h2 className="text-2xl sm:text-3xl font-black text-content tracking-tight flex items-center gap-2"><FileText size={26} className="text-accent-text" /> Choose a {title} Template</h2>
				<p className="text-sm font-medium text-muted mt-1">Pick a design — you can switch anytime while editing. Your content stays the same.</p>
			</div>

			<div className="grid gap-4 sm:gap-5 grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))]">
				{templates.map((t) => {
					const active = selectedId === t.id;
					return (
						<button
							key={t.id}
							onClick={() => onSelect(t.id)}
							className={`text-left rounded-3xl border p-4 bg-surface transition-all duration-300 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${active ? 'border-accent shadow-[0_10px_28px_rgba(15,23,42,0.10)]' : 'border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] hover:border-accent/40'}`}
						>
							<div className="relative">
								<MiniPreview category={t.category} />
								{active ? <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-accent text-accent-contrast flex items-center justify-center shadow"><Check size={16} /></span> : null}
							</div>
							<div className="flex items-center justify-between mt-3">
								<h3 className="text-base font-black text-content">{t.name}</h3>
								<span className="text-[11px] font-black uppercase tracking-wider text-accent-text bg-accent-soft px-2 py-0.5 rounded">{t.category}</span>
							</div>
							<p className="text-xs font-semibold text-muted mt-1 line-clamp-2">{t.description}</p>
							<p className="text-[11px] text-subtle mt-2 leading-relaxed"><span className="font-bold">Best for:</span> {t.useCase}</p>
							{t.atsFriendly ? <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1"><ShieldCheck size={13} /> ATS-friendly</p> : null}
						</button>
					);
				})}
			</div>
		</div>
	);
}
