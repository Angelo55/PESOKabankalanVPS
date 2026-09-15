import React from 'react';
import { RefreshCw, Loader2, AlertTriangle, Gauge } from 'lucide-react';
import useUsage from '../../hooks/useUsage';
import UsageMeter from './UsageMeter';

/**
 * UsagePanel — the comprehensive "Usage & Limits" surface (task: usage/limit
 * system). Groups the server-computed resources by category and renders a
 * UsageMeter per resource. Self-contained (fetches its own usage) so it can drop
 * into the seeker Account Settings tab and the PESO Admin overview alike.
 *
 * Informational vs enforced is decided by the SERVER (state === 'blocked' only for
 * a real enforced cap); this panel just reflects it — invariant 0.1 holds.
 */

const CATEGORY_ORDER = ['Records', 'Storage', 'Requests', 'Uploads'];
const CATEGORY_META = {
	Records: { label: 'Records', hint: 'How many of each you currently have.' },
	Storage: { label: 'Storage', hint: 'Approximate database footprint of your stored files (a guideline, not a hard cap).' },
	Requests: { label: 'Requests', hint: 'Rate-limited actions that reset over time.' },
	Uploads: { label: 'Upload limits', hint: 'Maximum size allowed per file.' },
};

export default function UsagePanel({ scope = 'seeker', title = 'Usage & Limits', description, className = '' }) {
	const { resources, loading, error, refresh } = useUsage(scope);

	const groups = CATEGORY_ORDER
		.map((cat) => ({ cat, items: resources.filter((r) => r.category === cat) }))
		.filter((g) => g.items.length);

	return (
		<div className={className}>
			<div className="flex items-center justify-between gap-3 mb-4">
				<div className="flex items-center gap-2 min-w-0">
					<span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent-soft text-accent-text shrink-0"><Gauge size={18} /></span>
					<div className="min-w-0">
						<h3 className="text-base font-black text-content truncate">{title}</h3>
						{description && <p className="text-xs text-muted mt-0.5">{description}</p>}
					</div>
				</div>
				<button
					type="button"
					onClick={refresh}
					disabled={loading}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-muted hover:text-content hover:bg-sunken border border-line bg-surface transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					<RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
				</button>
			</div>

			{loading && resources.length === 0 ? (
				<div className="flex items-center justify-center gap-2 py-12 text-muted text-sm font-semibold">
					<Loader2 size={16} className="animate-spin text-accent" /> Loading usage…
				</div>
			) : error ? (
				<div className="flex items-center gap-2 py-8 px-4 rounded-2xl border border-line bg-surface text-muted text-sm">
					<AlertTriangle size={16} className="text-warning shrink-0" /> {error}
				</div>
			) : (
				<div className="space-y-6">
					{groups.map(({ cat, items }) => (
						<section key={cat}>
							<div className="flex items-baseline justify-between gap-2 mb-1.5">
								<h4 className="text-[11px] font-black uppercase tracking-wider text-muted">{CATEGORY_META[cat]?.label || cat}</h4>
								<span className="text-[11px] text-subtle hidden sm:block">{CATEGORY_META[cat]?.hint}</span>
							</div>
							<div className="rounded-2xl border border-line bg-surface divide-y divide-line px-4">
								{items.map((r) => (
									<UsageMeter key={r.key} resource={r} />
								))}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
