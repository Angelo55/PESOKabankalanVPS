/**
 * LandingPage.jsx — PESO Kabankalan Employment Platform
 * ────────────────────────────────────────────────────────────
 * IMMERSIVE HERO REDESIGN & LGU BRANDING REFINEMENT
 * * Transitioned the Hero from a two-column split to a full-cover 
 * immersive background featuring Kabankalan City Hall.
 * * Implemented safe, accessible ambient-pan background motion.
 * * 100% of the existing production baseline, Auth Overlays, 
 * mascot, API contracts, and Micro-interactions are strictly preserved.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
    MapPin, Briefcase, ChevronRight, ChevronLeft, Menu, X, ArrowRight,
    ShieldCheck, Zap, Bot, Users, Building2, CheckCircle, Mail,
    Phone, Lock, Eye, EyeOff, Loader2, LayoutGrid, ChevronDown, Sparkles,
    User, Target, Rocket, PhilippinePeso, GraduationCap, Clock,
    Send, ShieldQuestion, ArrowLeft, RefreshCw,
    ScanSearch, FileCheck2, TrendingUp, Gauge, Award,
    UserPlus, ClipboardCheck, CalendarCheck, Navigation, ExternalLink,
    CalendarDays, Ticket
} from 'lucide-react';
import API from '../api';
import useFocusTrap from '../hooks/useFocusTrap';
// Auth-modal illustration-panel carousel slides — five local illustrations in
// src/assets/illustrations (the Streamline Tokyo set plus a call-manager WebP), imported once
// and emitted by Vite as hashed static assets: no runtime fetch, aspect ratio preserved.
import slideSupportTeam from '../assets/illustrations/Support-Team--Streamline-Tokyo.webp';
import slideCallCentre from '../assets/illustrations/Digital-Call-Centre--Streamline-Tokyo.webp';
import slideNotification from '../assets/illustrations/Receive-A-Notification-1--Streamline-Tokyo.webp';
import slideCallManager from '../assets/illustrations/Call_manager.webp';
import slideMessages from '../assets/illustrations/No-Messages--Streamline-Tokyo.webp';
import { resolveBannerSrc } from './jobs/jobImage';
import { modalOverlay, modalPanel } from '../config/motion';
import useJobFilters from './jobs/useJobFilters';
import Reveal from './common/Reveal';

// Featured images are served from /uploads on the API host (outside the /api prefix).
const FILE_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');
const resolveJobImage = (src) => (src ? (src.startsWith('http') ? src : `${FILE_BASE}${src}`) : null);
// Event banners use the shared, storage-agnostic resolver (data:/http passthrough, else
// FILE_BASE-prefix) so an R2 URL renders verbatim once banners are migrated (§41/§45.5).
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';
import ForgotPassword from './ForgotPassword';
import PublicChatbot from './PublicChatbot';
import ThemeToggle from './common/ThemeToggle';
import { PRIVACY, TERMS, LegalSections } from './legal/legalContent';

// Where an authenticated visitor's "Back to Dashboard" should return them.
// Seekers' dashboard lives at `/` (which renders Dashboard, not a redirect, once
// signed in); the two admin portals have their own paths.
const dashboardPathForRole = (role) => {
    const nr = normalizeRole(role);
    if (nr === ROLE_KEYS.SUPER_ADMINISTRATOR) return '/admin/dashboard';
    if (nr === ROLE_KEYS.PESO_ADMINISTRATOR) return '/peso-admin/dashboard';
    return '/';
};

import pesoLogo from '../assets/PESO LOGO.jpg';
import pesoCityOffice from '../assets/PESO CITY OFFICE.jpg';

// ─── STATIC DATA CONFIGURATIONS ──────────────────────────────────────────────

const FAQ_DATA = [
    { q: "What is the PESO Kabankalan Platform?", a: "It is the official digital employment service portal of the Public Employment Service Office (PESO) in Kabankalan City, providing job matching, labor market information (LMI), and career guidance for all job seekers and employers." },
    { q: "Is registration free?",              a: "Yes, registration is 100% free for all job seekers and employers as part of our local government-backed employment facilitation initiative." },
    { q: "How does the AI Career Assistant work?", a: "Our AI securely analyzes your uploaded resume, identifies your strengths, matches you with highly compatible local jobs, and provides intelligent career guidance." },
    { q: "Do I need to print a resume for Job Fairs?", a: "No! The portal digitizes your profile. You can apply directly to local employers and digital job fairs using your auto-generated Unified Career Profile." }
];

const SAFE_PWD_DEFAULT = {
    checks: { length: false, uppercase: false, lowercase: false, number: false, special: false },
    score: 0, label: 'Weak', color: 'bg-rose-500', width: '0%'
};

// ─── PURE HARDWARE-ACCELERATED TRANSITIONS & EMBEDDED KEYFRAMES ──────────────

const AnimationStyles = () => (
    <style dangerouslySetInnerHTML={{__html: `
        .glass-card {
            background: rgba(255, 255, 255, 0.75);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(226, 232, 240, 0.6);
        }
        .dark .glass-card {
            background: rgba(17, 27, 46, 0.72);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .ai-gradient-border {
            position: relative;
            background: #003631;
            border-radius: 2.5rem;
            z-index: 1;
        }
        .ai-gradient-border::before {
            content: '';
            position: absolute;
            inset: -2px;
            background: linear-gradient(45deg, #134e48, #5eca6a, #caead6);
            border-radius: 2.6rem;
            z-index: -1;
            filter: blur(6px);
            opacity: 0.7;
        }
        
        @keyframes elegantFloat {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-8px); }
        }
        @keyframes logoFloat {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-3px); }
        }
        @keyframes ambientPan {
            0%, 100% { transform: scale(1) translateY(0); }
            50%      { transform: scale(1.05) translateY(-2%); }
        }

        .animate-elegant-float {
            animation: elegantFloat 3s ease-in-out infinite;
            will-change: transform;
        }
        .animate-elegant-float:hover {
            animation-play-state: paused;
        }
        
        .animate-logo-float {
            animation: logoFloat 5s ease-in-out infinite;
            will-change: transform;
            transition: transform 300ms ease-out, filter 300ms ease-out;
        }
        .animate-logo-float:hover {
            transform: scale(1.05);
            filter: drop-shadow(0 4px 6px rgba(0, 54, 49, 0.15));
            animation-play-state: paused;
        }

        .animate-ambient-pan {
            animation: ambientPan 15s ease-in-out infinite;
            will-change: transform;
        }

        .hover-lift-rotate {
            transition: transform 300ms ease-out, box-shadow 300ms ease-out;
            will-change: transform, box-shadow;
        }
        .hover-lift-rotate:hover {
            transform: translateY(-8px) rotate(8deg);
            box-shadow: 0 25px 35px -5px rgba(0, 0, 0, 0.3), 0 15px 15px -5px rgba(0, 0, 0, 0.2);
        }
        .hover-lift-card {
            transition: transform 300ms ease-out, box-shadow 300ms ease-out;
            will-change: transform, box-shadow;
        }
        .hover-lift-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 25px -5px rgba(0, 54, 49, 0.12), 0 10px 10px -5px rgba(0, 54, 49, 0.04);
        }

        .reveal {
            opacity: 0;
            transform: translateY(40px);
            transition: opacity 800ms cubic-bezier(0.22, 1, 0.36, 1), transform 800ms cubic-bezier(0.22, 1, 0.36, 1);
            will-change: opacity, transform;
        }
        .reveal.active {
            opacity: 1;
            transform: translateY(0);
        }

        /* Speech bubble: gentle rise-and-settle entrance (no bounce/rotation),
           then a slow idle drift so re-triggered messages feel calm, not abrupt. */
        @keyframes speechIn {
            0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
            60%  { opacity: 1; }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes speechIdle {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-4px); }
        }
        /* Dynamic mascot backdrop: a slow aurora gradient wash, two drifting
           glow orbs, and a few floating accent dots. Pure CSS transforms /
           background-position -- cheap to composite, no layout work. */
        @keyframes orbDrift {
            0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
            50%      { transform: translate3d(22px, -18px, 0) scale(1.12); }
        }
        @keyframes floatDot {
            0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.35; }
            50%      { transform: translateY(-20px) rotate(14deg); opacity: 0.75; }
        }
        /* Gebbie 2.0 motion system: wave-then-rest arm cycle, body bob with a
           synchronized ground shadow, sprout sway, and periodic eye blinks.
           SVG groups animate via transform-box: fill-box so origins are local. */
        @keyframes gebbieWave {
            0%, 8%   { transform: rotate(0deg); }
            18%      { transform: rotate(-26deg); }
            28%      { transform: rotate(9deg); }
            38%      { transform: rotate(-18deg); }
            48%      { transform: rotate(0deg); }
            100%     { transform: rotate(0deg); }
        }
        @keyframes gebbieBob {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50%      { transform: translateY(-8px) rotate(-1.2deg); }
        }
        @keyframes gebbieShadowPulse {
            0%, 100% { transform: scaleX(1); opacity: 0.16; }
            50%      { transform: scaleX(0.88); opacity: 0.09; }
        }
        @keyframes gebbieSprout {
            0%, 100% { transform: rotate(-4deg); }
            50%      { transform: rotate(5deg); }
        }
        @keyframes gebbieBlink {
            0%, 90%, 96%, 100% { transform: scaleY(1); }
            93%                { transform: scaleY(0.08); }
        }
        @keyframes bgMotion {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        @keyframes shimmer {
            0% { transform: translateX(-100%) skewX(-15deg); }
            100% { transform: translateX(200%) skewX(-15deg); }
        }
        /* Partner showcase: a seamless left-drift marquee. The track holds TWO
           copies of the chips, so translating by -50% loops with no visible seam.
           Pauses on hover; transform-only, so it stays on the compositor. */
        @keyframes marquee {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
        }
        .animate-marquee { animation: marquee 34s linear infinite; will-change: transform; }
        .marquee-mask:hover .animate-marquee { animation-play-state: paused; }
        .marquee-mask {
            -webkit-mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
                    mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
        }

        /* ── CAREER ROADMAP ──────────────────────────────────────────────────
           The spine draws once its section scrolls in (pathLength=1 normalises
           the line so stroke-dashoffset 1 to 0 works regardless of pixel height).
           Medallions pop (scale only, since position is a margin, so the hover
           ring/shadow never fights the fill); cards slide in from the right. All
           staggered by an inline animation-delay per step; fill:both holds the
           first frame during the delay and the rest frame after, and the parent
           reveal opacity hides everything until activation so there is no
           pre-animation flash.
           NOTE: this whole block is a JS template literal, so it must contain NO
           backtick characters. */
        @keyframes roadDraw { to { stroke-dashoffset: 0; } }
        .road-path { stroke-dasharray: 1; stroke-dashoffset: 1; }
        .reveal.active .road-path { animation: roadDraw 1.7s cubic-bezier(0.65, 0, 0.35, 1) forwards; }

        @keyframes milestonePop {
            0%   { opacity: 0; transform: scale(0.3); }
            60%  { opacity: 1; transform: scale(1.15); }
            100% { opacity: 1; transform: scale(1); }
        }
        .milestone { opacity: 0; }
        .reveal.active .milestone { animation: milestonePop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

        @keyframes stepCardIn {
            from { opacity: 0; transform: translateX(16px); }
            to   { opacity: 1; transform: translateX(0); }
        }
        .step-card { opacity: 0; }
        .reveal.active .step-card { animation: stepCardIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .animate-speech  { animation: speechIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both, speechIdle 5s ease-in-out 0.5s infinite; }
        .gebbie-aurora {
            background: linear-gradient(125deg,
                rgba(255, 184, 77, 0.14) 0%, rgba(255, 184, 77, 0) 30%,
                rgba(139, 92, 246, 0.14) 55%, rgba(139, 92, 246, 0) 75%,
                rgba(255, 141, 99, 0.12) 100%);
            background-size: 220% 220%;
            animation: bgMotion 16s ease-in-out infinite;
        }
        .gebbie-orb   { animation: orbDrift 18s ease-in-out infinite; will-change: transform; }
        .gebbie-float { animation: floatDot 7s ease-in-out infinite; }
        .gebbie-wave-arm { animation: gebbieWave 4.2s cubic-bezier(0.45, 0, 0.55, 1) infinite; transform-box: fill-box; transform-origin: 92% 92%; }
        .gebbie-body     { animation: gebbieBob 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 85%; }
        .gebbie-shadow   { animation: gebbieShadowPulse 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .gebbie-sprout   { animation: gebbieSprout 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
        .gebbie-eyes     { animation: gebbieBlink 4.6s linear infinite; transform-box: fill-box; transform-origin: center; }
        .gebbie-mascot   { transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .gebbie-mascot:hover { transform: scale(1.05); }
        .gebbie-mascot:hover .gebbie-wave-arm { animation-duration: 1.6s; }
        .gebbie-mascot:hover .gebbie-body { animation-duration: 1.8s; }
        
        .job-card-hover {
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            will-change: transform, box-shadow;
        }
        .job-card-hover:hover {
            transform: translateY(-6px);
            box-shadow: 0 20px 30px -10px rgba(0, 54, 49, 0.08);
        }
        .btn-shimmer {
            position: relative;
            overflow: hidden;
        }
        .btn-shimmer::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 50%;
            height: 100%;
            background: linear-gradient(to right, transparent, rgba(255,255,255,0.15), transparent);
            transform: translateX(-100%) skewX(-15deg);
        }
        .btn-shimmer:hover::after {
            animation: shimmer 0.9s infinite;
        }
        .nav-link-hover {
            position: relative;
        }
        .nav-link-hover::after {
            content: '';
            position: absolute;
            width: 0;
            height: 2px;
            bottom: -4px;
            left: 0;
            background-color: #003631;
            transition: width 0.3s ease;
        }
        .nav-link-hover:hover::after {
            width: 100%;
        }
        .custom-scrollbar::-webkit-scrollbar {
            width: 5px;
            height: 6px; /* horizontal bar for the Events shelf — a native scroll affordance (C2) */
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #bfc8c6;
            border-radius: 12px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #99a3a0; }
        
        @media (prefers-reduced-motion: reduce) {
            .animate-speech, .gebbie-wave-arm, .gebbie-body, .gebbie-shadow, .gebbie-sprout, .gebbie-eyes, .gebbie-aurora, .gebbie-orb, .gebbie-float, .animate-elegant-float, .animate-logo-float, .animate-ambient-pan, .animate-marquee { animation: none !important; transform: none !important; }
            .gebbie-mascot, .gebbie-mascot:hover { transition: none !important; transform: none !important; }
            .animate-speech { opacity: 1 !important; }
            .hover-lift-rotate, .hover-lift-card { transition: none !important; }
            .hover-lift-rotate:hover, .hover-lift-card:hover { transform: none !important; box-shadow: inherit !important; }
            .reveal { opacity: 1 !important; transform: translateY(0) !important; transition: none !important; }

            /* Career roadmap: show it fully drawn and every node/card in place,
               with no animation. */
            .road-path { stroke-dashoffset: 0 !important; }
            .reveal.active .road-path { animation: none !important; }
            .milestone, .step-card { opacity: 1 !important; }
            .reveal.active .milestone, .reveal.active .step-card { animation: none !important; transform: none !important; }
        }
    `}} />
);

// ─── VISUAL DECORATIONS & ICON ASSETS (PROTECTED UNTOUCHED) ─────────────────

const BackgroundDecorations = () => (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-400/5 dark:bg-indigo-900/10 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400/5 dark:bg-emerald-900/10 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-screen" />
    </div>
);

const GoogleIcon = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
);

/**
 * HeroMascot — the auth modal's FULL ILLUSTRATION PANEL, a lightweight, dependency-free
 * carousel that fills the entire illustration side of the overlay (not a small icon).
 *
 *  • Slides are the five local Streamline Tokyo SVGs (square 400×400 vectors), imported
 *    once and emitted by Vite. They all mount ONCE; only CSS opacity toggles between them
 *    — no re-fetch, no re-decode, no per-slide remount, no excessive re-render.
 *  • The stage is `flex-1` and every slide is absolutely positioned + `object-contain`, so
 *    each fills the panel at its correct aspect ratio (sharp SVG, no distortion) and
 *    switching slides causes ZERO layout shift / reflow / flicker. The panel stretches to
 *    the form side's height, so the stage always has a definite height (never collapses).
 *  • Autoplay is a SINGLE interval, torn down on unmount and whenever paused/reduced
 *    changes (no leaked or stacked timers). Hover pauses; mouse-leave resumes.
 *  • prefers-reduced-motion (tracked live, listener cleaned up): autoplay is disabled and
 *    — via the global index.css reduced-motion rule — the cross-fade collapses to an
 *    instant swap. Dots still navigate.
 *  • Pagination dots are real <button>s (manual nav + current indicator), keyboard
 *    focusable with a visible focus ring and aria-selected state.
 */
const HERO_SLIDES = [
    { src: slideSupportTeam, alt: 'The PESO Kabankalan support team, ready to help' },
    { src: slideCallCentre, alt: 'PESO staff assisting job seekers at a digital service desk' },
    { src: slideNotification, alt: 'A job seeker receiving a job notification' },
    { src: slideMessages, alt: 'A job seeker checking their PESO messages' },
    { src: slideCallManager, alt: 'A PESO call manager assisting a job seeker by phone' },
];
const HERO_AUTOPLAY_MS = 4500;

const HeroMascot = () => {
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [reduced, setReduced] = useState(
        () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
    const count = HERO_SLIDES.length;

    // Track the reduced-motion preference live; remove the listener on unmount.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
        return () => { mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange); };
    }, []);

    // ONE autoplay interval — inert while paused (hover) or under reduced motion.
    useEffect(() => {
        if (paused || reduced || count <= 1) return undefined;
        const id = setInterval(() => setIndex((i) => (i + 1) % count), HERO_AUTOPLAY_MS);
        return () => clearInterval(id);
    }, [paused, reduced, count]);

    const goTo = (i) => setIndex(((i % count) + count) % count);

    return (
        // Fills the ENTIRE illustration side of the modal (h-full from the panel, which
        // stretches to the form's height). flex-col: a stage that grows + a dots row.
        <div
            className="hero-illustration relative w-full h-full flex flex-col select-none"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <div
                className="relative w-full flex-1 min-h-0"
                aria-roledescription="carousel"
                aria-label="PESO service illustrations"
            >
                {/* Slides — FILL the panel (object-contain keeps aspect + SVG sharpness),
                    stacked and cross-faded via opacity only → no layout shift or flicker.
                    No card/shadow behind them: the restrained panel surface is the ground. */}
                {HERO_SLIDES.map((s, i) => (
                    <img
                        key={s.src}
                        src={s.src}
                        alt={i === index ? s.alt : ''}
                        aria-hidden={i !== index}
                        className={`absolute inset-0 w-full h-full object-contain p-1 sm:p-2 transition-opacity duration-700 ease-in-out ${i === index ? 'opacity-100' : 'opacity-0'}`}
                        loading={i === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                        draggable="false"
                    />
                ))}
            </div>

            {/* Pagination dots — real buttons: manual nav + current-slide indicator. */}
            <div className="shrink-0 pt-4 flex items-center justify-center gap-2" role="tablist" aria-label="Choose illustration">
                {HERO_SLIDES.map((s, i) => (
                    <button
                        key={s.src}
                        type="button"
                        role="tab"
                        aria-selected={i === index}
                        aria-label={`Show illustration ${i + 1} of ${count}`}
                        onClick={() => goTo(i)}
                        className={`h-2.5 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7942] focus-visible:ring-offset-2 ${
                            i === index ? 'w-6 bg-[#4F7942]' : 'w-2.5 bg-[#4F7942]/30 hover:bg-[#4F7942]/60'
                        }`}
                    />
                ))}
            </div>
        </div>
    );
};

// ─── SCROLL-STORYTELLING DATA ─────────────────────────────────────────────────

// The five platform capabilities, surfaced as scroll-revealed cards. Icons and
// copy map to real features (AI resume analysis, compatibility scoring, matching,
// referral letters, career insights) — no invented capabilities.
const PLATFORM_FEATURES = [
    { icon: ScanSearch, title: 'AI Resume Analysis', desc: 'Upload a resume and DeepSeek AI extracts your career history and skills into a Unified Profile — no manual re-typing.', tint: 'from-indigo-500 to-violet-500' },
    { icon: Gauge, title: 'AI Compatibility Scoring', desc: 'Every vacancy is scored against your profile so you see, honestly, how well you fit before you apply.', tint: 'from-emerald-500 to-teal-500' },
    { icon: Target, title: 'Smart Job Matching', desc: 'The board surfaces roles that fit your experience first, connecting you to verified local employers faster.', tint: 'from-amber-500 to-orange-500' },
    { icon: FileCheck2, title: 'Official Referral Letters', desc: 'When PESO endorses you, an official signed referral letter is generated and delivered — no queuing at the office.', tint: 'from-[#134e48] to-[#4e6b5a]' },
    { icon: TrendingUp, title: 'Career Insights', desc: 'Get AI guidance on your trajectory and the skill gaps to close next, tailored to Kabankalan’s labour market.', tint: 'from-sky-500 to-indigo-500' },
];

// The full employment journey, Register → Hired. Each step is a real stage in
// the platform's flow (OTP verification, resume analysis, the referral pipeline).
const JOURNEY_STEPS = [
    { icon: UserPlus, title: 'Register', desc: 'Create your free account as a Kabankalan job seeker.' },
    { icon: ShieldCheck, title: 'Verify Account', desc: 'Confirm your email with a one-time code to secure your account.' },
    { icon: ClipboardCheck, title: 'Build Profile', desc: 'Complete your profile, or let the builder start it for you.' },
    { icon: ScanSearch, title: 'AI Resume Analysis', desc: 'Upload a resume and AI enriches your Unified Career Profile.' },
    { icon: Briefcase, title: 'Apply for Jobs', desc: 'Browse the board with compatibility scores and apply in a few clicks.' },
    { icon: FileCheck2, title: 'Referral', desc: 'A PESO administrator reviews and issues your official referral letter.' },
    { icon: CalendarCheck, title: 'Interview', desc: 'Meet the employer with your endorsement already in hand.' },
    { icon: Award, title: 'Hired', desc: 'Start your new role — and your placement is recorded by PESO.' },
];


/**
 * Count-up number that animates from 0 to `end` the first time it scrolls into
 * view. Deferred-safe: if the stat arrives AFTER the element is already visible
 * (the API resolves late), the animation still runs once `end` becomes > 0.
 * easeOutCubic via requestAnimationFrame; honours prefers-reduced-motion by
 * jumping straight to the final value.
 */
const CountUp = ({ end = 0, duration = 1600, suffix = '' }) => {
    const ref = useRef(null);
    const [inView, setInView] = useState(false);
    const [val, setVal] = useState(0);
    const started = useRef(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) { setInView(true); io.disconnect(); }
        }, { threshold: 0.4 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    useEffect(() => {
        if (!inView || started.current || end <= 0) return undefined;
        started.current = true;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVal(end); return undefined; }
        let raf;
        const start = performance.now();
        const tick = (now) => {
            const p = Math.min(1, (now - start) / duration);
            setVal(Math.round(end * (1 - Math.pow(1 - p, 3))));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [inView, end, duration]);

    return <span ref={ref}>{val.toLocaleString()}{end > 0 ? suffix : ''}</span>;
};

// ─── AUTHENTICATION PARAMETERS AND HELPERS ───────────────────────────────────

const checkPasswordStrength = (password) => {
    // 🚨 REGRESSION FIX: Absolute defensive guard intercepts missing parameters before string method execution
    if (!password || typeof password !== 'string') return SAFE_PWD_DEFAULT;
    
    const checks = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[^A-Za-z0-9]/.test(password)
    };

    let score = 0;
    if (checks.length) score++;
    if (checks.uppercase) score++;
    if (checks.lowercase) score++;
    if (checks.number) score++;
    if (checks.special) score++;
    if (password.length >= 12) score++;

    let label = 'Weak'; let color = 'bg-rose-500'; let width = '25%';
    if (score >= 5) { label = 'Very Strong'; color = 'bg-emerald-600'; width = '100%'; } 
    else if (score >= 4) { label = 'Strong'; color = 'bg-emerald-400'; width = '75%'; } 
    else if (score >= 3) { label = 'Moderate'; color = 'bg-amber-400'; width = '50%'; } 
    else if (password.length > 0) { label = 'Weak'; color = 'bg-rose-400'; width = '25%'; } 
    else { width = '0%'; }

    return { checks, score, label, color, width };
};

// ─── LEGAL COMPLIANCE MODALS ──────────────────────────────────────────────────

const TermsOfServiceModal = ({ onClose }) => (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-gray-900/60 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-white dark:bg-[#111b2e] w-full max-w-2xl rounded-3xl shadow-2xl relative border border-gray-100 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h2 className="text-xl font-black text-[#003631] dark:text-[#7fd8ba]">Terms of Service</h2>
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors border-none cursor-pointer">
                    <X size={20} />
                </button>
            </div>
            <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar text-sm text-gray-600 dark:text-gray-300 font-medium space-y-6 leading-relaxed">
                <LegalSections sections={TERMS.sections} />
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                <button onClick={onClose} className="px-6 py-2.5 bg-[#003631] text-white font-bold rounded-xl shadow-sm hover:opacity-90 transition-opacity border-none cursor-pointer">
                    I Understand
                </button>
            </div>
        </div>
    </div>
);

const PrivacyPolicyModal = ({ onClose }) => (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-gray-900/60 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-white dark:bg-[#111b2e] w-full max-w-2xl rounded-3xl shadow-2xl relative border border-gray-100 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h2 className="text-xl font-black text-[#003631] dark:text-[#7fd8ba]">Privacy Policy</h2>
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors border-none cursor-pointer">
                    <X size={20} />
                </button>
            </div>
            <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar text-sm text-gray-600 dark:text-gray-300 font-medium space-y-6 leading-relaxed">
                <LegalSections sections={PRIVACY.sections} />
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                <button onClick={onClose} className="px-6 py-2.5 bg-[#003631] text-white font-bold rounded-xl shadow-sm hover:opacity-90 transition-opacity border-none cursor-pointer">
                    I Understand
                </button>
            </div>
        </div>
    </div>
);

// ─── PESO EVENTS & JOB FAIRS (landing carousel) ─────────────────────────────────
// A public two-row horizontal-scrolling shelf fed by the SAME data source as the
// seeker Events module (GET /api/events?scope=upcoming&limit=12) — INCLUDING the
// uploaded banner image, so a card here shows the identical poster a signed-in user
// sees in Events & Job Fairs (no duplicate image path). Styled in the LandingPage's
// bespoke palette (intentionally excluded from the app design tokens, §24), mirroring
// the seeker EventCard's information architecture.

const EVENT_TYPE_LABELS = {
    job_fair: 'Job Fair',
    recruitment_drive: 'Recruitment Drive',
    seminar: 'Seminar',
    orientation: 'Orientation',
    general: 'Announcement',
};

const eventDateParts = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return {
        month: dt.toLocaleDateString('en-PH', { month: 'short' }).toUpperCase(),
        day: dt.toLocaleDateString('en-PH', { day: 'numeric' }),
        full: dt.toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }),
        short: dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
};
const eventTimeRange = (s, e) => (s || e) ? [s, e].filter(Boolean).join(' – ') : null;

// Where the (always-Published) event sits in time — the upcoming-vs-past distinction.
const eventRelativeStatus = (d) => {
    if (!d) return { label: 'Scheduled', cls: 'bg-[#eff4ff] dark:bg-[#16223a] text-[#003631] dark:text-[#7fd8ba]' };
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(dt); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return { label: 'Happening Today', cls: 'bg-amber-100 text-amber-700' };
    if (diff > 0) return { label: diff <= 14 ? `In ${diff} day${diff === 1 ? '' : 's'}` : 'Upcoming', cls: 'bg-[#caead6] dark:bg-[#1a4a38]/50 text-[#2f5a45]' };
    return { label: 'Ended', cls: 'bg-gray-100 dark:bg-[#1b2436] text-gray-500 dark:text-gray-400' };
};

// Live prefers-reduced-motion preference (tracked, listener cleaned up on unmount).
// Same idiom as HeroMascot's inline state, extracted so the Events carousel shares it.
const usePrefersReducedMotion = () => {
    const [reduced, setReduced] = useState(
        () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
        return () => { mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange); };
    }, []);
    return reduced;
};

// One full-width hero slide. The uploaded event image (banner_image) — the same
// poster the authenticated Events module renders — is the PRIMARY visual, filling
// the frame with a bottom scrim so the overlaid text stays legible; a branded
// gradient is the fallback only when an event has no image. The whole slide is a
// button that opens the detail modal. `active` gates focusability so an off-screen
// slide's button is never a tab-trap behind aria-hidden.
const LandingEventSlide = ({ event, onOpen, active, position, total }) => {
    const parts = eventDateParts(event.event_date);
    const time = eventTimeRange(event.start_time, event.end_time);
    const rel = eventRelativeStatus(event.event_date);
    const typeLabel = EVENT_TYPE_LABELS[event.event_type] || 'Announcement';
    const banner = resolveBannerSrc(event.banner_image);
    // A missing OR broken banner must never blank the slide — fall back to the branded
    // gradient. `imgFailed` flips on the poster's onError (404 / invalid R2 ref / corrupt
    // data URI); it resets when the banner source changes (a slide reused for a new event).
    const [imgFailed, setImgFailed] = useState(false);
    useEffect(() => { setImgFailed(false); }, [banner]);
    const showBanner = Boolean(banner) && !imgFailed;
    return (
        <button
            type="button"
            onClick={() => onOpen(event.id)}
            tabIndex={active ? 0 : -1}
            aria-hidden={!active}
            role="group"
            aria-roledescription="slide"
            aria-label={`${position} of ${total}: ${event.title}`}
            className="group/slide relative block w-full shrink-0 basis-full text-left overflow-hidden cursor-pointer border-none bg-[#0b1c30] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003631]/40 focus-visible:ring-inset"
        >
            {/* Taller poster-friendly frame. The poster is shown with object-CONTAIN (never
                cropped or distorted, whatever its aspect ratio) over a blurred, scaled copy of
                itself as a backdrop — so portrait A4 posters and landscape banners both display
                in full and the frame never looks empty. No hover scale transform on the poster
                (raster upscaling interpolates → blur); the subtle zoom lives only on the blurred
                backdrop, where softness is intended. */}
            <div className="relative h-[24rem] sm:h-[30rem] lg:h-[34rem] bg-[#0b1c30]">
                {showBanner ? (
                    <>
                        <img aria-hidden src={banner} alt="" className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50 transition-transform duration-[1200ms] ease-out group-hover/slide:scale-125" />
                        <img src={banner} alt={event.title} loading="lazy" decoding="async" onError={() => setImgFailed(true)} className="absolute inset-0 w-full h-full object-contain" />
                    </>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#134e48] via-[#1a4a38] to-[#003631]">
                        <CalendarDays className="text-white/15" size={120} />
                    </div>
                )}
                {/* legibility scrim (top + bottom, so overlaid chips/title read over any poster) */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/40" />

                {/* date chip */}
                <div className="absolute top-4 left-4 sm:top-5 sm:left-5 bg-white dark:bg-[#111b2e] rounded-2xl px-3 py-1.5 text-center shadow-lg min-w-[3rem]">
                    <div className="text-[11px] font-black uppercase text-rose-500 leading-none">{parts ? parts.month : 'TBA'}</div>
                    {parts && <div className="text-xl font-black text-[#003631] dark:text-[#7fd8ba] leading-none mt-0.5">{parts.day}</div>}
                </div>
                <div className="absolute top-4 right-4 sm:top-5 sm:right-5 flex items-center gap-2">
                    {rel && <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${rel.cls}`}>{rel.label}</span>}
                    <span className="text-[10px] font-black uppercase tracking-wider text-white bg-black/45 backdrop-blur-sm px-2.5 py-1 rounded-full">{typeLabel}</span>
                </div>

                {/* content over the image */}
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7 lg:p-9">
                    <h3 className="text-xl sm:text-2xl lg:text-3xl font-black text-white leading-tight line-clamp-2 max-w-3xl drop-shadow">{event.title}</h3>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm font-semibold text-white/90">
                        {parts && <span className="flex items-center gap-1.5"><CalendarDays size={15} className="shrink-0" /> {parts.short}{time ? ` · ${time}` : ''}</span>}
                        {event.venue && <span className="flex items-center gap-1.5"><MapPin size={15} className="text-rose-300 shrink-0" /> <span className="line-clamp-1">{event.venue}</span></span>}
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-[#003631] dark:text-[#7fd8ba] bg-white dark:bg-[#111b2e] px-4 py-2 rounded-xl shadow-md transition-transform group-hover/slide:translate-x-0.5">
                        View Details <ArrowRight size={15} />
                    </span>
                </div>
            </div>
        </button>
    );
};

// Premium single-event carousel (dev-history §34 redesign). Shows ONE event at a
// time with its uploaded poster as the primary visual; autoplays right→left via a
// GPU translateX track, with dynamic pagination dots (one per published event),
// hover-revealed prev/next arrows, touch swipe, and full keyboard/ARIA support.
//
// Same data source as before (GET /api/events, banner included) — a PRESENTATION
// refactor only. Autoplay is paused on hover / focus-within / manual interaction
// and is disabled entirely under prefers-reduced-motion (the global reduced-motion
// rule also collapses the slide transition to 0). Edge cases: 1 event renders a
// static hero (no autoplay / arrows / dots); 0 events never reach here (the section
// renders its empty state instead).
//
// TRUE infinite loop via slide cloning. The track holds [cloneOfLast, ...events,
// cloneOfFirst]; a real slide i lives at extended position i+1. Advancing past the last
// real slide animates onto the trailing clone (visually identical to the first); once the
// slide transition has run we JUMP — with the transition momentarily OFF — back to the real
// first slide, so forward motion continues in the SAME direction with no rewind. Backward
// past the first animates onto the leading clone (identical to the last) then jumps to the
// real last. This is why last→first / first→last never show the "back-to-start" jump the old
// modulo `translateX(-index*100%)` produced. The clone→real jump is driven by a TIMER matched
// to the transition duration (not `transitionend`, which React re-renders can retarget before
// it fires), so the seam is reliable regardless of timing.
const SLIDE_MS = 700;   // must match the track's transition duration
const AUTOPLAY_MS = 5500;

const EventsCarousel = ({ events, onOpen }) => {
    const count = events.length;
    const single = count <= 1;

    // Extended track with a clone at each end (only when looping is meaningful, count >= 2).
    const slides = single ? events : [events[count - 1], ...events, events[0]];
    // `pos` indexes the EXTENDED array. Real slide i ⇔ pos i+1; start on the first real slide.
    const [pos, setPos] = useState(single ? 0 : 1);
    const [withTransition, setWithTransition] = useState(true);
    const [paused, setPaused] = useState(false);
    const reduceMotion = usePrefersReducedMotion();
    const swipe = useRef(null);
    const snapping = useRef(false); // true only during the clone→real jump

    const onClone = !single && (pos === 0 || pos === count + 1);

    // Reset when the event set changes (data reload). Back to the first real slide.
    useEffect(() => {
        setPos(single ? 0 : 1);
        setWithTransition(true);
        snapping.current = false;
    }, [count, single]);

    // The real event index the current position maps to — drives the dots + slide ARIA,
    // and stays correct even on the transient clone frame (pos 0 → last, pos count+1 → first).
    const realIndex = single ? 0 : (((pos - 1) % count) + count) % count;

    const step = useCallback((dir) => {
        if (single || snapping.current) return; // ignore input during the micro-jump
        setWithTransition(true);
        setPos((p) => p + dir);
    }, [single]);
    const goToReal = useCallback((i) => {
        if (single || snapping.current) return;
        setWithTransition(true);
        setPos(i + 1); // real slide i lives at extended position i+1
    }, [single]);

    // Seam handler: when `pos` lands on a clone, let the slide transition play, then JUMP
    // (transition off) to the clone's real twin. Timer-driven so it never depends on a
    // `transitionend` that a concurrent re-render might swallow.
    useEffect(() => {
        if (!onClone) return undefined;
        snapping.current = true;
        const t = setTimeout(() => {
            setWithTransition(false);
            setPos((p) => (p === 0 ? count : 1)); // leading clone → real last; trailing → real first
        }, SLIDE_MS + 40);
        return () => clearTimeout(t);
    }, [onClone, count]);

    // After the no-transition jump has committed to the DOM, re-enable the transition for
    // subsequent moves. A short TIMER (not requestAnimationFrame) so it fires even when the
    // tab is backgrounded / not painting — rAF is gated on paint and would leave the carousel
    // stuck with the transition disabled. React has already committed the instant jump (class
    // removed + transform at the real position) before this macrotask runs, so re-adding the
    // transition class animates nothing.
    useEffect(() => {
        if (withTransition) return undefined;
        const id = setTimeout(() => {
            setWithTransition(true);
            snapping.current = false;
        }, 30);
        return () => clearTimeout(id);
    }, [withTransition]);

    // Autoplay (right→left). Keyed on `pos` so any manual nav resets the timer. Off while
    // paused (hover/focus), single-event, or under reduced motion. Uses the SAME step() as
    // manual nav, so autoplay and manual share one looping path.
    useEffect(() => {
        if (paused || reduceMotion || single) return undefined;
        const t = setTimeout(() => step(1), AUTOPLAY_MS);
        return () => clearTimeout(t);
    }, [pos, paused, reduceMotion, single, step]);

    // Touch swipe (pointer-based; 40px threshold) — same loop as arrows/autoplay.
    const onPointerDown = (e) => { swipe.current = { x: e.clientX, t: Date.now() }; };
    const onPointerUp = (e) => {
        const s = swipe.current; swipe.current = null;
        if (!s || single) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 40 && Date.now() - s.t < 800) { step(dx < 0 ? 1 : -1); }
    };

    return (
        <div
            className="group relative reveal"
            role="region"
            aria-roledescription="carousel"
            aria-label="PESO events"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
        >
            {/* viewport */}
            <div
                className="overflow-hidden rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-lg bg-white"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
            >
                <div
                    className={`flex ${withTransition ? 'transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]' : ''}`}
                    style={{ transform: `translateX(-${pos * 100}%)` }}
                >
                    {slides.map((ev, i) => {
                        // Map an extended-array index back to its real event index (for ARIA).
                        const ri = single ? 0 : (i === 0 ? count - 1 : i === count + 1 ? 0 : i - 1);
                        return (
                            <LandingEventSlide
                                key={`slide-${i}`}
                                event={ev}
                                onOpen={onOpen}
                                active={single ? true : i === pos}
                                position={ri + 1}
                                total={count}
                            />
                        );
                    })}
                </div>
            </div>

            {/* prev / next — hidden at rest on hover-capable devices, always shown on
                touch (§7 .reveal-on-hover), keyboard-reachable via focus-within/visible */}
            {!single && (
                <>
                    <button
                        type="button" onClick={() => step(-1)} aria-label="Previous event"
                        className="reveal-on-hover absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/90 backdrop-blur-sm text-[#003631] dark:text-[#7fd8ba] shadow-lg border border-black/5 transition-all hover:bg-white dark:bg-[#111b2e] hover:scale-105 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#003631] cursor-pointer"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <button
                        type="button" onClick={() => step(1)} aria-label="Next event"
                        className="reveal-on-hover absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/90 backdrop-blur-sm text-[#003631] dark:text-[#7fd8ba] shadow-lg border border-black/5 transition-all hover:bg-white dark:bg-[#111b2e] hover:scale-105 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#003631] cursor-pointer"
                    >
                        <ChevronRight size={20} />
                    </button>
                </>
            )}

            {/* dynamic pagination — one dot per published event; synced to realIndex so it
                stays correct across the loop seam. A dot click jumps to that real event. */}
            {!single && (
                <div className="mt-5 flex items-center justify-center gap-2.5" role="tablist" aria-label="Choose event">
                    {events.map((ev, i) => (
                        <button
                            key={ev.id}
                            type="button"
                            role="tab"
                            aria-selected={i === realIndex}
                            aria-label={`Go to event ${i + 1} of ${count}`}
                            onClick={() => goToReal(i)}
                            className={`h-2.5 rounded-full transition-all duration-300 cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003631] focus-visible:ring-offset-2 ${i === realIndex ? 'w-7 bg-[#003631]' : 'w-2.5 bg-[#bfc8c6]/70 hover:bg-[#4e6b5a]'}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Detail overlay. Fetches the FULL event (incl. banner) on demand from the public
// GET /events/:id — so the banner cost is paid only when a visitor opens one. Rendered
// inline (fixed overlay) like the page's other modals; closes on backdrop / Esc / X.
// Detail skeleton mirroring the loaded modal (banner → title → meta → body), so the
// public event modal never flashes a blank panel — the same §60 treatment as the
// seeker Events page. Palette-neutral pulse that reads in light and dark.
const LandingEventSkeleton = () => (
    <div className="animate-pulse" aria-hidden="true">
        <div className="w-full h-44 bg-gray-200 dark:bg-white/10" />
        <div className="p-5 sm:p-6 space-y-3">
            <div className="h-5 w-28 rounded-full bg-gray-200 dark:bg-white/10" />
            <div className="h-7 w-3/4 rounded-lg bg-gray-200 dark:bg-white/10" />
            <div className="space-y-2 pt-1">
                <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-white/10" />
                <div className="h-4 w-2/5 rounded bg-gray-200 dark:bg-white/10" />
            </div>
            <div className="space-y-2 pt-2">
                <div className="h-3.5 w-full rounded bg-gray-200 dark:bg-white/10" />
                <div className="h-3.5 w-11/12 rounded bg-gray-200 dark:bg-white/10" />
                <div className="h-3.5 w-4/5 rounded bg-gray-200 dark:bg-white/10" />
            </div>
        </div>
    </div>
);

const LandingEventModal = ({ id, onClose }) => {
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const trapRef = useFocusTrap(true); // C1: trap + restore focus (WCAG 2.4.3)
    const reduce = useReducedMotion();
    const overlayV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalOverlay;
    const panelV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalPanel;

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

    const parts = event && eventDateParts(event.event_date);
    const time = event && eventTimeRange(event.start_time, event.end_time);
    const typeLabel = event && (EVENT_TYPE_LABELS[event.event_type] || 'Announcement');

    return (
        <motion.div
            variants={overlayV} initial="initial" animate="animate" exit="exit"
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <motion.div ref={trapRef} role="dialog" aria-modal="true" aria-busy={loading} tabIndex={-1} variants={panelV} initial="initial" animate="animate" exit="exit" className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-[#111b2e] rounded-3xl shadow-2xl border border-[#bfc8c6]/30 dark:border-white/10 focus:outline-none">
                {loading ? (
                    <LandingEventSkeleton />
                ) : !event ? (
                    <div className="p-8 text-center">
                        <CalendarDays size={40} className="mx-auto text-gray-300 mb-3" />
                        <h3 className="text-base font-bold text-gray-700">Event unavailable</h3>
                        <p className="text-xs text-gray-400 mt-1">This event may have been unpublished or removed.</p>
                        <button onClick={onClose} className="mt-5 w-full py-2.5 rounded-xl bg-[#003631] text-white font-bold border-none cursor-pointer">Close</button>
                    </div>
                ) : (
                    <>
                        {event.banner_image
                            ? <img src={resolveBannerSrc(event.banner_image)} alt={event.title} decoding="async" className="w-full max-h-[60vh] object-contain bg-[#0b1c30]" />
                            : <div className="h-28 bg-gradient-to-br from-[#134e48] via-[#1a4a38] to-[#003631] flex items-center justify-center"><CalendarDays className="text-white/25" size={44} /></div>}
                        <div className="p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-3">
                                <span className="inline-flex items-center text-[11px] font-black uppercase tracking-wider text-[#003631] dark:text-[#7fd8ba] bg-[#eff4ff] dark:bg-[#16223a] px-2.5 py-1 rounded-full">{typeLabel}</span>
                                <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#003631] dark:text-[#7fd8ba] transition-colors border-none cursor-pointer bg-transparent"><X size={18} /></button>
                            </div>
                            <h2 className="mt-3 text-xl sm:text-2xl font-black text-[#003631] dark:text-[#7fd8ba] leading-tight">{event.title}</h2>
                            <div className="mt-3 space-y-2 text-sm font-semibold text-[#404947] dark:text-[#a3adbf]">
                                {parts && <p className="flex items-center gap-2"><CalendarDays size={16} className="text-[#4e6b5a] shrink-0" /> {parts.full}</p>}
                                {time && <p className="flex items-center gap-2"><Clock size={16} className="text-[#4e6b5a] shrink-0" /> {time}</p>}
                                {event.venue && <p className="flex items-center gap-2"><MapPin size={16} className="text-rose-500 shrink-0" /> {event.venue}</p>}
                            </div>
                            {event.description && <p className="mt-4 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{event.description}</p>}
                            {event.registration_info && (
                                <div className="mt-4 p-3.5 rounded-2xl bg-[#f8f9ff] dark:bg-[#0b1220] border border-[#bfc8c6]/30 dark:border-white/10">
                                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#003631] dark:text-[#7fd8ba] mb-1"><Ticket size={14} /> Registration / Participation</p>
                                    <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{event.registration_info}</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </motion.div>
        </motion.div>
    );
};

// ─── LANDING JOB DISCOVERY (grid + category selector + detail modal) ────────────
// The Landing reuses the Public Job Board's category taxonomy and filtering LOGIC
// (useJobFilters / getJobCategory — one source of category truth) but renders its
// own cards, chips, and modal in the Landing's bespoke hex palette. The token-styled
// JobCard / CategoryChips are NOT used here: the Landing must not adopt the app
// design tokens (§24/§53). Data, filtering, and navigation are shared; styling is native.

// Category selector — the Landing's primary job-discovery control (§64 relocation of the
// search bar was reverted: on the Landing, category navigation IS the discovery function;
// keyword/location/sort discovery lives on the Public Job Board). Uses the SAME shared
// taxonomy (jf.categories from useJobFilters) — one source of category truth. Laid out as a
// full-width FLEX-WRAP row so the chips span the whole content container and wrap onto more
// rows on narrow screens (no left-concentrated horizontal scroller, no forced stretching);
// selecting filters the grid in place.
const LandingCategorySelector = ({ categories = [], active = '', total = 0, onSelect, className = '' }) => {
    if (!categories.length) return null;
    const items = [
        { key: '__all__', value: '', label: 'All Jobs', count: total, selected: !active, all: true },
        ...categories.map(({ name, count }) => ({ key: name, value: active === name ? '' : name, label: name, count, selected: active === name, all: false })),
    ];
    return (
        <div className={`flex flex-wrap items-center gap-2.5 reveal ${className}`} role="group" aria-label="Filter jobs by category">
            {items.map((it) => (
                <button
                    key={it.key}
                    type="button"
                    aria-pressed={it.selected}
                    onClick={() => onSelect(it.value)}
                    className={`shrink-0 inline-flex items-center gap-2 pl-3.5 pr-2 py-2.5 rounded-full border text-sm font-bold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003631] focus-visible:ring-offset-1 ${
                        it.selected
                            ? 'bg-[#003631] border-[#003631] text-white shadow-sm'
                            : 'bg-white/70 dark:bg-[#111b2e] border-[#bfc8c6]/40 dark:border-white/10 text-[#003631] dark:text-[#7fd8ba] hover:border-[#003631]/40'
                    }`}
                >
                    {it.all && <LayoutGrid size={15} className={it.selected ? 'text-white' : 'text-[#4e6b5a] dark:text-[#7fd8ba]'} />}
                    <span className="whitespace-nowrap">{it.label}</span>
                    <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-black leading-none tabular-nums rounded-full ${
                        it.selected ? 'bg-[#FFD700] text-[#2F4A28]' : 'bg-[#003631]/10 text-[#003631] dark:bg-[#7fd8ba]/20 dark:text-[#7fd8ba]'
                    }`}>{it.count}</span>
                </button>
            ))}
        </div>
    );
};

// A vacancy tile in the discovery grid. Keyboard-operable (Enter/Space) since it is
// now the primary open affordance; opens the detail modal via onOpen(job).
const isLandingJobFilled = (job) =>
    job.status === 'Filled' || (job.referred_count != null && (Number(job.referred_count) || 0) >= (Number(job.positions_available) || 1));

const LandingJobCard = ({ job, onOpen }) => {
    const filled = isLandingJobFilled(job);
    const open = () => onOpen(job);
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
            className="h-full cursor-pointer rounded-2xl border border-[#bfc8c6]/30 dark:border-white/10 bg-white/70 dark:bg-[#111b2e] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003631] job-card-hover"
        >
            <div className="relative h-32 w-full overflow-hidden shrink-0">
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#134e48] via-[#1a4a38] to-[#003631]">
                    <span className="text-white/90 font-black text-3xl">{(job.company || 'C').charAt(0).toUpperCase()}</span>
                </div>
                {resolveJobImage(job.featured_image) && (
                    <img src={resolveJobImage(job.featured_image)} alt={job.title} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="relative w-full h-full object-cover" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
                {filled && (
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-900/85 text-white flex items-center gap-1"><Lock size={11} /> Filled</span>
                )}
                <div className="absolute bottom-2 left-3 right-3">
                    <h3 className="text-sm font-black text-white leading-tight line-clamp-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{job.title}</h3>
                    <p className="text-[11px] font-semibold text-white/90 line-clamp-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{job.company}</p>
                </div>
            </div>
            <div className="p-5 flex flex-col flex-1">
                <div className="flex flex-wrap gap-2 text-xs font-bold text-[#404947] dark:text-[#a3adbf] mb-3">
                    <span className="flex items-center gap-1 bg-[#eff4ff] dark:bg-[#16223a] px-2.5 py-1 rounded-md"><MapPin size={12} className="text-rose-500" /> {job.location || 'Kabankalan'}</span>
                    <span className="flex items-center gap-1 bg-[#caead6] dark:bg-[#1a4a38]/50 text-[#4e6b5a] px-2.5 py-1 rounded-md"><Briefcase size={12} /> {job.work_setup || 'On-site'}</span>
                </div>
                {job.description && <p className="text-xs text-[#404947] dark:text-[#a3adbf] font-medium line-clamp-2 mb-3">{job.description}</p>}
                <div className="mt-auto pt-3 border-t border-[#bfc8c6]/20 flex justify-between items-center text-xs gap-2">
                    <span className="text-gray-400 font-medium whitespace-nowrap">Posted {new Date(job.created_at).toLocaleDateString()}</span>
                    <span className="font-black text-[#003631] dark:text-[#7fd8ba] truncate text-right">{job.salary_range || 'Undisclosed'}</span>
                </div>
            </div>
        </div>
    );
};

// Detail modal — the §60/§61 Motion + backdrop treatment used by LandingEventModal.
// Renders straight from the job object (the public /jobs feed already carries the
// full detail, so there is no fetch and no skeleton, unlike events). "Apply Now"
// routes to login. Filled/lock logic mirrors the board (isJobFilled) exactly.
const LandingJobModal = ({ job, onClose, onApply }) => {
    const trapRef = useFocusTrap(true);
    const reduce = useReducedMotion();
    const overlayV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalOverlay;
    const panelV = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : modalPanel;
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
    const filled = isLandingJobFilled(job);
    return (
        <motion.div
            variants={overlayV} initial="initial" animate="animate" exit="exit"
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <motion.div ref={trapRef} role="dialog" aria-modal="true" aria-label={job.title} tabIndex={-1} variants={panelV} initial="initial" animate="animate" exit="exit" className="w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white dark:bg-[#111b2e] rounded-3xl shadow-2xl border border-[#bfc8c6]/30 dark:border-white/10 flex flex-col focus:outline-none">
                <div className="p-6 sm:p-8 border-b border-[#bfc8c6]/20 bg-[#f8f9ff] dark:bg-[#0b1220] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5 shrink-0">
                    <div className="flex items-center gap-5 min-w-0">
                        <div className="relative w-16 h-16 shrink-0 rounded-2xl overflow-hidden border border-[#bfc8c6]/30 dark:border-white/10 bg-white dark:bg-[#111b2e] flex items-center justify-center text-[#003631] dark:text-[#7fd8ba] font-black text-2xl">
                            {(job.company || 'C').charAt(0).toUpperCase()}
                            {resolveJobImage(job.featured_image) && (
                                <img src={resolveJobImage(job.featured_image)} alt={job.title} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="absolute inset-0 w-full h-full object-cover" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-xl font-black text-[#003631] dark:text-[#7fd8ba] tracking-tight line-clamp-2">{job.title}</h2>
                            <p className="text-xs font-bold text-gray-400 mt-0.5 line-clamp-1">{job.company} • {job.location || 'Kabankalan City'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        {filled ? (
                            <span className="flex-1 sm:flex-none px-6 py-3 bg-gray-100 dark:bg-[#1b2436] text-gray-500 dark:text-gray-400 font-semibold rounded-xl border border-gray-200 dark:border-white/10 flex items-center justify-center gap-2 shrink-0 cursor-not-allowed" title="All available positions have been referred">
                                <Lock size={16} /> {(Number(job.positions_available) || 1) === 1 ? 'Vacancy Filled' : 'Vacancies Filled'}
                            </span>
                        ) : (
                            <button onClick={onApply} className="flex-1 sm:flex-none px-6 py-3 bg-[#003631] text-white font-semibold rounded-xl shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 shrink-0 btn-shimmer border-none cursor-pointer">
                                <CheckCircle size={16} /> Apply Now
                            </button>
                        )}
                        <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-[#003631] dark:hover:text-[#7fd8ba] transition-colors border-none cursor-pointer bg-transparent shrink-0"><X size={18} /></button>
                    </div>
                </div>

                <div className="p-6 sm:p-8 overflow-y-auto custom-scrollbar flex-1 space-y-8">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-[#eff4ff] dark:bg-[#16223a] p-4 rounded-xl border border-[#bfc8c6]/20">
                            <Clock size={16} className="text-[#003631] dark:text-[#7fd8ba] mb-2" />
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Work Mode</p>
                            <p className="text-xs font-black text-[#003631] dark:text-[#7fd8ba] mt-0.5">{job.work_setup || 'On-site'}</p>
                        </div>
                        <div className="bg-[#eff4ff] dark:bg-[#16223a] p-4 rounded-xl border border-[#bfc8c6]/20">
                            <PhilippinePeso size={16} className="text-emerald-600 mb-2" />
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Salary</p>
                            <p className="text-xs font-black text-[#003631] dark:text-[#7fd8ba] mt-0.5">{job.salary_range || 'Undisclosed'}</p>
                        </div>
                        <div className="bg-[#eff4ff] dark:bg-[#16223a] p-4 rounded-xl border border-[#bfc8c6]/20">
                            <Users size={16} className="text-indigo-500 mb-2" />
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Vacancies</p>
                            <p className="text-xs font-black text-[#003631] dark:text-[#7fd8ba] mt-0.5">{
                                (job.referred_count != null && (Number(job.referred_count) || 0) >= (Number(job.positions_available) || 1))
                                    ? 'All Filled'
                                    : `${job.positions_available || 1} Slots`
                            }</p>
                        </div>
                        <div className="bg-[#eff4ff] dark:bg-[#16223a] p-4 rounded-xl border border-[#bfc8c6]/20">
                            <Briefcase size={16} className="text-amber-500 mb-2" />
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Job Type</p>
                            <p className="text-xs font-black text-[#003631] dark:text-[#7fd8ba] mt-0.5">{job.job_type || 'Full-Time'}</p>
                        </div>
                    </div>

                    <section>
                        <h3 className="text-base font-black text-[#003631] dark:text-[#7fd8ba] mb-3 pb-2 border-b border-gray-100 dark:border-white/10">Job Description</h3>
                        <p className="text-[#404947] dark:text-[#a3adbf] leading-relaxed text-sm whitespace-pre-wrap font-medium">{job.description}</p>
                    </section>

                    <section>
                        <h3 className="text-base font-black text-[#003631] dark:text-[#7fd8ba] mb-4 pb-2 border-b border-gray-100 dark:border-white/10">Job Criteria</h3>
                        <div className="bg-white dark:bg-[#0b1220] p-5 rounded-2xl border border-[#bfc8c6]/30 dark:border-white/10 space-y-4">
                            <div className="flex gap-3 items-start">
                                <GraduationCap size={18} className="text-[#003631] dark:text-[#7fd8ba] mt-0.5 shrink-0" />
                                <div><h4 className="font-bold text-[#003631] dark:text-[#7fd8ba] text-xs">Educational Attainment</h4><p className="text-xs text-gray-500 dark:text-[#a3adbf] font-medium mt-0.5">{job.education || 'Standard high school diploma or equivalent required.'}</p></div>
                            </div>
                            <div className="flex gap-3 items-start">
                                <Briefcase size={18} className="text-[#4e6b5a] mt-0.5 shrink-0" />
                                <div><h4 className="font-bold text-[#003631] dark:text-[#7fd8ba] text-xs">Required Experience</h4><p className="text-xs text-gray-500 dark:text-[#a3adbf] font-medium mt-0.5">{job.experience || 'Prior experience in a related field is preferred.'}</p></div>
                            </div>
                        </div>
                    </section>
                </div>
            </motion.div>
        </motion.div>
    );
};

// ─── MAIN LANDING COMPONENT ROOT TREE ──────────────────────────────────────────

const LandingPage = ({ onLoginSuccess }) => {
    const { user: authedUser } = useAuth();
    const dashboardPath = authedUser ? dashboardPathForRole(authedUser.role) : null;
    const { notify } = useNotification();

    // Navigation and Interaction States
    const [isScrolled, setIsScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [activeFaq, setActiveFaq] = useState(null);
    
    // Core Job Board States
    const [jobs, setJobs] = useState([]);
    const [loadingJobs, setLoadingJobs] = useState(true);
    // The discovery section reuses the Public Job Board's filter/sort/taxonomy hook —
    // one source of category truth and one filtering ruleset (search now spans
    // title/company/department/category/location/description, not just title+company).
    // The hero search + location inputs are bound directly to it (jf.state / jf.set).
    const jf = useJobFilters(jobs);
    const [selectedJob, setSelectedJob] = useState(null); // the job whose detail modal is open (null = closed)
    // The discovery grid scrolls INSIDE a fixed-height panel (below), so publishing
    // more vacancies never lengthens the page. This ref is the scroll-reveal root, so
    // cards animate in as they enter the PANEL's viewport, not the page's.
    const jobPanelRef = useRef(null);
    // PESO Events & Job Fairs teaser (lightweight, banner-free upcoming list).
    const [events, setEvents] = useState([]);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [openEventId, setOpenEventId] = useState(null);

    // Live Metrics States
    const [platformStats, setPlatformStats] = useState({ jobs: 0, users: 0, hires: 0, partners: 0, referrals: 0 });

    // Scroll-linked parallax on the hero backdrop. rAF-batched so the scroll
    // handler never does layout work inline, transform-only so it stays on the
    // compositor, and skipped entirely under prefers-reduced-motion.
    const heroBgRef = useRef(null);

    // Inquiries States

    // Authentication Modal Hooks
    const [authMode, setAuthMode] = useState(null);
    const [authLoading, setAuthLoading] = useState(false);
    // C1: trap + restore focus while the auth overlay is open (WCAG 2.4.3). Active only
    // when authMode is set; the hook re-arms on open and restores focus to the opener on close.
    const authTrapRef = useFocusTrap(!!authMode);
    // Standardized account-suspension notice (item 4) — shown when a login is blocked
    // or an open session is kicked (via the api interceptor's redirect). null = hidden.
    const [suspensionNotice, setSuspensionNotice] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [authForm, setAuthForm] = useState({
        name: '', email: '', password: '', role: 'applicant'
    });

    // ── Email verification (OTP) step ──────────────────────────────────────
    // Registration is now two steps: submitting the form only STAGES the signup
    // and mails a code; the account is created when the code is verified. The
    // password is intentionally NOT kept once the code is sent — the server
    // already holds the staged signup, so a resend needs only the address.
    const [otpEmail, setOtpEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [otpError, setOtpError] = useState('');
    const [otpVerifying, setOtpVerifying] = useState(false);
    const [otpResending, setOtpResending] = useState(false);
    const [otpCooldown, setOtpCooldown] = useState(0);
    const [otpExpiryMinutes, setOtpExpiryMinutes] = useState(10);

    const fetchPublicJobs = useCallback(async () => {
        try {
            const response = await API.get('/job-board');
            setJobs(response.data ?? []);
            // No auto-open: the detail modal opens only on an explicit card click.
        } catch (error) {
            console.error("Failed to load platform jobs");
        } finally {
            setLoadingJobs(false);
        }
    }, []);

    const fetchPlatformStats = useCallback(async () => {
        try {
            const response = await API.get('/job-board/stats');
            if (response.data?.status === 'success') {
                setPlatformStats(response.data.data);
            }
        } catch (error) {
            console.warn("Failed to synchronize baseline landing page analytics.");
        }
    }, []);

    // ALL published events for the carousel, capped. Same public data source as the seeker
    // Events module and WITH the uploaded banner image, so the poster is identical to the
    // authenticated Events & Job Fairs view. The backend orders upcoming-first (then past,
    // most-recent first), so the cap keeps what's next — a past event is shown, badged
    // "Ended", rather than vanishing the moment its date passes.
    const fetchPublicEvents = useCallback(async () => {
        try {
            const response = await API.get('/events?limit=12');
            setEvents(Array.isArray(response.data?.data) ? response.data.data : []);
        } catch (error) {
            console.warn("Failed to load PESO events.");
        } finally {
            setLoadingEvents(false);
        }
    }, []);

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll, { passive: true });
        fetchPublicJobs();
        fetchPlatformStats();
        fetchPublicEvents();
        return () => window.removeEventListener('scroll', handleScroll);
    }, [fetchPublicJobs, fetchPlatformStats, fetchPublicEvents]);

    // Hero parallax: a separate rAF-batched listener so the transform write is
    // decoupled from the isScrolled state update above.
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
        let raf = null;
        const update = () => {
            raf = null;
            const el = heroBgRef.current;
            if (!el) return;
            // Only the first viewport of scrolling matters (the hero leaves the
            // screen after that); the oversized layer hides the translated edges.
            const y = Math.min(window.scrollY, window.innerHeight);
            el.style.transform = `translate3d(0, ${y * 0.28}px, 0)`;
        };
        const onScroll = () => { if (raf == null) raf = requestAnimationFrame(update); };
        window.addEventListener('scroll', onScroll, { passive: true });
        update();
        return () => { window.removeEventListener('scroll', onScroll); if (raf != null) cancelAnimationFrame(raf); };
    }, []);

    // System-wide GPU-Accelerated Scroll-Reveal Motion System.
    //
    // The async-loaded lists are ALL in the deps ON PURPOSE: `.reveal` elements start at
    // opacity:0 and only this observer activates them. A `.reveal` that mounts AFTER the
    // observer last ran (because its data arrived later) is never observed — so it renders
    // but stays invisible: a blank, still-clickable area. That is exactly what bit the
    // Events & Job Fairs carousel — it mounts only once `events` resolves, which lands
    // after this effect's initial run, leaving the section blank. `events`/`loadingEvents`
    // (and jobs/search/faq) as deps re-run the observer the moment that content mounts, so
    // the freshly mounted `.reveal` is re-observed and revealed as soon as it scrolls in.
    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        const elements = document.querySelectorAll('.reveal');
        elements.forEach(el => observer.observe(el));

        return () => observer.disconnect();
    }, [jobs, activeFaq, jf.state.search, jf.state.location, jf.state.category, events, loadingEvents]);

    // Real partner names for the showcase marquee — distinct companies from the
    // live job feed, so nothing is fabricated. Deduped case-insensitively.
    const partnerNames = useMemo(() => {
        const seen = new Set();
        const names = [];
        for (const j of jobs) {
            const c = (j.company || '').trim();
            const key = c.toLowerCase();
            if (c && !seen.has(key)) { seen.add(key); names.push(c); }
        }
        return names;
    }, [jobs]);

    // Filtering/sorting/taxonomy are the hook's job (jf.filtered / jf.categories). The
    // modal opens only on an explicit card click, so there is no auto-selection here;
    // if the open job scrolls out of the filtered set it simply stays open until closed.

    const scrollTo = (id) => {
        const el = document.getElementById(id);
        if (el) {
            const y = el.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
        setMobileMenuOpen(false);
    };

    // The public assistant (PublicChatbot) returns allowlisted navigation actions; map them
    // to the SAME scroll / auth-modal mechanics the rest of the Landing Page already uses.
    const handleAssistantNav = (target) => {
        if (target === 'register') { setAuthMode('register'); return; }
        if (target === 'signin') { setAuthMode('login'); return; }
        scrollTo(String(target || '').replace(/^#/, ''));
    };

    // Resend cooldown tick. One interval, torn down whenever the count hits
    // zero or the modal closes, so it cannot leak across mode switches.
    useEffect(() => {
        if (otpCooldown <= 0) return undefined;
        const timer = setInterval(() => setOtpCooldown(prev => (prev <= 1 ? 0 : prev - 1)), 1000);
        return () => clearInterval(timer);
    }, [otpCooldown]);

    // On load, surface a suspension notice left by the api interceptor when it kicked
    // an active session (403 ACCOUNT_SUSPENDED → redirect to /?suspended=1). One-shot:
    // the stashed payload is consumed and removed so a refresh doesn't re-show it.
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem('pesoSuspensionNotice');
            if (stored) {
                setSuspensionNotice(JSON.parse(stored) || {});
                sessionStorage.removeItem('pesoSuspensionNotice');
            }
        } catch (_) { /* ignore malformed/blocked storage */ }
    }, []);

    const handleAuthChange = (e) => setAuthForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleAuthSubmit = async (e) => {
        e.preventDefault();
        setAuthLoading(true);

        if (authMode === 'login') {
            try {
                const response = await API.post('/auth/login', {
                    email: authForm.email,
                    password: authForm.password
                });
                if (response.data.status === 'success') {
                    notify.success("Welcome Back", "You have successfully signed in.");
                    setAuthMode(null);
                    onLoginSuccess(response.data.user, response.data.token);
                }
            } catch (error) {
                // A suspended account gets the standardized notice, not a generic error.
                if (error.response?.status === 403 && error.response?.data?.code === 'ACCOUNT_SUSPENDED') {
                    setSuspensionNotice(error.response.data.suspension || {});
                    setAuthMode(null);
                } else {
                    notify.error("Authentication Failed", error.response?.data?.message || "Invalid email or password.");
                }
            } finally {
                setAuthLoading(false);
            }
        } else if (authMode === 'register') {
            try {
                const response = await API.post('/auth/register', authForm);
                // 202 + verification_required: NOTHING has been created yet. The
                // account only exists after the code below is accepted.
                if (response.data.status === 'verification_required') {
                    // deliveryPending = the signup is staged but every mail provider
                    // was down. Move to the code screen anyway (nothing was lost) and
                    // let the user resend; be honest that the code is delayed.
                    const pending = response.data.deliveryPending === true;
                    if (pending) {
                        notify.warning("Code Delayed", response.data.message || "We couldn't send the code just now — tap Resend in a moment.");
                    } else {
                        notify.success("Check Your Email", response.data.message || "We sent you a 6-digit verification code.");
                    }
                    setOtpEmail(response.data.email || authForm.email);
                    setOtpExpiryMinutes(response.data.expiresInMinutes || 10);
                    // Nullish-coalesce, not ||: a legitimate 0 (resend available now,
                    // e.g. on delivery-pending) must not collapse to 60.
                    setOtpCooldown(response.data.resendAvailableInSeconds ?? 60);
                    setOtpCode('');
                    setOtpError('');
                    // Drop the password from component state now that the server
                    // holds the staged signup — it is no longer needed here.
                    setAuthForm(prev => ({ ...prev, password: '' }));
                    setAuthMode('verify_otp');
                }
            } catch (error) {
                notify.error("Registration Failed", error.response?.data?.message || "Could not create account.");
            } finally {
                setAuthLoading(false);
            }
        }
    };

    const resetAuthForm = () => setAuthForm({ name: '', email: '', password: '', role: 'applicant' });

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (otpCode.length !== 6) {
            setOtpError('Enter the full 6-digit code.');
            return;
        }

        setOtpVerifying(true);
        setOtpError('');
        try {
            const response = await API.post('/auth/register/verify', { email: otpEmail, code: otpCode });
            if (response.data.status === 'success') {
                notify.success("Account Created Successfully", "Your email is verified. Please sign in using your credentials.");
                resetAuthForm();
                setOtpCode('');
                setOtpEmail('');
                setAuthMode('login');
            }
        } catch (error) {
            // Inline, not a toast: the message ("2 attempts remaining", "expired")
            // has to stay on screen next to the input the user is retyping into.
            setOtpError(error.response?.data?.message || 'Could not verify that code. Please try again.');
        } finally {
            setOtpVerifying(false);
        }
    };

    const handleResendOtp = async () => {
        if (otpCooldown > 0 || otpResending) return;
        setOtpResending(true);
        setOtpError('');
        try {
            const response = await API.post('/auth/register/resend', { email: otpEmail });
            if (response.data.deliveryPending === true) {
                notify.warning("Still Sending", response.data.message || "The email service looks down — please try again shortly.");
            } else {
                notify.success("Code Resent", response.data.message || "A new verification code is on its way.");
            }
            setOtpCooldown(response.data.resendAvailableInSeconds ?? 60);
            setOtpExpiryMinutes(response.data.expiresInMinutes || 10);
            setOtpCode('');
        } catch (error) {
            const data = error.response?.data;
            // The server owns the pacing; mirror whatever wait it reports rather
            // than guessing, so the button cannot re-enable before the API will
            // actually accept another request.
            if (data?.retryAfterSeconds) setOtpCooldown(data.retryAfterSeconds);
            setOtpError(data?.message || 'Could not resend the code. Please try again shortly.');
        } finally {
            setOtpResending(false);
        }
    };

    const pwdStrength = authMode === 'register' ? checkPasswordStrength(authForm.password) : SAFE_PWD_DEFAULT;

    // Full-page redirect to the backend's Google OAuth entrypoint. It must be an
    // absolute backend URL (a top-level navigation, not an axios call), so drive it
    // from VITE_API_URL like api.js — a hardcoded localhost broke Google sign-in on
    // the deployed frontend. Falls back to the local dev backend when unset.
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const googleAuthUrl = `${API_BASE}/auth/google/login${authMode === 'register' ? `?role=${authForm.role}` : ''}`;

    return (
        <div className="relative w-full min-h-screen bg-[#f8f9ff] dark:bg-[#0b1220] text-[#0b1c30] dark:text-[#e6ebf2] dark:bg-[#0b1220] dark:text-[#e6ebf2] font-sans overflow-x-hidden antialiased">
            <AnimationStyles />
            <BackgroundDecorations />

            {/* Public visitor-support assistant (floating; §Phase C). onNavigate reuses the
                Landing Page's own scroll / auth-modal mechanics. */}
            <PublicChatbot onNavigate={handleAssistantNav} />

            {/* ═════════════════════════════ HEADER NAVIGATION ═════════════════════════════ */}
            <header className={`fixed top-0 w-full z-50 border-b border-[#bfc8c6]/30 dark:border-white/10 dark:border-white/10 backdrop-blur-md transition-all duration-300 ${isScrolled ? 'bg-[#f8f9ff]/80 dark:bg-[#0b1220]/85 shadow-md py-2' : 'bg-transparent py-4'}`}>
                <div className="max-w-7xl mx-auto px-6 lg:px-8 flex justify-between items-center w-full">
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-3 cursor-pointer group animate-logo-float" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                            <img src={pesoLogo} alt="PESO Kabankalan Logo" className="w-10 h-10 object-contain drop-shadow-sm rounded-full bg-white/50" />
                            <span className="text-2xl font-black tracking-tight text-[#003631] dark:text-[#7fd8ba]">
                                PESO Kabankalan
                            </span>
                        </div>
                        <nav className="hidden md:flex items-center gap-6 font-semibold text-sm text-[#404947] dark:text-[#a3adbf]">
                            <button onClick={() => scrollTo('jobs')} className="text-[#003631] dark:text-[#7fd8ba] font-bold border-b-2 border-[#003631] py-1 bg-transparent border-none cursor-pointer">Job Board</button>
                            <button onClick={() => scrollTo('events')} className="hover:text-[#003631] dark:text-[#7fd8ba] transition-colors nav-link-hover bg-transparent border-none cursor-pointer">Events</button>
                            <button onClick={() => scrollTo('ai-assistant')} className="hover:text-[#003631] dark:text-[#7fd8ba] transition-colors nav-link-hover bg-transparent border-none cursor-pointer">AI Coach</button>
                            <button onClick={() => scrollTo('how-it-works')} className="hover:text-[#003631] dark:text-[#7fd8ba] transition-colors nav-link-hover bg-transparent border-none cursor-pointer">How it Works</button>
                            <button onClick={() => scrollTo('faq')} className="hover:text-[#003631] dark:text-[#7fd8ba] transition-colors nav-link-hover bg-transparent border-none cursor-pointer">FAQ</button>
                            <button onClick={() => scrollTo('location')} className="hover:text-[#003631] dark:text-[#7fd8ba] transition-colors nav-link-hover bg-transparent border-none cursor-pointer">Visit Us</button>
                        </nav>
                    </div>

                    <div className="hidden md:flex items-center gap-4">
                        <ThemeToggle />
                        {authedUser ? (
                            <Link to={dashboardPath} className="px-6 py-2.5 bg-[#003631] text-white font-semibold rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition-all btn-shimmer flex items-center gap-2 no-underline">
                                <LayoutGrid size={16} /> Back to Dashboard
                            </Link>
                        ) : (
                            <>
                                <button onClick={() => setAuthMode('login')} className="text-[#0b1c30] dark:text-[#e6ebf2] font-semibold hover:bg-[#eff4ff] dark:bg-[#16223a] px-4 py-2 rounded-lg transition-all bg-transparent border-none cursor-pointer">Sign In</button>
                                <button onClick={() => setAuthMode('register')} className="px-6 py-2.5 bg-[#003631] text-white font-semibold rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition-all btn-shimmer border-none cursor-pointer">Get Started</button>
                            </>
                        )}
                    </div>

                    <div className="md:hidden flex items-center gap-1">
                        <ThemeToggle />
                        <button className="p-2 text-[#0b1c30] dark:text-[#e6ebf2] dark:text-[#e6ebf2] bg-transparent border-none cursor-pointer" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle mobile menu">
                            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Menu Panel Layer */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-40 bg-white/95 dark:bg-[#111b2e]/95 backdrop-blur-xl pt-24 px-6 flex flex-col gap-6 md:hidden animate-in slide-in-from-top-4">
                    <button onClick={() => scrollTo('home')} className="text-2xl font-black text-left text-[#003631] dark:text-[#7fd8ba] border-b border-gray-100 pb-4 bg-transparent border-none cursor-pointer">Home</button>
                    <button onClick={() => scrollTo('jobs')} className="text-2xl font-black text-left text-[#003631] dark:text-[#7fd8ba] border-b border-gray-100 pb-4 bg-transparent border-none cursor-pointer">Job Board</button>
                    <button onClick={() => scrollTo('events')} className="text-2xl font-black text-left text-[#003631] dark:text-[#7fd8ba] border-b border-gray-100 pb-4 bg-transparent border-none cursor-pointer">Events</button>
                    <button onClick={() => scrollTo('ai-assistant')} className="text-2xl font-black text-left text-[#003631] dark:text-[#7fd8ba] border-b border-gray-100 pb-4 bg-transparent border-none cursor-pointer">AI Coach</button>
                    <button onClick={() => scrollTo('how-it-works')} className="text-2xl font-black text-left text-[#003631] dark:text-[#7fd8ba] border-b border-gray-100 pb-4 bg-transparent border-none cursor-pointer">How it Works</button>
                    <div className="flex flex-col gap-4 mt-4">
                        {authedUser ? (
                            <Link to={dashboardPath} onClick={() => setMobileMenuOpen(false)} className="w-full py-4 text-center font-bold text-white bg-[#003631] rounded-xl shadow-lg no-underline flex items-center justify-center gap-2">
                                <LayoutGrid size={18} /> Back to Dashboard
                            </Link>
                        ) : (
                            <>
                                <button onClick={() => { setMobileMenuOpen(false); setAuthMode('login'); }} className="w-full py-4 text-center font-bold text-[#0b1c30] dark:text-[#e6ebf2] bg-gray-100 rounded-xl border-none cursor-pointer">Sign In</button>
                                <button onClick={() => { setMobileMenuOpen(false); setAuthMode('register'); }} className="w-full py-4 text-center font-bold text-white bg-[#003631] rounded-xl shadow-lg border-none cursor-pointer">Get Started</button>
                            </>
                        )}
                    </div>
                </div>
            )}

            <main className="relative z-10">
                {/* ═════════════════════════════ FULL-COVER HERO MODULE ═════════════════════════════ */}
                <section id="home" className="relative pt-36 pb-24 px-6 overflow-hidden min-h-[85vh] flex items-center justify-center">
                    <div className="absolute inset-0 z-0 overflow-hidden">
                        {/* Oversized parallax layer (−20%/140%) so the scroll-driven
                            translate never exposes an edge; ambient-pan zoom lives on
                            the inner div so the two transforms don't fight. */}
                        <div ref={heroBgRef} className="absolute -top-[20%] left-0 w-full h-[140%] will-change-transform">
                            <div className="w-full h-full animate-ambient-pan">
                                <img
                                    src={pesoCityOffice}
                                    alt="Kabankalan City Hall Background"
                                    loading="eager"
                                    decoding="async"
                                    className="w-full h-full object-cover dark:opacity-25"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#f8f9ff]/90 via-[#f8f9ff]/80 to-[#f8f9ff] dark:from-[#0b1220]/92 dark:via-[#0b1220]/88 dark:to-[#0b1220]"></div>

                    <div className="relative z-10 max-w-4xl mx-auto text-center flex flex-col items-center reveal">
                        <div className="inline-flex items-center gap-2 bg-[#b5ede5] dark:bg-[#173a30] px-4 py-1.5 rounded-full mb-8 shadow-sm border border-[#003631]/10 dark:border-[#7fd8ba]/20 animate-elegant-float cursor-default">
                            <ShieldCheck size={16} className="text-[#003631] dark:text-[#7fd8ba]" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#003631] dark:text-[#7fd8ba]">Official LGU Employment Services</span>
                        </div>
                        
                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-[#003631] dark:text-[#7fd8ba] mb-6 tracking-tight leading-tight">
                            Your Gateway to Local Employment.<br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#003631] to-[#486554] dark:from-[#7fd8ba] dark:to-[#a8e6cf]">
                                Connecting Kabankalan's Workforce.
                            </span>
                        </h1>
                        
                        <p className="text-base md:text-lg text-[#003631] dark:text-[#7fd8ba] mb-12 max-w-2xl font-medium leading-relaxed drop-shadow-sm">
                            The official digital employment service portal of the Public Employment Service Office (PESO) – Kabankalan City. Empowering job seekers and employers through modern job matching, Labor Market Information (LMI), and digital job fairs.
                        </p>

                        {/* Hero CTAs — the search itself moved DOWN to the Local Employment Board
                            section (so the controls sit with the job content); the hero now just
                            routes visitors into the board or the events section. */}
                        <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                            <button onClick={() => scrollTo('jobs')} className="w-full sm:w-auto px-8 py-3.5 bg-[#003631] text-white font-black rounded-xl shadow-md transition-all hover:bg-[#003631]/90 flex items-center justify-center gap-2 btn-shimmer border-none cursor-pointer">
                                Explore Local Jobs <ArrowRight size={18} />
                            </button>
                            <button onClick={() => scrollTo('events')} className="w-full sm:w-auto px-8 py-3.5 bg-white/80 dark:bg-[#111b2e] text-[#003631] dark:text-[#7fd8ba] font-bold rounded-xl border border-[#bfc8c6]/50 dark:border-white/10 shadow-sm transition-all hover:bg-white dark:hover:bg-[#16223a] flex items-center justify-center gap-2 border-none cursor-pointer">
                                <CalendarDays size={18} /> Events &amp; Job Fairs
                            </button>
                        </div>
                    </div>
                </section>

                {/* ═════════════════════════════ PLATFORM COUNTERS ═════════════════════════════ */}
                {/* Numbers count up the first time the strip scrolls into view. Each
                    maps 1:1 to a /stats field; "Referrals Issued" (approved letters)
                    is deliberately separate from "Successful Hires" (real placements). */}
                <section className="max-w-7xl mx-auto px-6 -mt-12 relative z-20">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                        {[
                            { key: 'jobs', label: 'Available Opportunities', icon: Briefcase },
                            { key: 'referrals', label: 'Referral Letters Issued', icon: FileCheck2 },
                            { key: 'hires', label: 'Successful Hires', icon: Award },
                            { key: 'partners', label: 'Active Local Employers', icon: Building2 },
                        ].map((s, idx) => {
                            const Icon = s.icon;
                            return (
                                <div key={s.key} className="reveal" style={{ transitionDelay: `${idx * 90}ms` }}>
                                    <div className="glass-card p-5 sm:p-6 rounded-3xl shadow-sm text-center transform hover:-translate-y-2 transition-all duration-300 h-full">
                                        <Icon className="mx-auto text-[#4e6b5a] mb-2" size={20} />
                                        <p className="text-2xl sm:text-3xl font-black text-[#003631] dark:text-[#7fd8ba] tabular-nums">
                                            <CountUp end={platformStats?.[s.key] || 0} />
                                        </p>
                                        <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-[#707977] mt-1">{s.label}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ═════════════════════════════ JOB DISCOVERY PANEL ═════════════════════════════ */}
                {/* Full-width category navigation (shared taxonomy) → a fixed-height, self-scrolling
                    job panel (its own scrollbar; the page height never grows with the vacancy count)
                    whose responsive multi-column cards scroll-reveal against the PANEL viewport →
                    detail modal → login. Reuses useJobFilters for filtering. No keyword search bar:
                    the Landing is a lightweight entry point; full keyword/location/sort search lives
                    on the Public Job Board (reached via the "View All Jobs" CTA). */}
                <section id="jobs" className="py-24 max-w-7xl mx-auto px-6 lg:px-8">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-12 gap-4 reveal">
                        <div>
                            <h2 className="text-3xl font-black text-[#003631] dark:text-[#7fd8ba]">Local Employment Board</h2>
                            <p className="text-[#404947] dark:text-[#a3adbf] font-medium text-sm mt-1">Discover verified local employment opportunities hosted by PESO.</p>
                        </div>
                        <button onClick={() => setAuthMode('login')} className="text-[#003631] dark:text-[#7fd8ba] font-semibold text-sm flex items-center gap-1.5 hover:underline bg-transparent border-none cursor-pointer">
                            View All Jobs <ChevronRight size={16} />
                        </button>
                    </div>

                    {jobs.length === 0 && !loadingJobs ? (
                        <div className="text-center py-16 bg-white dark:bg-[#111b2e] rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-sm reveal">
                            <Briefcase size={40} className="mx-auto text-gray-300 mb-3" />
                            <h3 className="text-base font-bold text-gray-700 dark:text-gray-200">No open positions right now</h3>
                            <p className="text-xs text-gray-400 mt-1">New PESO Kabankalan vacancies appear here as they are published.</p>
                        </div>
                    ) : (
                        /* Category-driven discovery (the Landing flow):
                           Category Navigation → Results Count/State → Matching Results → View
                           All Jobs (header CTA → Public Job Board). No keyword search bar here —
                           the Landing is a lightweight entry point; keyword/location/sort
                           discovery is the Public Job Board's job. Category nav reuses jf (the
                           board's own useJobFilters), so there is one shared taxonomy + ruleset. */
                        <>
                            {!loadingJobs && (
                                <LandingCategorySelector
                                    categories={jf.categories}
                                    active={jf.state.category}
                                    total={jobs.length}
                                    onSelect={jf.set.setCategory}
                                />
                            )}

                            {/* Results count / state — aria-live so the match total is announced
                               as the visitor picks a category (no page navigation). */}
                            <div className="mt-4 mb-5" aria-live="polite" aria-busy={loadingJobs}>
                                {loadingJobs ? (
                                    <span className="inline-flex items-center gap-2 text-sm font-bold text-[#404947] dark:text-[#a3adbf]">
                                        <Loader2 size={15} className="animate-spin text-[#003631] dark:text-[#7fd8ba]" /> Loading vacancies…
                                    </span>
                                ) : (
                                    <p className="text-xs sm:text-sm font-bold text-[#404947] dark:text-[#a3adbf]">
                                        {jf.state.category ? (
                                            <>Showing <span className="text-[#003631] dark:text-[#7fd8ba]">{jf.filtered.length}</span> of {jobs.length} vacanc{jobs.length === 1 ? 'y' : 'ies'} in <span className="text-[#003631] dark:text-[#7fd8ba]">{jf.state.category}</span></>
                                        ) : (
                                            <><span className="text-[#003631] dark:text-[#7fd8ba]">{jobs.length}</span> vacanc{jobs.length === 1 ? 'y' : 'ies'} available</>
                                        )}
                                    </p>
                                )}
                            </div>

                            {loadingJobs ? (
                                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#003631] dark:text-[#7fd8ba]" size={36} /></div>
                            ) : jf.filtered.length === 0 ? (
                                <div className="text-center py-16 bg-white dark:bg-[#111b2e] rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-sm reveal">
                                    <Briefcase size={40} className="mx-auto text-gray-300 mb-3" />
                                    <h3 className="text-base font-bold text-gray-700 dark:text-gray-200">No jobs in this category yet</h3>
                                    <p className="text-xs text-gray-400 mt-1 mb-4">Pick another category, or browse all available vacancies.</p>
                                    <button onClick={jf.reset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#003631] hover:bg-[#003631]/90 border-none cursor-pointer transition">
                                        <RefreshCw size={15} /> Show all jobs
                                    </button>
                                </div>
                            ) : (
                                /* Self-contained scroll PANEL: a controlled max-height container with its
                                   own vertical scrollbar (styled via custom-scrollbar), so however many
                                   vacancies are published the Landing's own height never grows — the rows
                                   scroll INSIDE this panel. The responsive grid (auto-fill/minmax → 1 col
                                   on phones, up to ~3 at max-w-7xl) reflows without horizontal overflow.
                                   Each card scroll-reveals once as it enters THIS panel's viewport
                                   (Reveal root={jobPanelRef}), never replaying on scroll-back. */
                                <div ref={jobPanelRef} className="max-h-[min(720px,72vh)] overflow-y-auto overflow-x-hidden custom-scrollbar rounded-2xl -mx-1">
                                    <div className="grid gap-5 sm:gap-6 grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] items-stretch p-1 pb-2">
                                        {jf.filtered.map((job, i) => (
                                            <Reveal key={job.id} root={jobPanelRef} className="h-full" delay={Math.min(i * 40, 320)}>
                                                <LandingJobCard job={job} onOpen={setSelectedJob} />
                                            </Reveal>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Detail modal — §60 Motion + backdrop, "Apply Now" → login. */}
                    <AnimatePresence>
                        {selectedJob && (
                            <LandingJobModal
                                key="landing-job-modal"
                                job={selectedJob}
                                onClose={() => setSelectedJob(null)}
                                onApply={() => { setSelectedJob(null); setAuthMode('login'); }}
                            />
                        )}
                    </AnimatePresence>
                </section>

                {/* ═════════════════════════════ PESO EVENTS & JOB FAIRS ═════════════════════════════ */}
                {/* Public teaser for the Events subsystem — a sibling of the Job Board (both are
                    "opportunities available now"). Fed by GET /api/events?limit=12 — EVERY published
                    event, ordered upcoming-first then past (banner_image always included, §34) and
                    rendered as a single-event carousel.
                    Degrades gracefully: on a fetch error the list is empty and the section shows
                    its purposeful empty state. */}
                <section id="events" className="py-24 scroll-mt-24 bg-gradient-to-b from-[#f8f9ff] to-white dark:from-[#0b1220] dark:to-[#0d1526]">
                    <div className="max-w-7xl mx-auto px-6 lg:px-8">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-12 gap-4 reveal">
                            <div>
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#003631] dark:text-[#7fd8ba] bg-[#caead6] dark:bg-[#1a4a38]/50 px-3 py-1 rounded-full mb-3"><CalendarDays size={13} /> Events &amp; Job Fairs</span>
                                <h2 className="text-3xl font-black text-[#003631] dark:text-[#7fd8ba]">PESO Events &amp; Job Fairs</h2>
                                <p className="text-[#404947] dark:text-[#a3adbf] font-medium text-sm mt-1">Job fairs, recruitment drives, and employment events hosted by PESO Kabankalan.</p>
                            </div>
                            <button onClick={() => setAuthMode('login')} className="text-[#003631] dark:text-[#7fd8ba] font-semibold text-sm flex items-center gap-1.5 hover:underline bg-transparent border-none cursor-pointer">
                                View All Events <ChevronRight size={16} />
                            </button>
                        </div>

                        {/* Single-event carousel (dev-history §34 redesign): one hero slide at a
                            time, uploaded poster as the primary visual, autoplay right→left with
                            hover-revealed arrows + dynamic dots + touch swipe. Same data source
                            (GET /api/events, banner included) — a presentation refactor only.
                            The loading skeleton mirrors the hero frame so nothing reflows on load. */}
                        {loadingEvents ? (
                            <div className="rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-lg bg-white dark:bg-[#111b2e] overflow-hidden animate-pulse">
                                <div className="h-[24rem] sm:h-[30rem] lg:h-[34rem] bg-gray-100 relative">
                                    <div className="absolute top-4 left-4 h-12 w-12 rounded-2xl bg-gray-200" />
                                    <div className="absolute bottom-0 inset-x-0 p-5 sm:p-7 lg:p-9 space-y-3">
                                        <div className="h-6 w-2/3 bg-gray-200 rounded" />
                                        <div className="h-3.5 w-1/2 bg-gray-200 rounded" />
                                        <div className="h-9 w-32 bg-gray-200 rounded-xl" />
                                    </div>
                                </div>
                            </div>
                        ) : events.length === 0 ? (
                            <div className="text-center py-16 bg-white dark:bg-[#111b2e] rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-sm reveal">
                                <CalendarDays size={40} className="mx-auto text-gray-300 mb-3" />
                                <h3 className="text-base font-bold text-gray-700">No events published yet</h3>
                                <p className="text-xs text-gray-400 mt-1">When PESO Kabankalan publishes a job fair or employment event, it will appear here.</p>
                            </div>
                        ) : (
                            <EventsCarousel events={events} onOpen={setOpenEventId} />
                        )}
                    </div>

                    <AnimatePresence>
                        {openEventId != null && <LandingEventModal key="landing-event-modal" id={openEventId} onClose={() => setOpenEventId(null)} />}
                    </AnimatePresence>
                </section>

                {/* ═════════════════════════════ PLATFORM CAPABILITIES ═════════════════════════════ */}
                {/* "What the platform does for you" — moved BELOW the search-driven discovery
                    content (Job Board + Events) so visitors reach opportunities first; this
                    explanatory marketing block now follows. */}
                <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
                    <div className="text-center max-w-2xl mx-auto mb-16 reveal">
                        <span className="inline-flex items-center gap-2 bg-[#caead6] dark:bg-[#1a4a38]/50 text-[#134e48] text-xs font-black uppercase tracking-wider px-4 py-1.5 rounded-full mb-4">
                            <Sparkles size={14} /> What the platform does for you
                        </span>
                        <h2 className="text-3xl md:text-4xl font-black text-[#003631] dark:text-[#7fd8ba]">One portal, from resume to referral</h2>
                        <p className="text-[#404947] dark:text-[#a3adbf] font-medium text-sm mt-3">Every step of the Kabankalan employment journey, powered by AI and backed by your local PESO office.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {PLATFORM_FEATURES.map((f, idx) => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} className="reveal h-full" style={{ transitionDelay: `${idx * 90}ms` }}>
                                    <div className="group h-full bg-white dark:bg-[#111b2e] p-7 rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-sm hover-lift-card flex flex-col">
                                        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${f.tint} text-white flex items-center justify-center shadow-md mb-5 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3`}>
                                            <Icon size={26} strokeWidth={2.2} />
                                        </div>
                                        <h3 className="text-lg font-black text-[#003631] dark:text-[#7fd8ba] mb-2">{f.title}</h3>
                                        <p className="text-sm text-[#404947] dark:text-[#a3adbf] leading-relaxed font-medium">{f.desc}</p>
                                    </div>
                                </div>
                            );
                        })}
                        {/* Sixth cell: a compact CTA tile so the 3-col grid stays balanced. */}
                        <div className="reveal h-full" style={{ transitionDelay: `${PLATFORM_FEATURES.length * 90}ms` }}>
                            <div className="ai-gradient-border h-full p-7 flex flex-col justify-center text-white">
                                <h3 className="text-lg font-black mb-2">Ready to begin?</h3>
                                <p className="text-sm text-gray-200 font-medium mb-5 leading-relaxed">Create your free profile and let the AI do the heavy lifting.</p>
                                <button onClick={() => setAuthMode('register')} className="self-start px-5 py-3 bg-[#8dfa94] text-[#002106] font-black rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center gap-2 border-none cursor-pointer">
                                    Get Started <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═════════════════════════════ DEEPSEEK AI COACH ═════════════════════════════ */}
                <section id="ai-assistant" className="py-20 px-6 max-w-7xl mx-auto">
                    <div className="ai-gradient-border p-10 lg:p-16 shadow-2xl flex flex-col lg:flex-row items-center gap-12 text-white reveal">
                        <div className="lg:w-1/2 relative z-10 reveal" style={{ transitionDelay: '100ms' }}>
                            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md text-[#8dfa94] font-bold text-xs px-4 py-2 rounded-full mb-6 border border-white/10">
                                <Bot size={16} className="animate-pulse" /> Powered by DeepSeek AI
                            </div>
                            <h2 className="text-3xl md:text-5xl font-black mb-6 leading-tight">
                                Intelligent Employment<br/>Assistance.
                            </h2>
                            <p className="text-gray-200 text-sm md:text-base mb-8 leading-relaxed font-medium">
                                The PESO Kabankalan platform integrates DeepSeek AI to provide secure resume parsing, skills gap analysis, and optimized career guidance natively to all registered job seekers.
                            </p>
                            <ul className="space-y-4 mb-10 font-bold text-sm list-none p-0">
                                <li className="flex items-center gap-3"><CheckCircle className="text-[#8dfa94]" size={18}/> 1-Click Resume Parsing</li>
                                <li className="flex items-center gap-3"><CheckCircle className="text-[#8dfa94]" size={18}/> Real-time Compatibility Scoring</li>
                                <li className="flex items-center gap-3"><CheckCircle className="text-[#8dfa94]" size={18}/> Automated Cover Letter Drafts</li>
                                <li className="flex items-center gap-3"><CheckCircle className="text-[#8dfa94]" size={18}/> Job Matching Algorithms</li>
                            </ul>
                            <button onClick={() => setAuthMode('register')} className="px-6 py-3.5 bg-[#8dfa94] text-[#002106] font-black rounded-xl shadow-lg hover:shadow-[#8dfa94]/30 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 border-none cursor-pointer btn-shimmer">
                                Build Your Profile <Zap size={16} />
                            </button>
                        </div>

                        <div className="lg:w-1/2 w-full relative z-10 reveal" style={{ transitionDelay: '300ms' }}>
                            <div className="bg-[#0b1c30] rounded-3xl p-6 shadow-2xl border border-white/10 relative hover-lift-rotate">
                                <div className="absolute top-4 right-4 flex gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                                </div>
                                <div className="mt-8 space-y-4">
                                    <div className="flex gap-4">
                                        <div className="w-9 h-9 rounded-xl bg-[#003631] flex items-center justify-center shrink-0"><Bot className="text-[#b5ede5]" size={18}/></div>
                                        <div className="bg-white/5 p-4 rounded-2xl rounded-tl-none border border-white/10 text-gray-200 text-xs md:text-sm max-w-[85%] leading-relaxed font-medium">Based on your parsed resume, you have an <span className="text-[#8dfa94] font-bold">82% match</span> for the <b>Senior Processor</b> role. I recommend highlighting your 3 years of inventory management in your cover letter. Shall I draft one for you?</div>
                                    </div>
                                    <div className="flex gap-4 justify-end">
                                        <div className="bg-[#134e48] p-4 rounded-2xl rounded-tr-none text-white text-xs md:text-sm max-w-[85%] leading-relaxed font-medium">Yes, please draft the cover letter with a professional and confident tone.</div>
                                        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0"><User size={18} className="text-white/60"/></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═════════════════════════════ HOW IT WORKS ═════════════════════════════ */}
                <section id="how-it-works" className="py-24 px-6 bg-[#eff4ff]/30 dark:bg-[#111b2e]/40">
                    <div className="text-center max-w-xl mx-auto mb-16 reveal">
                        <span className="inline-flex items-center gap-2 bg-[#003631] text-[#caead6] text-xs font-black uppercase tracking-wider px-4 py-1.5 rounded-full mb-4">
                            <Rocket size={14} /> Your employment journey
                        </span>
                        <h2 className="text-3xl md:text-4xl font-black text-[#003631] dark:text-[#7fd8ba]">From sign-up to hired</h2>
                        <p className="text-gray-500 font-medium text-sm mt-2">Eight guided steps — the platform walks with you the whole way.</p>
                    </div>

                    {/* ── CAREER ROADMAP ──────────────────────────────────────────
                        A left-rail roadmap with one drawing SVG spine, gradient
                        milestone medallions that pop in on a stagger, and cards that
                        slide in beside them. ONE responsive layout (medallions on the
                        rail, cards to the right) so there is no reflow between
                        breakpoints. The whole block is a single `.reveal`; when it
                        activates, descendant selectors (`.reveal.active .road-path`
                        etc.) fire the path draw and the staggered node/card entrances.
                        All motion collapses to a static, fully-drawn state under
                        prefers-reduced-motion. The <ol> keeps the real text so the
                        roadmap is legible to assistive tech; the SVG is aria-hidden. */}
                    <div className="max-w-3xl mx-auto relative reveal">
                        <svg
                            className="absolute top-3 bottom-3 left-6 sm:left-8 w-[3px] -translate-x-1/2 overflow-visible"
                            viewBox="0 0 3 100" preserveAspectRatio="none" aria-hidden="true"
                        >
                            <defs>
                                <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#134e48" />
                                    <stop offset="55%" stopColor="#4e6b5a" />
                                    <stop offset="100%" stopColor="#99e742" />
                                </linearGradient>
                            </defs>
                            {/* faint full-height track, then the gradient road that draws over it */}
                            <line x1="1.5" y1="0" x2="1.5" y2="100" stroke="#caead6" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
                            <line className="road-path" x1="1.5" y1="0" x2="1.5" y2="100" stroke="url(#roadGrad)" strokeWidth="3" strokeLinecap="round" pathLength="1" />
                        </svg>

                        <ol className="space-y-6 list-none p-0 m-0 relative">
                            {JOURNEY_STEPS.map((step, idx) => {
                                const Icon = step.icon;
                                return (
                                    <li key={step.title} className="relative pl-16 sm:pl-24">
                                        {/* Milestone medallion — centred on the rail via a
                                            negative margin (not translate) so the pop
                                            animation can own `transform` cleanly, leaving the
                                            hover highlight to non-transform ring/shadow. */}
                                        <div
                                            className="milestone absolute left-6 sm:left-8 -ml-6 sm:-ml-7 top-1 w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#134e48] to-[#003631] text-[#caead6] flex items-center justify-center shadow-lg ring-4 ring-[#f8f9ff] z-10 cursor-default transition-shadow duration-300 hover:ring-[#99e742] hover:shadow-[0_8px_24px_rgba(19,78,72,0.35)]"
                                            style={{ animationDelay: `${idx * 0.11}s` }}
                                        >
                                            <Icon size={22} strokeWidth={2.2} />
                                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#99e742] text-[#002106] text-[10px] font-black flex items-center justify-center border-2 border-white shadow-sm">{idx + 1}</span>
                                        </div>

                                        <div
                                            className="step-card group bg-white dark:bg-[#111b2e] p-5 rounded-2xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-sm transition-colors duration-300 hover:border-[#003631]/40 hover:shadow-md"
                                            style={{ animationDelay: `${idx * 0.11 + 0.08}s` }}
                                        >
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-white bg-[#003631] px-2 py-0.5 rounded-full">Step {idx + 1}</span>
                                                <h3 className="text-base font-black text-[#003631] dark:text-[#7fd8ba] group-hover:text-[#134e48] transition-colors">{step.title}</h3>
                                            </div>
                                            <p className="text-xs sm:text-sm text-[#404947] dark:text-[#a3adbf] font-medium leading-relaxed">{step.desc}</p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                </section>

                {/* ═════════════════════════════ PARTNER SHOWCASE ═════════════════════════════ */}
                {/* Only renders when there are real hiring organisations to show — a
                    seamless marquee of the actual companies posting on the board, not
                    invented brand logos. */}
                {partnerNames.length > 0 && (
                    <section className="py-16 overflow-hidden">
                        <p className="text-center text-xs font-black uppercase tracking-widest text-[#707977] mb-10 reveal">Trusted by local employers hiring in Kabankalan</p>
                        <div className="marquee-mask relative w-full overflow-hidden">
                            <div className="animate-marquee flex w-max gap-4">
                                {/* Two copies → -50% translate loops seamlessly. */}
                                {[...partnerNames, ...partnerNames].map((name, idx) => (
                                    <div key={idx} className="shrink-0 flex items-center gap-3 bg-white dark:bg-[#111b2e] px-6 py-4 rounded-2xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-sm hover:border-[#003631]/30 hover:shadow-md transition-all duration-300">
                                        <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#134e48] to-[#003631] text-[#caead6] font-black flex items-center justify-center shrink-0">
                                            {name.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="font-bold text-sm text-[#003631] dark:text-[#7fd8ba] whitespace-nowrap">{name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                )}

                {/* ═════════════════════════ COMMON QUESTIONS + VISIT US (consolidated) ═════════════════════════ */}
                {/* One cohesive section: the four Common Questions alongside the PESO office /
                    in-person visit info. The single contact channel is "Message Us" (the office
                    Facebook) in the office card — the old hardcoded "Contact Us" form was removed
                    to avoid a duplicate, unbacked contact path. `#faq` and `#location` anchors are
                    both preserved (top nav + footer link to them). */}
                <section id="faq" className="py-24 px-6 max-w-7xl mx-auto scroll-mt-24">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
                        {/* Common Questions — the exact four FAQs, unchanged. `flex flex-col` so the CTA
                            below stretches to fill the column and bottom-aligns with the office card + map. */}
                        <div className="lg:col-span-7 flex flex-col">
                            <h2 className="text-3xl font-black text-[#003631] dark:text-[#7fd8ba] mb-12 reveal">Common Questions</h2>
                            <div className="space-y-4">
                                {FAQ_DATA.map((faq, idx) => {
                                    const isOpen = activeFaq === idx;
                                    return (
                                        <div key={idx} className="reveal" style={{ transitionDelay: `${idx * 100}ms` }}>
                                            <div className={`border rounded-2xl overflow-hidden hover-lift-card ${isOpen ? 'border-[#003631]/30 bg-[#eff4ff] dark:bg-[#16223a] shadow-sm' : 'border-[#bfc8c6]/30 dark:border-white/10 bg-white'}`}>
                                                <button
                                                    onClick={() => setActiveFaq(isOpen ? null : idx)}
                                                    className="w-full px-6 py-5 flex justify-between items-center text-left focus:outline-none bg-transparent border-none cursor-pointer"
                                                >
                                                    <span className={`font-bold text-[#003631] dark:text-[#7fd8ba] text-sm md:text-base ${isOpen ? 'font-black' : ''}`}>{faq.q}</span>
                                                    <ChevronDown className={`text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} size={18} />
                                                </button>
                                                {isOpen && (
                                                    <div className="px-6 pb-5 text-xs md:text-sm text-[#404947] dark:text-[#a3adbf] font-medium leading-relaxed animate-in fade-in duration-200">
                                                        <p>{faq.a}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Final CTA — moved INTO the FAQ column (§46 rebalance) so it fills the space
                                beside the office card + map and the two columns bottom-align (CSS-grid stretch:
                                `flex-1` grows it into the leftover height). Layout only — the CTA's buttons/
                                handlers (register + scroll-to-jobs) are unchanged. */}
                            <div className="ai-gradient-border mt-10 flex-1 flex flex-col justify-center text-center text-white overflow-hidden px-6 py-12 sm:px-10 sm:py-14 reveal">
                                <div className="relative z-10 flex flex-col items-center">
                                    <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md text-[#8dfa94] font-bold text-xs px-4 py-2 rounded-full mb-6 border border-white/10">
                                        <ShieldCheck size={16} /> Free • Official • Government-backed
                                    </span>
                                    <h2 className="text-2xl md:text-4xl font-black mb-5 leading-tight max-w-2xl text-balance">
                                        Your next opportunity is waiting in Kabankalan.
                                    </h2>
                                    <p className="text-gray-200 text-sm md:text-base font-medium mb-8 max-w-md leading-relaxed">
                                        Join thousands of local job seekers using PESO Kabankalan to find work, build their profile, and get referred — all in one place.
                                    </p>
                                    <div className="flex flex-col sm:flex-row items-center gap-4">
                                        <button onClick={() => setAuthMode('register')} className="w-full sm:w-auto px-8 py-4 bg-[#8dfa94] text-[#002106] font-black rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center gap-2 border-none cursor-pointer btn-shimmer">
                                            Create Your Free Account <ArrowRight size={18} />
                                        </button>
                                        <button onClick={() => scrollTo('jobs')} className="w-full sm:w-auto px-8 py-4 bg-white/10 backdrop-blur-md text-white font-black rounded-xl border border-white/20 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center gap-2 border-none cursor-pointer">
                                            Explore Local Jobs
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Visit Us In Person — office info, directions, and "Message Us" (the single contact channel) */}
                        <div id="location" className="lg:col-span-5 scroll-mt-24 space-y-6">
                            <div className="reveal">
                                <span className="inline-flex items-center gap-2 bg-[#caead6] dark:bg-[#1a4a38]/50 text-[#003631] dark:text-[#7fd8ba] font-bold text-xs px-4 py-2 rounded-full mb-4"><MapPin size={14} /> Visit Us In Person</span>
                                <h2 className="text-3xl font-black text-[#003631] dark:text-[#7fd8ba]">Our Office</h2>
                                <p className="text-[#707977] font-medium mt-3 leading-relaxed">Prefer face-to-face help? Drop by the PESO Kabankalan office — our staff can assist you with registration, applications, and referral follow-ups in person.</p>
                            </div>

                            <div className="bg-white dark:bg-[#111b2e] rounded-3xl border border-[#bfc8c6]/30 dark:border-white/10 shadow-xl p-8 reveal">
                                <h3 className="text-2xl font-black text-[#003631] dark:text-[#7fd8ba] mb-6 tracking-tight">Kabankalan City PESO Office</h3>
                                <ul className="space-y-5 list-none p-0 m-0">
                                    <li className="flex items-start gap-4">
                                        <span className="w-11 h-11 rounded-xl bg-[#eff4ff] dark:bg-[#16223a] flex items-center justify-center shrink-0"><MapPin size={20} className="text-[#003631] dark:text-[#7fd8ba]" /></span>
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-wider text-[#707977] mb-1">Address</p>
                                            <p className="text-sm font-semibold text-[#404947] dark:text-[#a3adbf] leading-relaxed">J.Y. Perez Highway, Brgy. Talubangi (2nd Floor)<br />Kabankalan City, Negros Occidental 6111</p>
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-4">
                                        <span className="w-11 h-11 rounded-xl bg-[#eff4ff] dark:bg-[#16223a] flex items-center justify-center shrink-0"><Clock size={20} className="text-[#003631] dark:text-[#7fd8ba]" /></span>
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-wider text-[#707977] mb-1">Office Hours</p>
                                            <p className="text-sm font-semibold text-[#404947] dark:text-[#a3adbf]">Monday – Friday, 8:00 AM – 5:00 PM</p>
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-4">
                                        <span className="w-11 h-11 rounded-xl bg-[#eff4ff] dark:bg-[#16223a] flex items-center justify-center shrink-0"><Send size={20} className="text-[#003631] dark:text-[#7fd8ba]" /></span>
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-wider text-[#707977] mb-1">Connect</p>
                                            <a href="https://www.facebook.com/profile.php?id=100085082224847" target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline">PESO Kabankalan on Facebook</a>
                                        </div>
                                    </li>
                                </ul>
                                <div className="flex flex-col sm:flex-row gap-3 mt-8">
                                    <a href="https://www.google.com/maps/dir/?api=1&destination=10.008007,122.803436" target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-[#003631] text-white font-bold rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all btn-shimmer no-underline"><Navigation size={16} /> Get Directions</a>
                                    <a href="https://www.facebook.com/profile.php?id=100085082224847" target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-[#eff4ff] dark:bg-[#16223a] text-[#003631] dark:text-[#7fd8ba] font-bold rounded-xl border border-[#bfc8c6]/40 dark:border-white/10 hover:bg-[#caead6] dark:bg-[#1a4a38]/50 active:scale-95 transition-all no-underline"><Send size={16} /> Message Us</a>
                                </div>
                            </div>

                            {/* Lightweight map preview — opens the real map in a new tab */}
                            <a href="https://www.google.com/maps/search/?api=1&query=10.008007,122.803436" target="_blank" rel="noopener noreferrer" aria-label="Open the PESO Kabankalan office location in Google Maps" className="group relative block rounded-3xl overflow-hidden border border-[#bfc8c6]/30 dark:border-white/10 shadow-xl min-h-[240px] reveal bg-gradient-to-br from-[#134e48] via-[#1a4a38] to-[#003631] no-underline">
                                <div className="absolute inset-0 opacity-[0.14]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '38px 38px' }} aria-hidden="true" />
                                <div className="relative z-10 flex flex-col items-center text-center px-6 py-10">
                                    <span className="w-16 h-16 rounded-full bg-white/95 dark:bg-[#111b2e]/95 flex items-center justify-center shadow-lg mb-4 group-hover:scale-110 transition-transform"><MapPin size={30} className="text-[#003631] dark:text-[#7fd8ba]" /></span>
                                    <p className="text-white font-black text-lg">Kabankalan City PESO Office</p>
                                    <p className="text-[#caead6] text-sm font-semibold mt-1">J.Y. Perez Highway, Brgy. Talubangi</p>
                                    <span className="inline-flex items-center gap-1.5 mt-6 px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white text-xs font-bold group-hover:bg-white/20 transition-colors"><ExternalLink size={14} /> Open in Maps</span>
                                </div>
                            </a>
                        </div>
                    </div>
                </section>

                {/* ═════════════════════════════ FOOTER METADATA ═════════════════════════════ */}
                <footer className="bg-[#0b1c30] text-white pt-16 pb-8 border-t border-white/5 reveal">
                    <div className="max-w-7xl mx-auto px-6 lg:px-8">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                            <div className="col-span-1 md:col-span-2">
                                <div className="text-xl font-black text-[#b5ede5] mb-4 hover:scale-105 transition-transform cursor-default">PESO Kabankalan</div>
                                <p className="text-sm font-semibold text-[#bfc8c6] opacity-80 leading-relaxed max-w-sm">
                                    Bridging the gap between local employers and Kabankalan's talented workforce through modern, government-backed employment facilitation.
                                </p>
                            </div>
                            <div>
                                <h4 className="text-xs font-black uppercase tracking-widest text-[#b5ede5] mb-4">Quick Links</h4>
                                <ul className="space-y-2 text-sm text-[#bfc8c6] font-semibold list-none p-0">
                                    <li><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="hover:text-[#b5ede5] bg-transparent border-none p-0 cursor-pointer">Home</button></li>
                                    <li><button onClick={() => scrollTo('jobs')} className="hover:text-[#b5ede5] bg-transparent border-none p-0 cursor-pointer">Job Board</button></li>
                                    <li><button onClick={() => scrollTo('events')} className="hover:text-[#b5ede5] bg-transparent border-none p-0 cursor-pointer">Events &amp; Job Fairs</button></li>
                                    <li><button onClick={() => scrollTo('how-it-works')} className="hover:text-[#b5ede5] bg-transparent border-none p-0 cursor-pointer">How it Works</button></li>
                                    <li><button onClick={() => scrollTo('location')} className="hover:text-[#b5ede5] bg-transparent border-none p-0 cursor-pointer">Visit Us</button></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="text-xs font-black uppercase tracking-widest text-[#b5ede5] mb-4">Legal</h4>
                                {/* Real routed URLs (shareable + indexable), not modals — §56 follow-up.
                                    The signup-consent links below still open the modals so a user
                                    never navigates away mid-signup; both render the same shared content. */}
                                <ul className="space-y-2 text-sm text-[#bfc8c6] font-semibold list-none p-0">
                                    <li><Link to="/privacy" className="hover:text-[#b5ede5] no-underline text-[#bfc8c6] transition-colors">Privacy Policy</Link></li>
                                    <li><Link to="/terms" className="hover:text-[#b5ede5] no-underline text-[#bfc8c6] transition-colors">Terms of Service</Link></li>
                                    <li><Link to="/cookies" className="hover:text-[#b5ede5] no-underline text-[#bfc8c6] transition-colors">Cookie Policy</Link></li>
                                </ul>
                            </div>
                        </div>
                        <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center text-xs font-semibold text-[#bfc8c6]">
                            <p>&copy; {new Date().getFullYear()} PESO Kabankalan Employment Platform. Official LGU Portal.</p>
                            <div className="flex gap-4 mt-4 md:mt-0">
                                <span className="hover:text-white cursor-pointer">Facebook</span>
                                <span className="hover:text-white cursor-pointer">Twitter</span>
                                <span className="hover:text-white cursor-pointer">LinkedIn</span>
                            </div>
                        </div>
                        {/* Asset attribution — Streamline free-illustration license (welcome,
                            mascot, and assistant art are from the Streamline "Bangalore" set). */}
                        <p className="text-[11px] text-[#8ea3a0] mt-4 text-center md:text-left">
                            Illustrations by <a href="https://streamlinehq.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Streamline</a>.
                        </p>
                    </div>
                </footer>
            </main>

            {/* ═══════════════════════ LEGAL COMPLIANCE MODALS ═══════════════════════ */}
            {showTerms && <TermsOfServiceModal onClose={() => setShowTerms(false)} />}
            {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}

            {/* ═══════════════════════ PRODUCTION AUTHENTICATION MODAL OVERLAY ═══════════════════════ */}
            {/* ── ACCOUNT SUSPENDED NOTICE (item 4) ─────────────────────────────
                Standardized message shown when a login is blocked or an open session
                is kicked. Covers status, reason, dates, and office contact. */}
            {suspensionNotice && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSuspensionNotice(null)}>
                    <div className="w-full max-w-md bg-white dark:bg-[#111b2e] text-gray-800 rounded-3xl shadow-2xl overflow-hidden animate-speech" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-rose-600 text-white p-5 flex items-center gap-3">
                            <span className="p-2 rounded-xl bg-white/20"><Lock size={22} /></span>
                            <div>
                                <h2 className="text-lg font-black leading-tight">Account Suspended</h2>
                                <p className="text-xs text-white/80 font-medium">You cannot sign in at this time.</p>
                            </div>
                        </div>
                        <div className="p-5 space-y-3 text-sm">
                            <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100">
                                <span className="font-bold text-gray-500">Account status</span>
                                <span className="font-black text-rose-600">Suspended</span>
                            </div>
                            {suspensionNotice.suspendedAt && (
                                <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100">
                                    <span className="font-bold text-gray-500 flex items-center gap-1.5"><Clock size={14} /> Effective date</span>
                                    <span className="font-semibold text-gray-800 text-right">{new Date(suspensionNotice.suspendedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                </div>
                            )}
                            {suspensionNotice.endsAt && (
                                <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100">
                                    <span className="font-bold text-gray-500 flex items-center gap-1.5"><CalendarCheck size={14} /> Review / end date</span>
                                    <span className="font-semibold text-gray-800 text-right">{new Date(suspensionNotice.endsAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                </div>
                            )}
                            {suspensionNotice.reason && (
                                <div className="py-1.5">
                                    <p className="font-bold text-gray-500 mb-1">Reason</p>
                                    <p className="text-gray-800 bg-gray-50 border border-gray-100 rounded-xl p-3">{suspensionNotice.reason}</p>
                                </div>
                            )}
                            <div className="mt-1 p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-800 text-xs flex items-start gap-2">
                                <Mail size={15} className="shrink-0 mt-0.5" />
                                <span>To appeal or ask about this, contact the <strong>PESO Kabankalan office</strong> (City Hall, Kabankalan City) or check the email sent to your registered address.</span>
                            </div>
                        </div>
                        <div className="p-5 pt-0">
                            <button onClick={() => setSuspensionNotice(null)} className="w-full py-2.5 rounded-xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800 transition-colors">Understood</button>
                        </div>
                    </div>
                </div>
            )}

            {authMode && (
                // Backdrop-click to dismiss: onClick closes ONLY when the click lands on the
                // overlay itself (e.target === e.currentTarget) — i.e. the dimmed area / padding
                // around the modal. A click inside the modal content has e.target set to a
                // descendant, so it never closes (no stopPropagation needed, no propagation bugs).
                // The X button and the entrance animations are unaffected (both paths just unmount).
                <div
                    ref={authTrapRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label={authMode === 'register' ? 'Create your account' : authMode === 'forgot_password' ? 'Reset your password' : 'Sign in'}
                    tabIndex={-1}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-gray-900/60 backdrop-blur-md animate-in fade-in duration-300 focus:outline-none"
                    onClick={(e) => { if (e.target === e.currentTarget) setAuthMode(null); }}
                >
                    {authMode === 'forgot_password' ? (
                        <ForgotPassword onBackToLogin={() => setAuthMode('login')} />
                    ) : (
                        <div className="bg-white dark:bg-[#111b2e] rounded-2xl sm:rounded-[2rem] shadow-2xl relative border border-gray-100 max-w-[880px] w-full overflow-hidden flex flex-col md:flex-row animate-in zoom-in-95 duration-300 max-h-[92vh]">
                            <button onClick={() => setAuthMode(null)} className="absolute top-3.5 right-3.5 p-2 text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-full transition-colors z-50 border-none cursor-pointer" aria-label="Close modal">
                                <X size={18} />
                            </button>

                            {/* ── ILLUSTRATION SIDE ─────────────────────────────────────────
                                The 5-slide SVG carousel is the FULL visual content of this
                                panel — no captions/bubble, no decorative animated background.
                                A restrained soft surface supports the artwork without competing. */}
                            <div className="w-full md:w-5/12 relative overflow-hidden hidden md:flex flex-col border-r border-gray-200 bg-gradient-to-b from-[#f6f8f7] to-[#eef2f0] p-5 lg:p-6">
                                <div className="relative w-full flex-1 min-h-0">
                                    <HeroMascot />
                                </div>
                            </div>

                            <div className="w-full md:w-7/12 p-5 sm:p-7 md:p-9 relative z-10 flex flex-col justify-center bg-white dark:bg-[#111b2e] overflow-y-auto custom-scrollbar">
                                <div className="text-center mb-5">
                                    <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                                        {authMode === 'login' ? 'Welcome Back'
                                            : authMode === 'verify_otp' ? 'Verify Your Email'
                                            : 'Create an Account'}
                                    </h2>
                                    <p className="text-xs text-gray-500 font-medium mt-1.5">
                                        {authMode === 'login' ? 'Sign in to access official PESO services.'
                                            : authMode === 'verify_otp' ? 'One last step before your account is created.'
                                            : 'Join the Kabankalan City workforce network.'}
                                    </p>
                                </div>

                                {authMode === 'verify_otp' ? (
                                /* ── STEP 2 OF REGISTRATION ──────────────────────────────
                                   No account exists yet at this point. The signup is staged
                                   server-side and is only written to `users` when this code
                                   is accepted, so abandoning this screen leaves nothing
                                   behind — the staged row simply expires. */
                                <div className="animate-in fade-in slide-in-from-right-2 duration-300">
                                    <div className="flex flex-col items-center text-center mb-5">
                                        <span className="w-12 h-12 rounded-2xl bg-[#003631]/10 text-[#003631] dark:text-[#7fd8ba] flex items-center justify-center mb-3">
                                            <ShieldQuestion size={24} />
                                        </span>
                                        <p className="text-sm text-gray-600 font-medium">
                                            We sent a 6-digit code to
                                        </p>
                                        <p className="text-sm font-black text-gray-900 break-all mt-0.5">{otpEmail}</p>
                                        <p className="text-xs text-gray-400 font-medium mt-1.5">
                                            It expires in {otpExpiryMinutes} minutes. Check your spam folder if it hasn't arrived.
                                        </p>
                                    </div>

                                    <form onSubmit={handleVerifyOtp} className="space-y-4">
                                        <div>
                                            <label htmlFor="otp-code" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 text-center">Verification Code</label>
                                            <input
                                                id="otp-code"
                                                name="otp"
                                                type="text"
                                                inputMode="numeric"
                                                autoComplete="one-time-code"
                                                autoFocus
                                                maxLength={6}
                                                placeholder="000000"
                                                value={otpCode}
                                                // Strip non-digits on the way in: browsers paste codes
                                                // from mail clients with stray spaces, and a `type=number`
                                                // input would drop a leading zero from a valid code.
                                                onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                                                aria-invalid={Boolean(otpError)}
                                                aria-describedby={otpError ? 'otp-error' : undefined}
                                                className={`w-full py-3 rounded-xl bg-gray-50 border outline-none focus:ring-2 focus:ring-[#003631]/40 font-black text-gray-900 text-center text-2xl tracking-[0.5em] indent-[0.5em] placeholder:text-gray-300 placeholder:font-bold ${otpError ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-[#003631]/30'}`}
                                            />
                                            {otpError && (
                                                <p id="otp-error" role="alert" className="text-xs font-bold text-rose-600 mt-2 text-center">{otpError}</p>
                                            )}
                                        </div>

                                        <button type="submit" disabled={otpVerifying || otpCode.length !== 6} className="w-full py-3 bg-[#003631] text-white font-black text-sm rounded-xl shadow-lg hover:opacity-95 active:scale-[0.98] transition-all flex justify-center items-center gap-2 border-none disabled:opacity-50 disabled:active:scale-100 cursor-pointer btn-shimmer">
                                            {otpVerifying ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle size={16} />}
                                            Verify &amp; Create Account
                                        </button>
                                    </form>

                                    <div className="mt-4 text-center">
                                        <button
                                            type="button"
                                            onClick={handleResendOtp}
                                            disabled={otpCooldown > 0 || otpResending}
                                            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline bg-transparent border-none cursor-pointer disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                                        >
                                            {otpResending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                            {otpCooldown > 0 ? `Resend code in ${otpCooldown}s` : 'Resend code'}
                                        </button>
                                    </div>

                                    <div className="mt-4 text-center text-xs sm:text-sm font-semibold text-gray-500 border-t border-gray-100 pt-4">
                                        <button
                                            type="button"
                                            onClick={() => { setAuthMode('register'); setOtpCode(''); setOtpError(''); }}
                                            className="inline-flex items-center gap-1.5 font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline bg-transparent border-none cursor-pointer"
                                        >
                                            <ArrowLeft size={14} /> Use a different email address
                                        </button>
                                    </div>
                                </div>
                                ) : (
                                <>
                                <a href={googleAuthUrl} className="w-full py-2.5 sm:py-3 mb-4 bg-white dark:bg-[#111b2e] border border-gray-200 hover:bg-gray-50 hover:border-gray-300 rounded-xl flex items-center justify-center gap-2.5 font-bold text-gray-700 transition-colors shadow-sm text-sm no-underline">
                                    <GoogleIcon /> Continue with Google
                                </a>

                                <div className="relative flex items-center mb-4">
                                    <div className="flex-grow border-t border-gray-200" />
                                    <span className="shrink-0 mx-3 text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">Or continue with email</span>
                                    <div className="flex-grow border-t border-gray-200" />
                                </div>

                                <form onSubmit={handleAuthSubmit} className="space-y-3.5">
                                    {authMode === 'register' && (
                                        <div className="animate-in slide-in-from-bottom-2 duration-300">
                                            <div className="flex justify-center mb-3">
                                                <div className="py-2 px-5 rounded-xl font-bold text-xs bg-[#003631]/5 text-[#003631] dark:text-[#7fd8ba] border border-[#003631]/10 flex items-center gap-2">
                                                    <User size={14} /> Job Seeker Portal
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Full Name</label>
                                                <div className="relative">
                                                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                                    <input required name="name" type="text" placeholder="Juan dela Cruz" autoComplete="name" value={authForm.name ?? ''} onChange={handleAuthChange} className="w-full pl-10 pr-3 py-2.5 sm:py-3 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:ring-2 focus:ring-[#003631]/40 focus:border-[#003631]/30 font-medium text-gray-900 text-sm placeholder:text-gray-300" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Email Address</label>
                                        <div className="relative">
                                            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                            <input required name="email" type="email" placeholder="you@example.com" autoComplete="email" value={authForm.email ?? ''} onChange={handleAuthChange} className="w-full pl-10 pr-3 py-2.5 sm:py-3 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:ring-2 focus:ring-[#003631]/40 focus:border-[#003631]/30 font-medium text-gray-900 text-sm placeholder:text-gray-300" />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Password</label>
                                        <div className="relative">
                                            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                            <input required name="password" type={showPassword ? 'text' : 'password'} placeholder={authMode === 'register' ? 'Create a strong password' : 'Enter your password'} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authForm.password ?? ''} onChange={handleAuthChange} className="w-full pl-10 pr-11 py-2.5 sm:py-3 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:ring-2 focus:ring-[#003631]/40 focus:border-[#003631]/30 font-medium text-gray-900 text-sm placeholder:text-gray-300" />
                                            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer">
                                                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                            </button>
                                        </div>
                                    </div>

                                    {authMode === 'register' && authForm.password && (
                                        <div className="mt-2 text-xs">
                                            <div className="flex justify-between font-bold mb-1">
                                                <span className="text-gray-400 uppercase">Strength:</span>
                                                <span className={pwdStrength.color.replace('bg-', 'text-')}>{pwdStrength.label}</span>
                                            </div>
                                            <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                                                <div className={`h-full ${pwdStrength.color}`} style={{ width: pwdStrength.width }} />
                                            </div>
                                        </div>
                                    )}

                                    {authMode === 'login' && (
                                        <div className="flex justify-end pt-1">
                                            <button type="button" onClick={() => setAuthMode('forgot_password')} className="text-xs font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline bg-transparent border-none cursor-pointer">Forgot Password?</button>
                                        </div>
                                    )}

                                    <button type="submit" disabled={authLoading} className="w-full py-3 mt-4 bg-[#003631] text-white font-black text-sm rounded-xl shadow-lg hover:opacity-95 active:scale-[0.98] transition-all flex justify-center items-center gap-2 border-none disabled:opacity-50 cursor-pointer btn-shimmer">
                                        {authLoading ? <Loader2 size={17} className="animate-spin" /> : <Lock size={15} />}
                                        {authMode === 'login' ? 'Sign In Securely' : 'Create Account'}
                                    </button>
                                </form>

                                <div className="mt-4 text-center text-[10px] sm:text-xs text-gray-400 font-medium leading-relaxed">
                                    By continuing, you agree to our{' '}
                                    <button onClick={() => setShowTerms(true)} className="font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline bg-transparent border-none cursor-pointer transition-colors p-0">Terms of Service</button>{' '}
                                    and{' '}
                                    <button onClick={() => setShowPrivacy(true)} className="font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline bg-transparent border-none cursor-pointer transition-colors p-0">Privacy Policy</button>.
                                </div>

                                <div className="mt-4 text-center text-xs sm:text-sm font-semibold text-gray-500 border-t border-gray-100 pt-4">
                                    {authMode === 'login' ? (
                                        <p>Don't have an account? <button onClick={() => { setAuthMode('register'); resetAuthForm(); }} className="font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline ml-1 bg-transparent border-none cursor-pointer">Register here</button></p>
                                    ) : (
                                        <p>Already have an account? <button onClick={() => { setAuthMode('login'); resetAuthForm(); }} className="font-bold text-[#003631] dark:text-[#7fd8ba] hover:underline ml-1 bg-transparent border-none cursor-pointer">Sign in</button></p>
                                    )}
                                </div>
                                </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default LandingPage;