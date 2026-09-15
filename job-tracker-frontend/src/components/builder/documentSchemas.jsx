// Unified Document Builder — schema definitions for the three Job Seeker documents.
// ONE framework, three data-driven definitions. Each schema describes: the empty draft,
// the form sections/fields (SchemaForm renders them), the draft endpoints, the AI actions,
// and the export (client react-pdf primary + the existing pdfkit endpoint as fallback).
//
// HARD CONSTRAINT (blueprint §12): the résumé draft shape + its /resume/draft contract are
// UNCHANGED — including the `rescore` flag computed from `aiSignature` (§18.5). Templates and
// preview render FROM this structured data; they never replace it. Do NOT move the résumé to
// freeform rich text or the AI compatibility scoring / ATS sync breaks.

import { User, Briefcase, GraduationCap, Sparkles, Edit3, FileText } from 'lucide-react';

const TONES_COVER = ['Professional and Confident', 'Formal and Traditional', 'Enthusiastic and Friendly', 'Executive and Direct'];
const TONES_RESIGN = ['Professional & Grateful', 'Direct & Formal', 'Warm & Personal', 'Immediate Departure'];

// ── RESUME ────────────────────────────────────────────────────────────────────
const resume = {
	key: 'resume',
	title: 'Resume',
	docLabel: 'resume',
	route: '/builder',
	defaultTemplateId: 'modern',
	emptyState: (user) => ({
		personal: { name: user?.name || '', email: user?.email || '', phone: '', location: '', summary: '', photo: '' },
		experience: [],
		education: [],
		skills: '',
		templateId: 'modern',
		language: 'en',
	}),
	// The AI-relevant fingerprint (§18.5): only the fields the scorer reads. A change here
	// asks the backend to re-score; a cosmetic-only change (template/photo/contact/language)
	// persists WITHOUT re-scoring. Missing/undefined ⇒ default-true (never swallow a real change).
	aiSignature: (d) => JSON.stringify({
		summary: d?.personal?.summary || '',
		experience: (d?.experience || []).map((e) => ({ role: e.role || '', company: e.company || '', dates: e.dates || '', description: e.description || '' })),
		education: (d?.education || []).map((e) => ({ degree: e.degree || '', school: e.school || '', year: e.year || '' })),
		skills: d?.skills || '',
	}),
	draft: { loadPath: '/resume/draft', savePath: '/resume/draft', payloadKey: 'resumeData' },
	sections: [
		{ id: 'personal', title: 'Personal Details', icon: User, path: 'personal', photo: true, fields: [
			{ name: 'name', label: 'Full Name', type: 'text' },
			{ name: 'email', label: 'Email Address', type: 'email' },
			{ name: 'phone', label: 'Phone Number', type: 'text' },
			{ name: 'location', label: 'Location', type: 'text', placeholder: 'e.g., Kabankalan City' },
			{ name: 'summary', label: 'Professional Summary', type: 'textarea', full: true, ai: 'improve' },
		] },
		{ id: 'experience', title: 'Work Experience', icon: Briefcase, repeater: 'experience', addLabel: 'Add Position', itemFields: [
			{ name: 'role', label: 'Job Title', type: 'text' },
			{ name: 'company', label: 'Company Name', type: 'text' },
			{ name: 'dates', label: 'Dates', type: 'text', full: true, placeholder: 'e.g., Jan 2020 - Present' },
			{ name: 'description', label: 'Description / Achievements', type: 'textarea', full: true },
		] },
		{ id: 'education', title: 'Education', icon: GraduationCap, repeater: 'education', addLabel: 'Add Degree', itemFields: [
			{ name: 'degree', label: 'Degree / Certification', type: 'text', full: true },
			{ name: 'school', label: 'School / Institution', type: 'text' },
			{ name: 'year', label: 'Graduation Year', type: 'text' },
		] },
		{ id: 'skills', title: 'Skills & Certifications', icon: Sparkles, path: '', fields: [
			{ name: 'skills', label: 'Skills', type: 'textarea', full: true, placeholder: 'List your skills, certifications, and core technologies (comma-separated)…' },
		] },
	],
	ai: {
		improve: { endpoint: '/resume/optimize', label: 'Improve Summary with AI', build: (d) => ({ section: 'Professional Summary', rawText: d?.personal?.summary || '' }), apply: 'personal.summary', pick: (res) => res?.data?.optimizedText, requires: 'personal.summary' },
		translate: { endpoint: '/resume/translate', build: (d, lang) => ({ resumeData: d, targetLanguage: lang }), pick: (res) => res?.data?.translatedData },
		prefill: 'resume-profile',
	},
	export: { filename: (d) => `${(d?.personal?.name || 'My').replace(/[^a-z0-9]/gi, '_')}_Resume.pdf`, fallback: { endpoint: '/resume/generate', payloadKey: 'resumeData' } },
};

