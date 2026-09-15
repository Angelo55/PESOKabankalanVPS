import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from 'docx';
import { triggerDownload } from './LivePreview';

// Unified Document Builder — DOCX export from the SAME structured draft the react-pdf
// templates render. DOCX can't share the exact react-pdf layout, so it's a parallel
// renderer off one data model: "clean and correct," not pixel-identical to the PDF
// (industry-normal). Fully client-side, like the PDF export.

const ACCENT = '134E48';
const GREY = '52606D';

const skillList = (skills) => String(skills || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const bullets = (description) => {
	const raw = String(description || '').trim();
	if (!raw) return [];
	let items = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (items.length === 1) items = items[0].split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
	return items;
};
const paragraphsOf = (body) => {
	const raw = String(body || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return [];
	if (/\n\s*\n/.test(raw)) return raw.split(/\n\s*\n/).map((p) => p.replace(/\n+/g, ' ').trim()).filter(Boolean);
	return raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
};
const fmtDate = (v) => {
	const d = v ? new Date(v) : new Date();
	return (Number.isNaN(d.getTime()) ? new Date() : d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const RULE = { border: { bottom: { color: ACCENT, space: 1, style: BorderStyle.SINGLE, size: 12 } } };
const sectionHeading = (text) => new Paragraph({
	spacing: { before: 220, after: 80 },
	border: { bottom: { color: 'D3DBE2', space: 1, style: BorderStyle.SINGLE, size: 6 } },
	children: [new TextRun({ text: text.toUpperCase(), bold: true, color: ACCENT, size: 21, characterSpacing: 20 })],
});

// ── Résumé ─────────────────────────────────────────────────────────────────────
function resumeChildren(data) {
	const p = data.personal || {};
	const out = [];
	out.push(new Paragraph({ children: [new TextRun({ text: (p.name || 'Your Name').toUpperCase(), bold: true, size: 40 })] }));
	const contact = [p.email, p.phone, p.location].filter(Boolean).join('   |   ');
	if (contact) out.push(new Paragraph({ children: [new TextRun({ text: contact, color: GREY, size: 19 })] }));
	out.push(new Paragraph({ ...RULE, spacing: { after: 60 }, children: [] }));

	if (p.summary) { out.push(sectionHeading('Professional Summary')); out.push(new Paragraph({ children: [new TextRun({ text: p.summary, size: 21 })] })); }

	const exp = Array.isArray(data.experience) ? data.experience : [];
	if (exp.length) {
		out.push(sectionHeading('Professional Experience'));
		exp.forEach((e) => {
			out.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: e.role || '', bold: true, size: 22 }), ...(e.dates ? [new TextRun({ text: `    ${e.dates}`, color: GREY, size: 19 })] : [])] }));
			if (e.company) out.push(new Paragraph({ children: [new TextRun({ text: e.company, italics: true, color: ACCENT, size: 20 })] }));
			bullets(e.description).forEach((b) => out.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 20 })] })));
		});
	}

	const edu = Array.isArray(data.education) ? data.education : [];
	if (edu.length) {
		out.push(sectionHeading('Education'));
		edu.forEach((e) => {
			out.push(new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: e.degree || '', bold: true, size: 22 }), ...(e.year ? [new TextRun({ text: `    ${e.year}`, color: GREY, size: 19 })] : [])] }));
			if (e.school) out.push(new Paragraph({ children: [new TextRun({ text: e.school, italics: true, color: GREY, size: 20 })] }));
		});
	}

	const skills = skillList(data.skills);
	if (skills.length) { out.push(sectionHeading('Skills & Competencies')); out.push(new Paragraph({ children: [new TextRun({ text: skills.join('   •   '), size: 20 })] })); }
	return out;
}

// ── Letters (cover / resignation) ────────────────────────────────────────────────
function letterChildren(letter) {
	const out = [];
	out.push(new Paragraph({ children: [new TextRun({ text: letter.senderName || '', bold: true, size: 28 })] }));
	const contacts = (letter.senderContacts || []).filter(Boolean);
	if (contacts.length) out.push(new Paragraph({ children: [new TextRun({ text: contacts.join('   |   '), color: GREY, size: 20 })] }));
	out.push(new Paragraph({ ...RULE, spacing: { after: 160 }, children: [] }));
	out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: letter.date, color: GREY, size: 21 })] }));
	(letter.recipientLines || []).filter(Boolean).forEach((line) => out.push(new Paragraph({ children: [new TextRun({ text: line, size: 21 })] })));
	if (letter.subject) out.push(new Paragraph({ spacing: { before: 160, after: 160 }, children: [new TextRun({ text: letter.subject, bold: true, size: 21 })] }));
	if (letter.salutation) out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: letter.salutation, size: 22 })] }));
	const paras = letter.bodyParas || [];
	if (!paras.length) out.push(new Paragraph({ children: [new TextRun({ text: '(No letter content yet.)', italics: true, color: GREY, size: 22 })] }));
	paras.forEach((p) => out.push(new Paragraph({ spacing: { after: 160 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: p, size: 22 })] })));
	out.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: letter.closing || 'Sincerely,', size: 22 })] }));
	out.push(new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: letter.signatureName || letter.senderName || '', bold: true, size: 22 })] }));
	return out;
}

const coverToLetter = (d) => {
	const a = d.applicant || {}, t = d.target || {};
	return { senderName: a.name || 'Applicant', senderContacts: [a.email, a.phone, a.location], date: fmtDate(), recipientLines: [t.hiringManager, t.department, t.company], subject: t.position ? `RE: Application for the ${t.position} position` : null, salutation: `Dear ${t.hiringManager || 'Hiring Manager'},`, bodyParas: paragraphsOf(d.body), closing: 'Sincerely,', signatureName: a.name || '' };
};
const resignToLetter = (d) => {
	const e = d.employee || {}, m = d.employment || {}, det = d.details || {};
	return { senderName: e.name || 'Employee', senderContacts: [e.email, e.phone], date: fmtDate(det.date), recipientLines: [m.managerName, m.company], subject: `RE: Letter of Resignation${m.position ? ` — ${m.position}` : ''}`, salutation: `Dear ${m.managerName || 'Manager'},`, bodyParas: paragraphsOf(d.body), closing: 'Sincerely,', signatureName: e.name || '' };
};

function buildChildren(docType, data) {
	if (docType === 'resume') return resumeChildren(data);
	if (docType === 'cover-letter') return letterChildren(coverToLetter(data));
	if (docType === 'resignation') return letterChildren(resignToLetter(data));
	return [];
}

// A4 vs US Letter in twips (1/1440 inch).
const PAGE = { a4: { width: 11906, height: 16838 }, letter: { width: 12240, height: 15840 } };

export async function exportDocx(docType, data, filename, pageSize = 'A4') {
	const size = pageSize === 'letter' ? PAGE.letter : PAGE.a4;
	const doc = new Document({
		styles: { default: { document: { run: { font: 'Calibri' } } } },
		sections: [{ properties: { page: { size, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: buildChildren(docType, data) }],
	});
	const blob = await Packer.toBlob(doc);
	triggerDownload(blob, filename.replace(/\.pdf$/i, '.docx'));
}
