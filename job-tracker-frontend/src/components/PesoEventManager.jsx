/**
 * PesoEventManager.jsx — the PESO Manager / Staff surface for creating and
 * publishing Events & Announcements (Job Fairs, recruitment drives, seminars…).
 *
 * Backed by the events:manage RBAC capability, so BOTH the PESO Manager and the
 * limited PESO Staff (job-publication co-worker) reach it. Publishing an event for
 * the first time broadcasts an EVENT_ANNOUNCEMENT to every job seeker (server-side).
 *
 * Design-token styled (§24), reduced-motion-safe, purposeful empty state (§14).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
    CalendarDays, Plus, Loader2, X, Trash2, Edit3, ImagePlus, ImageOff, CheckCircle, MapPin,
} from 'lucide-react';
import API from '../api';
import EmptyState from './common/EmptyState';
import { useNotification } from '../context/NotificationContext';
import { SkeletonEventGrid } from './Skeleton';
import { resolveBannerSrc } from './jobs/jobImage';
import { modalOverlay, modalPanel } from '../config/motion';

const EVENT_TYPES = [
    { value: 'job_fair', label: 'Job Fair' },
    { value: 'recruitment_drive', label: 'Recruitment Drive' },
    { value: 'seminar', label: 'Seminar' },
    { value: 'orientation', label: 'Orientation' },
    { value: 'general', label: 'General Announcement' },
];
const STATUS_BADGE = {
    Draft: 'bg-sunken text-muted border border-line',
    Published: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    Cancelled: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    Completed: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
};

const emptyForm = {
    id: null, event_type: 'job_fair', title: '', description: '', venue: '',
    event_date: '', start_time: '', end_time: '', registration_info: '', banner_image: '',
};

// Quality-preserving banner ingest (base64-in-DB, §41). Event posters must stay SHARP
// (they are displayed large on the Landing carousel + detail modal), so we avoid the old
// destructive path (hard 1000px / JPEG q0.82 for EVERY upload — the cause of the blur).
// Strategy, in order of preference:
//   1. If the original is already an appropriate size AND fits under the store cap, keep it
//      VERBATIM (its own bytes + format) — ZERO re-encoding, zero quality loss. This keeps
//      crisp PNG text posters lossless and avoids upscaling a small source.
//   2. Otherwise downscale (NEVER upscale) to MAX_BANNER_W and re-encode at high quality,
//      stepping quality down only as far as needed to fit the cap. A white matte is painted
//      first so a transparent PNG doesn't turn black when it must fall back to JPEG.
// MAX_BANNER_W (2000px) is retina-adequate for the ~1186px desktop hero without bloating the
// base64 payload; MAX_BANNER_CHARS mirrors the backend cap in eventRoutes.js.
const MAX_BANNER_W = 2000;
const MAX_BANNER_CHARS = 3_000_000; // ~2.2MB image; keep in lockstep with eventRoutes.MAX_BANNER_CHARS

const fileToBannerDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const original = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
            // Fast path: already sized right and within the cap → store the original untouched.
            if (img.width <= MAX_BANNER_W && original.length <= MAX_BANNER_CHARS) {
                resolve(original);
                return;
            }
            const scale = Math.min(1, MAX_BANNER_W / img.width); // never upscale
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; // matte so transparent PNG → JPEG doesn't go black
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            let quality = 0.92;
            let out = canvas.toDataURL('image/jpeg', quality);
            while (out.length > MAX_BANNER_CHARS && quality > 0.5) {
                quality -= 0.08;
                out = canvas.toDataURL('image/jpeg', quality);
            }
            resolve(out);
        };
        img.onerror = reject;
        img.src = original;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

const inputCls = 'w-full p-2.5 sm:p-3 rounded-lg text-sm bg-sunken border border-line outline-none focus-visible:ring-2 focus-visible:ring-accent font-medium text-content transition-all';

const PesoEventManager = () => {
    const { notify } = useNotification();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [bannerTouched, setBannerTouched] = useState(false);
    const [saving, setSaving] = useState(false);
    const reduce = useReducedMotion();
    const overlayV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalOverlay;
    const panelV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalPanel;

    const load = useCallback(() => {
        setLoading(true);
        API.get('/events/manage')
            .then((res) => setEvents(Array.isArray(res.data?.data) ? res.data.data : []))
            .catch(() => setEvents([]))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => { load(); }, [load]);

    const openCreate = () => { setForm(emptyForm); setBannerTouched(false); setModalOpen(true); };
    const openEdit = (ev) => {
        // The manage list now carries banner_image, so the edit modal previews it
        // directly (works for drafts too — the public detail route is published-only).
        // bannerTouched stays false, so a save that doesn't re-upload keeps the banner.
        setForm({ ...emptyForm, ...ev, description: ev.description || '', banner_image: ev.banner_image || '' });
        setBannerTouched(false);
        setModalOpen(true);
    };

    // Select OR replace the banner. Transaction-safe: the NEW image is read + validated FIRST,
    // and the form's banner is swapped ONLY on success — so a bad/oversized pick, or a
    // cancelled dialog, leaves the EXISTING banner (and the event) intact. The stored banner in
    // the DB is not touched until the form is saved. Used by both "Upload" and "Change".
    const onBanner = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return; // cancelled → keep the current banner
        if (!file.type.startsWith('image/')) return notify?.error?.('Invalid file', 'Please choose an image (JPG, PNG, or WEBP).');
        try {
            const dataUrl = await fileToBannerDataUrl(file);
            if (dataUrl.length > MAX_BANNER_CHARS) {
                return notify?.error?.('Image too large', 'Even after optimizing, this image is too big. Please choose a smaller one — the current banner is unchanged.');
            }
            setForm((f) => ({ ...f, banner_image: dataUrl }));
            setBannerTouched(true);
        } catch { notify?.error?.('Image error', 'Could not process that image. The current banner is unchanged.'); }
    };
    const clearBanner = () => { setForm((f) => ({ ...f, banner_image: '' })); setBannerTouched(true); };

    const save = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) return notify?.warning?.('Title required', 'Give the event a title.');
        setSaving(true);
        // Send banner_image ONLY when the user changed it, so an edit that leaves the
        // image alone keeps the stored banner (the backend treats undefined as "keep").
        const payload = {
            event_type: form.event_type, title: form.title.trim(), description: form.description,
            // Send a plain YYYY-MM-DD (the stored value round-trips as a full UTC datetime);
            // the backend also normalizes, but sending it clean keeps the payload unambiguous.
            venue: form.venue, event_date: form.event_date ? String(form.event_date).slice(0, 10) : null, start_time: form.start_time,
            end_time: form.end_time, registration_info: form.registration_info,
        };
        if (bannerTouched) payload.banner_image = form.banner_image || null;
        try {
            if (form.id) await API.put(`/events/${form.id}`, payload);
            else await API.post('/events', payload);
            notify?.success?.('Saved', form.id ? 'Event updated.' : 'Event saved as a draft.');
            setModalOpen(false);
            load();
        } catch (err) {
            notify?.error?.('Save failed', err.response?.data?.message || 'Could not save the event.');
        } finally { setSaving(false); }
    };

    const changeStatus = async (ev, status) => {
        if (status === ev.status) return;
        try {
            if (status === 'Published') {
                const res = await API.post(`/events/${ev.id}/publish`);
                notify?.success?.('Published', res.data?.message || 'Event published.');
            } else {
                await API.put(`/events/${ev.id}/status`, { status });
                notify?.success?.('Updated', `Event marked ${status}.`);
            }
            load();
        } catch (err) {
            notify?.error?.('Update failed', err.response?.data?.message || 'Could not update the status.');
        }
    };

    const removeEvent = async (ev) => {
        if (!window.confirm(`Delete "${ev.title}"? This cannot be undone.`)) return;
        try {
            await API.delete(`/events/${ev.id}`);
            notify?.success?.('Deleted', 'Event removed.');
            load();
        } catch (err) {
            notify?.error?.('Delete failed', err.response?.data?.message || 'Could not delete the event.');
        }
    };

    return (
        <div className="max-w-7xl mx-auto p-3 sm:p-5 lg:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-content">Event Announcements</h1>
                    <p className="text-sm font-medium text-muted mt-1">Create and publish job fairs and employment events. Publishing notifies every registered job seeker.</p>
                </div>
                <button onClick={openCreate} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-contrast font-bold shadow-sm hover:bg-accent-hover transition-colors self-start">
                    <Plus size={18} /> New Event
                </button>
            </div>

            {loading ? (
                <SkeletonEventGrid count={6} />
            ) : events.length === 0 ? (
                <EmptyState
                    icon={CalendarDays}
                    title="No events yet"
                    description="Create your first job fair or employment event. Save it as a draft, then publish when it's ready — every job seeker gets a notification."
                    primaryAction={{ label: 'New Event', onClick: openCreate, icon: <Plus size={16} /> }}
                />
            ) : (
                <div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
                    {events.map((ev) => (
                        <div key={ev.id} className="h-full flex flex-col rounded-3xl bg-surface border border-line/80 shadow-card overflow-hidden">
                            {ev.banner_image ? (
                                <div className="h-32 overflow-hidden bg-sunken shrink-0">
                                    <img src={resolveBannerSrc(ev.banner_image)} alt={ev.title} loading="lazy" className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="h-16 bg-accent-soft flex items-center justify-center shrink-0">
                                    <CalendarDays className="text-accent-text/60" size={26} />
                                </div>
                            )}
                            <div className="p-4 flex flex-col flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-accent-text bg-accent-soft px-2.5 py-1 rounded-full">
                                        {EVENT_TYPES.find((t) => t.value === ev.event_type)?.label || 'Announcement'}
                                    </span>
                                    <span className={`text-[11px] font-black px-2.5 py-1 rounded-full ${STATUS_BADGE[ev.status] || STATUS_BADGE.Draft}`}>{ev.status}</span>
                                </div>
                                <h3 className="mt-2 text-sm sm:text-base font-black text-content line-clamp-2">{ev.title}</h3>
                                <div className="mt-1.5 space-y-1 text-xs font-semibold text-muted">
                                    {ev.event_date && <p className="flex items-center gap-1.5"><CalendarDays size={13} className="text-accent-text shrink-0" /> {new Date(ev.event_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}{ev.start_time ? ` · ${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ''}` : ''}</p>}
                                    {ev.venue && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-accent-text shrink-0" /> <span className="line-clamp-1">{ev.venue}</span></p>}
                                </div>
                                {ev.description && <p className="mt-2 text-xs text-muted/90 line-clamp-2 leading-relaxed">{ev.description}</p>}

                                <div className="mt-auto pt-3 flex items-center gap-2">
                                    <select
                                        aria-label={`Status for ${ev.title}`}
                                        value={ev.status}
                                        onChange={(e) => changeStatus(ev, e.target.value)}
                                        className="flex-1 min-w-0 p-2 rounded-lg text-xs font-bold bg-sunken border border-line text-content outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                                    >
                                        <option value="Draft">Draft (hidden)</option>
                                        <option value="Published">Published (live + notify)</option>
                                        <option value="Cancelled">Cancelled</option>
                                        <option value="Completed">Completed</option>
                                    </select>
                                    <button onClick={() => openEdit(ev)} aria-label="Edit event" className="p-2 rounded-lg text-muted hover:bg-sunken hover:text-content transition-colors"><Edit3 size={16} /></button>
                                    <button onClick={() => removeEvent(ev)} aria-label="Delete event" className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={16} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
            {modalOpen && createPortal(
                <motion.div key="event-form-modal" variants={overlayV} initial="initial" animate="animate" exit="exit" className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !saving && setModalOpen(false)}>
                    <motion.div variants={panelV} initial="initial" animate="animate" exit="exit" className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-raised rounded-3xl shadow-raised border border-line" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-line">
                            <h2 className="text-lg font-black text-content">{form.id ? 'Edit Event' : 'New Event'}</h2>
                            <button onClick={() => setModalOpen(false)} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:bg-sunken hover:text-content transition-colors"><X size={18} /></button>
                        </div>
                        <form id="eventForm" onSubmit={save} className="p-4 sm:p-5 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                                <div className="space-y-1.5 md:col-span-2">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Event Title *</label>
                                    <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Kabankalan City Job Fair 2026" className={inputCls} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Event Type</label>
                                    <select aria-label="Event type" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className={`${inputCls} cursor-pointer`}>
                                        {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Venue</label>
                                    <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="e.g., Kabankalan City Gymnasium" className={inputCls} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Date</label>
                                    <input type="date" value={form.event_date ? String(form.event_date).slice(0, 10) : ''} onChange={(e) => setForm({ ...form, event_date: e.target.value })} className={inputCls} />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-muted uppercase tracking-wide">Start Time</label>
                                        <input type="time" value={form.start_time || ''} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className={inputCls} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-muted uppercase tracking-wide">End Time</label>
                                        <input type="time" value={form.end_time || ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className={inputCls} />
                                    </div>
                                </div>
                                <div className="space-y-1.5 md:col-span-2">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Description</label>
                                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What the event is about, who should attend, what to bring…" className={`${inputCls} min-h-[90px]`} />
                                </div>
                                <div className="space-y-1.5 md:col-span-2">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Registration / Participation Info</label>
                                    <textarea value={form.registration_info} onChange={(e) => setForm({ ...form, registration_info: e.target.value })} placeholder="How to register, requirements, walk-in details…" className={`${inputCls} min-h-[70px]`} />
                                </div>
                                <div className="space-y-1.5 md:col-span-2">
                                    <label className="text-xs font-bold text-muted uppercase tracking-wide">Banner / Poster (optional)</label>
                                    {form.banner_image ? (
                                        <div className="relative">
                                            <img src={resolveBannerSrc(form.banner_image)} alt="Event banner preview" className="w-full max-h-48 object-cover rounded-xl border border-line" />
                                            {/* Change = atomic replace (picks + validates a new image, swapping ONLY on
                                                success — the event and its current banner stay intact until the form is
                                                saved). Remove clears it (event keeps its record, shows a gradient). */}
                                            <div className="absolute top-2 right-2 flex items-center gap-2">
                                                <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-black/75 text-white text-xs font-bold cursor-pointer transition-colors" title="Replace this banner">
                                                    <ImagePlus size={14} /> Change
                                                    <input type="file" accept="image/*" onChange={onBanner} className="hidden" />
                                                </label>
                                                <button type="button" onClick={clearBanner} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-black/75 text-white text-xs font-bold transition-colors"><ImageOff size={14} /> Remove</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="flex items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-line text-muted hover:text-content hover:border-accent cursor-pointer transition-colors">
                                            <ImagePlus size={18} /> <span className="text-sm font-bold">Upload a banner image</span>
                                            <input type="file" accept="image/*" onChange={onBanner} className="hidden" />
                                        </label>
                                    )}
                                </div>
                            </div>
                        </form>
                        <div className="p-4 sm:p-5 border-t border-line flex gap-3">
                            <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm text-content bg-surface border border-line hover:bg-sunken transition-colors">Cancel</button>
                            <button type="submit" form="eventForm" disabled={saving} className="flex-1 py-2.5 rounded-xl font-bold text-sm text-accent-contrast bg-accent hover:bg-accent-hover flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                {form.id ? 'Save Changes' : 'Save Draft'}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>,
                document.body
            )}
            </AnimatePresence>
        </div>
    );
};

export default PesoEventManager;
