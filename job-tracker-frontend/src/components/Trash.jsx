import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, RotateCcw, Loader2, Bookmark, Briefcase, Inbox, Clock, AlertTriangle } from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import { getLabel } from './jobs/CardLabels';
import EmptyState from './common/EmptyState';

/**
 * Centralised Trash for the Job Seeker's deleted items.
 *
 * ONE page, TWO sources (Saved Vacancies + My Applications), kept visually
 * categorised rather than merged into a single undifferentiated list — an item's
 * origin determines where "Restore" puts it back, so hiding that would make the
 * action unpredictable.
 *
 * Retention is enforced server-side (7 days, purged on read); `days_left` is
 * computed there too, so this page never re-derives the policy.
 */
const SOURCE_META = {
    'saved-jobs': { Icon: Bookmark, noun: { singular: 'vacancy', plural: 'vacancies' } },
    'applications': { Icon: Briefcase, noun: { singular: 'application', plural: 'applications' } },
};

const Trash = () => {
    const { notify, confirm } = useNotification();
    const [groups, setGroups] = useState({});
    const [retentionDays, setRetentionDays] = useState(7);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await API.get('/trash');
            if (res.data?.status === 'success') {
                setGroups(res.data.data || {});
                setRetentionDays(res.data.retentionDays ?? 7);
            }
        } catch (error) {
            notify.error('Could not load Trash', 'Please try again in a moment.');
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => { load(); }, [load]);

    const totalItems = useMemo(
        () => Object.values(groups).reduce((n, g) => n + (g.items?.length || 0), 0),
        [groups]
    );

    const restore = async (type, item) => {
        setBusyId(`${type}-${item.id}`);
        try {
            await API.post(`/trash/${type}/restore`, { ids: [item.id] });
            await load();
            notify.success('Restored', `"${item.title}" is back in its original place.`);
        } catch (error) {
            notify.error('Restore failed', 'The item is still in Trash. Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    const destroy = async (type, item) => {
        const ok = await confirm(
            'Delete Permanently?',
            `"${item.title}" will be deleted for good. This cannot be undone.`
        );
        if (!ok) return;

        setBusyId(`${type}-${item.id}`);
        try {
            await API.delete(`/trash/${type}`, { data: { ids: [item.id] } });
            await load();
            notify.success('Deleted', 'The item has been permanently removed.');
        } catch (error) {
            notify.error('Delete failed', 'The item is still in Trash. Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[calc(100vh-4rem)]">
                <Loader2 className="animate-spin text-accent-text" size={40} />
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Trash</h1>
                <p className="text-muted mt-1 font-medium text-sm">
                    Deleted vacancies and applications stay here for {retentionDays} days, then are removed automatically.
                </p>
            </header>

            {totalItems === 0 ? (
                <EmptyState
                    icon={Inbox}
                    title="Trash is empty"
                    description="Items you remove from Saved Vacancies or My Applications rest here for 7 days, so you can restore them if you change your mind. Nothing needs your attention right now."
                    primaryAction={{ label: 'Back to Saved Vacancies', to: '/saved-jobs', icon: <Bookmark size={16} /> }}
                />
            ) : (
                <div className="space-y-8">
                    {Object.entries(groups).map(([type, group]) => {
                        const meta = SOURCE_META[type] || { Icon: Inbox, noun: { singular: 'item', plural: 'items' } };
                        const { Icon } = meta;
                        const items = group.items || [];
                        if (items.length === 0) return null;

                        return (
                            <section key={type}>
                                <h2 className="text-sm font-black uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
                                    <Icon size={16} className="text-accent-text" />
                                    {group.label}
                                    <span className="text-[11px] font-black bg-sunken text-muted px-2 py-0.5 rounded-full">
                                        {items.length}
                                    </span>
                                </h2>

                                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
                                    {items.map((item) => {
                                        const label = getLabel(item.color_label);
                                        const busy = busyId === `${type}-${item.id}`;
                                        const expiring = item.days_left <= 1;

                                        return (
                                            <div
                                                key={`${type}-${item.id}`}
                                                className="bg-surface/80 rounded-2xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4 flex flex-col"
                                            >
                                                <div className="flex items-start gap-2 mb-2">
                                                    {label && <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${label.swatch}`} title={`Label: ${label.name}`} />}
                                                    <div className="min-w-0">
                                                        <p className="font-black text-sm text-content leading-snug line-clamp-2">{item.title}</p>
                                                        <p className="text-xs font-semibold text-muted line-clamp-1 mt-0.5">
                                                            {item.company}{item.status ? ` · ${item.status}` : ''}
                                                        </p>
                                                    </div>
                                                </div>

                                                <p className={`text-[11px] font-bold flex items-center gap-1 mb-3 ${expiring ? 'text-rose-600 dark:text-rose-400' : 'text-muted'}`}>
                                                    {expiring ? <AlertTriangle size={12} /> : <Clock size={12} />}
                                                    {item.days_left === 0
                                                        ? 'Removed today'
                                                        : `${item.days_left} day${item.days_left === 1 ? '' : 's'} left`}
                                                </p>

                                                <div className="mt-auto pt-3 border-t border-line flex items-center gap-2">
                                                    <button
                                                        onClick={() => restore(type, item)}
                                                        disabled={busy}
                                                        className="flex-1 px-3 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-black transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                                                    >
                                                        {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                                        Restore
                                                    </button>
                                                    <button
                                                        onClick={() => destroy(type, item)}
                                                        disabled={busy}
                                                        aria-label="Delete permanently"
                                                        title="Delete permanently"
                                                        className="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-xs font-black transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Trash;
