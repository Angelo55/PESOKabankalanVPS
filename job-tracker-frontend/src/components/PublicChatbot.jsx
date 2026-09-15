import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, RotateCcw, ArrowRight } from 'lucide-react';
import API from '../api';
import useFocusTrap from '../hooks/useFocusTrap';
import ChatLauncher from './chat/ChatLauncher';
import MessageBubble from './chat/MessageBubble';
import TypingIndicator from './chat/TypingIndicator';
import { CHAT_PANEL_TRANSITION, chatPanelState } from './chat/chatMotion';

/**
 * PublicChatbot — the PUBLIC "Visitor Support" assistant on the Landing Page (Phase C of
 * docs/public-visitor-chatbot-proposal.md). It talks to POST /api/public-assistant/query
 * (unauthenticated, public-safe tools) and is SEPARATE from the authenticated in-app
 * chatbot. Landing-native: bespoke landing palette (LandingPage is excluded from the app
 * design tokens, §24), the shared fade/slide animation language, focus trap + a11y.
 *
 * Conversation is client-managed (stateless server): we send the recent turns each time;
 * nothing is persisted for anonymous visitors. Navigation is NOT decided here — the backend
 * returns `actions` (allowlisted), and onNavigate() (from LandingPage) scrolls to a section
 * or opens the Register/Sign-in modal.
 */

const GREETING = "Hi! 👋 I'm the PESO Kabankalan Assistant. I can help you understand PESO, find jobs, register, or get in touch with our office. What would you like to know?";

const QUICK_ACTIONS = [
    'What is PESO?',
    'How do I register?',
    'What jobs are available?',
    'How do I apply for a job?',
    'What are the requirements?',
    'Where is the PESO office?',
    'How can I contact PESO?',
    'I need help with my account.',
];

// Cap the client-side history we send (the backend re-caps too). Keeps payloads small.
const SEND_LIMIT = 12;

