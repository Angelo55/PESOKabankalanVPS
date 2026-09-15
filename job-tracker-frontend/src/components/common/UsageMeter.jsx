import React from 'react';

/**
 * UsageMeter — the ONE indicator for a single quota'd resource (task: usage/limit
 * system). Renders `used / max`, a state-coloured progress bar, and a concise
 * status ("15 remaining" / "Limit reached" / "No limit"). The server owns the
 * numbers (config/quotas.js → /api/usage); this only presents the row it is given.
 *
 * A resource row (from useUsage) carries: { key,label,type,unit,max,used,remaining,
 * percent,state,enforced,secondary,help,soft }. `state` is authoritative:
 *   normal | warn | blocked | unlimited | reference.
 * Design-token styled + dark-aware (§24.1); reduced-motion is handled globally.
 */

export const fmtBytes = (n) => {
	if (n == null) return '—';
	if (n < 1024) return `${n} B`;
	const kb = n / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	const gb = mb / 1024;
	return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`;
};

const fmtNum = (n) => new Intl.NumberFormat().format(Number(n ?? 0));
const fmtValue = (resource, v) => (resource.unit === 'bytes' ? fmtBytes(v) : fmtNum(v));

const STATE_STYLE = {
	normal: { bar: 'bg-accent', pill: '' },
	warn: { bar: 'bg-warning', pill: 'text-warning bg-warning/10' },
	blocked: { bar: 'bg-danger', pill: 'text-danger bg-danger/10' },
	unlimited: { bar: 'bg-accent-soft', pill: 'text-muted' },
	reference: { bar: 'bg-accent-soft', pill: 'text-muted' },
};

// The short status shown to the right of a resource, per the spec's examples.
function statusLabel(r) {
	if (r.state === 'blocked') return 'Limit reached';
	if (r.state === 'warn') {
		if (r.type === 'bytes') return 'Approaching guideline';
		if (r.remaining != null) return `${fmtNum(r.remaining)} remaining`;
		return 'Near limit';
	}
	if (r.state === 'unlimited') return 'No limit';
	return '';
}

export default function UsageMeter({ resource, compact = false }) {
	if (!resource) return null;
	const style = STATE_STYLE[resource.state] || STATE_STYLE.normal;
	const status = statusLabel(resource);
	const showBar = resource.type !== 'processing' && resource.max != null;
	const percent = resource.state === 'unlimited' ? 0 : Math.max(0, Math.min(100, resource.percent ?? 0));

	// The right-hand value: "24 / 100", or a bare count for unlimited, or "Max 5 MB" for a reference ceiling.
	let valueText;
	if (resource.type === 'processing') {
		valueText = `Max ${fmtValue(resource, resource.max)}`;
	} else if (resource.max == null) {
		valueText = fmtValue(resource, resource.used);
	} else {
		valueText = `${fmtValue(resource, resource.used)} / ${fmtValue(resource, resource.max)}`;
	}

	return (
		<div className={compact ? 'w-full py-1.5' : 'w-full py-2.5'}>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className={`font-bold text-content truncate ${compact ? 'text-xs' : 'text-sm'}`} title={resource.help || ''}>
						{resource.label}
					</p>
					{!compact && resource.secondary && (
						<p className="text-[11px] text-muted mt-0.5">{resource.secondary.label}: {fmtNum(resource.secondary.value)} {resource.secondary.unit}</p>
					)}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{status && (
						<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${style.pill}`}>{status}</span>
					)}
					<span className={`font-black tabular-nums text-content ${compact ? 'text-xs' : 'text-sm'}`}>{valueText}</span>
				</div>
			</div>
			{showBar && (
				<div className={`mt-1.5 w-full ${compact ? 'h-1.5' : 'h-2'} rounded-full bg-sunken overflow-hidden`} role="progressbar" aria-valuenow={resource.used ?? 0} aria-valuemin={0} aria-valuemax={resource.max} aria-label={`${resource.label} usage`}>
					<div className={`h-full rounded-full transition-all duration-500 ${style.bar}`} style={{ width: `${percent}%` }} />
				</div>
			)}
		</div>
	);
}
