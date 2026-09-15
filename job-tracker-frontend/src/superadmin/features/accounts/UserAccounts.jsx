import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Shield, ShieldCheck, Ban, CheckCircle, Loader, Filter, ArrowDownUp } from 'lucide-react';
import API from '../../../api';
import { useNotification } from '../../../context/NotificationContext';
import { normalizeRole, getRoleLabel, ROLE_KEYS } from '../../../utils/roles';
import Avatar from '../../../components/common/Avatar';
import EmptyState from '../../../components/common/EmptyState';
import { useAuth } from '../../../context/AuthContext';
import RoleChangeDialog from './RoleChangeDialog';
import SuspendDialog from './SuspendDialog';
import Pagination from '../../../components/common/Pagination';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

/**
 * Badge colour per CANONICAL role key, not per stored string.
 *
 * Keyed on the output of normalizeRole() so a legacy stored value ('employer'
 * for a PESO Administrator) resolves to the same entry as the current one. A
 * lookup table also means an unrecognised role gets the neutral `default` style
 * instead of silently borrowing the styling of whichever branch happened to be
 * last in an if/else chain.
 */
const ROLE_BADGE = {
    [ROLE_KEYS.SUPER_ADMINISTRATOR]: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
    [ROLE_KEYS.PESO_ADMINISTRATOR]:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    [ROLE_KEYS.PESO_STAFF]:          'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400',
    [ROLE_KEYS.JOB_SEEKER]:          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    default:                         'bg-sunken text-content dark:bg-surface dark:text-muted',
};

