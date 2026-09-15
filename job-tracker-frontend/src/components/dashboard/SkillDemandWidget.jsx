import React, { useEffect, useState } from 'react';
import { TrendingUp, Loader2, Info } from 'lucide-react';
import API from '../../api';

/**
 * Skill Demand Analytics — replaces the old "Top Platforms" widget.
 *
 * External job boards were irrelevant here: applicants apply and are managed
 * entirely inside PESO Kabankalan. This shows real local labour-market signal
 * instead — which competencies the currently LIVE vacancies actually ask for.
 *
 * Figures come from /api/analytics/skill-demand, recomputed per request from
 * `pesoadmin_job_posts`, so the widget tracks postings being created, edited,
 * filled or closed with nothing to invalidate.
 *
 * Each bar is "N job postings mention this competency" — a posting is counted
 * once per competency, never per keyword occurrence, so the numbers stay honest.
 */
const SkillDemandWidget = ({ className = '' }) => {
    const [state, setState] = useState({ loading: true, skills: [], totalPostings: 0, withSkillText: 0, error: false });

    useEffect(() => {
        let cancelled = false;
        API.get('/analytics/skill-demand?limit=6')
            .then(res => {
                if (cancelled) return;
                const d = res.data?.data || {};
                setState({
                    loading: false,
                    skills: d.skills || [],
                    totalPostings: d.totalPostings || 0,
                    withSkillText: d.postingsWithSkillText || 0,
                    error: false,
                });
            })
            .catch(() => { if (!cancelled) setState(s => ({ ...s, loading: false, error: true })); });
        return () => { cancelled = true; };
    }, []);

    const { loading, skills, totalPostings, withSkillText, error } = state;
    // Bars are scaled to the top skill, so the leader always fills the track and
    // the rest read as a proportion of it.
    const max = skills.length ? Math.max(...skills.map(s => s.count)) : 0;

    return (
        <div className={`bg-surface/70 backdrop-blur-xl p-5 sm:p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line/50 ${className}`}>
            <div className="flex items-start justify-between gap-3 mb-5">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-accent/10 dark:bg-accent-text/15 rounded-xl shrink-0">
                        <TrendingUp className="text-accent-text" size={20} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-content tracking-tight">Skill Demand</h3>
                        <p className="text-xs font-medium text-muted">
                            Most requested across {totalPostings} live vacanc{totalPostings === 1 ? 'y' : 'ies'}
                        </p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="animate-spin text-accent-text" size={26} />
                </div>
            ) : error ? (
                <p className="text-sm text-muted font-medium py-6 text-center">
                    Skill demand is unavailable right now.
                </p>
            ) : skills.length === 0 ? (
                <div className="py-8 text-center">
                    <p className="text-sm font-bold text-muted">No skill data yet</p>
                    <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
                        Demand appears here once live vacancies list the skills they need.
                    </p>
                </div>
            ) : (
                <>
                    <ul className="space-y-3.5">
                        {skills.map((s) => (
                            <li key={s.name}>
                                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                                    <span className="text-sm font-bold text-content truncate">{s.name}</span>
                                    <span className="text-xs font-black text-muted whitespace-nowrap tabular-nums">
                                        {s.count} posting{s.count === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div
                                    className="h-2 w-full rounded-full bg-sunken/60 overflow-hidden"
                                    role="img"
                                    aria-label={`${s.name}: ${s.count} of ${totalPostings} live postings`}
                                >
                                    <div
                                        className="h-full rounded-full bg-accent dark:bg-accent-text transition-[width] duration-700 ease-out"
                                        style={{ width: max ? `${Math.max((s.count / max) * 100, 6)}%` : '0%' }}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>

                    {/* Explains a thin chart honestly rather than letting it look broken. */}
                    {withSkillText < totalPostings && (
                        <p className="mt-4 pt-3 border-t border-line text-[11px] text-subtle flex items-start gap-1.5 leading-relaxed">
                            <Info size={12} className="shrink-0 mt-0.5" />
                            Based on the details employers provided. Coverage improves as more
                            postings list required skills.
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

export default SkillDemandWidget;
