import React, { useState } from 'react';
import { Mail, ArrowLeft, Loader2, CheckCircle, ShieldAlert } from 'lucide-react';
import API from '../api';

const ForgotPassword = ({ onBackToLogin }) => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [message, setMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email) return;

        setStatus('loading');
        try {
            const response = await API.post('/auth/forgot-password', { email });
            // The backend returns a generic success message to prevent email enumeration
            setStatus('success');
            setMessage(response.data.message);
        } catch (error) {
            setStatus('error');
            setMessage(error.response?.data?.message || 'Failed to process request. Please try again.');
        }
    };

    return (
        <div className="w-full max-w-md bg-surface p-10 rounded-[2rem] shadow-2xl border border-line animate-fade-scale-in motion-reduce:animate-none">
            
            <button 
                onClick={onBackToLogin}
                className="flex items-center gap-2 text-sm font-bold text-muted hover:text-indigo-600 dark:text-muted dark:hover:text-indigo-400 transition-colors mb-6 group"
            >
                <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Login
            </button>

            <div className="flex justify-center mb-6">
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl">
                    <Mail className="text-indigo-600 dark:text-indigo-400" size={32} />
                </div>
            </div>
            
            <h2 className="text-2xl font-black text-center text-content mb-2 tracking-tight">
                Reset Password
            </h2>
            <p className="text-center text-muted text-sm mb-8 font-medium px-4">
                Enter your registered email address and we'll send you a secure reset link.
            </p>

            {status === 'success' ? (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 p-5 rounded-2xl flex flex-col items-center gap-3 text-center border border-emerald-100 dark:border-emerald-800/50 animate-slide-up-fade">
                    <CheckCircle size={28} /> 
                    <span className="font-bold text-sm leading-relaxed">{message}</span>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="relative group">
                        <Mail className="absolute left-4 top-3.5 text-subtle group-focus-within:text-indigo-500 transition-colors" size={20} />
                        <input 
                            type="email" 
                            placeholder="name@example.com" 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full pl-12 pr-5 py-3.5 bg-sunken border border-line rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all dark:text-white font-medium"
                            required 
                        />
                    </div>

                    {status === 'error' && (
                        <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm font-bold bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-100 dark:border-red-800/50">
                            <ShieldAlert size={18} className="shrink-0 mt-0.5" /> 
                            <span>{message}</span>
                        </div>
                    )}

                    <button 
                        type="submit" 
                        disabled={status === 'loading'}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/40 hover:-translate-y-0.5 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                        {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : 'Send Reset Link'}
                    </button>
                </form>
            )}
        </div>
    );
};

export default ForgotPassword;