import React from 'react';

/**
 * Skeleton placeholders.
 *
 * WHY: TiDB is a cloud round-trip (~100ms+), so every data screen has a window
 * where content is absent. A spinner on a blank page reads as "loading" (or
 * worse, "broken"); a gray shape the size of the real content reads as "almost
 * here." Same wait, better perceived speed -- the eye sees structure instead of
 * emptiness, and nothing shifts when real data replaces the skeleton (no CLS).
 *
 * The shimmer is pure CSS (see the keyframes appended to index.css). No library.
 * Styled in semantic tokens (§24): the shimmer block is `bg-line` (a mid-tone that
 * reads on both the light and dark surface), frames use `bg-surface`/`border-line`.
 */

// Base shimmer block. Everything else composes this.
export const Skeleton = ({ className = '' }) => (
	<div className={`animate-skeleton-shimmer bg-line rounded-lg ${className}`} />
);

// A metric card placeholder — matches the MetricCard footprint.
export const SkeletonMetricCard = () => (
	<div className="p-5 rounded-3xl bg-surface/60 border border-line flex items-center gap-4">
		<Skeleton className="w-14 h-14 rounded-2xl shrink-0" />
		<div className="flex-1 space-y-2">
			<Skeleton className="h-6 w-16" />
			<Skeleton className="h-3 w-24" />
		</div>
	</div>
);

// A generic list-row placeholder for tables/lists (referrals, applicants, jobs).
export const SkeletonRow = () => (
	<div className="flex items-center gap-4 p-4">
		<Skeleton className="w-12 h-12 rounded-2xl shrink-0" />
		<div className="flex-1 space-y-2">
			<Skeleton className="h-4 w-1/3" />
			<Skeleton className="h-3 w-1/2" />
		</div>
		<Skeleton className="h-9 w-24 rounded-xl" />
	</div>
);

// The chart's rectangular footprint (reserves the 400px height, prevents CLS).
export const SkeletonChart = () => (
	<Skeleton className="w-full h-[400px] rounded-2xl" />
);

// A header block placeholder (title + subtitle), shared by page skeletons.
export const SkeletonPageHeader = () => (
	<div className="mb-6 space-y-2">
		<Skeleton className="h-8 w-64 max-w-full" />
		<Skeleton className="h-4 w-96 max-w-full" />
	</div>
);

// Responsive card grid — mirrors the Public Job Board / Saved Vacancies grids.
export const SkeletonCardGrid = ({ count = 8 }) => (
	<div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
		{Array.from({ length: count }).map((_, i) => <SkeletonJobCard key={i} />)}
	</div>
);

// A stacked form placeholder — mirrors the Identity & Profile section cards.
export const SkeletonForm = ({ sections = 3, fields = 4 }) => (
	<div className="space-y-6">
		{Array.from({ length: sections }).map((_, i) => (
			<div key={i} className="p-5 sm:p-8 rounded-[2rem] border border-line bg-surface/60">
				<div className="flex items-center gap-3 mb-6 pb-4 border-b border-line">
					<Skeleton className="w-6 h-6 rounded-lg" /><Skeleton className="h-5 w-48" />
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
					{Array.from({ length: fields }).map((_, j) => (
						<div key={j} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-11 w-full rounded-xl" /></div>
					))}
				</div>
			</div>
		))}
	</div>
);

// A kanban board placeholder — mirrors the My Applications stage columns.
export const SkeletonKanban = ({ columns = 4, cards = 3 }) => (
	<div className="flex gap-4 sm:gap-5 overflow-hidden pb-4">
		{Array.from({ length: columns }).map((_, i) => (
			<div key={i} className="w-[280px] shrink-0 bg-sunken/60 rounded-2xl p-4 border border-line">
				<div className="flex justify-between items-center mb-4 px-2">
					<Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-8 rounded-full" />
				</div>
				<div className="space-y-4">
					{Array.from({ length: cards }).map((_, j) => (
						<div key={j} className="bg-surface rounded-xl p-4 space-y-3 border border-line">
							<Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/3" />
						</div>
					))}
				</div>
			</div>
		))}
	</div>
);

