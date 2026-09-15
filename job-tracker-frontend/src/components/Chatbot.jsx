import React, { useState, useEffect, useRef } from 'react';
import { X, Send, HelpCircle, FileText, LayoutDashboard, Globe } from 'lucide-react';
import API from '../api';
import JobSeekerMascot from './JobSeekerMascot';
import ChatLauncher from './chat/ChatLauncher';
import MessageBubble from './chat/MessageBubble';
import TypingIndicator from './chat/TypingIndicator';
import { CHAT_PANEL_TRANSITION, chatPanelState, CHAT_MSG_IN } from './chat/chatMotion';

// Circular mascot avatar in a soft branded frame — the launcher/header face.
const AssistantAvatar = ({ className = 'w-9 h-9' }) => (
    <span className={`${className} shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-accent-soft to-accent-soft dark:from-accent dark:to-accent-hover border border-white/70 dark:border-accent/30 shadow-sm`}>
        <JobSeekerMascot avatar className="w-[130%] h-[130%] translate-y-[6%]" />
    </span>
);

const QUICK_ACTIONS = [
    { id: 1, label: "How to Apply", icon: <LayoutDashboard size={14} />, query: "How do I apply to a job, and what do I need to complete first?" },
    { id: 2, label: "My Referrals", icon: <FileText size={14} />, query: "How do PESO referrals work and how do I get referred?" },
    { id: 3, label: "Build My Résumé", icon: <HelpCircle size={14} />, query: "How do I build and improve my résumé to raise my match score?" }
];

const INITIAL_GREETINGS = {
    'en': "Hi! I'm your PESO Assistant. I can help you navigate the platform, explain features, or offer career advice. How can I help today?",
    'fil': "Kamusta! Ako ang iyong PESO Assistant. Matutulungan kitang gamitin ang platform, ipaliwanag ang mga features, o magbigay ng career advice. Paano kita matutulungan ngayon?",
    'ceb': "Maayong adlaw! Ako ang imong PESO Assistant. Andam ko mutabang nimo sa pag-navigate sa platform o muhatag og career advice. Unsaon nako pagtabang nimo karon?",
    'ilo': "Naimbag nga aldaw! Siak ti PESO Assistant mo. Situtuladak nga tumulong kenka nga ag-navigate iti platform, mangilawlawag kadagiti features, wenno mangted ti career advice. Kasanok nga makatulong ita?",
    'es': "¡Hola! Soy tu Asistente PESO. Puedo ayudarte a navegar por la plataforma, explicar características o ofrecer consejos profesionales. ¿Cómo puedo ayudarte hoy?"
};

const LANGUAGES = [
    { code: 'en', label: 'EN', full: 'English' },
    { code: 'fil', label: 'FIL', full: 'Tagalog' },
    { code: 'ceb', label: 'CEB', full: 'Cebuano' },
    { code: 'ilo', label: 'ILO', full: 'Ilocano' },
    { code: 'es', label: 'ES', full: 'Español' }
];

