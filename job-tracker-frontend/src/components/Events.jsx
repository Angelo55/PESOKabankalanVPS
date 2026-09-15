/**
 * Events.jsx — the Job Seeker view of PESO Events & Announcements (Job Fairs,
 * recruitment drives, seminars…). Read-only: published events only, from the
 * public GET /api/events. Card grid + detail modal. Design-token styled (§24),
 * reduced-motion-safe, with a purposeful empty state (§14).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CalendarDays, MapPin, Clock, X, Ticket, ArrowRight } from 'lucide-react';
import API from '../api';
import EmptyState from './common/EmptyState';
import { SkeletonEventGrid } from './Skeleton';
import useFocusTrap from '../hooks/useFocusTrap';
import { resolveBannerSrc } from './jobs/jobImage';
import { modalOverlay, modalPanel } from '../config/motion';

const TYPE_LABELS = {
    job_fair: 'Job Fair',
    recruitment_drive: 'Recruitment Drive',
    seminar: 'Seminar',
    orientation: 'Orientation',
    general: 'Announcement',
};

const formatDate = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
};
const formatDateShort = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};
const formatTimeRange = (s, e) => (s || e) ? [s, e].filter(Boolean).join(' – ') : null;

// A seeker-meaningful "status": every listed event is Published, so surface where it
// sits in time instead (Today / Upcoming / Ended).
const relativeDayStatus = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(dt); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return { label: 'Today', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
    if (diff > 0) return { label: diff <= 14 ? `In ${diff} day${diff === 1 ? '' : 's'}` : 'Upcoming', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
    return { label: 'Ended', cls: 'bg-sunken text-muted' };
};

const EventCard = ({ event, onOpen }) => {
    const dateShort = formatDateShort(event.event_date);
    const timeLabel = formatTimeRange(event.start_time, event.end_time);
    const rel = relativeDayStatus(event.event_date);
    return (
        <button
            onClick={() => onOpen(event)}
            className="group h-full text-left flex flex-col rounded-3xl bg-surface border border-line/80 shadow-card overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
            {event.banner_image ? (
                <div className="h-40 overflow-hidden shrink-0 bg-sunken">
                    <img src={resolveBannerSrc(event.banner_image)} alt={event.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                </div>
            ) : (
                <div className="h-24 bg-accent-soft flex items-center justify-center shrink-0">
                    <CalendarDays className="text-accent-text/70" size={40} />
                </div>
            )}
            <div className="p-4 flex flex-col flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-accent-text bg-accent-soft px-2.5 py-1 rounded-full">
                        {TYPE_LABELS[event.event_type] || 'Announcement'}
                    </span>
                    {rel && <span className={`text-[11px] font-black px-2.5 py-1 rounded-full ${rel.cls}`}>{rel.label}</span>}
                </div>
                <h3 className="text-sm sm:text-base font-black text-content line-clamp-2">{event.title}</h3>
                <div className="mt-2 space-y-1 text-xs font-semibold text-muted">
                    {dateShort && <p className="flex items-center gap-1.5"><CalendarDays size={13} className="text-accent-text shrink-0" /> <span className="line-clamp-1">{dateShort}{timeLabel ? ` · ${timeLabel}` : ''}</span></p>}
                    {event.venue && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-accent-text shrink-0" /> <span className="line-clamp-1">{event.venue}</span></p>}
                </div>
                {event.description && <p className="mt-2 text-xs text-muted/90 line-clamp-2 leading-relaxed">{event.description}</p>}
                <div className="mt-auto pt-3 flex items-center gap-1.5 text-xs font-black text-accent-text">
                    View details <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </div>
            </div>
        </button>
    );
};

// Detail skeleton — mirrors the loaded modal's shape (banner → title → meta rows
// → body) so the panel never flashes a blank/white box while the event or its
// media is resolving. Pulses on the same tokens as SkeletonEventGrid.
const EventDetailSkeleton = () => (
    <div className="animate-pulse" aria-hidden="true">
        <div className="w-full h-44 bg-sunken" />
        <div className="p-5 sm:p-6 space-y-3">
            <div className="h-5 w-28 rounded-full bg-sunken" />
            <div className="h-7 w-3/4 rounded-lg bg-sunken" />
            <div className="space-y-2 pt-1">
                <div className="h-4 w-1/2 rounded bg-sunken" />
                <div className="h-4 w-2/5 rounded bg-sunken" />
                <div className="h-4 w-1/3 rounded bg-sunken" />
            </div>
            <div className="space-y-2 pt-2">
                <div className="h-3.5 w-full rounded bg-sunken" />
                <div className="h-3.5 w-11/12 rounded bg-sunken" />
                <div className="h-3.5 w-4/5 rounded bg-sunken" />
            </div>
        </div>
    </div>
);

const EventModal = ({ id, onClose }) => {
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const trapRef = useFocusTrap(true); // C1: trap + restore focus (WCAG 2.4.3)
    const reduce = useReducedMotion();

    useEffect(() => {
        let alive = true;
        setLoading(true);
        API.get(`/events/${id}`)
            .then((res) => { if (alive) setEvent(res.data?.data || null); })
            .catch(() => { if (alive) setEvent(null); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [id]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const dateLabel = event && formatDate(event.event_date);
    const timeLabel = event && formatTimeRange(event.start_time, event.end_time);

    // Reduced motion → plain opacity swap, no transform/scale (config variants
    // are transform-based; honour the OS setting).
    const overlayV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalOverlay;
    const panelV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalPanel;

    return createPortal(
        <motion.div
            variants={overlayV} initial="initial" animate="animate" exit="exit"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}
        >
            <motion.div
                ref={trapRef} role="dialog" aria-modal="true" aria-busy={loading} tabIndex={-1}
                variants={panelV} initial="initial" animate="animate" exit="exit"
                className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-raised rounded-3xl shadow-raised border border-line focus:outline-none" onClick={(e) => e.stopPropagation()}
            >
                {loading ? (
                    <EventDetailSkeleton />
                ) : !event ? (
                    <div className="p-8">
                        <EmptyState size="sm" variant="search" title="Event unavailable" description="This event may have been unpublished or removed." />
                        <button onClick={onClose} className="mt-4 w-full py-2.5 rounded-xl bg-accent text-accent-contrast font-bold">Close</button>
                    </div>
                ) : (
                    <>
                        {event.banner_image
                            ? <img src={resolveBannerSrc(event.banner_image)} alt={event.title} className="w-full max-h-56 object-cover" />
                            : <div className="h-28 bg-accent-soft flex items-center justify-center"><CalendarDays className="text-accent-text/70" size={44} /></div>}
                        <div className="p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-3">
                                <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-accent-text bg-accent-soft px-2.5 py-1 rounded-full">
                                    {TYPE_LABELS[event.event_type] || 'Announcement'}
                                </span>
                                <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:bg-sunken hover:text-content transition-colors"><X size={18} /></button>
                            </div>
                            <h2 className="mt-3 text-xl sm:text-2xl font-black text-content">{event.title}</h2>
                            <div className="mt-3 space-y-2 text-sm font-semibold text-muted">
                                {dateLabel && <p className="flex items-center gap-2"><CalendarDays size={16} className="text-accent-text shrink-0" /> {dateLabel}</p>}
                                {timeLabel && <p className="flex items-center gap-2"><Clock size={16} className="text-accent-text shrink-0" /> {timeLabel}</p>}
                                {event.venue && <p className="flex items-center gap-2"><MapPin size={16} className="text-accent-text shrink-0" /> {event.venue}</p>}
                            </div>
                            {event.description && (
                                <p className="mt-4 text-sm text-content/90 whitespace-pre-wrap leading-relaxed">{event.description}</p>
                            )}
                            {event.registration_info && (
                                <div className="mt-4 p-3.5 rounded-2xl bg-sunken border border-line">
                                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-accent-text mb-1"><Ticket size={14} /> Registration / Participation</p>
                                    <p className="text-sm text-content/90 whitespace-pre-wrap leading-relaxed">{event.registration_info}</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </motion.div>
        </motion.div>,
        document.body
    );
};

const Events = () => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [openId, setOpenId] = useState(null);

    const load = useCallback(() => {
        setLoading(true);
        API.get('/events')
            .then((res) => setEvents(Array.isArray(res.data?.data) ? res.data.data : []))
            .catch(() => setEvents([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="max-w-7xl mx-auto p-3 sm:p-5 lg:p-6">
            <div className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-content">PESO Events &amp; Job Fairs</h1>
                <p className="text-sm font-medium text-muted mt-1">Upcoming job fairs, recruitment drives, and employment events from PESO Kabankalan.</p>
            </div>

            {loading ? (
                <SkeletonEventGrid count={6} />
            ) : events.length === 0 ? (
                <EmptyState
                    icon={CalendarDays}
                    title="No upcoming events yet"
                    description="When PESO Kabankalan schedules a job fair or employment event, it will appear here — and you'll get a notification."
                />
            ) : (
                <div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))]">
                    {events.map((ev) => <EventCard key={ev.id} event={ev} onOpen={(e) => setOpenId(e.id)} />)}
                </div>
            )}

            <AnimatePresence>
                {openId != null && <EventModal key="event-modal" id={openId} onClose={() => setOpenId(null)} />}
            </AnimatePresence>
        </div>
    );
};

export default Events;