const UserAccounts = () => {
    const { notify } = useNotification();
    const { user: currentAdmin } = useAuth();
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);

    // Role administration. `roleMeta` carries the assignable list and the count
    // of Super Administrators, so the dialog can warn about the last-admin
    // lockout BEFORE the attempt rather than only rejecting it afterwards.
    const [roleTarget, setRoleTarget] = useState(null);
    const [roleMeta, setRoleMeta] = useState({ assignable: [], superAdminCount: 0 });
    const [loading, setLoading] = useState(true);

    // Filtering State. Search + role now drive SERVER-SIDE queries (Phase 1), so
    // the browser never receives the whole account table.
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All');   // All | Active | Suspended (item 4)
    const [sortBy, setSortBy] = useState('joined_desc');        // joined_desc|joined_asc|name_asc|name_desc
    const [suspendTarget, setSuspendTarget] = useState(null);  // user pending suspension (dialog)
    const [suspendBusy, setSuspendBusy] = useState(false);

    // Debounce typing so we query once the user pauses, not per keystroke.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    // A new search, role, status, or sort always returns to page 1.
    useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter, statusFilter, sortBy]);

    // Assignable-roles metadata is fetched once; a failure only disables the
    // pre-flight warning, never the page. The server enforces every guard anyway.
    useEffect(() => {
        API.get('/admin/roles')
            .then((res) => setRoleMeta(res.data?.data || { assignable: [], superAdminCount: 0 }))
            .catch(() => {});
    }, []);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(limit) });
            if (debouncedSearch) params.set('q', debouncedSearch);
            if (roleFilter !== 'All') params.set('role', roleFilter);
            if (statusFilter !== 'All') params.set('status', statusFilter);
            if (sortBy) params.set('sort', sortBy);
            const response = await API.get(`/admin/users?${params.toString()}`, getAuthConfig());
            setUsers(Array.isArray(response.data?.data) ? response.data.data : []);
            setTotal(response.data?.total || 0);
        } catch (error) {
            notify.error("Data Error", "Failed to load user records.");
            setUsers([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [page, limit, debouncedSearch, roleFilter, statusFilter, sortBy, notify]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    // Suspend opens a dialog to capture the reason + optional end date (item 4);
    // Activate is a direct call (it just clears the suspension metadata).
    const activateUser = async (userId) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, account_status: 'Active' } : u));
        try {
            const response = await API.put(`/admin/users/${userId}/status`, { status: 'Active' }, getAuthConfig());
            notify.success('Status Updated', response.data.message);
        } catch (error) {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, account_status: 'Suspended' } : u));
            notify.error('Action Failed', 'Could not reactivate the account.');
        }
    };

    const confirmSuspend = async (reason, endsAt) => {
        if (!suspendTarget) return;
        const userId = suspendTarget.id;
        setSuspendBusy(true);
        try {
            const response = await API.put(`/admin/users/${userId}/status`, { status: 'Suspended', reason, endsAt }, getAuthConfig());
            setUsers(prev => prev.map(u => u.id === userId
                ? { ...u, account_status: 'Suspended', suspension_reason: reason, suspension_ends_at: endsAt }
                : u));
            notify.success('Account Suspended', response.data.message);
            setSuspendTarget(null);
        } catch (error) {
            notify.error('Action Failed', error.response?.data?.message || 'Could not suspend the account.');
        } finally {
            setSuspendBusy(false);
        }
    };

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight flex items-center gap-3">
                        <Users className="text-indigo-500" size={32} /> User Management
                    </h1>
                    <p className="text-muted mt-2 font-medium">Monitor, filter, and manage platform access for all accounts.</p>
                </div>
            </header>

            {/* Filter & Search Bar */}
            <div className="bg-surface p-4 rounded-2xl border border-line shadow-sm flex flex-col sm:flex-row gap-4 mb-8">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-3.5 text-subtle" size={18} />
                    <input 
                        type="text" 
                        placeholder="Search by name or email..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-sunken border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none text-content transition-all"
                    />
                </div>
                <div className="relative w-full sm:w-44 shrink-0">
                    <Filter className="absolute left-4 top-3.5 text-subtle" size={18} />
                    <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        aria-label="Filter by role"
                        className="w-full pl-12 pr-4 py-3 bg-sunken border-none rounded-xl text-sm font-bold text-muted outline-none cursor-pointer appearance-none"
                    >
                        <option value="All">All Roles</option>
                        <option value={ROLE_KEYS.JOB_SEEKER}>Job Seekers</option>
                        <option value={ROLE_KEYS.PESO_ADMINISTRATOR}>PESO Administrators</option>
                        <option value={ROLE_KEYS.PESO_STAFF}>PESO Staff</option>
                        <option value={ROLE_KEYS.SUPER_ADMINISTRATOR}>Super Administrators</option>
                    </select>
                </div>
                <div className="relative w-full sm:w-40 shrink-0">
                    <ShieldCheck className="absolute left-4 top-3.5 text-subtle" size={18} />
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter by account status"
                        className="w-full pl-12 pr-4 py-3 bg-sunken border-none rounded-xl text-sm font-bold text-muted outline-none cursor-pointer appearance-none"
                    >
                        <option value="All">All Statuses</option>
                        <option value="Active">Active</option>
                        <option value="Suspended">Suspended</option>
                    </select>
                </div>
                <div className="relative w-full sm:w-44 shrink-0">
                    <ArrowDownUp className="absolute left-4 top-3.5 text-subtle" size={18} />
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        aria-label="Sort accounts"
                        className="w-full pl-12 pr-4 py-3 bg-sunken border-none rounded-xl text-sm font-bold text-muted outline-none cursor-pointer appearance-none"
                    >
                        <option value="joined_desc">Newest joined</option>
                        <option value="joined_asc">Oldest joined</option>
                        <option value="name_asc">Name A–Z</option>
                        <option value="name_desc">Name Z–A</option>
                    </select>
                </div>
            </div>

            {/* User Data Table */}
            <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} position="top" />

            <div className="bg-surface rounded-3xl border border-line shadow-sm overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-sunken/50 border-b border-line text-xs font-black text-muted uppercase tracking-widest">
                                <th className="p-5">User Details</th>
                                <th className="p-5">Role</th>
                                <th className="p-5">Status</th>
                                <th className="p-5">Joined</th>
                                <th className="p-5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="p-16 text-center">
                                        <Loader className="animate-spin text-indigo-500 mx-auto" size={32} />
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-4">
                                        <EmptyState
                                            size="sm"
                                            variant="search"
                                            icon={Users}
                                            title="No users match your criteria"
                                            description="No accounts match the current search or role filter. Try a different name, email address, or role to find the account you're looking for."
                                        />
                                    </td>
                                </tr>
                            ) : (
                                users.map((u) => (
                                    <tr key={u.id} className="border-b border-line dark:border-line last:border-0 hover:bg-sunken/50 transition-colors">
                                        <td className="p-5">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <Avatar user={u} size="md" />
                                                <div className="min-w-0">
                                                    <div className="font-bold text-content truncate">{u.name || 'Unknown User'}</div>
                                                    <div className="text-xs text-muted font-medium mt-0.5 truncate">{u.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            {/* normalizeRole, never a raw string. This badge used to test
                                                u.role === 'employer', but the stored value for a PESO
                                                Administrator is 'peso_administrator' — so every one of them
                                                fell through to the blue applicant style AND displayed
                                                "PESO_ADMINISTRATOR" in raw column form. The label comes from
                                                the server's role_label, which is already the display name. */}
                                            <span className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${ROLE_BADGE[normalizeRole(u.role)] || ROLE_BADGE.default}`}>
                                                {u.role_label || getRoleLabel(u.role)}
                                            </span>
                                        </td>
                                        <td className="p-5">
                                            <span className={`flex items-center gap-1.5 text-xs font-bold ${u.account_status === 'Suspended' ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                {u.account_status === 'Suspended' ? <Ban size={14}/> : <CheckCircle size={14}/>}
                                                {u.account_status || 'Active'}
                                            </span>
                                        </td>
                                        <td className="p-5 text-sm text-muted font-medium">
                                            {new Date(u.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="p-5 text-right">
                                            {/* A Super Administrator cannot be suspended from here — normalizeRole
                                                so a legacy stored value cannot slip past this guard. */}
                                            <div className="flex items-center gap-2 justify-end">
                                            <button
                                                onClick={() => setRoleTarget(u)}
                                                className="px-3 py-2 rounded-xl text-xs font-bold border border-line text-muted hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1.5"
                                            >
                                                <ShieldCheck size={14} /> Role
                                            </button>
                                            {normalizeRole(u.role) !== ROLE_KEYS.SUPER_ADMINISTRATOR && (
                                                <button
                                                    onClick={() => (u.account_status === 'Suspended' ? activateUser(u.id) : setSuspendTarget(u))}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm flex items-center gap-2 ml-auto ${
                                                        u.account_status === 'Suspended' 
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400' 
                                                        : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-400'
                                                    }`}
                                                >
                                                    {u.account_status === 'Suspended' ? <Shield size={14}/> : <Ban size={14}/>}
                                                    {u.account_status === 'Suspended' ? 'Activate' : 'Suspend'}
                                                </button>
                                            )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />

            {roleTarget && (
                <RoleChangeDialog
                    user={roleTarget}
                    assignableRoles={roleMeta.assignable}
                    superAdminCount={roleMeta.superAdminCount}
                    currentAdminId={currentAdmin?.id}
                    onClose={() => setRoleTarget(null)}
                    onSaved={() => {
                        fetchUsers();
                        API.get('/admin/roles')
                            .then((res) => setRoleMeta(res.data?.data || roleMeta))
                            .catch(() => {});
                    }}
                />
            )}

            {suspendTarget && (
                <SuspendDialog
                    user={suspendTarget}
                    busy={suspendBusy}
                    onClose={() => setSuspendTarget(null)}
                    onConfirm={confirmSuspend}
                />
            )}
        </div>
    );
};

export default UserAccounts;