// ── COVER LETTER ──────────────────────────────────────────────────────────────
const coverLetter = {
	key: 'cover-letter',
	title: 'Cover Letter',
	docLabel: 'cover letter',
	route: '/cover-letter',
	defaultTemplateId: 'modern',
	emptyState: (user) => ({
		applicant: { name: user?.name || '', email: user?.email || '', phone: '', location: '' },
		target: { company: '', hiringManager: 'Hiring Manager', position: '', department: '' },
		context: { whyInterested: '', experienceSummary: '', tone: TONES_COVER[0] },
		body: '',
		templateId: 'modern',
		language: 'en',
	}),
	draft: { loadPath: '/cover-letter/draft', savePath: '/cover-letter/draft', payloadKey: 'letterData' },
	sections: [
		{ id: 'applicant', title: 'Applicant Information', icon: User, path: 'applicant', fields: [
			{ name: 'name', label: 'Full Name', type: 'text' },
			{ name: 'email', label: 'Email Address', type: 'email' },
			{ name: 'phone', label: 'Phone Number', type: 'text' },
			{ name: 'location', label: 'Location', type: 'text' },
		] },
		{ id: 'target', title: 'Target Position', icon: Briefcase, path: 'target', fields: [
			{ name: 'company', label: 'Target Company', type: 'text' },
			{ name: 'position', label: 'Position / Job Title', type: 'text' },
			{ name: 'hiringManager', label: 'Hiring Manager (optional)', type: 'text' },
			{ name: 'department', label: 'Department (optional)', type: 'text' },
		] },
		{ id: 'context', title: 'AI Generation Context', icon: Edit3, path: 'context', fields: [
			{ name: 'whyInterested', label: 'Why this role & company?', type: 'textarea', full: true },
			{ name: 'experienceSummary', label: 'Most relevant experience', type: 'textarea', full: true },
			{ name: 'tone', label: 'Tone', type: 'select', options: TONES_COVER },
		] },
		{ id: 'body', title: 'Cover Letter Body', icon: FileText, path: '', generate: 'generate', fields: [
			{ name: 'body', label: 'Body', type: 'textarea', full: true, big: true, placeholder: 'Generate with AI, or write it here — the preview updates as you type.' },
		] },
	],
	ai: {
		generate: { endpoint: '/cover-letter/generate-body', label: 'Generate Body with AI', build: (d) => ({ data: d }), apply: 'body', pick: (res) => res?.data?.generatedText, requires: 'target.company', requires2: 'target.position' },
		improve: { endpoint: '/cover-letter/generate-body', label: 'Refine Body with AI', build: (d) => ({ data: { ...d, context: { ...(d.context || {}), experienceSummary: `Refine this exact draft: ${d.body || ''}` } } }), apply: 'body', pick: (res) => res?.data?.generatedText, requires: 'body' },
		translate: { endpoint: '/cover-letter/translate', build: (d, lang) => ({ letterData: d, targetLanguage: lang }), pick: (res) => res?.data?.translatedData },
	},
	export: { filename: (d) => `${(d?.applicant?.name || 'Cover').replace(/[^a-z0-9]/gi, '_')}_Letter.pdf`, fallback: { endpoint: '/cover-letter/generate-pdf', payloadKey: 'letterData' } },
};