// An event card placeholder — mirrors Events.jsx EventCard: a 160px banner band, a
// type pill, a two-line title, two meta rows, a description line, and a footer CTA.
export const SkeletonEventCard = () => (
	<div className="h-full bg-surface rounded-3xl border border-line/80 overflow-hidden flex flex-col">
		<Skeleton className="h-40 w-full rounded-none" />
		<div className="p-4 flex flex-col flex-1 gap-2">
			<div className="flex items-center gap-2">
				<Skeleton className="h-5 w-24 rounded-full" />
				<Skeleton className="h-5 w-16 rounded-full" />
			</div>
			<Skeleton className="h-4 w-4/5" />
			<div className="space-y-2 pt-1">
				<Skeleton className="h-3 w-2/3" />
				<Skeleton className="h-3 w-1/2" />
			</div>
			<Skeleton className="h-3 w-full mt-1" />
			<div className="mt-auto pt-3"><Skeleton className="h-3 w-24" /></div>
		</div>
	</div>
);

// The Events grid placeholder — same responsive grid template as Events.jsx so the
// skeleton lays out exactly where the real cards will (no shift on load).
export const SkeletonEventGrid = ({ count = 6 }) => (
	<div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))]">
		{Array.from({ length: count }).map((_, i) => <SkeletonEventCard key={i} />)}
	</div>
);

// A vacancy card placeholder — mirrors the Job Publication Management card:
// a 144px media band above a title, meta lines, and a footer rule.
export const SkeletonJobCard = () => (
	<div className="h-full bg-surface rounded-3xl border border-line overflow-hidden flex flex-col">
		<Skeleton className="h-36 w-full rounded-none" />
		<div className="p-5 flex flex-col gap-3 flex-1">
			<Skeleton className="h-5 w-3/4" />
			<Skeleton className="h-3 w-1/2" />
			<div className="space-y-2 pt-1">
				<Skeleton className="h-3 w-2/3" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="h-3 w-3/5" />
			</div>
			<div className="mt-auto pt-4 border-t border-line">
				<Skeleton className="h-3 w-24" />
			</div>
		</div>
	</div>
);

// A COMPACT card placeholder — mirrors the SHARED Saved Vacancies / My Applications card
// (jobs/CardLabels `cardTheme`): NO media band, p-4 body, a 40px icon tile + two control
// dots in the header, a status/source pill, a two-line title, a company line, bordered
// meta chips, and a footer rule with a left control + a right badge. Its box model matches
// the real card (h-full, min-h-[180px], rounded-3xl, border, flex column) so nothing
// shifts when data arrives (no CLS). Both modules use this — one skeleton, two consumers.
export const SkeletonCompactCard = () => (
	<div className="h-full min-h-[180px] rounded-3xl border border-line bg-surface flex flex-col overflow-hidden">
		<div className="p-4 flex flex-col flex-1 min-h-0">
			<div className="flex justify-between items-start mb-3">
				<Skeleton className="w-10 h-10 rounded-xl" />
				<div className="flex items-center gap-1">
					<Skeleton className="w-6 h-6 rounded-lg" />
					<Skeleton className="w-6 h-6 rounded-lg" />
				</div>
			</div>
			<Skeleton className="h-4 w-20 rounded-full mb-2.5" />
			<Skeleton className="h-4 w-4/5 mb-1.5" />
			<Skeleton className="h-4 w-3/5 mb-2.5" />
			<Skeleton className="h-3 w-1/2 mb-3" />
			<div className="flex flex-wrap gap-1.5 mb-3">
				<Skeleton className="h-6 w-24 rounded-lg" />
				<Skeleton className="h-6 w-16 rounded-lg" />
			</div>
			<div className="mt-auto pt-2.5 border-t border-line flex items-center justify-between gap-2">
				<Skeleton className="h-6 w-24 rounded-lg" />
				<Skeleton className="h-6 w-16 rounded-full" />
			</div>
		</div>
	</div>
);

// The COMPACT card grid — the EXACT fluid grid (240px floor, equal-height rows) the Saved
// Vacancies and My Applications boards use, so the skeleton renders on the identical column
// count at every breakpoint (desktop → mobile). Keep this template in lockstep with the
// modules' `CARD_GRID` / grid className.
export const SkeletonCompactCardGrid = ({ count = 8 }) => (
	<div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
		{Array.from({ length: count }).map((_, i) => <SkeletonCompactCard key={i} />)}
	</div>
);

