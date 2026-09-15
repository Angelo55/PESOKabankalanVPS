import { useState, useEffect, useCallback, useRef } from 'react';
import API from '../api';

/**
 * Live quota/usage feed for the limit indicators (task: usage/limit system).
 * Fetches the server-computed usage (the backend is authoritative — the UI only
 * REFLECTS server-side usage, never computes limits itself) from:
 *   scope 'seeker' → GET /api/usage
 *   scope 'admin'  → GET /api/peso-admin/usage
 *
 * Returns { resources, loading, error, refresh, byKey }. Call refresh() after a
 * mutation (an import, a new certificate) to re-pull the current figures.
 */
export default function useUsage(scope = 'seeker', { auto = true } = {}) {
	const [resources, setResources] = useState([]);
	const [loading, setLoading] = useState(auto);
	const [error, setError] = useState(null);
	const alive = useRef(true);
	const url = scope === 'admin' ? '/peso-admin/usage' : '/usage';

	useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await API.get(url);
			if (!alive.current) return;
			setResources(Array.isArray(res.data?.resources) ? res.data.resources : []);
		} catch (e) {
			if (!alive.current) return;
			setError(e.response?.data?.message || 'Could not load usage.');
		} finally {
			if (alive.current) setLoading(false);
		}
	}, [url]);

	useEffect(() => { if (auto) refresh(); }, [auto, refresh]);

	const byKey = useCallback((key) => resources.find((r) => r.key === key) || null, [resources]);

	return { resources, loading, error, refresh, byKey };
}
