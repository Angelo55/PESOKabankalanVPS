import React, { useState, useEffect, useMemo } from 'react';
import { PDFViewer, pdf } from '@react-pdf/renderer';
import { Loader2 } from 'lucide-react';
import { getTemplate } from './templates';

// Unified Document Builder — the live WYSIWYG preview. Renders the selected react-pdf
// template with the current draft data; the SAME component tree exports the PDF, so the
// preview IS the export (no drift). Preview data is debounced so typing stays smooth.

export default function LivePreview({ docType, templateId, data, pageSize = 'A4' }) {
	const [previewData, setPreviewData] = useState(data);
	useEffect(() => {
		const t = setTimeout(() => setPreviewData(data), 250);
		return () => clearTimeout(t);
	}, [data]);

	const tpl = getTemplate(docType, templateId);
	const Component = tpl?.Component;
	// pageSize is threaded via a prop the templates read from data (kept simple: templates
	// default to A4; a US-Letter toggle re-renders with data.pageSize).
	const doc = useMemo(() => (Component ? <Component data={{ ...previewData, pageSize }} /> : null), [Component, previewData, pageSize]);

	if (!Component) return null;

	return (
		<div className="w-full h-full bg-[#5b6470] rounded-2xl overflow-hidden">
			<PDFViewer key={`${templateId}-${pageSize}`} showToolbar={false} style={{ width: '100%', height: '100%', border: 'none' }}>
				{doc}
			</PDFViewer>
		</div>
	);
}

// Export the current draft as a PDF using the SAME template component the preview renders.
export async function exportPdf(docType, templateId, data, filename, pageSize = 'A4') {
	const tpl = getTemplate(docType, templateId);
	if (!tpl) throw new Error('Template not found.');
	const blob = await pdf(<tpl.Component data={{ ...data, pageSize }} />).toBlob();
	triggerDownload(blob, filename);
}

export function triggerDownload(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export const PreviewSpinner = () => (
	<div className="w-full h-full flex items-center justify-center bg-[#5b6470] rounded-2xl">
		<Loader2 className="animate-spin text-white/80" size={32} />
	</div>
);