// Identity & Profile loading state — STRUCTURALLY mirrors Profile.jsx (not a generic
// form): the page header, the left summary card (avatar circle + name/role + the two
// avatar buttons + a "Basic Information" block) and the right column (Profile-Strength
// card with a progress bar + metric chips, then the tabbed form card with three tab
// headers, an Edit button, labelled field rows, and a Save button). Same outer shell
// (`max-w-5xl`, padding, min-h-screen) and card box model as the real page, so the
// layout does not shift when data arrives. Chip widths are a fixed varied set so the
// pills read like the real strength metrics.
const SKELETON_PROFILE_CHIPS = ['w-24', 'w-28', 'w-20', 'w-24', 'w-16', 'w-28', 'w-20'];

export const SkeletonProfile = () => (
	<div className="p-3 sm:p-5 lg:p-6 w-full max-w-5xl mx-auto min-h-screen">
		{/* Header (matches the h1 + subtitle) */}
		<div className="mb-6 space-y-2">
			<Skeleton className="h-8 w-56 max-w-full" />
			<Skeleton className="h-4 w-96 max-w-full" />
		</div>

		<div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
			{/* Left: profile summary card */}
			<div className="md:col-span-4 flex flex-col gap-5">
				<div className="relative overflow-hidden rounded-3xl border border-line bg-surface/60 p-5 sm:p-6">
					<div className="absolute top-0 left-0 w-full h-20 bg-sunken" />
					<div className="relative flex flex-col items-center">
						<Skeleton className="w-24 h-24 sm:w-28 sm:h-28 rounded-full mt-2 mb-3" />
						<Skeleton className="h-5 w-32 mb-2" />
						<Skeleton className="h-3 w-20 mb-4" />
						<div className="flex gap-2 w-full mb-4">
							<Skeleton className="h-9 flex-1 rounded-lg" />
							<Skeleton className="h-9 flex-1 rounded-lg" />
						</div>
						<div className="w-full border-t border-line pt-4 space-y-3">
							<Skeleton className="h-3 w-28 mb-1" />
							{[0, 1].map((i) => (
								<div key={i} className="flex items-center gap-3">
									<Skeleton className="w-5 h-5 rounded-md shrink-0" />
									<div className="flex-1 space-y-1.5">
										<Skeleton className="h-2.5 w-16" />
										<Skeleton className="h-3 w-24" />
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>

			{/* Right: strength card + tabbed form card */}
			<div className="md:col-span-8 flex flex-col gap-5">
				{/* Profile strength */}
				<div className="rounded-3xl border border-line bg-surface/60 p-5 sm:p-6">
					<div className="flex flex-wrap justify-between items-end gap-2 mb-3">
						<Skeleton className="h-5 w-44" />
						<Skeleton className="h-3 w-28" />
					</div>
					<Skeleton className="h-2 w-full rounded-full mb-4" />
					<div className="flex flex-wrap gap-2">
						{SKELETON_PROFILE_CHIPS.map((w, i) => <Skeleton key={i} className={`h-7 ${w} rounded-full`} />)}
					</div>
				</div>

				{/* Tabbed form card */}
				<div className="rounded-3xl border border-line bg-surface/60 overflow-hidden min-h-[420px]">
					<div className="flex border-b border-line bg-sunken/50">
						{['w-28', 'w-28', 'w-20'].map((w, i) => (
							<div key={i} className="flex-1 py-4 flex justify-center"><Skeleton className={`h-4 ${w}`} /></div>
						))}
					</div>
					<div className="p-5 sm:p-6">
						<div className="flex justify-end mb-5"><Skeleton className="h-9 w-28 rounded-xl" /></div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
							{Array.from({ length: 6 }).map((_, i) => (
								<div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-11 w-full rounded-xl" /></div>
							))}
						</div>
						<div className="flex justify-end mt-6"><Skeleton className="h-11 w-32 rounded-xl" /></div>
					</div>
				</div>
			</div>
		</div>
	</div>
);