// ── RESIGNATION LETTER ────────────────────────────────────────────────────────
const resignation = {
	key: 'resignation',
	title: 'Resignation Letter',
	docLabel: 'resignation letter',
	route: '/resignation-builder',
	defaultTemplateId: 'modern',
	emptyState: (user) => ({
		employee: { name: user?.name || '', email: user?.email || '', phone: '' },
		employment: { company: '', position: '', managerName: '' },
		details: { date: new Date().toISOString().split('T')[0], lastDay: '', reason: '', tone: TONES_RESIGN[0] },
		body: '',
		templateId: 'modern',
		language: 'en',
	}),
	draft: { loadPath: '/resignation/draft', savePath: '/resignation/draft', payloadKey: 'letterData' },
	sections: [
		{ id: 'employee', title: 'Employee Details', icon: User, path: 'employee', fields: [
			{ name: 'name', label: 'Full Name', type: 'text' },
			{ name: 'email', label: 'Email Address', type: 'email' },
			{ name: 'phone', label: 'Phone Number', type: 'text' },
		] },
		{ id: 'employment', title: 'Employment Details', icon: Briefcase, path: 'employment', fields: [
			{ name: 'company', label: 'Company Name', type: 'text' },
			{ name: 'position', label: 'Your Position', type: 'text' },
			{ name: 'managerName', label: "Manager's Name", type: 'text' },
		] },
		{ id: 'details', title: 'Context & Tone', icon: Edit3, path: 'details', fields: [
			{ name: 'date', label: 'Letter Date', type: 'date' },
			{ name: 'lastDay', label: 'Last Day of Work', type: 'date' },
			{ name: 'tone', label: 'Target Tone', type: 'select', options: TONES_RESIGN },
			{ name: 'reason', label: 'Reason for leaving (optional)', type: 'textarea', full: true, placeholder: 'e.g., accepted a new opportunity, relocating, career change — helps the AI tailor the letter.' },
		] },
		{ id: 'body', title: 'Letter Body', icon: FileText, path: '', generate: 'generate', fields: [
			{ name: 'body', label: 'Letter Body Draft', type: 'textarea', full: true, big: true, placeholder: 'Generate with AI, or write a rough draft — AI can refine it, and the preview updates as you type.' },
		] },
	],
	ai: {
		generate: { endpoint: '/resignation/generate-body', label: 'Generate Body with AI', build: (d) => ({ data: d }), apply: 'body', pick: (res) => res?.data?.generatedText, requires: 'employment.company', requires2: 'employment.position' },
		improve: { endpoint: '/resignation/optimize', label: 'Refine Letter with AI', build: (d) => ({ rawText: d?.body || '', details: { position: d?.employment?.position, company: d?.employment?.company, lastDay: d?.details?.lastDay, reason: d?.details?.reason, tone: d?.details?.tone } }), apply: 'body', pick: (res) => res?.data?.optimizedText, requires: 'body' },
		translate: { endpoint: '/resignation/translate', build: (d, lang) => ({ letterData: d, targetLanguage: lang }), pick: (res) => res?.data?.translatedData },
	},
	export: { filename: (d) => `${(d?.employee?.name || 'My').replace(/[^a-z0-9]/gi, '_')}_Resignation.pdf`, fallback: { endpoint: '/resignation/generate', payloadKey: 'letterData' } },
};

export const DOCUMENT_SCHEMAS = { resume, 'cover-letter': coverLetter, resignation };
export const getSchema = (docType) => DOCUMENT_SCHEMAS[docType] || DOCUMENT_SCHEMAS.resume;

// ── tiny path helpers (get/set a value by dotted path; '' = root) ───────────────
export function getPath(obj, path) {
	if (!path) return obj;
	return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
	if (!path) return { ...obj, ...value };
	const keys = path.split('.');
	const next = { ...obj };
	let cur = next;
	for (let i = 0; i < keys.length - 1; i++) {
		cur[keys[i]] = { ...(cur[keys[i]] || {}) };
		cur = cur[keys[i]];
	}
	cur[keys[keys.length - 1]] = value;
	return next;
}
