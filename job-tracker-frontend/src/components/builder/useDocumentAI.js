import { useState, useCallback } from 'react';
import API from '../../api';
import { getPath, setPath } from './documentSchemas';

// Unified Document Builder — AI assistance, driven by schema.ai. Actions:
//   generate  — (cover letter) draft the body from context, applied directly.
//   improve   — refine a field; returns a SUGGESTION the editor shows as accept/redo/discard.
//   translate — translate the whole document, applied directly.
//   prefill   — (resume) import career history from the seeker's AI profile analysis.
// Every action degrades gracefully (invariant 0.1/0.2): a failure notifies and leaves the
// draft untouched. The underlying endpoints are the SAME ones the legacy builders used.

const LANG_MAP = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', zh: 'Mandarin' };

function cleanAiText(raw) {
	let t = String(raw || '').replace(/^["']|["']$/g, '').trim();
	t = t.replace(/^(here is|here's|sure|certainly|the optimized|optimized version|professional summary)[^:]*:?\s*/i, '');
	return t.trim();
}

export function useDocumentAI({ schema, data, setData, notify }) {
	const ai = schema.ai || {};
	const [busy, setBusy] = useState(null);
	const [suggestion, setSuggestion] = useState(null); // { field, text, original }

	const missing = (path) => {
		const v = getPath(data, path);
		return !v || (typeof v === 'string' && v.trim() === '');
	};

	const runField = useCallback(async (actionKey) => {
		const action = ai[actionKey];
		if (!action) return;
		if (action.requires && missing(action.requires)) {
			notify.warning('Missing info', `Please fill in the required field before using AI.`);
			return;
		}
		if (action.requires2 && missing(action.requires2)) {
			notify.warning('Missing info', 'Please fill in the company and position first.');
			return;
		}
		setBusy(actionKey);
		try {
			const res = await API.post(action.endpoint, action.build(data));
			const text = cleanAiText(action.pick(res));
			if (!text) throw new Error('The AI returned an empty result.');
			if (actionKey === 'generate') {
				setData((d) => setPath(d, action.apply, text));
				notify.success('Generated', 'AI draft added — edit it freely.');
			} else {
				setSuggestion({ field: action.apply, text, original: getPath(data, action.apply) || '' });
			}
		} catch (e) {
			notify.error('AI failed', e.response?.data?.message || e.message || 'Please try again.');
		} finally {
			setBusy(null);
		}
	}, [ai, data, setData, notify]);

	const acceptSuggestion = useCallback(() => {
		if (!suggestion) return;
		setData((d) => setPath(d, suggestion.field, suggestion.text));
		setSuggestion(null);
	}, [suggestion, setData]);

	const discardSuggestion = useCallback(() => setSuggestion(null), []);

	const translate = useCallback(async (lang) => {
		if (!ai.translate) return;
		if (!lang || lang === (data.language || 'en')) return;
		setBusy('translate');
		try {
			const res = await API.post(ai.translate.endpoint, ai.translate.build(data, LANG_MAP[lang] || 'English'));
			const translated = ai.translate.pick(res);
			if (translated && typeof translated === 'object') {
				setData((d) => ({ ...d, ...translated, templateId: d.templateId, language: lang }));
				notify.success('Translated', `Document translated to ${LANG_MAP[lang]}.`);
			} else {
				throw new Error('Translation returned no data.');
			}
		} catch (e) {
			notify.error('Translation failed', e.response?.data?.message || e.message);
		} finally {
			setBusy(null);
		}
	}, [ai, data, setData, notify]);

	// Résumé only: import career history from the seeker's AI profile analysis (the old
	// "Create with AI" path, now an explicit, optional in-editor button).
	const prefill = useCallback(async () => {
		if (ai.prefill !== 'resume-profile') return;
		setBusy('prefill');
		try {
			const res = await API.get('/profile');
			const raw = res.data?.ai_profile_data;
			if (!raw) { notify.info('No AI profile', 'Run “Analyze My Resume” on your profile first.'); return; }
			const aiData = JSON.parse(raw);
			const history = Array.isArray(aiData.canonical_history) ? aiData.canonical_history : [];
			const experience = history.map((job, idx) => ({
				id: `exp-${Date.now()}-${idx}`,
				role: job.job_title || '',
				company: job.hrflow_explicit_data?.company || '',
				dates: `${job.hrflow_explicit_data?.start_date || ''} - ${job.hrflow_explicit_data?.end_date || 'Present'}`,
				description: job.hrflow_explicit_data?.description || '',
			}));
			const skills = history[0]?.hrflow_explicit_data?.skills?.join(', ') || '';
			setData((d) => ({ ...d, experience: experience.length ? experience : d.experience, skills: skills || d.skills }));
			notify.success('Imported', 'Your AI profile history was added. Review and edit as needed.');
		} catch (e) {
			notify.error('Import failed', e.response?.data?.message || e.message);
		} finally {
			setBusy(null);
		}
	}, [ai, setData, notify]);

	return {
		busy, suggestion, runField, acceptSuggestion, discardSuggestion, translate, prefill,
		hasGenerate: !!ai.generate, hasImprove: !!ai.improve, hasTranslate: !!ai.translate, hasPrefill: ai.prefill === 'resume-profile',
		improveLabel: ai.improve?.label || 'Improve with AI', generateLabel: ai.generate?.label || 'Generate with AI',
		LANG_MAP,
	};
}