export default function PublicChatbot({ onNavigate }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content, actions?}
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    const panelRef = useFocusTrap(open);
    const inputRef = useRef(null);
    const scrollRef = useRef(null);
    const liveRef = useRef(true); // guards setState after unmount

    // Set true on (re)mount, false on unmount. Setting it in the effect SETUP (not just the
    // cleanup) keeps it correct across a remount — otherwise a dev Fast-Refresh cycle leaves
    // it stuck false and in-flight replies get silently dropped.
    useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; }; }, []);

    // Auto-scroll to the newest message / typing indicator.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, loading, open]);

    // Focus the input when the panel opens.
    useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open]);

    // Escape closes the panel.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    // Click-outside to dismiss — a pointerdown anywhere OUTSIDE the panel closes it, while
    // clicks/scrolls/typing INSIDE stay fully interactive (panelRef.contains guard). Attached
    // only while open, so the launcher click that opens the panel (this effect isn't mounted
    // yet) never self-closes it. No backdrop element: the rest of the page keeps working, the
    // clicked element still receives its own click, nothing is left behind, and the normal
    // open/close transition plays on setOpen(false). (Launcher is pointer-events-none while
    // open, so it can't double-toggle.)
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [open]);

    const send = async (text) => {
        const content = String(text ?? input).trim();
        if (!content || loading) return;
        const nextMessages = [...messages, { role: 'user', content }];
        setMessages(nextMessages);
        setInput('');
        setLoading(true);
        try {
            const payload = nextMessages
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .slice(-SEND_LIMIT)
                .map(({ role, content: c }) => ({ role, content: c }));
            const res = await API.post('/public-assistant/query', { messages: payload });
            const { reply, actions } = res.data || {};
            if (!liveRef.current) return;
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: reply || "Sorry, I couldn't find an answer. Please try rephrasing, or contact the PESO office.",
                actions: Array.isArray(actions) ? actions : [],
            }]);
        } catch (err) {
            if (!liveRef.current) return;
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: "I'm sorry — I can't reach the assistant right now. You can browse the Job Board and Common Questions on this page, or message the PESO Kabankalan office on Facebook.",
                actions: [],
            }]);
        } finally {
            if (liveRef.current) setLoading(false);
        }
    };

    const reset = () => { setMessages([]); setInput(''); setLoading(false); inputRef.current?.focus(); };

    const handleAction = (a) => {
        if (a?.target && typeof onNavigate === 'function') onNavigate(a.target);
        setOpen(false);
    };

    return (
        <>
            {/* Shared pill launcher — same treatment as the authenticated PESO Assistant
                (mascot logo + "Ask PESO Assistant" + Chat chip), in the landing palette. */}
            <div className="fixed bottom-5 right-5 z-[60]">
                <ChatLauncher open={open} onClick={() => setOpen(true)} variant="landing" />
            </div>

            {/* Chat panel */}
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="false"
                aria-label="PESO Kabankalan Assistant"
                aria-hidden={!open}
                inert={!open || undefined}
                className={`fixed z-[60] bg-white dark:bg-[#0f1826] flex flex-col overflow-hidden ${CHAT_PANEL_TRANSITION}
                    bottom-0 right-0 w-full h-[85vh] rounded-t-3xl
                    sm:bottom-5 sm:right-5 sm:w-[380px] sm:h-[560px] sm:max-h-[80vh] sm:rounded-3xl
                    border border-[#bfc8c6]/40 dark:border-white/10 shadow-2xl shadow-[#003631]/20
                    ${chatPanelState(open)}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-br from-[#134e48] via-[#1a4a38] to-[#003631] text-white shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/15 shrink-0"><MessageCircle size={18} /></span>
                        <div className="min-w-0">
                            <p className="font-black text-sm leading-tight truncate">PESO Kabankalan Assistant</p>
                            <p className="text-[11px] text-[#caead6] leading-tight">Public help · anonymous</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {messages.length > 0 && (
                            <button type="button" onClick={reset} aria-label="Start a new conversation" className="p-2 rounded-lg hover:bg-white/15 transition-colors bg-transparent border-none cursor-pointer text-white"><RotateCcw size={16} /></button>
                        )}
                        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-2 rounded-lg hover:bg-white/15 transition-colors bg-transparent border-none cursor-pointer text-white"><X size={18} /></button>
                    </div>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3 bg-[#f8f9ff] dark:bg-[#0b1220]" aria-live="polite" aria-atomic="false">
                    {/* Greeting (static first bubble) */}
                    <div className="flex justify-start">
                        <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-white dark:bg-[#16223a] border border-[#bfc8c6]/40 dark:border-white/10 text-[#404947] dark:text-[#cdd5e0] text-sm leading-relaxed shadow-sm">
                            {GREETING}
                        </div>
                    </div>

                    {/* Quick actions — only before the first user message */}
                    {messages.length === 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {QUICK_ACTIONS.map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    onClick={() => send(q)}
                                    className="px-3 py-1.5 rounded-full bg-white dark:bg-[#16223a] border border-[#bfc8c6]/60 dark:border-white/10 text-[#003631] dark:text-[#7fd8ba] text-xs font-semibold hover:bg-[#caead6]/50 dark:hover:bg-[#1a4a38]/50 hover:border-[#003631]/30 active:scale-95 transition-all cursor-pointer"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Conversation — shared MessageBubble (landing palette); the derived
                        navigation buttons render inside the assistant bubble via `actions`. */}
                    {messages.map((m, i) => (
                        <MessageBubble
                            key={i}
                            variant="landing"
                            role={m.role}
                            actions={m.role === 'assistant' && Array.isArray(m.actions) && m.actions.length > 0 ? (
                                <div className="flex flex-wrap gap-2 mt-2.5">
                                    {m.actions.map((a, j) => (
                                        <button
                                            key={j}
                                            type="button"
                                            onClick={() => handleAction(a)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#eff4ff] text-[#003631] text-xs font-bold border border-[#003631]/20 hover:bg-[#caead6] active:scale-95 transition-all cursor-pointer"
                                        >
                                            {a.label || 'Go'} <ArrowRight size={13} />
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        >
                            {m.content}
                        </MessageBubble>
                    ))}

                    {/* Typing indicator (shared) */}
                    {loading && <TypingIndicator variant="landing" />}
                </div>

                {/* Composer */}
                <form
                    onSubmit={(e) => { e.preventDefault(); send(); }}
                    className="flex items-end gap-2 p-3 border-t border-[#bfc8c6]/40 dark:border-white/10 bg-white dark:bg-[#0f1826] shrink-0"
                >
                    <input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={loading}
                        maxLength={500}
                        placeholder="Ask about PESO, jobs, registration…"
                        aria-label="Type your question"
                        className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#bfc8c6]/60 dark:border-white/10 bg-[#f8f9ff] dark:bg-[#16223a] text-[#404947] dark:text-[#e6ebf2] text-sm placeholder:text-[#404947]/50 dark:placeholder:text-[#8892a3] focus:outline-none focus:border-[#003631]/50 focus:ring-2 focus:ring-[#caead6] disabled:opacity-60"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        aria-label="Send"
                        className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#003631] text-white shrink-0 hover:bg-[#0a4a3f] active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-none"
                    >
                        <Send size={18} />
                    </button>
                </form>
            </div>
        </>
    );
}
