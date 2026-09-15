import React from 'react';
import { AudioLines } from 'lucide-react';
import JobSeekerMascot from '../JobSeekerMascot';
import { CHAT_LAUNCHER_TRANSITION, chatLauncherState } from './chatMotion';

/**
 * ChatLauncher — the ONE pill launcher for BOTH chatbots (Phase 1 of the chatbot UI
 * unification). Same structure / dimensions / typography / spacing / interaction: a rounded
 * pill fronted by the shared `JobSeekerMascot` logo, an "Ask PESO Assistant" label (collapsed
 * on mobile), and an accent "Chat" chip; a soft aura + hover-lift; it scales away when the
 * panel opens.
 *
 * `variant` swaps ONLY the palette — the authenticated assistant lives inside AppLayout and
 * uses the design tokens (`accent`, `surface`, dark-mode aware); the public assistant lives on
 * the Landing Page, which is deliberately excluded from the tokens (§24/§45), so it uses the
 * bespoke landing greens. Same product, two contexts — exactly the intended distinction.
 */
const VARIANTS = {
    app: {
        pill: 'bg-surface/95 dark:bg-surface/95 border-white/80 dark:border-line/70 shadow-[0_10px_35px_-8px_rgba(26,74,56,0.35)] hover:shadow-[0_14px_40px_-8px_rgba(26,74,56,0.45)]',
        glow: 'from-accent/30 via-accent/25 to-accent-hover/30',
        avatar: 'from-accent-soft to-accent-soft dark:from-accent dark:to-accent-hover border-white/70 dark:border-accent/30',
        label: 'text-muted dark:text-muted',
        chip: 'from-accent to-accent-hover text-accent-contrast dark:text-[#0f172a]',
    },
    landing: {
        pill: 'bg-white dark:bg-[#111b2e] border-[#bfc8c6]/60 dark:border-white/10 shadow-[0_10px_35px_-8px_rgba(0,54,49,0.35)] hover:shadow-[0_14px_40px_-8px_rgba(0,54,49,0.45)]',
        glow: 'from-[#003631]/30 via-[#1a4a38]/25 to-[#003631]/30',
        avatar: 'from-[#caead6] to-[#eff4ff] dark:from-[#1a4a38] dark:to-[#16223a] border-white dark:border-white/10',
        label: 'text-[#404947] dark:text-[#a3adbf]',
        chip: 'from-[#134e48] to-[#003631] text-white',
    },
};

export default function ChatLauncher({ open, onClick, variant = 'app' }) {
    const v = VARIANTS[variant] || VARIANTS.app;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Open the PESO assistant chat"
            aria-expanded={open}
            className={`relative flex items-center gap-2 sm:gap-2.5 p-1.5 pr-1.5 sm:pl-2 backdrop-blur-xl border rounded-full pointer-events-auto group hover:-translate-y-0.5 ${v.pill} ${CHAT_LAUNCHER_TRANSITION} ${chatLauncherState(open)}`}
        >
            {/* soft branded aura */}
            <span className={`absolute -inset-1.5 bg-gradient-to-r ${v.glow} blur-lg opacity-40 group-hover:opacity-70 rounded-full transition-opacity duration-500 -z-10`} />
            {/* shared mascot logo in a variant-colored frame */}
            <span className={`w-10 h-10 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br ${v.avatar} border shadow-sm`}>
                <JobSeekerMascot avatar className="w-[130%] h-[130%] translate-y-[6%]" />
            </span>
            <span className={`hidden sm:block text-sm font-bold pr-1 ${v.label}`}>Ask PESO Assistant</span>
            <span className={`flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-full bg-gradient-to-br text-xs font-black shadow-md group-hover:shadow-[0_4px_15px_rgba(26,74,56,0.4)] transition-shadow ${v.chip}`}>
                <AudioLines size={14} />
                Chat
            </span>
        </button>
    );
}
