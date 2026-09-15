/**
 * chatMotion — ONE motion language shared by BOTH chatbots so they feel like the same PESO
 * product: the authenticated PESO Assistant (`Chatbot.jsx`) and the public Landing assistant
 * (`PublicChatbot.jsx`). Timing / easing / entrance are defined once here instead of drifting
 * in two components (Phase 1 of the chatbot UI unification).
 *
 * The message-entrance keyframe (`.chat-msg-in`) lives in `index.css` (a global stylesheet
 * keyframe, reduced-motion-guarded) because the app has NO tailwindcss-animate plugin — the
 * `animate-in …` utility classes both chatbots used are silent no-ops. `.chat-msg-in` is the
 * real, working fade+rise both now use.
 */

// Panel open/close — a polished expo-out ease, GPU transform + opacity, `origin-bottom-right`
// so it grows from the launcher corner. Same for both chatbots.
export const CHAT_PANEL_TRANSITION = 'origin-bottom-right transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]';
export const chatPanelState = (open) =>
    open
        ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
        : 'opacity-0 scale-95 translate-y-4 pointer-events-none';

// Launcher — scales away when the panel opens (the panel takes its place).
export const CHAT_LAUNCHER_TRANSITION = 'transition-all duration-500 ease-out';
export const chatLauncherState = (open) =>
    open ? 'scale-0 opacity-0 pointer-events-none' : 'scale-100 opacity-100';

// Message-bubble entrance — the class is defined in index.css (`.chat-msg-in`).
export const CHAT_MSG_IN = 'chat-msg-in';
