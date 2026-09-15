import React from 'react';
import { CHAT_MSG_IN } from './chatMotion';

/**
 * TypingIndicator — the shared "assistant is typing" three-dot bubble for BOTH chatbots
 * (Phase 2). Same structure + staggered bounce; `variant` supplies the palette, and an
 * optional `avatar` slot matches the authenticated chatbot's per-message avatar column.
 */
const DOTS = {
    app: { bubble: 'bg-surface/95 dark:bg-surface/95 backdrop-blur-2xl border border-white/80 dark:border-line/80 shadow-md rounded-2xl rounded-bl-sm', dot: 'bg-accent dark:bg-accent-text' },
    landing: { bubble: 'bg-white dark:bg-[#16223a] border border-[#bfc8c6]/40 dark:border-white/10 shadow-sm rounded-2xl rounded-bl-md', dot: 'bg-[#003631]/40 dark:bg-[#7fd8ba]/50' },
};

export default function TypingIndicator({ variant = 'app', avatar = null }) {
    const v = DOTS[variant] || DOTS.app;
    return (
        <div className={`flex items-end gap-2 justify-start ${CHAT_MSG_IN}`}>
            {avatar}
            <div className={`px-4 py-3 flex items-center gap-1.5 ${v.bubble}`} aria-label="Assistant is typing">
                <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${v.dot}`} style={{ animationDelay: '0ms' }} />
                <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${v.dot}`} style={{ animationDelay: '150ms' }} />
                <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${v.dot}`} style={{ animationDelay: '300ms' }} />
            </div>
        </div>
    );
}
