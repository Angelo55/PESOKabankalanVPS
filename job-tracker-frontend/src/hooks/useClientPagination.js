import { useState, useMemo, useEffect } from 'react';

/**
 * Client-side pagination for lists that are already fully loaded and small enough
 * to hold in memory (Saved Vacancies, a job seeker's own referrals, etc.). Gives
 * those lists the SAME <Pagination> UX as the server-paginated grids — default 10
 * rows, a 10/25/50/100 selector, First/Last — without any backend work.
 *
 * Pass the (already filtered/sorted) array; get back the current page's slice plus
 * the props <Pagination> needs. The page clamps itself when the list shrinks (a
 * filter change) or the size grows, so it can never point past the end.
 *
 *   const { pageItems, page, setPage, limit, onLimitChange, total } =
 *       useClientPagination(filteredItems);
 *   // render pageItems, and <Pagination page limit total onPage={setPage}
 *   //   onLimitChange={onLimitChange} /> above and below.
 */
export default function useClientPagination(items, defaultLimit = 10) {
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(defaultLimit);

	const list = Array.isArray(items) ? items : [];
	const total = list.length;
	const totalPages = Math.max(1, Math.ceil(total / limit));

	// Keep the page in range as the underlying list changes.
	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	const pageItems = useMemo(() => {
		const start = (page - 1) * limit;
		return list.slice(start, start + limit);
	}, [list, page, limit]);

	const onLimitChange = (n) => { setLimit(n); setPage(1); };

	return { pageItems, page, setPage, limit, onLimitChange, total, totalPages };
}
