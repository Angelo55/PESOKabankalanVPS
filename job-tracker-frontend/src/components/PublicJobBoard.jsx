/**
 * PUBLIC JOB BOARD — the vacancy browser, and the entry point to applying.
 *
 * WHAT: searchable, filterable list of PESO vacancies with a detail panel, AI
 * compatibility scoring for the signed-in user, similar-job recommendations,
 * and the Apply button.
 *
 * WHEN: the main destination for job seekers, and browsable without an account.
 *
 * ── FILLED VACANCIES STAY ON THE BOARD ─────────────────────────────────────
 * A vacancy that has been fully referred is shown with a "Vacancy Filled" /
 * "Vacancies Filled" ribbon and a locked Apply button — it does not disappear.
 * A posting that silently vanishes reads as a broken link to anyone who
 * bookmarked or shared it.
 *
 * Use isJobFilled() and filledLabel() from jobs/JobCard.jsx. Never re-derive
 * the check locally: "filled" is true when the status says so OR when
 * referred_count has reached positions_available, and the COUNT wins over the
 * flag. Two copies of that rule WILL drift.
 *
 * ── AI COMPATIBILITY ───────────────────────────────────────────────────────
 * The detail panel scores the signed-in user against the selected job. Three
 * states have to be handled, and all three are real:
 *   - a score          show the breakdown
 *   - NO RESUME YET    prompt to add one; scoring is impossible, not broken
 *   - NULL score       the AI was unavailable; the application still works and
 *                      routes to manual review
 * NULL is a NORMAL outcome, never an error state. A fabricated number would be
 * worse than none, because it misleads someone deciding whether to apply.
 *
 * ── THE RECOMMENDATION CAROUSEL ────────────────────────────────────────────
 * Native CSS scroll-snap with page-based dots rather than a carousel library:
 * it keeps momentum scrolling and touch behaviour that users already expect on
 * mobile, and adds no dependency. This is the reference implementation — copy
 * this pattern for any new carousel.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
    Briefcase, MapPin, Building2, CheckCircle, Search, Loader2, 
    Bookmark, BookmarkCheck, ArrowRight, Sparkles, GraduationCap, 
    ChevronLeft, LayoutGrid, Accessibility, Cpu, MessageCircle,
    Clock, Users, FileText, Lock, Building, Globe,
    Banknote, CalendarDays, CalendarClock
} from 'lucide-react';
import API from '../api';
import { SkeletonPageHeader, SkeletonCardGrid, Skeleton } from './Skeleton';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import useJobFilters from './jobs/useJobFilters';
import JobFilterBar from './jobs/JobFilterBar';
import CategoryChips from './jobs/CategoryChips';
import JobCategorySections from './jobs/JobCategorySections';
import JobCard, { isJobFilled, filledLabel } from './jobs/JobCard';
import ApplyWizard from './ApplyWizard';
import EmptyState from './common/EmptyState';
import Reveal from './common/Reveal';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const FILE_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');
const resolveJobImage = (src) => (src ? (src.startsWith('http') ? src : `${FILE_BASE}${src}`) : null);

// One consistent reveal for the AI compatibility result: ~1.4s, ease-out.
const SCORE_ANIM_MS = 1400;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * AI Compatibility score reveal. The numeric score AND the progress bar are BOTH
 * driven off ONE animated value (`displayed`), so they advance in lockstep from
 * 0 → the real score — never one finishing before the other.
 *
 * WHEN IT ANIMATES (and, crucially, when it does NOT): this is a MOUNT-triggered
 * animation. The parent resets `aiScores` to null at the start of every open/reopen
 * (handleOpenDetails) and only renders this component once the VERIFIED score has
 * arrived — so mounting == "a real result just became available". That gives a
 * fresh reveal on each new result and on an intentional panel reopen, while an
 * unrelated re-render (hover, typing, other state) never restarts it because the
 * component stays mounted with the same result. No fabricated/intermediate score is
 * ever shown: until this mounts, the card shows the loading/failure/locked states.
 *
 * States handled cleanly: 0% (animates to 0, no misleading fill), partial, 100%,
 * and a non-numeric/missing overall (shows "—" + empty bar, no animation). Respects
 * prefers-reduced-motion by jumping straight to the final value.
 */
