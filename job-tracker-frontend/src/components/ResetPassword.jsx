import React, { useState } from 'react';
import { Lock, CheckCircle, ShieldAlert, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import API from '../api';

const ResetPassword = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const navigate = useNavigate();

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    const calculateStrength = (pwd) => {
        let score = 0;
        if (pwd.length > 8) score += 1;
        if (pwd.match(/[A-Z]/)) score += 1;
        if (pwd.match(/[0-9]/)) score += 1;
        if (pwd.match(/[^A-Za-z0-9]/)) score += 1;
        return score; 
    };
    
    const strength = calculateStrength(password);
    const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-lime-500', 'bg-emerald-500'];
    const strengthLabels = ['Too Weak', 'Weak', 'Fair', 'Good', 'Strong'];

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setStatus('error');
            setMessage('Passwords do not match.');
            return;
        }
        if (strength < 2) {
            setStatus('error');
            setMessage('Please choose a stronger password.');
            return;
        }

        setStatus('loading');
        try {
            await API.post('/auth/reset-password', { token, newPassword: password });
            setStatus('success');
            setMessage('Your password has been successfully reset. You can now log in.');
            setTimeout(() => navigate('/'), 3000); // Redirect to Landing Page
        } catch (error) {
            setStatus('error');
            setMessage(error.response?.data?.message || 'Failed to reset password. The link may have expired.');
        }
    };

    if (!token) return <div className="p-10 text-center text-red-500 font-bold">Invalid Reset Link</div>;

    return (
        <div className="min-h-screen flex items-center justify-center bg-sunken animate-fade-scale-in">
            <div className="bg-surface p-10 rounded-[2rem] shadow-2xl max-w-md w-full border border-line">
                
                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl">
                        <Lock className="text-indigo-600 dark:text-indigo-400" size={32} />
                    </div>
                </div>
                
                <h2 className="text-2xl font-black text-center text-content mb-2">Secure Your Account</h2>
                <p className="text-center text-muted text-sm mb-8 font-medium">Enter a new, strong password below.</p>

                {status === 'success' ? (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 p-4 rounded-2xl flex items-center gap-3 font-bold">
                        <CheckCircle size={20} /> {message}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <input 
                                type="password" 
                                placeholder="New Password" 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-5 py-3.5 bg-sunken border border-line rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all dark:text-white"
                                required 
                            />
                            {password.length > 0 && (
                                <div className="mt-3">
                                    <div className="flex gap-1 h-1.5 w-full rounded-full overflow-hidden bg-sunken">
                                        {[...Array(4)].map((_, i) => (
                                            <div key={i} className={`h-full flex-1 transition-all duration-500 ${i < strength ? strengthColors[strength] : 'bg-transparent'}`} />
                                        ))}
                                    </div>
                                    <p className={`text-xs mt-1.5 font-bold ${strengthColors[strength].replace('bg-', 'text-')}`}>
                                        {strengthLabels[strength]}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div>
                            <input 
                                type="password" 
                                placeholder="Confirm New Password" 
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-5 py-3.5 bg-sunken border border-line rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all dark:text-white"
                                required 
                            />
                        </div>

                        {status === 'error' && (
                            <div className="flex items-center gap-2 text-red-500 text-sm font-bold bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">
                                <ShieldAlert size={16} /> {message}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={status === 'loading'}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-lg hover:-translate-y-0.5 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                        >
                            {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : 'Confirm Reset'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default ResetPassword;