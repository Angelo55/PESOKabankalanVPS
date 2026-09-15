/**
 * GETTING STARTED GUIDE (GAM) — the first-run onboarding checklist.
 *
 * Turns a new user's empty dashboard into a guided journey. Each step declares its
 * OWN completion from a real signal (resume exists, a job was saved, an application
 * was submitted…), so the checklist reflects genuine progress rather than a fake
 * tour. The first not-yet-done step is highlighted as "do this next"; every step
 * carries a one-line description and a direct action button.
 *
 * Steps shape:
 *   { id, title, description, icon, done, action: { label, to?, onClick? } }
 *
 * When every step is done it collapses to a compact success banner (celebrating the
 * completed setup) instead of a wall of ticks. All motion is CSS-token based and
 * covered by the global reduced-motion rules.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ArrowRight, Sparkles, PartyPopper, Rocket } from 'lucide-react';

const StepAction = ({ action, emphasized }) => {
    if (!action) return null;
    const base = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 whitespace-nowrap';
    const styles = emphasized
        ? 'bg-accent text-accent-contrast hover:bg-accent-hover shadow-sm'
        : 'bg-surface border border-line text-content hover:bg-sunken';
    const inner = <>{action.label}<ArrowRight size={14} /></>;
    if (action.to) return <Link to={action.to} className={`${base} ${styles}`}>{inner}</Link>;
    return <button type="button" onClick={action.onClick} className={`${base} ${styles}`}>{inner}</button>;
};

const GettingStartedGuide = ({ name, steps = [], onDismiss, className = '' }) => {
    const total = steps.length;
    const doneCount = steps.filter(s => s.done).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const allDone = total > 0 && doneCount === total;
    const nextId = steps.find(s => !s.done)?.id;
    const greeting = name ? `Welcome, ${String(name).split(' ')[0]}!` : 'Welcome to PESO Kabankalan!';

    return (
        <section
            aria-label="Getting started guide"
            className={`relative overflow-hidden rounded-[2rem] border border-line bg-surface shadow-card p-5 sm:p-8 animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none ${className}`}
        >
            {/* soft accent wash — decorative only */}
            <span aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-accent/10 blur-3xl" />

            <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
                <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent-soft/60 dark:bg-accent-text/10 border border-line text-accent-text shrink-0 es-float">
                    {allDone ? <PartyPopper size={26} /> : <Rocket size={26} />}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-xl sm:text-2xl font-black text-content tracking-tight">{greeting}</h2>
                    <p className="text-sm text-muted font-medium mt-1">
                        {allDone
                            ? "You're all set — your profile is ready and you know your way around."
                            : "Let's get you set up. Complete these steps to make the most of your job search."}
                    </p>
                </div>
                {onDismiss && (
                    <button onClick={onDismiss} className="self-start text-xs font-bold text-muted hover:text-content transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg px-2 py-1">
                        Dismiss
                    </button>
                )}
            </div>

            {/* Progress */}
            <div className="relative mb-6">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-subtle flex items-center gap-1.5">
                        <Sparkles size={12} /> Setup progress
                    </span>
                    <span className="text-xs font-black text-accent-text tabular-nums">{doneCount} of {total} complete</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-sunken overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding progress">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                </div>
            </div>

            {/* Steps */}
            <ol className="space-y-2.5">
                {steps.map((step, i) => {
                    const isNext = step.id === nextId;
                    const Icon = step.icon;
                    return (
                        <li
                            key={step.id}
                            className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl border transition-colors ${
                                step.done
                                    ? 'border-line bg-sunken/40'
                                    : isNext
                                        ? 'border-accent/40 bg-accent-soft/40 dark:bg-accent-text/5'
                                        : 'border-line bg-surface'
                            }`}
                        >
                            {/* state marker */}
                            <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border ${
                                step.done
                                    ? 'bg-emerald-50 dark:bg-emerald-900/25 border-emerald-200/70 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400'
                                    : isNext
                                        ? 'bg-accent text-accent-contrast border-transparent'
                                        : 'bg-sunken border-line text-subtle'
                            }`}>
                                {step.done ? <CheckCircle2 size={18} /> : Icon ? <Icon size={18} /> : <span className="text-xs font-black tabular-nums">{i + 1}</span>}
                            </span>

                            <div className="min-w-0 flex-1">
                                <p className={`text-sm font-bold ${step.done ? 'text-muted line-through decoration-1' : 'text-content'}`}>
                                    {step.title}
                                </p>
                                <p className="text-xs text-muted font-medium mt-0.5 line-clamp-2">{step.description}</p>
                            </div>

                            {!step.done && (
                                <div className="shrink-0">
                                    <StepAction action={step.action} emphasized={isNext} />
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
};

export default GettingStartedGuide;