const AnimatedScore = ({ score, matchBand }) => {
    const target = Number(score);
    const valid = Number.isFinite(target);
    const finalValue = valid ? Math.max(0, Math.min(100, target)) : 0;
    const [displayed, setDisplayed] = useState(valid ? 0 : null);

    useEffect(() => {
        if (!valid) { setDisplayed(null); return; }
        const reduce = typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduce || finalValue === 0) { setDisplayed(finalValue); return; }

        let raf;
        const start = performance.now();
        const tick = (now) => {
            const p = Math.min(1, (now - start) / SCORE_ANIM_MS);
            setDisplayed(finalValue * easeOutCubic(p));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // Mount-only: the parent remounts this per new result / reopen (see doc above).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Tone + band label come from the REAL score (stable), so only the number and the
    // bar count up — the colour/label are correct from the first frame.
    const band = matchBand(score);
    const shown = displayed == null ? null : Math.round(displayed);
    const barWidth = displayed == null ? 0 : displayed;

    return (
        <>
            {/* PRIMARY: the numeric AI compatibility score, counting up in sync with the bar. */}
            <div className={`text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r ${band.tone} tabular-nums`} title={`${band.label} — estimated compatibility`}>
                {shown == null ? '—' : `${shown}%`}
            </div>
            {/* SECONDARY: the qualitative band, supporting text rather than the value. */}
            <p className={`text-sm font-black mt-1 text-transparent bg-clip-text bg-gradient-to-r ${band.tone}`}>
                {band.label}
            </p>
            {/* Progress bar — width driven by the SAME animated value; no CSS transition
                (rAF drives it frame-by-frame, a CSS transition would desync it). */}
            <div className="mt-3 h-2 w-full rounded-full bg-sunken overflow-hidden" role="progressbar" aria-valuenow={valid ? Math.round(finalValue) : 0} aria-valuemin={0} aria-valuemax={100} aria-label="AI compatibility score">
                <div className={`h-full rounded-full bg-gradient-to-r ${band.tone}`} style={{ width: `${barWidth}%` }} />
            </div>
            <p className="text-xs font-bold text-muted uppercase tracking-widest mt-2">Estimated Compatibility</p>
            <p className="text-[11px] font-medium text-subtle mt-1">
                Your exact match score is calculated when you apply.
            </p>
        </>
    );
};

// A compact labelled fact cell for the detail panel's "key facts" strip — the scannable
// header row (pay / employment / location / positions / deadline) a seeker reads first.
const DetailFact = ({ icon: Icon, label, value, accent = 'text-accent-text', emphasis = false, valueClass = '' }) => (
    <div className="flex flex-col gap-1 rounded-xl bg-surface border border-line p-3 shadow-sm min-w-0">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-subtle">
            <Icon size={13} className={`${accent} shrink-0`} /> {label}
        </span>
        <span className={`${emphasis ? 'text-[15px] font-black' : 'text-sm font-bold'} text-content leading-snug break-words ${valueClass}`}>{value}</span>
    </div>
);

// Relative posting age for the detail header ("Posted today / 3 days ago", else a date).
const postedLabel = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
    if (days <= 0) return 'Posted today';
    if (days === 1) return 'Posted yesterday';
    if (days < 30) return `Posted ${days} days ago`;
    return `Posted ${dt.toLocaleDateString()}`;
};

// Swipe-friendly recommendation carousel with page-based pagination dots
// instead of a visible scrollbar. Uses native horizontal scroll (momentum +
// swipe on mobile) with CSS scroll-snap; one dot represents one screenful of
// cards, so the indicator stays compact even with many recommendations.
const RecommendationCarousel = ({ jobs, onSelect }) => {
    const scrollRef = useRef(null);
    const [activePage, setActivePage] = useState(0);
    const [pageCount, setPageCount] = useState(1);

    // A "page" is one viewport-width of cards. Page count therefore adapts to
    // how many cards fit at the current screen size (recomputed on resize).
    const measure = () => {
        const el = scrollRef.current;
        if (!el) return;
        const pages = Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth));
        setPageCount(pages);
        const maxScroll = el.scrollWidth - el.clientWidth;
        const page = maxScroll - el.scrollLeft < 4
            ? pages - 1
            : Math.round(el.scrollLeft / el.clientWidth);
        setActivePage(Math.max(0, Math.min(pages - 1, page)));
    };

    useEffect(() => {
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobs.length]);

    const scrollToPage = (i) => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    };

    return (
        <div>
            <div
                ref={scrollRef}
                onScroll={measure}
                className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {jobs.map(simJob => (
                    <div key={simJob.id} onClick={() => onSelect(simJob)} className="snap-start shrink-0 w-[280px] bg-surface p-5 rounded-2xl border border-line shadow-sm hover:shadow-md cursor-pointer group hover:-translate-y-1 transition-all">
                        <h4 className="font-bold text-content truncate group-hover:text-indigo-500 transition-colors">{simJob.title}</h4>
                        <p className="text-xs font-semibold text-indigo-500 mb-3">{simJob.company}</p>
                        <div className="flex items-center gap-2 text-xs text-muted font-medium">
                            <MapPin size={12} /> {simJob.location || 'Remote'}
                        </div>
                        <div className="mt-4 pt-3 border-t border-line flex justify-between items-center text-xs font-bold">
                            {/* Neutral recommendation indicator — NOT a compatibility
                                score. The personalised score lives on the detail view
                                (/jobs/match); these cards are a relevance shortlist, so
                                showing a percentage here misled users (see jobRoutes
                                /:id/similar). 'profile' = AI picked it from the resume;
                                'related' = AI-unavailable fallback of live vacancies. */}
                            <span className="inline-flex items-center gap-1 text-indigo-500">
                                <Sparkles size={12} />
                                {simJob.recommendation_reason === 'related' ? 'Related Position' : 'Recommended for You'}
                            </span>
                            <span className="text-subtle group-hover:text-content transition-colors">View <ArrowRight size={12} className="inline" /></span>
                        </div>
                    </div>
                ))}
            </div>

            {pageCount > 1 && (
                <div className="flex justify-center items-center gap-2 mt-4">
                    {Array.from({ length: pageCount }).map((_, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() => scrollToPage(i)}
                            aria-label={`Go to recommendations page ${i + 1}`}
                            aria-current={activePage === i}
                            className={`h-2 rounded-full transition-all duration-300 ${activePage === i ? 'w-6 bg-accent-text' : 'w-2 bg-line hover:bg-line-strong'}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const PublicJobBoard = () => {
    const { user, onboarding, openOnboarding, refreshOnboarding } = useAuth();
    // Keep the Apply gate current — a résumé built/uploaded elsewhere flips canApply.
    useEffect(() => { if (user?.role === 'applicant') refreshOnboarding?.(); }, [user, refreshOnboarding]);

    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingJob, setSavingJob] = useState(null);
    const [savedJobIds, setSavedJobIds] = useState(new Set());

    // Discovery: search / filter / sort / category browsing (client-side). The search
    // dropdown (recent / suggested / results / quick filters) is owned by JobFilterBar,
    // keyed on the 'job-board' namespace passed below.
    const jf = useJobFilters(jobs);

    // Multi-step apply wizard target job (null = closed).
    const [wizardJob, setWizardJob] = useState(null);

    // Distinguishes touch devices (single tap opens) from mouse devices
	// (single click browses; double-click or the Full Details button opens).
	const [isTouch, setIsTouch] = useState(false);
	useEffect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		const mq = window.matchMedia('(pointer: coarse)');
		const update = () => setIsTouch(mq.matches);
		update();
		mq.addEventListener ? mq.addEventListener('change', update) : mq.addListener(update);
		return () => { mq.removeEventListener ? mq.removeEventListener('change', update) : mq.removeListener(update); };
	}, []);
    
    // Modal State
    const [selectedJob, setSelectedJob] = useState(null);

    // The vacancy-detail panel is a modal dialog: Escape closes it — the keyboard equivalent of
    // the backdrop click, matching the platform's other overlays (WCAG 2.1.2 / dialog dismissal).
    // MUST stay BELOW selectedJob's useState: a useEffect whose deps read `selectedJob` cannot sit
    // above its declaration or it's accessed before initialization (const TDZ → runtime crash).
    useEffect(() => {
        if (!selectedJob) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setSelectedJob(null); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [selectedJob]);
    const [similarJobs, setSimilarJobs] = useState([]);
    const [aiScores, setAiScores] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [resumeRequired, setResumeRequired] = useState(false);

    const { notify, notifications } = useNotification();
    // Real-time board sync: bumped by ChatContext when a vacancy is published / edited /
    // has its status changed (socket 'job_board_updated' or a NEW_JOB broadcast).
    const { jobBoardRefreshTrigger } = useChat() || {};
    const navigate = useNavigate();

    // Freshness marker for the visibility backstop, so a quick tab-focus doesn't refetch
    // when the list was just loaded. Real-time triggers refetch immediately regardless.
    const lastFetchedRef = useRef(0);

    useEffect(() => {
        fetchJobs();
        if (user) fetchSavedJobs();
    }, [user]);

    // A `silent` fetch refreshes the list in place — no skeleton, no error toast, no
    // clobbering the list on a transient failure — so background/real-time refreshes
    // never flash the UI or disturb an open detail drawer / active filters.
    const fetchJobs = async ({ silent = false } = {}) => {
        try {
            const response = await API.get('/job-board', getAuthConfig());
            const jobsArray = Array.isArray(response.data) ? response.data : (response.data?.data || []);
            setJobs(jobsArray);
            lastFetchedRef.current = Date.now();
        } catch (error) {
            if (!silent) {
                notify.error("Error", "Failed to load job postings.");
                setJobs([]);
            }
        } finally {
            if (!silent) setLoading(false);
        }
    };

    // Real-time (INSTANT path): a vacancy was published/edited/closed/reopened → the
    // socket bumped this trigger → refetch the list silently so browsers see it without
    // a manual reload. Skips the initial mount (the trigger starts at 0).
    const firstBoardTrigRef = useRef(true);
    useEffect(() => {
        if (firstBoardTrigRef.current) { firstBoardTrigRef.current = false; return; }
        fetchJobs({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobBoardRefreshTrigger]);

    // Real-time (RELIABLE path): keep the board in lock-step with the NOTIFICATION the
    // seeker actually received. The bell learns about a new vacancy through BOTH the
    // socket broadcast AND its own visibility-gated poll backstop (NotificationContext),
    // so it can surface a NEW_JOB even when the raw 'job_board_updated' socket event was
    // missed (a dropped/degraded socket on Render's free tier, §18.9). Watching the
    // highest NEW_JOB notification id means: the instant the seeker is TOLD a job exists —
    // by any channel — the board refetches to show it. This closes the gap where the
    // notification subsystem and the board subscribed to different sync events.
    const latestNewJobNotifId = useMemo(() => {
        let max = 0;
        for (const n of (notifications || [])) {
            if (n.type === 'NEW_JOB' && Number(n.id) > max) max = Number(n.id);
        }
        return max;
    }, [notifications]);
    const prevNewJobNotifIdRef = useRef(null);
    useEffect(() => {
        // First observation just records the baseline (existing history is not "new").
        if (prevNewJobNotifIdRef.current === null) {
            prevNewJobNotifIdRef.current = latestNewJobNotifId;
            return;
        }
        if (latestNewJobNotifId > prevNewJobNotifIdRef.current) {
            prevNewJobNotifIdRef.current = latestNewJobNotifId;
            fetchJobs({ silent: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [latestNewJobNotifId]);

    // Backstop poll: guarantees eventual consistency if a socket event is missed, and
    // covers anonymous visitors (who have no socket). Visibility-gated so a hidden tab
    // never polls; on tab-focus it refetches only when the list is already stale, so
    // rapid Alt-Tabbing does not hammer the endpoint (the platform's §18.9 posture).
    useEffect(() => {
        const POLL_MS = Number(import.meta.env.VITE_JOB_BOARD_POLL_MS) || 90000;
        const STALE_MS = 30000;
        const tick = () => {
            if (document.hidden) return;
            if (Date.now() - lastFetchedRef.current < STALE_MS) return;
            fetchJobs({ silent: true });
        };
        const id = setInterval(tick, POLL_MS);
        document.addEventListener('visibilitychange', tick);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchSavedJobs = async () => {
        try {
            const response = await API.get('/saved-jobs', getAuthConfig());
            const savedArray = Array.isArray(response.data) ? response.data : (response.data?.data || []);
            const ids = new Set(savedArray.map(j => j.job_id || j.id));
            setSavedJobIds(ids);
        } catch (error) {}
    };

    const handleSaveToggle = async (e, jobId) => {
        e.stopPropagation();
        if (!user) return notify.info("Authentication Required", "Please log in to save jobs.");
        
        setSavingJob(jobId);
        try {
            if (savedJobIds.has(jobId)) {
                await API.delete(`/saved-jobs/${jobId}`, getAuthConfig());
                setSavedJobIds(prev => { const next = new Set(prev); next.delete(jobId); return next; });
                notify.info("Removed", "Job removed from saved list.");
            } else {
                await API.post('/saved-jobs', { job_id: jobId }, getAuthConfig()); 
                setSavedJobIds(prev => { const next = new Set(prev); next.add(jobId); return next; });
                notify.success("Saved!", "Job bookmarked to your profile.");
            }
        } catch (error) {
            notify.error("Save Failed", "Could not update saved jobs.");
        } finally {
            setSavingJob(null);
        }
    };

    // 🚨 ARCHITECTURAL FIX: Deep Fetch Pipeline implementation
    const handleOpenDetails = async (job) => {
        // Optimistically open modal with lightweight data immediately to prevent lag
        setSelectedJob(job);
        setIsAnalyzing(true);
        setAiScores(null);
        setSimilarJobs([]);
        setResumeRequired(false);

        try {
            // 1. Execute Deep Fetch for rich description texts & employer profile
            const detailsRes = await API.get(`/job-board/${job.id}`, getAuthConfig());
            const fullJob = detailsRes.data?.data || job;
            setSelectedJob(fullJob);

            // 2. Execute AI Processing
            if (user && user.role === 'applicant') {
                const [similarRes, scoreRes] = await Promise.all([
                    API.get(`/jobs/${job.id}/similar`, getAuthConfig()),
                    API.post('/jobs/match', { jobId: job.id }, getAuthConfig())
                ]);
                
                if (scoreRes.data?.status === 'resume_required' || similarRes.data?.status === 'resume_required') {
                    setResumeRequired(true);
                } else {
                    setSimilarJobs(Array.isArray(similarRes.data?.data) ? similarRes.data.data : []);
                    setAiScores(scoreRes.data?.data || scoreRes.data);
                }
            }
        } catch (error) {
            if (error.response?.data?.status === 'resume_required') {
                setResumeRequired(true);
            } else {
                console.error("Job Pipeline Failure:", error);
                notify.error("Data Error", "Could not load complete job details.");
            }
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Opens the multi-step apply wizard (gated to signed-in job seekers).
    const handleStartApply = (job) => {
        if (isJobFilled(job)) return notify.info(filledLabel(job), "All available positions for this job have been referred. Applications are closed.");
        if (!user) return notify.info("Authentication Required", "Please log in to apply.");
        if (user.role !== 'applicant') return notify.error("Access Denied", "Only job seekers can apply.");
        if (!job) return;
        // Account-completion gate: a seeker must finish the required identity/profile
        // fields AND have a résumé on file before applying. The server re-enforces this
        // at POST /applications; here we open the onboarding flow instead of the wizard.
        if (onboarding && !onboarding.canApply) {
            notify.info(
                'Complete your profile to apply',
                !onboarding.profileComplete
                    ? 'Please finish your identity details first — it only takes a minute.'
                    : 'Please add your résumé before applying to a vacancy.'
            );
            openOnboarding();
            return;
        }
        setWizardJob(job);
    };

    const handleMessageEmployer = async (employerId, jobId) => {
        if (!user) return notify.info("Authentication Required", "Please log in to send messages.");
        try {
            const response = await API.post('/messages/conversations', { peso_admin_id: employerId, job_id: jobId }, getAuthConfig());
            if (response.data?.status === 'success' || response.status === 201 || response.status === 200) {
                navigate('/messages'); 
            }
        } catch (error) {
            notify.error("Connection Error", "Could not establish a secure channel with the employer.");
        }
    };

    const triggerAiAdvice = () => {
        if (!selectedJob) return;
        window.dispatchEvent(new CustomEvent('trigger-ai-analysis', { detail: { job: selectedJob } }));
    };

    // Deep-link support: Saved Vacancies (and any other module) can hand off to the
    // board — the single source of truth for job details + AI — via the URL:
    //   /job-board?job=<id>       auto-open that vacancy's detail drawer
    //   /job-board?category=<c>   pre-apply the category filter ("Browse Similar")
    // The params are consumed once (guarded by a ref) and cleared so a refresh or a
    // later filter change never re-triggers the open.
    const [searchParams, setSearchParams] = useSearchParams();
    const deepLinkHandledRef = useRef(false);
    useEffect(() => {
        if (deepLinkHandledRef.current) return;
        const jobParam = searchParams.get('job');
        const catParam = searchParams.get('category');
        if (!jobParam && !catParam) return;
        // The job list drives the open, so wait until it has loaded.
        if (jobParam && loading) return;

        if (catParam) jf.set.setCategory(catParam);

        if (jobParam) {
            const found = jobs.find(j => String(j.id) === String(jobParam));
            if (found) {
                handleOpenDetails(found);
            } else {
                // Not on the board (e.g. the vacancy was closed/removed after saving).
                // Try a direct detail fetch; if that fails too, tell the user plainly.
                (async () => {
                    try {
                        const r = await API.get(`/job-board/${jobParam}`, getAuthConfig());
                        const fj = r.data?.data;
                        if (fj) handleOpenDetails(fj);
                        else notify.info('Unavailable', 'That job posting could not be opened.');
                    } catch {
                        notify.info('Unavailable', 'That job posting is no longer available.');
                    }
                })();
            }
        }

        deepLinkHandledRef.current = true;
        const next = new URLSearchParams(searchParams);
        next.delete('job');
        next.delete('category');
        setSearchParams(next, { replace: true });
    }, [loading, jobs, searchParams]);

    if (loading) return (
        <div className="p-5 sm:p-6 lg:p-8 w-full max-w-7xl mx-auto min-h-screen">
            <SkeletonPageHeader />
            <Skeleton className="h-12 w-full rounded-2xl mb-6" />
            <SkeletonCardGrid count={8} />
        </div>
    );


    // The job-board score is a LIVE preview -- a fresh DeepSeek call each time the
	// job opens, so it drifts a few points between views. Per panel feedback (2026-08)
	// the NUMERIC score is now shown as the PRIMARY value for transparency; the band
	// label below is kept as SECONDARY supporting text, and the "exact score at apply"
	// note is preserved so the drift reads as an estimate, not a bug. The exact, stored
	// score is still computed once at apply time; this remains only a browsing estimate.
	// (Band tones also drive the progress bar + label colour.)
	const matchBand = (score) => {
		const value = Number(score);
		if (!Number.isFinite(value)) return { label: 'Estimating', tone: 'from-gray-400 to-gray-500' };
		if (value >= 75) return { label: 'Strong Match', tone: 'from-emerald-500 to-green-500' };
		if (value >= 55) return { label: 'Good Match', tone: 'from-indigo-500 to-violet-500' };
		if (value >= 35) return { label: 'Moderate Match', tone: 'from-amber-500 to-orange-500' };
		return { label: 'Low Match', tone: 'from-rose-500 to-red-500' };
	};

	// Sub-score colour must track the actual High/Medium/Low value — a "Low" must not
	// render green (previously all three were hardcoded emerald/amber). Unknown → muted.
	const levelTone = (level) => {
		const v = String(level || '').trim().toLowerCase();
		if (v === 'high') return 'text-emerald-500';
		if (v === 'medium' || v === 'moderate') return 'text-amber-500';
		if (v === 'low') return 'text-rose-500';
		return 'text-muted';
	};

    return (
        <>
            {/* Page background is intentionally the app's own surface (AppLayout's
                #f0f5f3 / gray-900) — no tinted wash. "Radiant Fields" survives only
                as restrained accents: Deep Green #4F7942 for actions and active
                states (5.07:1 on white), with Ink Green #2F4A28 for headings.
                Gold is reserved for a single small highlight in the category nav,
                never as text on a light surface (1.6:1) and never on cards. */}
            <div className="p-5 sm:p-6 lg:p-8 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in relative">
                    <header className="mb-6">
                        <h1 className="text-3xl sm:text-4xl font-black text-content tracking-tight">
                            PESO Job Portal
                        </h1>
                        <p className="text-muted mt-2 font-medium text-sm sm:text-base">
                            Discover verified local opportunities within the Kabankalan City community.
                        </p>
                    </header>

                {/* Category navigation — full-width flex-wrap across the module's
                    content width; fills each row edge-to-edge and wraps on narrow
                    screens (no horizontal scroll, no left-clustering; see CategoryChips). */}
                {jobs.length > 0 && (
                    <CategoryChips
                        categories={jf.categories}
                        active={jf.state.category}
                        total={jobs.length}
                        onSelect={(name) => jf.set.setCategory(name)}
                        className="mb-5"
                    />
                )}

                <JobFilterBar filters={jf} showCategory={false} variant="radiant" resultCount={jf.activeCount > 0 ? jf.filtered.length : null} className="mb-8 sm:mb-10" searchNamespace="job-board" searchPlaceholder="Search jobs, keywords, or companies" />

                {jobs.length === 0 ? (
                    <EmptyState
                        icon={Briefcase}
                        title="No open positions right now"
                        description="The PESO Kabankalan office hasn't posted any vacancies at the moment. New openings appear here automatically — in the meantime, get your resume ready so you can apply the moment a match is posted."
                        primaryAction={{ label: 'Build Your Resume', to: '/builder', icon: <FileText size={16} /> }}
                    />
                ) : jf.activeCount === 0 ? (
                    <JobCategorySections
                        jobs={jobs}
                        categories={jf.categories}
                        savedJobIds={savedJobIds}
                        savingJob={savingJob}
                        onOpen={handleOpenDetails}
                        onToggleSave={handleSaveToggle}
                        isTouch={isTouch}
                        onSeeAllCategory={(name) => jf.set.setCategory(name)}
                    />
                ) : jf.filtered.length === 0 ? (
                    <EmptyState
                        variant="search"
                        title={jf.state.search ? `No jobs match “${jf.state.search}”` : 'No jobs match your filters'}
                        description="We couldn't find any vacancies for that search. Try a different keyword from the search box, explore a category, or clear your filters to see everything that's currently open."
                        primaryAction={{ label: 'Clear filters', onClick: jf.reset }}
                    />
                ) : (
                    /* Fluid card grid: auto-fill/minmax keeps every track in the
                       ~350–400px design band and reflows 1→2→3+ columns on its
                       own, so no breakpoint list can drift out of sync. The
                       min() guard stops the 340px floor from overflowing narrow
                       phones, and auto-rows-fr equalises heights per row. */
                    <div className="grid gap-5 sm:gap-6 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
                        {jf.filtered.map((job, i) => (
                            <Reveal key={job.id} className="h-full" delay={Math.min(i * 40, 320)}>
                                <JobCard
                                    job={job}
                                    saved={savedJobIds.has(job.id)}
                                    saving={savingJob === job.id}
                                    onOpen={handleOpenDetails}
                                    onToggleSave={handleSaveToggle}
                                    isTouch={isTouch}
                                />
                            </Reveal>
                        ))}
                    </div>
                )}
            </div>

            {selectedJob && (
                <div className="fixed inset-0 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md z-[40] flex justify-end animate-in fade-in duration-300 cursor-pointer" onClick={() => setSelectedJob(null)}>
                    <div role="dialog" aria-modal="true" aria-label={`Vacancy details: ${selectedJob.title}`} className="w-full max-w-4xl h-full bg-canvas shadow-2xl flex flex-col animate-in slide-in-from-right-8 duration-500 overflow-hidden relative cursor-default" onClick={(e) => e.stopPropagation()}>
                        
                        <div className="flex flex-wrap items-center justify-between p-6 bg-raised/80 backdrop-blur-xl border-b border-line z-10 shadow-sm gap-4">
                            <button onClick={() => setSelectedJob(null)} className="p-2 bg-sunken hover:bg-line text-content rounded-full transition-colors flex items-center gap-2 pr-4 font-bold text-sm">
                                <ChevronLeft size={18} /> Back
                            </button>
                            
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                <button onClick={(e) => handleSaveToggle(e, selectedJob.id)} className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border transition-all ${savedJobIds.has(selectedJob.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300' : 'bg-surface border-line text-content hover:bg-sunken'}`}>
                                    {savedJobIds.has(selectedJob.id) ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} 
                                    <span className="hidden sm:inline">{savedJobIds.has(selectedJob.id) ? 'Saved' : 'Save'}</span>
                                </button>
                                
                                <button onClick={() => handleMessageEmployer(selectedJob.peso_admin_id, selectedJob.id)} className="px-4 py-2.5 bg-sunken hover:bg-line text-content font-bold rounded-xl transition-all flex items-center gap-2 border border-transparent shadow-sm" title="Send a message to the employer">
                                    <MessageCircle size={16} /> <span className="hidden sm:inline">Inquire</span>
                                </button>

                                {isJobFilled(selectedJob) ? (
                                    <span className="px-5 py-2.5 bg-sunken border border-line text-muted font-bold rounded-xl flex items-center gap-2 text-sm cursor-not-allowed" title="All available positions have been referred">
                                        <Lock size={15} />
                                        {filledLabel(selectedJob)}
                                    </span>
                                ) : (
                                    <button onClick={() => handleStartApply(selectedJob)} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-accent-contrast font-black rounded-xl shadow-sm transition-colors flex items-center gap-2">
                                        <CheckCircle size={16} />
                                        Apply Now
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6 lg:p-8">

                            {/* ── HERO: title, employer, posting age + status, and the scannable key-facts strip ── */}
                            <div className="mb-6 pb-6 border-b border-line">
                                {resolveJobImage(selectedJob.featured_image) && (
                                    <div className="mb-5 rounded-2xl overflow-hidden border border-line shadow-sm h-40 sm:h-44">
                                        <img src={resolveJobImage(selectedJob.featured_image)} alt={selectedJob.title} className="w-full h-full object-cover" />
                                    </div>
                                )}

                                {isJobFilled(selectedJob) && (
                                    <div className="mb-4 px-4 py-2.5 rounded-xl bg-sunken border border-line flex items-center gap-2.5">
                                        <Lock size={16} className="text-subtle shrink-0" />
                                        <p className="text-xs sm:text-sm font-bold text-muted">
                                            {(selectedJob.positions_available != null && (Number(selectedJob.positions_available) || 1) === 1)
                                                ? 'This vacancy has been filled — no longer accepting applications.'
                                                : 'All vacancies have been filled — no longer accepting applications.'}
                                        </p>
                                    </div>
                                )}

                                {/* status + posting age + department, at a glance */}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2.5">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black ${isJobFilled(selectedJob) ? 'bg-sunken text-muted border border-line' : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${isJobFilled(selectedJob) ? 'bg-muted' : 'bg-emerald-500'}`} />
                                        {isJobFilled(selectedJob) ? filledLabel(selectedJob) : 'Now Hiring'}
                                    </span>
                                    {postedLabel(selectedJob.created_at) && (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-subtle"><CalendarDays size={13} /> {postedLabel(selectedJob.created_at)}</span>
                                    )}
                                    {selectedJob.department && (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-subtle"><LayoutGrid size={13} className="text-amber-500" /> {selectedJob.department}</span>
                                    )}
                                </div>

                                <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight leading-tight">{selectedJob.title}</h1>
                                <p className="mt-1.5 text-base font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-2"><Building2 size={18} className="shrink-0" /> {selectedJob.company}</p>

                                {/* KEY FACTS — the scannable core a seeker weighs first: pay, type, place, availability, deadline */}
                                <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                                    <DetailFact icon={Banknote} label="Salary" emphasis accent="text-emerald-500" value={selectedJob.salary_range || 'Undisclosed'} />
                                    <DetailFact icon={Briefcase} label="Employment" accent="text-emerald-500" value={`${selectedJob.job_type || 'Full-Time'}${selectedJob.work_setup ? ` · ${selectedJob.work_setup}` : ''}`} />
                                    <DetailFact icon={MapPin} label="Location" accent="text-rose-500" value={selectedJob.location || 'Unspecified'} />
                                    <DetailFact
                                        icon={Users}
                                        label="Positions"
                                        value={
                                            isJobFilled(selectedJob)
                                                ? 'All filled'
                                                : selectedJob.positions_available == null
                                                    ? 'Multiple'
                                                    : selectedJob.referred_count != null
                                                        ? `${Math.max(0, (Number(selectedJob.positions_available) || 1) - (Number(selectedJob.referred_count) || 0))} of ${Number(selectedJob.positions_available) || 1} open`
                                                        : `${Number(selectedJob.positions_available) || 1} open`
                                        }
                                    />
                                    <DetailFact icon={CalendarClock} label="Deadline" accent="text-rose-500" valueClass={selectedJob.deadline ? 'text-rose-500' : ''} value={selectedJob.deadline ? new Date(selectedJob.deadline).toLocaleDateString() : 'Open until filled'} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                                <div className="lg:col-span-2 space-y-6">
                                    
                                    {/* 🚨 RESTORED: Complete Job Description Blocks with Rich Formatted Text Support */}
                                    {selectedJob.description ? (
                                        <section>
                                            <h3 className="flex items-center gap-2 text-base font-black text-content mb-3 pb-2 border-b border-line"><FileText size={16} className="text-indigo-500 shrink-0" /> About the Job</h3>
                                            <div className="text-muted leading-relaxed whitespace-pre-wrap font-medium text-sm" dangerouslySetInnerHTML={{ __html: selectedJob.description }} />
                                        </section>
                                    ) : (
                                        <section>
                                            <h3 className="flex items-center gap-2 text-base font-black text-content mb-3 pb-2 border-b border-line"><FileText size={16} className="text-indigo-500 shrink-0" /> About the Job</h3>
                                            <p className="text-muted italic text-sm font-medium">No description provided.</p>
                                        </section>
                                    )}

                                    {selectedJob.responsibilities && (
                                        <section>
                                            <h3 className="flex items-center gap-2 text-base font-black text-content mb-3 pb-2 border-b border-line"><CheckCircle size={16} className="text-emerald-500 shrink-0" /> Responsibilities & Duties</h3>
                                            <div className="text-muted leading-relaxed whitespace-pre-wrap font-medium text-sm" dangerouslySetInnerHTML={{ __html: selectedJob.responsibilities }} />
                                        </section>
                                    )}

                                    {selectedJob.skills && (
                                        <section>
                                            <h3 className="flex items-center gap-2 text-base font-black text-content mb-3 pb-2 border-b border-line"><Sparkles size={16} className="text-violet-500 shrink-0" /> Skills & Competencies</h3>
                                            <div className="text-muted leading-relaxed whitespace-pre-wrap font-medium text-sm" dangerouslySetInnerHTML={{ __html: selectedJob.skills }} />
                                        </section>
                                    )}

                                    <section>
                                        <h3 className="flex items-center gap-2 text-base font-black text-content mb-3 pb-2 border-b border-line"><GraduationCap size={16} className="text-indigo-500 shrink-0" /> Qualifications & Requirements</h3>
                                        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-line space-y-3.5 shadow-sm">
                                            <div className="flex gap-3 items-start">
                                                <GraduationCap size={20} className="text-indigo-500 mt-0.5 shrink-0" />
                                                <div><h4 className="font-bold text-content">Education</h4><p className="text-sm text-muted">{selectedJob.education || 'Standard educational qualifications required.'}</p></div>
                                            </div>
                                            <div className="flex gap-3 items-start">
                                                <Briefcase size={20} className="text-emerald-500 mt-0.5 shrink-0" />
                                                <div><h4 className="font-bold text-content">Experience</h4><p className="text-sm text-muted">{selectedJob.experience || 'Prior experience in a related field is preferred.'}</p></div>
                                            </div>
                                            <div className="flex gap-3 items-start">
                                                <Accessibility size={20} className="text-rose-500 mt-0.5 shrink-0" />
                                                <div><h4 className="font-bold text-content">Accessibility Accommodations</h4><p className="text-sm text-muted">{selectedJob.accessibility_accommodations || 'Accommodations provided upon request.'}</p></div>
                                            </div>
                                        </div>
                                    </section>

                                    {selectedJob.additional_instructions && (
                                        <section>
                                            <h3 className="flex items-center gap-2 text-base font-black text-content mb-3 pb-2 border-b border-line"><FileText size={16} className="text-amber-500 shrink-0" /> Additional Instructions</h3>
                                            <div className="text-muted leading-relaxed whitespace-pre-wrap font-medium text-sm" dangerouslySetInnerHTML={{ __html: selectedJob.additional_instructions }} />
                                        </section>
                                    )}

                                    {/* 🚨 RESTORED: Deep Fetched Employer Company Information Block */}
                                    {(selectedJob.emp_company || selectedJob.business_description) && (
                                        <section className="bg-sunken p-5 rounded-2xl border border-line shadow-inner">
                                            <h3 className="text-lg font-black text-content mb-4 flex items-center gap-2"><Building size={18} className="text-subtle"/> About {selectedJob.emp_company || selectedJob.company}</h3>
                                            {selectedJob.business_description ? (
                                                <p className="text-sm text-muted mb-6 leading-relaxed whitespace-pre-wrap">{selectedJob.business_description}</p>
                                            ) : (
                                                <p className="text-sm text-muted italic mb-6">No extended company overview provided.</p>
                                            )}
                                            <div className="grid grid-cols-2 gap-6 text-sm font-medium">
                                                {selectedJob.industry && <div><span className="text-subtle block text-xs uppercase tracking-widest mb-1">Industry</span><span className="text-content">{selectedJob.industry}</span></div>}
                                                {selectedJob.company_size && <div><span className="text-subtle block text-xs uppercase tracking-widest mb-1">Company Size</span><span className="text-content">{selectedJob.company_size}</span></div>}
                                                {selectedJob.website && <div className="col-span-2"><span className="text-subtle block text-xs uppercase tracking-widest mb-1">Website</span><a href={selectedJob.website} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline flex items-center gap-1.5"><Globe size={14}/> {selectedJob.website}</a></div>}
                                            </div>
                                        </section>
                                    )}
                                </div>

                                <div className="space-y-6">
                                    {/* AI Match Module */}
                                    <div className="bg-gradient-to-br from-indigo-500 to-violet-700 rounded-[2rem] p-1 shadow-xl">
                                        <div className="bg-raised rounded-[1.75rem] p-6 h-full flex flex-col">
                                            <h3 className="text-lg font-black text-content mb-4 flex items-center gap-2"><Cpu size={20} className="text-indigo-500" /> AI Compatibility</h3>
                                            
                                            {isAnalyzing ? (
                                                <div className="flex flex-col items-center justify-center py-8">
                                                    <Loader2 size={32} className="animate-spin text-indigo-500 mb-4" />
                                                    <p className="text-sm font-bold text-muted text-center mt-2">Scanning your profile...</p>
                                                </div>
                                            ) : (!user || user.role !== 'applicant') ? (
                                                <div className="flex flex-col items-center justify-center py-8 text-center flex-1">
                                                    <Lock size={32} className="text-subtle mb-3" />
                                                    <h4 className="text-sm font-bold text-content mb-1">Sign In Required</h4>
                                                    <p className="text-xs font-medium text-muted">Log in as a job seeker to unlock AI match scoring.</p>
                                                </div>
                                            ) : resumeRequired ? (
                                                <div className="flex flex-col items-center justify-center py-8 text-center flex-1">
                                                    <FileText size={32} className="text-subtle mb-3" />
                                                    <h4 className="text-sm font-bold text-content mb-1">AI Compatibility Unavailable</h4>
                                                    <p className="text-xs font-medium text-muted mb-5 leading-relaxed">A resume is required before we can analyze how well your profile matches this job.</p>
                                                    <button onClick={() => navigate('/builder')} className="px-5 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-xs font-black rounded-xl transition-colors">
                                                        Add Your Resume
                                                    </button>
                                                </div>
                                            ) : aiScores ? (
                                                <div className="space-y-5 flex-1">
                                                    <div className="text-center pb-4 border-b border-line">
                                                        {/* Synchronized 0 → real-score reveal (number + bar share one value). */}
                                                        <AnimatedScore score={aiScores.overall} matchBand={matchBand} />
                                                    </div>
                                                    <div className="space-y-3 text-sm font-bold text-muted">
                                                        <div className="flex justify-between items-center"><span>Skills Match</span><span className={levelTone(aiScores.skills)}>{aiScores.skills || 'N/A'}</span></div>
                                                        <div className="flex justify-between items-center"><span>Education</span><span className={levelTone(aiScores.education)}>{aiScores.education || 'N/A'}</span></div>
                                                        <div className="flex justify-between items-center"><span>Experience</span><span className={levelTone(aiScores.experience)}>{aiScores.experience || 'N/A'}</span></div>
                                                    </div>
                                                    {/* F2: the AI's own one-sentence rationale — turns the number into an
                                                        EXPLAINED number instead of an unexplained AI output. */}
                                                    {aiScores.summary && (
                                                        <div className="rounded-xl bg-sunken border border-line p-3">
                                                            <p className="text-[11px] font-black uppercase tracking-widest text-subtle mb-1 flex items-center gap-1.5"><Cpu size={12} className="text-indigo-500" /> Why this score</p>
                                                            <p className="text-xs text-content/90 leading-relaxed font-medium">{aiScores.summary}</p>
                                                        </div>
                                                    )}
                                                    <button onClick={triggerAiAdvice} className="w-full mt-auto py-3.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border border-indigo-200 dark:border-indigo-800">
                                                        <Sparkles size={16} /> Get AI Advice
                                                    </button>
                                                    {/* F1 provenance — a subtle, auditable footprint of what produced the score. */}
                                                    {aiScores.provenance?.model && (
                                                        <p className="text-[10px] text-subtle text-center mt-1">
                                                            Analyzed by {aiScores.provenance.model}
                                                            {aiScores.provenance.scoredAt ? ` · ${new Date(aiScores.provenance.scoredAt).toLocaleDateString()}` : ''}
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted">Failed to calculate match score.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Explore Similar Jobs Section */}
                            <div className="mt-10 pt-8 border-t border-line">
                                <h3 className="text-xl font-black text-content mb-5">Explore Similar Jobs</h3>
                                
                                {resumeRequired ? (
                                    <div className="bg-surface/50 p-8 rounded-3xl border border-line text-center flex flex-col items-center justify-center">
                                        <Briefcase size={40} className="text-subtle mb-4" />
                                        <h4 className="text-lg font-bold text-content mb-2">Resume Required</h4>
                                        <p className="text-sm text-muted font-medium max-w-md mb-6">Add your resume — build one here or upload an existing file — to receive personalized job recommendations based on your skills, experience, and qualifications.</p>
                                        <button onClick={() => navigate('/builder')} className="px-6 py-3 bg-accent text-accent-contrast font-black rounded-xl hover:bg-accent-hover shadow-sm transition-colors">
                                            Add Your Resume
                                        </button>
                                    </div>
                                ) : similarJobs.length === 0 ? (
                                    <p className="text-muted font-medium bg-surface/50 p-6 rounded-2xl border border-line text-center">No similar jobs found at this time.</p>
                                ) : (
                                    <RecommendationCarousel jobs={similarJobs} onSelect={handleOpenDetails} />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {wizardJob && (
                <ApplyWizard
                    job={wizardJob}
                    onClose={() => setWizardJob(null)}
                    onApplied={() => { setWizardJob(null); setSelectedJob(null); }}
                />
            )}
        </>
    );
};

export default PublicJobBoard;