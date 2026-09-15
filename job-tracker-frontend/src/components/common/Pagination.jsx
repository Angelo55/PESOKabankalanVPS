import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Compact server-side pager (Phase 1). Presentational only — the parent owns the
 * page + size state and refetches when `onPage` / `onLimitChange` fire. Render it
 * BOTH above and below a table (pass position="top" on the upper one): both read
 * the same props, so they stay perfectly in sync with zero extra wiring.
 *
 * Controls: First «, Prev, page indicator, Next, Last », a rows-per-page selector
 * (default 10 · 10/25/50/100), the total count, and the current record range.
 *
 * Renders nothing when everything fits on one page AND no size selector is offered,
 * so a short list looks exactly as it did before pagination.
 */
const DEFAULT_OPTIONS = [10, 25, 50, 100];

const Pagination = ({ page, limit, total, onPage, onLimitChange, pageSizeOptions = DEFAULT_OPTIONS, position = 'bottom', className = '' }) => {
	const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 1)));
	// Offer the sizer whenever changing it could matter (more rows than the smallest
	// option), even on one page — so a user can shrink the page for readability.
	const showSizer = typeof onLimitChange === 'function' && (total || 0) > Math.min(...pageSizeOptions);
	if (totalPages <= 1 && !showSizer) return null;

	const from = total ? (page - 1) * limit + 1 : 0;
	const to = Math.min(page * limit, total);
	const margin = position === 'top' ? 'mb-4' : 'mt-6';

	const btn = 'inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold bg-surface border border-line text-content hover:bg-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1';

	return (
		<div className={`flex flex-col sm:flex-row items-center justify-between gap-3 ${margin} ${className}`}>
			<div className="flex items-center gap-3">
				<p className="text-xs font-semibold text-muted">
					Showing <span className="font-bold text-content tabular-nums">{from}–{to}</span> of{' '}
					<span className="font-bold text-content tabular-nums">{total}</span>
				</p>
				{showSizer && (
					<label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
						Rows:
						<select
							value={limit}
							onChange={(e) => onLimitChange(Number(e.target.value))}
							aria-label="Rows per page"
							className="appearance-none px-2 py-1 rounded-lg border border-line bg-surface text-content font-bold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
						>
							{pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
						</select>
					</label>
				)}
			</div>
			<div className="flex items-center gap-1.5">
				<button onClick={() => onPage(1)} disabled={page <= 1} className={btn} aria-label="First page" title="First page"><ChevronsLeft size={14} /></button>
				<button onClick={() => onPage(page - 1)} disabled={page <= 1} className={btn} aria-label="Previous page">
					<ChevronLeft size={14} /> Prev
				</button>
				<span className="text-xs font-bold text-muted tabular-nums px-1">Page {page} / {totalPages}</span>
				<button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className={btn} aria-label="Next page">
					Next <ChevronRight size={14} />
				</button>
				<button onClick={() => onPage(totalPages)} disabled={page >= totalPages} className={btn} aria-label="Last page" title="Last page"><ChevronsRight size={14} /></button>
			</div>
		</div>
	);
};

export default Pagination;
