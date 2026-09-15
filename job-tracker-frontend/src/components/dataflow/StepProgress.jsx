import React from 'react';

/**
 * StepProgress — an explicit, named progress state for a data-processing job (NOT a
 * bare spinner). Phase A: a single active step (icon + title + subtitle + bar). Phase B
 * will extend it with a `steps` array + current index for the full pipeline; the current
 * one-step API stays a subset of that.
 *
 * Motion respects prefers-reduced-motion via the global reduced-motion rule.
 *
 * Props: icon (element), title, subtitle, barClass (accent bar color).
 */
const StepProgress = ({ icon, title, subtitle, barClass = 'bg-accent' }) => (
    <div className="flex flex-col items-center justify-center py-10 text-center animate-in fade-in duration-300">
        {icon && <div className="mb-6 animate-pulse motion-reduce:animate-none" aria-hidden="true">{icon}</div>}
        <h3 className="text-xl sm:text-2xl font-black text-content mb-2">{title}</h3>
        {subtitle && <p className="text-muted font-medium">{subtitle}</p>}
        <div className="w-48 h-1.5 bg-sunken rounded-full mt-8 overflow-hidden" role="progressbar" aria-label={title}>
            <div className={`h-full ${barClass} rounded-full w-full animate-pulse motion-reduce:animate-none`} />
        </div>
    </div>
);

export default StepProgress;
