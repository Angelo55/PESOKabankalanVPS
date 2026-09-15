import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import useFocusTrap from '../../hooks/useFocusTrap';

/**
 * ProcessingModal — the shared, system-consistent overlay for the Job Seeker
 * data-processing modules (Import Past Applications, Analyze My Resume). Phase A of
 * docs/data-processing-modules-proposal.md.
 *
 * Behaviour (the important part):
 *  • Backdrop-click closes the modal — but ONLY when it is NOT `busy`, so an in-flight
 *    import/analysis is never interrupted. Clicks INSIDE the card never bubble to the
 *    backdrop (the card is a separate element; the handler checks `e.target === currentTarget`).
 *  • Escape mirrors the backdrop rule (ignored while busy).
 *  • The X button stays available but is DISABLED while busy.
 *  • Focus is trapped + restored (useFocusTrap, WCAG 2.4.3).
 *  • Design-token styling, responsive width, and the app's standard enter animation.
 *
 * Props: open, onClose, title, icon (element), iconWrapClass (accent chip classes),
 *        busy (guards close), size ('md'|'lg'), children (the body).
 */
const SIZES = { md: 'max-w-lg', lg: 'max-w-2xl' };

const ProcessingModal = ({ open, onClose, title, icon, iconWrapClass = 'bg-accent-soft text-accent-text', busy = false, size = 'md', children }) => {
    const trapRef = useFocusTrap(open);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, busy, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
            <div
                ref={trapRef}
                role="dialog"
                aria-modal="true"
                aria-busy={busy}
                tabIndex={-1}
                className={`w-full ${SIZES[size] || SIZES.md} bg-surface/95 dark:bg-surface/90 backdrop-blur-2xl border border-white/60 dark:border-line rounded-3xl shadow-2xl p-6 sm:p-8 focus:outline-none animate-in zoom-in-95 slide-in-from-bottom-4 duration-300`}
            >
                <div className="flex justify-between items-center mb-6 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        {icon && <span className={`p-2.5 rounded-2xl shrink-0 ${iconWrapClass}`}>{icon}</span>}
                        <h2 className="text-xl sm:text-2xl font-black text-content truncate">{title}</h2>
                    </div>
                    <button
                        onClick={() => { if (!busy) onClose(); }}
                        disabled={busy}
                        aria-label="Close"
                        className="p-2 bg-sunken/50 hover:bg-sunken dark:hover:bg-raised text-muted rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <X size={20} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

export default ProcessingModal;
