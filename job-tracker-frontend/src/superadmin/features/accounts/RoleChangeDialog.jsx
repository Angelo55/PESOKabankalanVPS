import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import API from '../../../api';
import { useNotification } from '../../../context/NotificationContext';
import { normalizeRole, ROLE_KEYS } from '../../../utils/roles';

/**
 * ROLE CHANGE DIALOG — the most consequential action in the Super Admin portal.
 *
 * WHAT: changes one account's role, with the danger stated before the click
 * rather than discovered after it.
 *
 * ── EVERY GUARD IS ENFORCED SERVER-SIDE ────────────────────────────────────
 * Nothing in this component is security. roleAdminService independently blocks
 * self-demotion, blocks removing the last Super Administrator (under a row
 * lock, so two simultaneous demotions cannot both succeed), and writes the
 * audit entry inside the same transaction. This file exists to make the
 * consequences legible, not to enforce them.
 *
 * ── WHY THE WARNINGS ARE WORDED PLAINLY ────────────────────────────────────
 * "Promoting to Super Administrator" understates it. The honest sentence is
 * that this person will be able to change anyone's role, remove any job, and
 * suspend any account — so that is what the dialog says. Someone approving a
 * privilege escalation should not have to already know what the privilege means.
 *
 * ── THE LOCKOUT ────────────────────────────────────────────────────────────
 * There is no way to create a Super Administrator except promotion by an
 * existing one. If the last is demoted, recovery requires a manual UPDATE
 * against production by whoever holds the database credentials. The count is
 * fetched up front so the warning appears BEFORE the attempt.
 */
const RoleChangeDialog = ({ user, assignableRoles, superAdminCount, currentAdminId, onClose, onSaved }) => {
    const { notify } = useNotification();
    const currentRole = normalizeRole(user.role);

    const [nextRole, setNextRole] = useState(currentRole);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const isSelf = Number(user.id) === Number(currentAdminId);
    const promotingToSuper = nextRole === ROLE_KEYS.SUPER_ADMINISTRATOR && currentRole !== ROLE_KEYS.SUPER_ADMINISTRATOR;
    const demotingFromSuper = currentRole === ROLE_KEYS.SUPER_ADMINISTRATOR && nextRole !== ROLE_KEYS.SUPER_ADMINISTRATOR;
    const wouldStrandPlatform = demotingFromSuper && superAdminCount <= 1;
    const unchanged = nextRole === currentRole;

    const blocked = isSelf || wouldStrandPlatform || unchanged;

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await API.put(`/admin/users/${user.id}/role`, { role: nextRole, reason: reason.trim() || null });
            notify.success('Role Updated', res.data?.message || 'The role has been changed.');
            onSaved();
            onClose();
        } catch (err) {
            notify.error('Could Not Change Role', err.response?.data?.message || 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in"
            onClick={() => !saving && onClose()}
            role="dialog"
            aria-modal="true"
            aria-label="Change account role"
        >
            <form
                onSubmit={submit}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface rounded-3xl w-full max-w-md shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95"
            >
                <div className="flex items-start justify-between gap-4 p-5 border-b border-line">
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-content">Change Role</h3>
                        <p className="text-xs text-muted font-medium mt-0.5 truncate">{user.name} &middot; {user.email}</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close"
                        className="p-2 rounded-lg text-subtle hover:text-muted dark:hover:text-gray-200 hover:bg-line transition-colors disabled:opacity-40">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label htmlFor="next_role" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">New role</label>
                        <select id="next_role" value={nextRole} onChange={(e) => setNextRole(e.target.value)} disabled={isSelf}
                            className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:opacity-50">
                            {assignableRoles.map((r) => (
                                <option key={r.key} value={r.key}>{r.label}</option>
                            ))}
                        </select>
                    </div>

                    {isSelf && (
                        <p className="flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3">
                            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                            You cannot change your own role. Ask another Super Administrator to do it — that way a mistake is always reversible by someone.
                        </p>
                    )}

                    {wouldStrandPlatform && (
                        <p className="flex items-start gap-2 text-sm font-medium text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded-xl px-4 py-3">
                            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                            This is the last Super Administrator. Removing this role would leave nobody able to administer the platform, and it could only be undone directly in the database. Promote someone else first.
                        </p>
                    )}

                    {promotingToSuper && !blocked && (
                        <p className="flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3">
                            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                            <span>
                                <strong>{user.name}</strong> will be able to change anyone's role, suspend any account, remove any job posting, and see every record on the platform. This is recorded in the audit trail.
                            </span>
                        </p>
                    )}

                    {demotingFromSuper && !wouldStrandPlatform && (
                        <p className="flex items-start gap-2 text-sm font-medium text-muted bg-sunken border border-line rounded-xl px-4 py-3">
                            <ShieldCheck size={16} className="shrink-0 mt-0.5" />
                            {superAdminCount - 1} Super Administrator{superAdminCount - 1 === 1 ? '' : 's'} will remain.
                        </p>
                    )}

                    <div>
                        <label htmlFor="role_reason" className="block text-xs font-bold text-muted uppercase tracking-wide mb-1.5">
                            Reason <span className="normal-case font-medium text-subtle">(optional, saved to the audit trail)</span>
                        </label>
                        <textarea id="role_reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Joined the PESO office as coordinator."
                            className="w-full p-2.5 sm:p-3 rounded-lg text-sm font-medium bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-indigo-500/35 resize-none" />
                    </div>
                </div>

                <div className="p-5 border-t border-line flex gap-3">
                    <button type="button" onClick={onClose} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-muted bg-sunken hover:bg-line transition-colors disabled:opacity-50">
                        Cancel
                    </button>
                    <button type="submit" disabled={saving || blocked}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-black text-white shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${promotingToSuper ? 'bg-amber-600 hover:bg-amber-700' : 'bg-accent hover:bg-accent-hover'}`}>
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                        {unchanged ? 'No change' : 'Change role'}
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
};

export default RoleChangeDialog;
