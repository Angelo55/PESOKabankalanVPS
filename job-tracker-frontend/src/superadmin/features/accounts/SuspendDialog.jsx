/**
 * SuspendDialog — captures the REASON and an optional END DATE when a Super
 * Administrator suspends an account (item 4). The reason + dates flow to the
 * standardized suspension notice the user sees (login screen, email, SMS). Activating
 * an account needs no dialog (it just clears the metadata), so this is suspend-only.
 *
 * Design-token styled (§24). The parent owns the API call + optimistic update; this
 * only collects input and calls onConfirm(reason, endsAt).
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, X, AlertTriangle } from 'lucide-react';

const SuspendDialog = ({ user, onClose, onConfirm, busy = false }) => {
    const [reason, setReason] = useState('');
    const [endsAt, setEndsAt] = useState('');

    const submit = (e) => {
        e.preventDefault();
        onConfirm(reason.trim() || null, endsAt || null);
    };

    const today = new Date().toISOString().slice(0, 10);

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
            <form
                onSubmit={submit}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md bg-raised rounded-3xl shadow-raised border border-line overflow-hidden animate-in slide-in-from-bottom-4"
            >
                <div className="p-5 border-b border-line flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className="p-2 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400"><Ban size={20} /></span>
                        <div>
                            <h2 className="text-lg font-black text-content">Suspend account</h2>
                            <p className="text-xs text-muted font-medium truncate max-w-[220px]">{user?.name || user?.email}</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:bg-sunken hover:text-content transition-colors"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-900/20 border border-amber-200/70 dark:border-amber-800/50">
                        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">The user is signed out immediately and cannot log in. They are notified in-app, by email, and by SMS (if enabled &amp; verified).</p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted uppercase tracking-wide">Reason <span className="text-subtle normal-case font-medium">(shown to the user)</span></label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder="e.g. Violation of platform terms — posting false information."
                            className="w-full p-2.5 rounded-lg text-sm bg-sunken border border-line outline-none focus-visible:ring-2 focus-visible:ring-accent text-content resize-none"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted uppercase tracking-wide">Review / end date <span className="text-subtle normal-case font-medium">(optional)</span></label>
                        <input
                            type="date"
                            value={endsAt}
                            min={today}
                            onChange={(e) => setEndsAt(e.target.value)}
                            className="w-full p-2.5 rounded-lg text-sm bg-sunken border border-line outline-none focus-visible:ring-2 focus-visible:ring-accent text-content"
                        />
                        <p className="text-[11px] text-subtle">Informational only — the account is not auto-reactivated; an admin must reactivate it.</p>
                    </div>
                </div>

                <div className="p-5 border-t border-line flex gap-2">
                    <button type="button" onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-surface border border-line text-content font-bold text-sm hover:bg-sunken disabled:opacity-50">Cancel</button>
                    <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
                        <Ban size={16} /> Suspend account
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
};

export default SuspendDialog;