const Chatbot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [interactionState, setInteractionState] = useState('main_menu');
    
    const [language, setLanguage] = useState('en');
    const [isLangMenuOpen, setIsLangMenuOpen] = useState(false); 
    
    const scrollRef = useRef(null);
    const langMenuRef = useRef(null);

    // ----------------------------------------------------------------------
    // INTERACTION MODEL: the window opens ONLY on explicit user intent —
    // the launcher click, the nudge pill, or an AI-analysis request from the
    // job board. The old 60s idle timer and the never-dispatched
    // 'user-confused' listener force-opened the panel (plus its full-screen
    // backdrop) mid-task; both are intentionally gone. Do not reintroduce
    // auto-open — proactive attention is limited to the passive nudge below.
    // ----------------------------------------------------------------------

    // Passive nudge: after 90s, show a small dismissible "Need help?" pill by
    // the launcher. Once per browser session, auto-hides after 10s, and never
    // opens the window on its own.
    const [nudgeVisible, setNudgeVisible] = useState(false);

    useEffect(() => {
        if (sessionStorage.getItem('hiReChatNudgeShown')) return;
        const show = setTimeout(() => {
            sessionStorage.setItem('hiReChatNudgeShown', '1');
            setNudgeVisible(true);
        }, 90000);
        return () => clearTimeout(show);
    }, []);

    useEffect(() => {
        if (!nudgeVisible) return;
        const hide = setTimeout(() => setNudgeVisible(false), 10000);
        return () => clearTimeout(hide);
    }, [nudgeVisible]);

    // The chat is modal on every breakpoint: the backdrop below sits under the
    // panel and owns click-outside-to-close, so no document-level mousedown
    // listener is needed (one would only double-fire on the same clicks).
    // Escape stays here as the keyboard equivalent.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); };
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (langMenuRef.current && !langMenuRef.current.contains(event.target)) setIsLangMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const savedLang = localStorage.getItem('hi_re_chat_language') || 'en';
        setLanguage(savedLang);
        fetchDatabaseHistory(savedLang);
    }, []);

    const fetchDatabaseHistory = async (currentLang) => {
        try {
            const response = await API.get('/chatbot/history'); 
            const dbHistory = response.data;
            
            if (dbHistory && dbHistory.length > 0) {
                setMessages(dbHistory);
                if (dbHistory.length > 1) setInteractionState('follow_up');
            } else {
                setMessages([{ sender: 'ai', text: INITIAL_GREETINGS[currentLang] || INITIAL_GREETINGS['en'] }]);
                setInteractionState('main_menu');
            }
        } catch (error) {
            console.error("Failed to load chat history from database:", error);
            setMessages([{ sender: 'ai', text: INITIAL_GREETINGS[currentLang] || INITIAL_GREETINGS['en'] }]);
            setInteractionState('main_menu');
        }
    };

    // Auto-scroll to the newest message. Set the container's scrollTop directly (the same
    // cheap approach the public assistant uses) instead of scrollIntoView({behavior:'smooth'}) —
    // the smooth variant animated on EVERY message, competing with the bubble entrance and
    // occasionally nudging the whole page. This is one layout write, no animation.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, isLoading, isOpen]);

    // ----------------------------------------------------------------------
    // EVENT BUS: PUBLIC JOB BOARD AI INTEGRATION
    // ----------------------------------------------------------------------
    useEffect(() => {
        const handleAiAnalysis = async (e) => {
            const job = e.detail.job;
            setIsOpen(true);
            setInteractionState('waiting_for_ai');
            setIsLoading(true);

            // 1. Initial State
            setMessages(prev => [...prev, { sender: 'ai', text: `Initializing compatibility analysis for **${job.title}** at **${job.company}**...` }]);
            
            // 2. Sequential Processing Animations (Simulated pacing for UX)
            await new Promise(r => setTimeout(r, 1200));
            setMessages(prev => [...prev, { sender: 'ai', text: `Analyzing your profile...` }]);
            
            await new Promise(r => setTimeout(r, 1200));
            setMessages(prev => [...prev, { sender: 'ai', text: `Reviewing resume content...` }]);
            
            await new Promise(r => setTimeout(r, 1200));
            setMessages(prev => [...prev, { sender: 'ai', text: `Comparing qualifications and evaluating skill requirements...` }]);

            // 3. API Execution
            try {
                // Hidden prompt structure for the backend AI
                const prompt = `Act as a career advisor. Provide a compatibility analysis and advice for a user applying to the job: ${job.title} at ${job.company}. Job Description: ${job.description ? job.description.substring(0, 500) : 'No description provided'}. Structure the response with Strengths, Gaps, Resume Tips, and Interview Advice.`;
                
                const response = await API.post('/chatbot/query', { message: prompt, language }); 
                setMessages(prev => [...prev, { sender: 'ai', text: response.data.reply }]);
            } catch (error) {
                setMessages(prev => [...prev, { sender: 'ai', text: "I encountered an error while analyzing this job. Please try again." }]);
            } finally {
                setIsLoading(false);
                setInteractionState('follow_up');
            }
        };

        window.addEventListener('trigger-ai-analysis', handleAiAnalysis);
        return () => window.removeEventListener('trigger-ai-analysis', handleAiAnalysis);
    }, [language]);

    // ----------------------------------------------------------------------
    // HANDLERS
    // ----------------------------------------------------------------------
    const handleLanguageChange = (newLang) => {
        setLanguage(newLang);
        localStorage.setItem('hi_re_chat_language', newLang);
        setIsLangMenuOpen(false);
        
        const confirmMsg = newLang === 'fil' ? "Nai-set na ang wika sa Filipino. Magpapatuloy ako sa pagsasalita sa Filipino." :
                           newLang === 'ceb' ? "Gi-set na ang pinulongan sa Cebuano." :
                           newLang === 'ilo' ? "Naikabil ti lengguahe iti Ilocano." :
                           newLang === 'es' ? "Idioma configurado a Español." :
                           "Language set to English. I will continue responding in English.";
                           
        setMessages(prev => [...prev, { sender: 'ai', text: confirmMsg }]);
    };

    const handleSend = async (textQuery) => {
        const query = typeof textQuery === 'string' ? textQuery : input;
        if (!query.trim()) return;

        const userMessage = { sender: 'user', text: query };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        setInteractionState('waiting_for_ai');

        try {
            const response = await API.post('/chatbot/query', { 
                message: userMessage.text,
                language: language 
            }); 
            
            setMessages((prev) => [...prev, { sender: 'ai', text: response.data.reply }]);
        } catch (error) {
            const errorMessage = error.response?.data?.reply || "Sorry, I'm having trouble connecting to my knowledge base right now.";
            setMessages((prev) => [...prev, { sender: 'ai', text: errorMessage }]);
        } finally {
            setIsLoading(false);
            setInteractionState('follow_up'); 
        }
    };

    const handleFollowUp = (action) => {
        if (action === 'Yes') {
            const reply = language === 'fil' ? "Sige! Ano ang gusto mong itanong?" : "Of course! What's on your mind?";
            setMessages(prev => [...prev, { sender: 'ai', text: reply }]);
            setInteractionState('idle'); 
        } else if (action === 'No') {
            const reply = language === 'fil' ? "Sige! Nandito lang ako kung kailangan mo ng tulong." : "Alright! Feel free to ask anytime if you need help.";
            setMessages(prev => [...prev, { sender: 'ai', text: reply }]);
            setInteractionState('idle');
        } else if (action === 'MainMenu') {
            setInteractionState('main_menu'); 
        }
    };

    const clearHistory = async () => {
        try {
            await API.delete('/chatbot/history'); 
            const resetMessage = [{ sender: 'ai', text: INITIAL_GREETINGS[language] || INITIAL_GREETINGS['en'] }];
            setMessages(resetMessage);
            setInteractionState('main_menu');
        } catch (error) {
            console.error("Failed to delete chat history from server:", error);
        }
    };

    // ----------------------------------------------------------------------
    // RENDER
    // ----------------------------------------------------------------------
    return (
        <>
            {/* Modal backdrop — every breakpoint. Dims and lightly blurs the page
                so focus lands on the chat while the content behind stays readable,
                and owns click-outside-to-close (Escape is the keyboard twin).

                Kept lightweight on purpose: a plain opacity-animated dim (a
                compositor-only property), with NO backdrop-filter. A full-viewport
                `backdrop-blur` re-samples the entire page every frame for the whole
                time the chat is open — pure cost for a 2px effect nobody reads through
                the dim anyway; dropping it is the single biggest processing win here.
                `pointer-events-none` while closed means the invisible layer can never
                swallow clicks on the page. */}
            <div
                onClick={() => setIsOpen(false)}
                aria-hidden="true"
                className={`fixed inset-0 z-[9998] bg-gray-900/30 dark:bg-black/50 transition-opacity duration-300 ease-out ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            />

            <div className="fixed bottom-6 right-4 sm:bottom-8 sm:right-6 z-[9999] flex flex-col items-end pointer-events-none">

                <div
                    className={`w-[calc(100vw-2rem)] max-w-[360px] h-[min(560px,calc(100dvh-7.5rem))] mb-16 absolute bottom-0 right-0 flex flex-col overflow-hidden shadow-2xl rounded-3xl transform-gpu ${CHAT_PANEL_TRANSITION}
                    ${chatPanelState(isOpen)}`}
                    role="dialog"
                    aria-label="PESO Assistant chat"
                    aria-hidden={!isOpen}
                >
                    {/* Panel base. Glassmorphism needs SOME transparency to read as
                        glass, but at 60% the page behind bled through and made
                        message text hard to follow. Raised to 92% and paired with a
                        stronger backdrop-blur: the frosted depth and inner highlight
                        survive, while body copy now sits on a near-solid surface. */}
                    {/* One frosted layer for the whole panel. The blur was `3xl`; the panel
                        sits at 92% opacity so almost nothing shows through it, yet at 3xl the
                        compositor re-sampled the page behind on every frame of the open
                        scale/translate — the visible flicker. `md` keeps the frosted edge at a
                        fraction of the cost. The nested header/composer no longer re-blur on
                        top of this (they sample an already-near-opaque surface — invisible work). */}
                    <div className="absolute inset-0 bg-surface/92 dark:bg-canvas/92 backdrop-blur-md shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-white/70 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"></div>

                    {/* Brand glow, dialled back so it tints the glass rather than
                        competing with the text sitting on top of it. */}
                    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-br from-accent/12 to-accent/8 dark:from-accent/8 dark:to-accent/12 blur-[60px] rounded-full pointer-events-none mix-blend-multiply dark:mix-blend-screen opacity-40"></div>

                    <div className="relative p-3 flex justify-between items-center shrink-0 border-b border-white/50 dark:border-line/50 bg-surface/70 dark:bg-black/30 z-[60]">
                        <div className="flex items-center gap-2.5">
                            <AssistantAvatar className="w-9 h-9" />
                            <div>
                                <span className="font-black tracking-tight text-sm block leading-none text-content drop-shadow-sm">PESO Assistant</span>
                                <span className="text-[10px] font-bold text-accent-text uppercase tracking-wider flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-accent-text shadow-[0_0_5px_rgba(153,231,66,0.6)]" /> Online
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">

                            <div className="relative" ref={langMenuRef}>
                                <button
                                    onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all duration-300 border shadow-sm
                                    ${isLangMenuOpen
                                        ? 'bg-white dark:bg-raised border-white/80 dark:border-line text-content shadow-[0_0_15px_rgba(255,255,255,0.4)] dark:shadow-[0_0_15px_rgba(153,231,66,0.15)]'
                                        : 'bg-surface/80 dark:bg-surface/80 hover:bg-white dark:hover:bg-raised border-white/60 dark:border-line text-content'}`}
                                >
                                    <Globe size={12} className={isLangMenuOpen ? "text-accent-text" : "text-muted"} />
                                    <span>{language.toUpperCase()}</span>
                                </button>

                                <div
                                    className={`absolute right-0 top-full mt-2 w-32 bg-surface/70 dark:bg-canvas/80 backdrop-blur-2xl border border-white/60 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] flex flex-col p-1 origin-top-right transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-[100]
                                    ${isLangMenuOpen ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'}`}
                                >
                                    {LANGUAGES.map((lang) => (
                                        <button
                                            key={lang.code}
                                            onClick={() => handleLanguageChange(lang.code)}
                                            className={`flex items-center justify-between w-full px-2.5 py-2 rounded-xl text-[10px] font-bold transition-all duration-200
                                            ${language === lang.code
                                                ? 'bg-accent/10 dark:bg-accent-text/15 text-accent-text'
                                                : 'text-muted hover:bg-surface/60 dark:hover:bg-surface/10 hover:shadow-sm'}`}
                                        >
                                            <span className="tracking-wide">{lang.label} - {lang.full}</span>
                                            {language === lang.code && <div className="w-1.5 h-1.5 rounded-full bg-accent dark:bg-accent-text shadow-[0_0_5px_rgba(26,74,56,0.5)] dark:shadow-[0_0_5px_rgba(153,231,66,0.5)]"></div>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button onClick={clearHistory} className="text-[10px] font-bold text-muted hover:text-red-500 mx-0.5 transition-colors">Clear</button>
                            <button onClick={() => setIsOpen(false)} aria-label="Close chat" className="bg-surface/80 dark:bg-surface/80 hover:bg-white dark:hover:bg-raised rounded-full transition-all p-1 border border-white/60 dark:border-line shadow-sm text-muted">
                                <X size={14} />
                            </button>
                        </div>
                    </div>

                    <div ref={scrollRef} className="relative flex-1 p-3.5 overflow-y-auto bg-transparent space-y-3.5 custom-scrollbar z-10">
                        {messages.map((msg, idx) => {
                            const isUser = msg.sender === 'user';
                            // Only the first bubble of a consecutive AI group gets the avatar;
                            // the rest indent to align (a spacer), keeping groups tidy.
                            const startsAiGroup = !isUser && (idx === 0 || messages[idx - 1].sender === 'user');
                            const avatar = startsAiGroup
                                ? <AssistantAvatar className="w-7 h-7 mb-0.5" />
                                : <span className="w-7 shrink-0" aria-hidden="true" />;
                            return (
                                <MessageBubble key={idx} variant="app" role={isUser ? 'user' : 'assistant'} avatar={avatar}>
                                    {msg.text}
                                </MessageBubble>
                            );
                        })}

                        {isLoading && <TypingIndicator variant="app" avatar={<AssistantAvatar className="w-7 h-7 mb-0.5" />} />}
                    </div>

                    {interactionState === 'main_menu' && !isLoading && (
                        <div className={`relative px-3.5 pb-1.5 flex flex-col gap-2 shrink-0 z-10 ${CHAT_MSG_IN}`}>
                            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1.5">
                                {QUICK_ACTIONS.map(action => (
                                    <button
                                        key={action.id}
                                        onClick={() => handleSend(action.query)}
                                        className="flex items-center gap-1.5 shrink-0 px-3 py-2 bg-surface/90 dark:bg-surface/90 border border-white dark:border-line text-content text-[11px] font-bold rounded-xl hover:bg-white dark:hover:bg-raised hover:border-accent/40 dark:hover:border-accent/40 hover:shadow-lg transition-all duration-300 shadow-sm"
                                    >
                                        <div className="p-1 bg-sunken dark:bg-gray-900 rounded-lg">{action.icon}</div>
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {interactionState === 'follow_up' && !isLoading && (
                        <div className={`relative px-3.5 pb-1.5 flex flex-col gap-2 shrink-0 z-10 ${CHAT_MSG_IN}`}>
                            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1.5">
                                <button onClick={() => handleFollowUp('Yes')} className="shrink-0 px-3 py-2 bg-indigo-50/95 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-[11px] rounded-xl border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 hover:shadow-md transition-all shadow-sm">Ask Question</button>
                                <button onClick={() => handleFollowUp('No')} className="shrink-0 px-3 py-2 bg-surface/90 dark:bg-surface/90 text-muted font-bold text-[11px] rounded-xl border border-white dark:border-line hover:bg-white hover:shadow-md transition-all shadow-sm">No, I'm good</button>
                                <button onClick={() => handleFollowUp('MainMenu')} className="shrink-0 px-3 py-2 bg-accent/10 dark:bg-accent-text/10 text-accent-text font-bold text-[11px] rounded-xl border border-accent/20 dark:border-accent/30 hover:bg-accent/20 hover:shadow-md transition-all shadow-sm">Main Menu</button>
                            </div>
                        </div>
                    )}

                    <div className="relative px-3.5 pb-3.5 shrink-0 z-20">
                        <form onSubmit={(e) => { e.preventDefault(); handleSend(input); }} className="flex gap-2 p-1.5 bg-surface/80 dark:bg-gray-900/90 border border-white dark:border-line rounded-2xl shadow-lg transition-all focus-within:shadow-[0_0_20px_rgba(26,74,56,0.15)] dark:focus-within:shadow-[0_0_20px_rgba(153,231,66,0.15)]">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Type a message..."
                                className="flex-1 px-3 bg-transparent outline-none text-sm text-content font-medium placeholder-gray-500 dark:placeholder-gray-400"
                            />
                            <button
                                type="submit"
                                disabled={isLoading || !input.trim()}
                                aria-label="Send message"
                                className="p-2.5 bg-gradient-to-br from-accent to-accent-hover dark:from-accent/90 dark:to-accent-hover/90 text-accent-contrast dark:text-[#0f172a] rounded-full hover:shadow-[0_4px_15px_rgba(26,74,56,0.4)] hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 transition-all flex items-center justify-center shrink-0 shadow-md"
                            >
                                <Send size={16} className={`transform translate-x-[-1px] translate-y-[1px] ${isLoading ? 'animate-pulse' : ''}`} />
                            </button>
                        </form>
                    </div>
                </div>

                {/* Passive nudge pill: never opens the window by itself; clicking it
                    does, dismissing X just hides it. Once per session (see effect). */}
                {nudgeVisible && !isOpen && (
                    <div className="pointer-events-auto mb-2 flex items-center gap-1.5 pl-3.5 pr-1.5 py-1.5 bg-surface/95 dark:bg-surface/95 backdrop-blur-xl border border-white/80 dark:border-line rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <button
                            onClick={() => { setNudgeVisible(false); setIsOpen(true); }}
                            className="text-xs font-bold text-content hover:text-accent-text dark:hover:text-accent-text transition-colors"
                        >
                            Need help? I'm right here.
                        </button>
                        <button
                            onClick={() => setNudgeVisible(false)}
                            aria-label="Dismiss help suggestion"
                            className="p-1 text-subtle hover:text-muted dark:hover:text-gray-200 rounded-full transition-colors"
                        >
                            <X size={12} />
                        </button>
                    </div>
                )}

                {/* Launcher — the shared pill (mascot logo + "Ask PESO Assistant" + Chat chip),
                    app-token palette. The SAME component the public Landing assistant uses. */}
                <ChatLauncher open={isOpen} onClick={() => setIsOpen(true)} variant="app" />
            </div>
        </>
    );
};

export default Chatbot;