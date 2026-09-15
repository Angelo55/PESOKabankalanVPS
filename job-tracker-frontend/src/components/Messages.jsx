import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Search, Send, Paperclip, MoreVertical, Briefcase,
    Loader2, MessageCircle, RefreshCw, Inbox,
    Pin, PinOff, Bell, BellOff, MailOpen, Mail, CheckSquare, Square, X, Check
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import API from '../api';
import { normalizeRole, getRoleLabel } from '../utils/roles';
import Avatar from './common/Avatar';
import { modalOverlay } from '../config/motion';

const MAX_PINNED = 5;
// A conversation is "unread" for the viewer when it has incoming unread messages
// OR they manually flagged it unread. Muting hides the count but the flag stays.
const isConvUnread = (c) => (Number(c.unread_count) > 0) || c.manually_unread === 1 || c.manually_unread === true;
const isConvPinned = (c) => c.pinned_at != null;
const isConvMuted = (c) => c.is_muted === 1 || c.is_muted === true;

const getAuthConfig = () => ({
    headers: { Authorization: `Bearer ${sessionStorage.getItem('jobTrackerToken') || localStorage.getItem('jobTrackerToken')}` }
});

/**
 * Identity of the OTHER participant in a conversation.
 *
 * ID comparison, never role comparison. The header used to test
 * `user.role === 'employer'`, but the stored role is 'peso_administrator'
 * ('employer' is only a legacy alias), so the test never matched and a PESO
 * admin saw THEIR OWN name. The conversation list still had that same bug; both
 * now share this one symmetric helper, which cannot drift apart again.
 *
 * The returned shape is what <Avatar> consumes (id + name + avatar_url), so an
 * applicant with no uploaded photo still gets their deterministic avatar rather
 * than a coloured initial.
 */
const peerOf = (conv, viewerId) => {
    if (!conv) return { id: null, name: '', avatar_url: null, role: null, roleLabel: '' };
    const viewerIsAdmin = Number(conv.peso_admin_id) === Number(viewerId);
    // `role` is carried on the peer so <Avatar> can render the PESO organisation
    // logo for the admin side (isOrgAccount). roleLabel stays the display string.
    return viewerIsAdmin
        ? {
            id: conv.applicant_id,
            name: conv.applicant_name,
            avatar_url: conv.applicant_avatar || null,
            role: normalizeRole(conv.applicant_role),
            roleLabel: getRoleLabel(normalizeRole(conv.applicant_role)),
        }
        : {
            id: conv.peso_admin_id,
            name: conv.employer_name,
            avatar_url: conv.employer_avatar || null,
            role: normalizeRole(conv.employer_role),
            roleLabel: getRoleLabel(normalizeRole(conv.employer_role)),
        };
};

