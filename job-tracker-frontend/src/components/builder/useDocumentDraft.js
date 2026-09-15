import { useState, useEffect, useRef, useCallback } from 'react';
import API from '../../api';

// Unified Document Builder — draft load + change-driven autosave, generalized from the
// legacy ResumeBuilder. Only saves when content actually CHANGED, so opening the page,
// switching templates back and forth, tab-switching, or focus/blur write nothing.
//
// §12 / §18.5 CONTRACT (resume only): when the schema defines `aiSignature`, the save sends
// a `rescore` flag that is TRUE only when an AI-relevant field (summary/experience/education/
// skills) changed — a cosmetic-only edit (template/photo/contact/language) persists WITHOUT
// re-scoring. It DEFAULTS TO TRUE (a genuine content change is never swallowed). Non-resume
// docs have no aiSignature and never send the flag.

const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function ensureItemIds(data, schema) {
	let out = data;
	for (const sec of schema.sections) {
		if (!sec.repeater) continue;
		const arr = Array.isArray(out[sec.repeater]) ? out[sec.repeater] : [];
		out = { ...out, [sec.repeater]: arr.map((it) => (it && it.id ? it : { ...it, id: uid(sec.repeater) })) };
	}
	return out;
}

export function useDocumentDraft({ schema, user }) {
	const emptyState = useRef(schema.emptyState(user)).current;
	const [data, setData] = useState(emptyState);
	const [isLoaded, setIsLoaded] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [savedAt, setSavedAt] = useState(0);

	const lastFullSig = useRef(null);
	const lastAiSig = useRef(null);

	const fullSig = useCallback((d) => JSON.stringify(d), []);
	const aiSig = useCallback((d) => (schema.aiSignature ? schema.aiSignature(d) : ''), [schema]);

	// ── load ────────────────────────────────────────────────────────────────────
	useEffect(() => {
		let mounted = true;
		(async () => {
			let baseline = emptyState;
			try {
				const res = await API.get(schema.draft.loadPath);
				const loaded = res.data?.data;
				if (mounted && loaded && typeof loaded === 'object') {
					const merged = ensureItemIds({ ...emptyState, ...loaded, templateId: loaded.templateId || schema.defaultTemplateId }, schema);
					setData(merged);
					baseline = merged;
				}
			} catch {
				// no draft / not logged in → keep the empty state
			} finally {
				if (mounted) {
					lastFullSig.current = fullSig(baseline);
					lastAiSig.current = aiSig(baseline);
					setIsLoaded(true);
				}
			}
		})();
		return () => { mounted = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [schema.key]);

	// ── the actual save ───────────────────────────────────────────────────────────
	const save = useCallback(async (d, { rescore } = {}) => {
		setIsSaving(true);
		try {
			const payload = { [schema.draft.payloadKey]: d };
			if (schema.aiSignature) payload.rescore = rescore !== false; // resume: honour the flag
			await API.post(schema.draft.savePath, payload);
			lastFullSig.current = fullSig(d);
			lastAiSig.current = aiSig(d);
			setSavedAt(Date.now());
		} catch {
			// non-fatal — retried on the next change (baselines only advance on success)
		} finally {
			setIsSaving(false);
		}
	}, [schema, fullSig, aiSig]);

	// ── change-driven autosave ────────────────────────────────────────────────────
	useEffect(() => {
		if (!isLoaded) return;
		const sig = fullSig(data);
		if (lastFullSig.current === null) { lastFullSig.current = sig; lastAiSig.current = aiSig(data); return; }
		if (sig === lastFullSig.current) return;
		const aiChanged = aiSig(data) !== lastAiSig.current;
		const t = setTimeout(() => save(data, { rescore: aiChanged }), 1500);
		return () => clearTimeout(t);
	}, [data, isLoaded, fullSig, aiSig, save]);

	// Persist the latest content immediately (called before export). No-op if unchanged.
	const flush = useCallback(async () => {
		if (!isLoaded) return;
		if (fullSig(data) === lastFullSig.current) return;
		await save(data, { rescore: aiSig(data) !== lastAiSig.current });
	}, [isLoaded, data, fullSig, aiSig, save]);

	// Reset to empty. For the résumé this IS an AI-relevant change (empty parsed_text) → rescore.
	const wipe = useCallback(async () => {
		const empty = schema.emptyState(user);
		lastFullSig.current = fullSig(empty);
		lastAiSig.current = aiSig(empty);
		setData(empty);
		await save(empty, { rescore: true });
	}, [schema, user, fullSig, aiSig, save]);

	return { data, setData, isLoaded, isSaving, savedAt, flush, wipe, newItemId: uid };
}
