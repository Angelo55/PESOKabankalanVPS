import React from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import JobCard from './JobCard';
import { getJobCategory } from './useJobFilters';
import Reveal from '../common/Reveal';

/**
 * The Public Job Board's default browse view: a "Recommended for You" carousel
 * followed by one horizontally-scrolling row per category. Shown when no search
 * or filter is active; otherwise the board renders a flat filtered grid instead.
 *
 * Styled with the "Radiant Fields" palette (see JobCard for the contrast
 * rationale). Row items are sized to the same ~350px design target as the grid
 * cards and stretch to a shared height, so a row never looks ragged.
 */
const RowScroller = ({ children }) => (
    <div className="flex items-stretch gap-6 overflow-x-auto custom-scrollbar pb-4 -mx-1 px-1 snap-x">
        {children}
    </div>
);

const JobCategorySections = ({ jobs = [], categories = [], savedJobIds, savingJob, onOpen, onToggleSave, isTouch, onSeeAllCategory }) => {
    const isSaved = (id) => savedJobIds?.has?.(id);

    // Recommended: newest handful across all categories.
    const recommended = [...jobs]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 8);

    // Matches the grid's card target; stays a comfortable peek-width on phones.
    const itemClass = 'shrink-0 w-[86vw] sm:w-[350px] snap-start';

    return (
        <div className="space-y-12">
            {recommended.length > 0 && (
                <section>
                    <h2 className="text-2xl font-black text-content mb-5 flex items-center gap-2.5">
                        <Sparkles size={20} className="text-accent-text" />
                        Recommended for You
                    </h2>
                    <RowScroller>
                        {recommended.map((job, i) => (
                            <Reveal key={`rec-${job.id}`} className={itemClass} delay={Math.min(i * 40, 320)}>
                                <JobCard job={job} saved={isSaved(job.id)} saving={savingJob === job.id} onOpen={onOpen} onToggleSave={onToggleSave} isTouch={isTouch} />
                            </Reveal>
                        ))}
                    </RowScroller>
                </section>
            )}

            {categories.map(({ name }) => {
                const inCat = jobs.filter(j => getJobCategory(j) === name).slice(0, 8);
                if (inCat.length === 0) return null;
                return (
                    <section key={name}>
                        <div className="flex items-center justify-between gap-3 mb-5">
                            <h2 className="text-2xl font-black text-content flex items-center gap-2.5">
                                <span className="w-1 h-6 rounded-full bg-accent" aria-hidden="true" />
                                {name}
                            </h2>
                            <button
                                onClick={() => onSeeAllCategory?.(name)}
                                className="shrink-0 text-sm font-bold text-accent-text hover:text-content dark:hover:text-white hover:underline underline-offset-4 flex items-center gap-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg px-1"
                            >
                                <span className="hidden sm:inline">See all {name} jobs</span>
                                <span className="sm:hidden">See all</span>
                                <ArrowRight size={14} />
                            </button>
                        </div>
                        <RowScroller>
                            {inCat.map((job, i) => (
                                <Reveal key={`${name}-${job.id}`} className={itemClass} delay={Math.min(i * 40, 320)}>
                                    <JobCard job={job} saved={isSaved(job.id)} saving={savingJob === job.id} onOpen={onOpen} onToggleSave={onToggleSave} isTouch={isTouch} />
                                </Reveal>
                            ))}
                        </RowScroller>
                    </section>
                );
            })}
        </div>
    );
};

export default JobCategorySections;
