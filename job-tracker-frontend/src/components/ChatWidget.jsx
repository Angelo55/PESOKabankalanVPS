import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Loader2, User } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import API from '../api';

const getAuthConfig = () => ({
    headers: { Authorization: `Bearer ${sessionStorage.getItem('jobTrackerToken') || localStorage.getItem('jobTrackerToken')}` }
});

const ChatWidget = () => {
    const { user } = useAuth();
    const { socket } = useChat();
    const [isOpen, setIsOpen] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [activeConv, setActiveConv] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    // Hydrate conversations when the widget is opened
    useEffect(() => {
        if (isOpen && user) {
            setIsLoading(true);
            API.get('/messages/conversations', getAuthConfig())
               .then(res => setConversations(res.data.data))
               .catch(err => console.error("Failed to load conversations", err))
               .finally(() => setIsLoading(false));
        }
    }, [isOpen, user]);

    // Handle Active Conversation & Live Socket Listeners
    useEffect(() => {
        if (!socket || !activeConv) return;

        // Fetch historical messages
        API.get(`/messages/${activeConv.id}`, getAuthConfig())
           .then(res => {
               setMessages(res.data.data);
               setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
           });

        // Join the isolated Socket room
        socket.emit('join_conversation', activeConv.id);

        // Listen for live messages
        const handleNewMessage = (msg) => {
            setMessages(prev => [...prev, msg]);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        };

        socket.on('receive_message', handleNewMessage);

        return () => {
            socket.off('receive_message', handleNewMessage);
        };
    }, [activeConv, socket]);

    const handleSend = (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !socket || !activeConv) return;

        socket.emit('send_message', { conversationId: activeConv.id, content: newMessage });
        setNewMessage('');
    };

    // Hide entirely for admins or unauthenticated users
    if (!user || user.role === 'admin') return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9000] flex flex-col items-end">
            
            {/* Expanded Chat Interface */}
            {isOpen && (
                <div className="mb-4 w-80 sm:w-96 h-[500px] bg-surface/90 dark:bg-gray-900/95 backdrop-blur-2xl rounded-[2rem] shadow-2xl border border-line flex flex-col overflow-hidden animate-in slide-in-from-bottom-4">
                    
                    {/* Header */}
                    <div className="bg-gradient-to-r from-accent to-accent-hover text-white p-5 flex justify-between items-center shadow-md z-10">
                        <div className="flex items-center gap-3">
                            {activeConv && (
                                <button onClick={() => setActiveConv(null)} className="hover:bg-surface/20 p-1.5 rounded-lg transition-colors mr-1">
                                    <X size={16} className="rotate-45" style={{ transform: 'rotate(45deg) scale(1.5)' }} /> {/* Simulated back arrow */}
                                </button>
                            )}
                            <div>
                                <h3 className="font-black text-accent-contrast tracking-tight">
                                    {activeConv ? (user.role === 'employer' ? activeConv.applicant_name : activeConv.employer_name) : 'Messages'}
                                </h3>
                                {activeConv && <p className="text-xs text-indigo-100 font-medium truncate max-w-[180px]">Application Pipeline</p>}
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="hover:bg-surface/20 p-2 rounded-full transition-colors">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-4 bg-sunken/50 dark:bg-surface/50 custom-scrollbar">
                        {isLoading ? (
                            <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-accent-text" size={24} /></div>
                        ) : !activeConv ? (
                            conversations.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                                    <MessageCircle size={40} className="text-subtle mb-3" />
                                    <p className="text-muted font-medium text-sm">No active conversations yet. Applications you submit will appear here.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {conversations.map(c => (
                                        <button key={c.id} onClick={() => setActiveConv(c)} className="w-full flex items-center gap-3 p-3 bg-surface rounded-2xl shadow-sm border border-line hover:border-accent dark:hover:border-accent transition-colors text-left group">
                                            <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                                                <User size={18} />
                                            </div>
                                            <div className="flex-1 overflow-hidden">
                                                <p className="font-bold text-content text-sm truncate group-hover:text-accent-text dark:group-hover:text-accent-text transition-colors">
                                                    {user.role === 'employer' ? c.applicant_name : c.employer_name}
                                                </p>
                                                <p className="text-xs text-muted truncate">Tap to view conversation</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )
                        ) : (
                            <div className="flex flex-col gap-4 py-2">
                                {messages.map((msg, idx) => {
                                    const isMe = msg.sender_id === user.id;
                                    return (
                                        <div key={idx} className={`flex flex-col max-w-[85%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
                                            <div className={`p-3.5 text-sm shadow-sm ${isMe ? 'bg-accent text-white rounded-2xl rounded-tr-sm' : 'bg-white dark:bg-raised text-content dark:text-gray-100 border border-line rounded-2xl rounded-tl-sm'}`}>
                                                {msg.content}
                                            </div>
                                            <span className="text-[10px] text-subtle mt-1 font-medium mx-1">
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>
                        )}
                    </div>

                    {/* Input Form */}
                    {activeConv && (
                        <form onSubmit={handleSend} className="p-4 bg-surface border-t border-line flex gap-2">
                            <input 
                                type="text" 
                                value={newMessage} 
                                onChange={e => setNewMessage(e.target.value)} 
                                placeholder="Type your message..." 
                                className="flex-1 bg-sunken text-sm px-4 py-3 rounded-xl border border-line outline-none focus:ring-2 focus:ring-accent/50 text-content font-medium"
                            />
                            <button 
                                type="submit" 
                                disabled={!newMessage.trim()}
                                className="p-3 bg-accent text-accent-contrast rounded-xl hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:hover:bg-accent"
                            >
                                <Send size={18} />
                            </button>
                        </form>
                    )}
                </div>
            )}

            {/* Floating Action Button */}
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 bg-gradient-to-br from-accent to-accent-hover text-accent-contrast rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform border-4 border-white dark:border-line"
            >
                {isOpen ? <X size={24} /> : <MessageCircle size={24} className="animate-in zoom-in" />}
            </button>
        </div>
    );
};

export default ChatWidget;