const MenuItem = ({ icon: Icon, label, onClick, tone = 'text-content' }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-sunken transition-colors ${tone}`}
    >
        <Icon size={15} className="text-muted shrink-0" /> {label}
    </button>
);

const Messages = () => {
    const { user } = useAuth();
    const { socket, messageUpdateTrigger, triggerBadgeRefresh } = useChat();
    
    const [conversations, setConversations] = useState([]);
    const [filteredConvs, setFilteredConvs] = useState([]);
    const [activeConv, setActiveConv] = useState(null);
    const [messages, setMessages] = useState([]);
    
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterTab, setFilterTab] = useState('All'); 
    
    const [typingUsers, setTypingUsers] = useState(new Set());
    const typingTimeoutRef = useRef(null);
    const messagesEndRef = useRef(null);
    // Trailing-debounce for socket-driven roster refreshes, so a burst of incoming
    // messages coalesces into ONE /conversations refetch instead of one-per-message.
    const rosterTimerRef = useRef(null);
    const scheduleRosterRefresh = () => {
        if (rosterTimerRef.current) clearTimeout(rosterTimerRef.current);
        rosterTimerRef.current = setTimeout(() => fetchConversations(), 400);
    };
    useEffect(() => () => { if (rosterTimerRef.current) clearTimeout(rosterTimerRef.current); }, []);

    // Roster controls: per-row kebab menu, multi-select, and the active chat's menu.
    const [menuOpenId, setMenuOpenId] = useState(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [actionBusy, setActionBusy] = useState(false);
    const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
    const [actionError, setActionError] = useState('');

    // React to initial load AND incoming global triggers
    useEffect(() => {
        fetchConversations();
    }, [messageUpdateTrigger]);

    const fetchConversations = () => {
        setIsLoading(true);
        API.get('/messages/conversations', getAuthConfig())
           .then(res => {
               const data = res.data.data || [];
               setConversations(data);
               setFilteredConvs(data);
               // Keep the open conversation's state fields (mute/pin/unread) fresh.
               setActiveConv(prev => prev ? (data.find(c => c.id === prev.id) || prev) : prev);
           })
           .catch(err => console.error("Failed to load conversations", err))
           .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        let result = conversations;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(c => {
                // Match on the OTHER participant's name (peerOf), never the legacy
                // `role === 'employer'` test, plus the job title for convenience.
                const p = peerOf(c, user?.id);
                return (p.name || '').toLowerCase().includes(q) || (c.job_title || '').toLowerCase().includes(q);
            });
        }
        if (filterTab === 'Unread') result = result.filter(isConvUnread);
        else if (filterTab === 'Pinned') result = result.filter(isConvPinned);
        setFilteredConvs(result);
    }, [searchQuery, filterTab, conversations, user]);

    // Keyed on activeConv?.id (NOT the whole object): this effect only needs to
    // re-run when the SELECTED CONVERSATION changes — to fetch its history and join
    // its room. Keying on the object identity caused a request storm (429): a roster
    // refetch replaces activeConv with a new object of the SAME id, which re-ran this
    // effect → triggerBadgeRefresh() → messageUpdateTrigger++ → fetchConversations()
    // → new activeConv ref → loop. Id-keying breaks that cycle. (§60→§61 fix.)
    useEffect(() => {
        if (!socket || !activeConv?.id) return;
        const convId = activeConv.id;
        const controller = new AbortController();

        API.get(`/messages/${convId}`, { ...getAuthConfig(), signal: controller.signal })
           .then(res => {
               setMessages(res.data.data);
               scrollToBottom();
               // Opening a conversation marks its messages read server-side (see
               // messageRoutes GET /:id). Refresh the shared unread count so the
               // Messages badge in the sidebar clears immediately — without this the
               // badge stayed stale until a new message or a page reload.
               triggerBadgeRefresh();
           })
           .catch(err => {
               // A cancelled request (conversation switched / unmounted) is expected.
               if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') {
                   console.error('Failed to load messages', err);
               }
           });

        socket.emit('join_conversation', convId);

        /**
         * Exactly-once message rendering.
         *
         * The server broadcasts to the whole conversation room, so the SENDER
         * also receives their own message back. Appending it blindly is what
         * duplicated outgoing messages on the sender's thread.
         *
         * Two guards, in order:
         *  1. tempId match -> this is the authoritative row for our optimistic
         *     bubble. REPLACE it, so the placeholder id/timestamp are swapped
         *     for the real ones instead of a second bubble appearing.
         *  2. real id already present -> ignore. Makes the handler idempotent
         *     against a reconnect or a duplicate emit.
         * Otherwise it is genuinely new: append.
         */
        const handleNewMessage = (msg) => {
            setMessages(prev => {
                if (msg.tempId) {
                    const idx = prev.findIndex(m => m.tempId === msg.tempId);
                    if (idx !== -1) {
                        const next = [...prev];
                        next[idx] = { ...msg, pending: false };
                        return next;
                    }
                }
                if (prev.some(m => m.id === msg.id && !m.pending)) return prev;
                return [...prev, msg];
            });
            scrollToBottom();
            scheduleRosterRefresh(); // Bump roster order (debounced — coalesces bursts)
        };

        const handleTyping = (data) => {
            if (data.isTyping) {
                setTypingUsers(prev => new Set(prev).add(data.userId));
            } else {
                setTypingUsers(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(data.userId);
                    return newSet;
                });
            }
        };

        socket.on('receive_message', handleNewMessage);
        socket.on('user_typing', handleTyping);

        return () => {
            controller.abort();
            socket.off('receive_message', handleNewMessage);
            socket.off('user_typing', handleTyping);
        };
    }, [activeConv?.id, socket]);

    const scrollToBottom = () => {
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleTypingStart = () => {
        if (!socket || !activeConv) return;
        socket.emit('typing', { conversationId: activeConv.id, isTyping: true });
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            socket.emit('typing', { conversationId: activeConv.id, isTyping: false });
        }, 2000);
    };

    const handleSend = (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !socket || !activeConv) return;

        // Correlation id linking this optimistic bubble to the row the server
        // will echo back, so it is REPLACED rather than duplicated.
        const tempId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        socket.emit('send_message', { conversationId: activeConv.id, content: newMessage, tempId });

        // Optimistic UI update. `pending` marks this as a placeholder whose id
        // and timestamp are provisional until the server's row arrives.
        const optimisticMsg = {
            id: tempId,
            tempId,
            pending: true,
            sender_id: user.id,
            content: newMessage,
            created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, optimisticMsg]);
        setNewMessage('');
        socket.emit('typing', { conversationId: activeConv.id, isTyping: false });
        scrollToBottom();
    };

    // Transient error toast for roster actions (pin cap, network) — auto-clears.
    useEffect(() => {
        if (!actionError) return;
        const t = setTimeout(() => setActionError(''), 4000);
        return () => clearTimeout(t);
    }, [actionError]);

    // ── Roster actions (optimistic, reconciled on error) ────────────────────
    // Patches the roster AND the open conversation (same id) so the active-chat
    // header's pin/mute state stays live. Safe now that the history effect is keyed
    // on activeConv?.id — updating activeConv's fields no longer refetches history.
    const patchConv = (id, patch) => {
        setConversations(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
        setActiveConv(prev => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    };

    const toggleMute = async (conv) => {
        setMenuOpenId(null);
        const next = !isConvMuted(conv);
        patchConv(conv.id, { is_muted: next ? 1 : 0 });
        try { await API.patch(`/messages/${conv.id}/mute`, { muted: next }); triggerBadgeRefresh(); }
        catch { patchConv(conv.id, { is_muted: next ? 0 : 1 }); setActionError('Could not update mute.'); }
    };

    const togglePin = async (conv) => {
        setMenuOpenId(null);
        const next = !isConvPinned(conv);
        if (next && conversations.filter(isConvPinned).length >= MAX_PINNED) {
            setActionError(`You can pin up to ${MAX_PINNED} conversations. Unpin one first.`);
            return;
        }
        patchConv(conv.id, { pinned_at: next ? new Date().toISOString() : null });
        try { await API.patch(`/messages/${conv.id}/pin`, { pinned: next }); fetchConversations(); }
        catch (e) {
            patchConv(conv.id, { pinned_at: next ? null : conv.pinned_at });
            setActionError(e.response?.data?.message || 'Could not update pin.');
        }
    };

    const setReadState = async (conv, action) => { // 'read' | 'unread'
        setMenuOpenId(null);
        patchConv(conv.id, {
            manually_unread: action === 'unread' ? 1 : 0,
            ...(action === 'read' ? { unread_count: 0 } : {}),
        });
        try { await API.post('/messages/conversations/state', { conversationIds: [conv.id], action }); triggerBadgeRefresh(); }
        catch { fetchConversations(); setActionError('Could not update read state.'); }
    };

    const toggleSelect = (id) => setSelectedIds(prev => {
        const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
    const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };

    const applyBatch = async (action) => {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        setActionBusy(true);
        try {
            await API.post('/messages/conversations/state', { conversationIds: ids, action });
            exitSelect();
            fetchConversations();
            triggerBadgeRefresh();
        } catch { setActionError('Could not update the selected conversations.'); }
        finally { setActionBusy(false); }
    };

    /**
     * The OTHER participant in the active conversation.
     *
     * Resolved by comparing user IDs, never by inspecting the viewer's role
     * string: `users.role` stores 'peso_administrator' while 'employer' is only
     * a legacy alias (see utils/roles), so the old `user.role === 'employer'`
     * test never matched and the header showed the viewer their own name.
     *
     * ID comparison is also symmetric, so both participants see each other
     * correctly with no role-specific branching to keep in sync.
     */
    const peer = peerOf(activeConv, user?.id);

    // One conversation row: avatar + identity + unread/mute/pin markers, a select
    // checkbox in multi-select mode, and a per-row actions menu otherwise.
    const renderRow = (conv) => {
        const rowPeer = peerOf(conv, user?.id);
        const isActive = activeConv?.id === conv.id;
        const unread = isConvUnread(conv);
        const muted = isConvMuted(conv);
        const pinned = isConvPinned(conv);
        const checked = selectedIds.has(conv.id);
        return (
            <div
                key={conv.id}
                className={`group relative flex items-stretch rounded-2xl border transition-all ${isActive ? 'bg-surface border-line shadow-sm ring-1 ring-accent/10' : checked ? 'bg-accent-soft/40 border-accent/40' : 'border-transparent hover:bg-surface/60'}`}
            >
                {selectMode && (
                    <button onClick={() => toggleSelect(conv.id)} aria-label={checked ? 'Deselect conversation' : 'Select conversation'} className="pl-3 flex items-center shrink-0">
                        {checked ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} className="text-subtle" />}
                    </button>
                )}
                <button
                    onClick={() => (selectMode ? toggleSelect(conv.id) : setActiveConv(conv))}
                    className="flex-1 min-w-0 flex items-start gap-3 p-3 text-left"
                >
                    <div className="relative shrink-0">
                        <Avatar user={rowPeer} size="lg" className="border border-line" />
                        {unread && !muted && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent border-2 border-sunken" aria-label="Unread" />}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex justify-between items-start mb-0.5 gap-2">
                            <h4 className={`text-sm truncate flex items-center gap-1.5 min-w-0 ${unread ? 'font-black text-content' : 'font-bold text-content'}`}>
                                {pinned && <Pin size={12} className="text-amber-500 shrink-0 fill-amber-500" />}
                                <span className="truncate">{rowPeer.name}</span>
                                {muted && <BellOff size={12} className="text-subtle shrink-0" />}
                            </h4>
                            <span className="text-[10px] font-bold text-subtle whitespace-nowrap">
                                {conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                            </span>
                        </div>
                        <p className="text-xs text-muted font-medium flex items-center gap-1.5 truncate">
                            <Briefcase size={12} className="shrink-0 text-emerald-500" /> {conv.job_title}
                        </p>
                    </div>
                </button>
                {!selectMode && (
                    <div className="relative flex items-start pt-2 pr-1.5">
                        <button
                            onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === conv.id ? null : conv.id); }}
                            aria-label="Conversation options"
                            className="p-1.5 rounded-lg text-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-content hover:bg-sunken transition"
                        >
                            <MoreVertical size={16} />
                        </button>
                        <AnimatePresence>
                            {menuOpenId === conv.id && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.15 }}
                                        className="absolute right-0 top-9 z-20 w-44 bg-raised border border-line rounded-xl shadow-raised py-1"
                                    >
                                        <MenuItem icon={pinned ? PinOff : Pin} label={pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(conv)} />
                                        <MenuItem icon={muted ? Bell : BellOff} label={muted ? 'Unmute' : 'Mute'} onClick={() => toggleMute(conv)} />
                                        <MenuItem icon={unread ? MailOpen : Mail} label={unread ? 'Mark as read' : 'Mark as unread'} onClick={() => setReadState(conv, unread ? 'read' : 'unread')} />
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        );
    };

    const EmptyState = () => (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-surface/50 rounded-[2rem]">
            <div className="relative mb-6">
                <MessageCircle size={80} className="text-cyan-400 opacity-80 absolute -left-4 -top-4 -rotate-12" />
                <MessageCircle size={80} className="text-rose-400 opacity-80" />
            </div>
            <h2 className="text-2xl font-black text-content mb-2">Hello!</h2>
            <p className="text-muted font-medium max-w-sm">Select an active pipeline from the left panel to coordinate interviews and application details.</p>
        </div>
    );

    return (
        <div className="p-8 w-full max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col animate-fade-scale-in">
            
            <header className="mb-6 shrink-0">
                <h1 className="text-3xl font-black text-content tracking-tight">Messages Hub</h1>
                <p className="text-muted mt-1 font-medium">Manage your inquiries, applications, and direct communications.</p>
            </header>

            <div className="flex-1 bg-raised/80 backdrop-blur-xl rounded-[2rem] border border-line shadow-sm overflow-hidden flex gap-0 h-full">
                
                {/* LEFT PANE: Conversation List */}
                <div className="w-full md:w-80 lg:w-96 border-r border-line flex flex-col shrink-0 bg-sunken/50">
                    <div className="p-5 border-b border-line space-y-4 shrink-0">
                        <div className="relative">
                            <Search className="absolute left-3.5 top-3 text-subtle" size={18} />
                            <input 
                                type="text" 
                                placeholder="Search conversations..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30 dark:text-white transition-all"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex gap-2">
                                {['All', 'Unread', 'Pinned'].map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setFilterTab(tab)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterTab === tab ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'text-muted hover:bg-line'}`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                                    title={selectMode ? 'Cancel selection' : 'Select conversations'}
                                    className={`p-1.5 rounded-lg transition-colors ${selectMode ? 'text-accent bg-accent-soft' : 'text-subtle hover:text-indigo-500'}`}
                                >
                                    {selectMode ? <X size={15} /> : <CheckSquare size={15} />}
                                </button>
                                <button onClick={fetchConversations} title="Refresh" className="p-1.5 text-subtle hover:text-indigo-500 transition-colors">
                                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Bulk-action bar — responsive; one controlled batch request, never one-per-row. */}
                    <AnimatePresence>
                        {selectMode && (
                            <motion.div
                                variants={modalOverlay} initial="initial" animate="animate" exit="exit"
                                className="px-3 py-2.5 border-b border-line bg-surface/80 flex flex-wrap items-center gap-2 shrink-0"
                            >
                                <span className="text-xs font-black text-content mr-auto">{selectedIds.size} selected</span>
                                <button onClick={() => applyBatch('read')} disabled={actionBusy || selectedIds.size === 0} className="px-2.5 py-1.5 rounded-lg bg-sunken border border-line text-xs font-bold text-content flex items-center gap-1 disabled:opacity-40 hover:bg-line transition">
                                    <MailOpen size={13} /> Read
                                </button>
                                <button onClick={() => applyBatch('unread')} disabled={actionBusy || selectedIds.size === 0} className="px-2.5 py-1.5 rounded-lg bg-sunken border border-line text-xs font-bold text-content flex items-center gap-1 disabled:opacity-40 hover:bg-line transition">
                                    <Mail size={13} /> Unread
                                </button>
                                <button onClick={exitSelect} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-muted hover:text-content transition">Cancel</button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {actionError && (
                        <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold border border-rose-500/20 shrink-0">
                            {actionError}
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                        {isLoading ? (
                            <div className="space-y-2" aria-hidden="true">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="flex items-start gap-3 p-3 animate-pulse">
                                        <div className="w-12 h-12 rounded-full bg-sunken shrink-0" />
                                        <div className="flex-1 space-y-2 pt-1">
                                            <div className="h-3.5 w-2/3 rounded bg-sunken" />
                                            <div className="h-3 w-1/2 rounded bg-sunken" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : filteredConvs.length === 0 ? (
                            <div className="text-center px-4 py-10">
                                <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sunken border border-line mb-3 es-float">
                                    <Inbox size={26} className="text-accent-text" />
                                </span>
                                <p className="text-sm font-black text-content">
                                    {(searchQuery || filterTab !== 'All') ? 'No conversations match' : 'No conversations yet'}
                                </p>
                                <p className="text-xs text-muted mt-1 max-w-[15rem] mx-auto leading-relaxed">
                                    {(searchQuery || filterTab !== 'All')
                                        ? 'Try a different search term or switch filters to see your other conversations.'
                                        : 'Messages with the PESO Kabankalan office appear here once a conversation begins — when you inquire about a vacancy or an administrator follows up on your application.'}
                                </p>
                            </div>
                        ) : (() => {
                            // Pinned first (own group), then the rest — the server already
                            // orders pinned-first, this just adds the visual grouping.
                            const pinnedConvs = filteredConvs.filter(isConvPinned);
                            const otherConvs = filteredConvs.filter(c => !isConvPinned(c));
                            const showHeaders = pinnedConvs.length > 0 && filterTab !== 'Pinned';
                            return (
                                <>
                                    {showHeaders && (
                                        <p className="px-2 pt-1 pb-0.5 text-[10px] font-black uppercase tracking-wider text-subtle flex items-center gap-1"><Pin size={10} className="fill-amber-500 text-amber-500" /> Pinned</p>
                                    )}
                                    {(filterTab === 'Pinned' ? filteredConvs : pinnedConvs).map(renderRow)}
                                    {showHeaders && otherConvs.length > 0 && (
                                        <p className="px-2 pt-3 pb-0.5 text-[10px] font-black uppercase tracking-wider text-subtle">Recent</p>
                                    )}
                                    {filterTab !== 'Pinned' && otherConvs.map(renderRow)}
                                </>
                            );
                        })()}
                    </div>
                </div>

                {/* RIGHT PANE: Active Chat Context */}
                <div className="flex-1 flex flex-col hidden md:flex h-full min-w-0">
                    {!activeConv ? <EmptyState /> : (
                        <>
                            <div className="px-8 py-5 border-b border-line bg-surface/50 flex justify-between items-center shrink-0">
                                {/* Identity of the OTHER participant — see peerOf(). */}
                                <div className="flex items-center gap-3 min-w-0">
                                    <Avatar user={peer} size={44} className="shadow-sm" />
                                    <div className="min-w-0">
                                        <h2 className="text-base font-black text-content truncate">
                                            {peer.name || 'Unknown participant'}
                                        </h2>
                                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                                            <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent-text dark:bg-accent-text/15 dark:text-accent-text">
                                                {peer.roleLabel}
                                            </span>
                                            <p className="text-xs font-bold text-muted flex items-center gap-1.5 truncate">
                                                <Briefcase size={12} className="text-accent-text" /> {activeConv.job_title}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="relative">
                                    <button onClick={() => setHeaderMenuOpen(v => !v)} aria-label="Conversation options" className="p-2 text-subtle hover:text-content dark:hover:text-gray-200 transition-colors">
                                        <MoreVertical size={20} />
                                    </button>
                                    <AnimatePresence>
                                        {headerMenuOpen && (
                                            <>
                                                <div className="fixed inset-0 z-10" onClick={() => setHeaderMenuOpen(false)} />
                                                <motion.div
                                                    initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.15 }}
                                                    className="absolute right-0 top-11 z-20 w-44 bg-raised border border-line rounded-xl shadow-raised py-1"
                                                >
                                                    <MenuItem icon={isConvPinned(activeConv) ? PinOff : Pin} label={isConvPinned(activeConv) ? 'Unpin' : 'Pin'} onClick={() => { setHeaderMenuOpen(false); togglePin(activeConv); }} />
                                                    <MenuItem icon={isConvMuted(activeConv) ? Bell : BellOff} label={isConvMuted(activeConv) ? 'Unmute' : 'Mute'} onClick={() => { setHeaderMenuOpen(false); toggleMute(activeConv); }} />
                                                    <MenuItem icon={Mail} label="Mark as unread" onClick={() => { setHeaderMenuOpen(false); setReadState(activeConv, 'unread'); }} />
                                                </motion.div>
                                            </>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-6 bg-canvas">
                                {messages.map((msg, idx) => {
                                    const isMe = msg.sender_id === user.id;
                                    return (
                                        <div key={msg.id || idx} className={`flex flex-col max-w-[75%] ${isMe ? 'self-end items-end ml-auto' : 'self-start items-start'}`}>
                                            <div className={`p-4 text-sm font-medium shadow-sm ${isMe ? 'bg-gradient-to-br from-accent to-accent-hover text-white rounded-2xl rounded-tr-sm border border-accent' : 'bg-surface text-content border border-line rounded-2xl rounded-tl-sm'}`}>
                                                {msg.content}
                                            </div>
                                            <span className="text-[10px] text-subtle mt-1.5 font-bold mx-1">
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    );
                                })}
                                
                                {typingUsers.size > 0 && (
                                    <div className="self-start items-start max-w-[75%] flex flex-col">
                                        <div className="p-4 bg-surface border border-line rounded-2xl rounded-tl-sm flex gap-1.5">
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            <div className="p-6 bg-surface/80 border-t border-line shrink-0">
                                <form onSubmit={handleSend} className="flex items-end gap-3">
                                    <button type="button" className="p-3.5 text-subtle hover:text-indigo-500 bg-sunken hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors">
                                        <Paperclip size={20} />
                                    </button>
                                    <div className="flex-1 relative">
                                        <textarea 
                                            rows="1"
                                            value={newMessage} 
                                            onChange={e => {
                                                setNewMessage(e.target.value);
                                                handleTypingStart();
                                            }} 
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSend(e);
                                                }
                                            }}
                                            placeholder="Write a message..." 
                                            className="w-full bg-sunken text-sm px-5 py-4 rounded-2xl border border-line outline-none focus:ring-2 focus:ring-accent/30 text-content font-medium resize-none custom-scrollbar min-h-[56px] max-h-[150px]"
                                        />
                                    </div>
                                    <button 
                                        type="submit" 
                                        disabled={!newMessage.trim()}
                                        className="p-3.5 bg-accent text-accent-contrast rounded-xl shadow-md hover:bg-accent-hover hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
                                    >
                                        <Send size={20} className="ml-1" />
                                    </button>
                                </form>
                            </div>
                        </>
                    )}
                </div>

            </div>
        </div>
    );
};

export default Messages;