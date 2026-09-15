import React from 'react';
import { CHAT_MSG_IN } from './chatMotion';

/**
 * MessageBubble — the shared chat message row for BOTH chatbots (Phase 2). One row wrapper +
 * entrance motion; `variant` supplies the palette-exact bubble styling (verbatim from each
 * chatbot's original markup, so neither changes visually):
 *   - `app`     → the authenticated PESO Assistant (design tokens, glass, 13px), with an
 *                 optional `avatar` slot for its consecutive-AI-group avatar.
 *   - `landing` → the public Landing assistant (bespoke greens, 14px), with an optional
 *                 `actions` slot rendered inside the assistant bubble (its nav buttons).
 *
 * Structure/motion are shared; only colors + the two context-specific slots differ — the
 * intended "same product, two contexts" split.
 */
const BUBBLE = {
    app: {
        maxW: 'max-w-[80%]',
        text: 'text-[13px]',
        user: 'bg-gradient-to-br from-accent/95 to-accent-hover/95 dark:from-accent/95 dark:to-accent-hover/95 backdrop-blur-xl border border-accent/20 dark:border-accent/30 text-white dark:text-[#0f172a] font-semibold rounded-2xl rounded-br-sm shadow-md',
        assistant: 'bg-surface/95 dark:bg-surface/95 backdrop-blur-2xl dark:text-gray-100 text-content font-medium rounded-2xl rounded-bl-sm border border-white/80 dark:border-line/80 shadow-md',
    },
    landing: {
        maxW: 'max-w-[85%]',
        text: 'text-sm',
        user: 'bg-[#003631] dark:bg-[#0e5a4d] text-white rounded-2xl rounded-tr-md shadow-sm',
        assistant: 'bg-white dark:bg-[#16223a] border border-[#bfc8c6]/40 dark:border-white/10 text-[#404947] dark:text-[#cdd5e0] rounded-2xl rounded-tl-md shadow-sm',
    },
};

export default function MessageBubble({ variant = 'app', role = 'assistant', avatar = null, actions = null, children }) {
    const isUser = role === 'user';
    const v = BUBBLE[variant] || BUBBLE.app;
    return (
        <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'} ${CHAT_MSG_IN}`}>
            {!isUser && avatar}
            <div className={`${v.maxW} px-3.5 py-2.5 ${v.text} leading-relaxed whitespace-pre-wrap break-words ${isUser ? v.user : v.assistant}`}>
                {children}
                {!isUser && actions}
            </div>
        </div>
    );
}
