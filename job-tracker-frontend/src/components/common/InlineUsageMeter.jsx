import React, { useEffect } from 'react';
import useUsage from '../../hooks/useUsage';
import UsageMeter from './UsageMeter';

/**
 * InlineUsageMeter — a compact usage strip for a module header (task: usage/limit
 * system). Shows one or more resources from the shared quota catalogue, fed by the
 * server-authoritative /usage feed (config/quotas.js → useUsage). This is the ONE
 * inline wrapper the seeker modules reuse, so the hook + container aren't repeated.
 *
 * Props:
 *   scope      'seeker' | 'admin' (default 'seeker')
 *   keys       resource keys to show, e.g. ['certificate_library'] or
 *              ['peso_applications','tracked_applications']
 *   refreshKey when it changes, the usage is re-pulled — pass a value that changes
 *              on a mutation (e.g. the list length) so the meter follows add/remove.
 *
 * Renders nothing until at least one requested resource is available (a thin strip
 * appearing after a fast fetch is preferable to reserving space for missing rows).
 */
export default function InlineUsageMeter({ scope = 'seeker', keys = [], refreshKey, className = '' }) {
	const { resources, refresh } = useUsage(scope);

	useEffect(() => {
		if (refreshKey !== undefined) refresh();
	}, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

	const rows = keys.map((k) => resources.find((r) => r.key === k)).filter(Boolean);
	if (!rows.length) return null;

	return (
		<div className={`rounded-2xl border border-line bg-surface/60 px-4 divide-y divide-line ${className}`}>
			{rows.map((r) => (
				<UsageMeter key={r.key} resource={r} compact />
			))}
		</div>
	);
}
