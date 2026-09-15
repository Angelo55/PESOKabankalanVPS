/**
 * LegalPage — the standalone, routed rendering of a legal document (`/privacy`, `/terms`,
 * `/cookies`). Shareable, indexable URLs — a public government service should have real
 * pages, not modal-only text (SKILL §56 follow-up). Content comes from the shared
 * `legalContent` module, so this page and the Landing signup-consent modals never drift.
 *
 * Self-contained chrome (it lives OUTSIDE AppLayout and the Landing): a slim header with the
 * PESO seal, the shared ThemeToggle, and a Home link; the document; tabs to the sibling docs;
 * a short footer. Landing-family palette (bespoke greens + `dark:` variants, NOT app tokens —
 * §24/§53), so it matches the marketing surface and honours the light/dark theme.
 */
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import ThemeToggle from '../common/ThemeToggle';
import { LEGAL_DOCS, LegalSections } from './legalContent';
import pesoLogo from '../../assets/PESO LOGO.jpg';

const TABS = [
    { slug: 'privacy', label: 'Privacy Policy' },
    { slug: 'terms', label: 'Terms of Service' },
    { slug: 'cookies', label: 'Cookie Policy' },
];

export default function LegalPage({ doc }) {
    // Set the tab/SEO title while this page is mounted, then restore it on unmount so
    // navigating back to the app doesn't keep the legal title.
    useEffect(() => {
        const prev = document.title;
        document.title = `${doc.title} · PESO Kabankalan`;
        window.scrollTo(0, 0);
        return () => { document.title = prev; };
    }, [doc]);

    return (
        <div className="min-h-screen bg-[#f8f9ff] dark:bg-[#0b1220] text-[#404947] dark:text-[#cdd5e0]">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-white/90 dark:bg-[#0f1826]/90 backdrop-blur border-b border-[#bfc8c6]/40 dark:border-white/10">
                <div className="max-w-4xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-3">
                    <Link to="/home" className="flex items-center gap-2.5 min-w-0 no-underline">
                        <img src={pesoLogo} alt="PESO Kabankalan" className="w-9 h-9 rounded-full object-contain bg-white shadow-sm shrink-0" />
                        <span className="font-black text-[#003631] dark:text-[#7fd8ba] truncate">PESO Kabankalan</span>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                        <ThemeToggle />
                        <Link to="/home" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-[#003631] dark:text-[#7fd8ba] hover:bg-[#caead6]/50 dark:hover:bg-[#1a4a38]/40 transition-colors no-underline">
                            <ArrowLeft size={16} /> <span className="hidden sm:inline">Back to Home</span>
                        </Link>
                    </div>
                </div>
            </header>

            {/* Document */}
            <main className="max-w-3xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#003631] dark:text-[#7fd8ba] bg-[#caead6] dark:bg-[#1a4a38]/50 px-3 py-1 rounded-full w-max mb-4">
                    <ShieldCheck size={13} /> Legal
                </div>
                <h1 className="text-3xl sm:text-4xl font-black text-[#003631] dark:text-[#7fd8ba] tracking-tight">{doc.title}</h1>
                <p className="mt-2 text-sm font-semibold text-[#404947]/70 dark:text-[#a3adbf]">Last updated: {doc.updated}</p>

                {/* Sibling-document tabs */}
                <nav className="mt-6 flex flex-wrap gap-2" aria-label="Legal documents">
                    {TABS.map((t) => (
                        <Link
                            key={t.slug}
                            to={`/${t.slug}`}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors no-underline ${
                                t.slug === doc.slug
                                    ? 'bg-[#003631] text-white border-[#003631]'
                                    : 'bg-white dark:bg-[#111b2e] text-[#003631] dark:text-[#7fd8ba] border-[#bfc8c6]/60 dark:border-white/10 hover:bg-[#caead6]/50 dark:hover:bg-[#1a4a38]/40'
                            }`}
                        >
                            {t.label}
                        </Link>
                    ))}
                </nav>

                <div className="mt-8 rounded-3xl bg-white dark:bg-[#111b2e] border border-[#bfc8c6]/40 dark:border-white/10 shadow-sm p-6 sm:p-9">
                    <div className="text-[15px] leading-relaxed font-medium text-[#404947] dark:text-[#cdd5e0] space-y-7">
                        <LegalSections sections={doc.sections} />
                    </div>
                </div>

                <p className="mt-8 text-xs text-[#404947]/60 dark:text-[#8892a3]">
                    This document is provided for transparency and may be updated. For questions about your
                    data or these terms, contact the PESO Kabankalan office through the details on the{' '}
                    <Link to="/home" className="font-bold text-[#003631] dark:text-[#7fd8ba] underline">home page</Link>.
                </p>
            </main>

            <footer className="border-t border-[#bfc8c6]/40 dark:border-white/10 py-8 text-center text-xs text-[#404947]/60 dark:text-[#8892a3]">
                © {new Date().getFullYear()} Public Employment Service Office — Kabankalan City.
            </footer>
        </div>
    );
}
