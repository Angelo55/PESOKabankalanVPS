/**
 * ROUTING AND LAYOUT SHELLS — the map of the frontend.
 *
 * WHAT: declares every route and wraps it in the correct shell for the signed-in
 * role. Start here when asked "where does this screen live?".
 *
 * ── TWO SHELLS, BY ROLE ────────────────────────────────────────────────────
 *   AppLayout    Sidebar + TopHeader + page. Job Seekers AND PESO
 *                Administrators. The sidebar's LINKS differ by role, but the
 *                chrome is the same — one layout to keep consistent, and a role
 *                change does not restructure the page.
 *   SuperAdminLayout  Sidebar only, for Super Administrators. No TopHeader,
 *                     which is why the notification bell is not fetched for
 *                     that role — there would be nowhere to render it. Lives in
 *                     src/superadmin/, with the rest of that subsystem.
 *
 * ── PROVIDER ORDER MATTERS ─────────────────────────────────────────────────
 * AuthProvider -> NotificationProvider -> ChatProvider. Chat needs to know who
 * is signed in before it opens a socket, and notifications need the same before
 * they can fetch. Reordering these breaks the session bootstrap.
 *
 * ── CODE SPLITTING ─────────────────────────────────────────────────────────
 * Routed pages are lazy-loaded so a job seeker never downloads the admin
 * dashboard. Deliberately NOT split (see the import block below): ProtectedRoute
 * must resolve synchronously to gate a route, LandingPage is the first paint for
 * logged-out visitors, and the shell components render on every navigation —
 * lazy-loading those causes visible flicker on each page change.
 *
 * ── ProtectedRoute IS UX, NOT SECURITY ─────────────────────────────────────
 * It decides what is rendered and where an unauthorised visitor is redirected.
 * It does NOT protect data: anyone can call the API directly. Every protected
 * endpoint independently checks the role AND the record's owner server-side.
 * If asked "what stops a job seeker opening the admin dashboard?", the honest
 * answer is that they can render the shell, and every request it makes returns
 * 403 or 404.
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { ChatProvider } from './context/ChatContext';
import { normalizeRole, ROLE_KEYS } from './utils/roles';

// EAGER — needed immediately or on every navigation, so NOT split:
//  - ProtectedRoute: gates every protected route; must resolve synchronously.
//  - LandingPage: the first paint for logged-out visitors; a loading flash
//    here would hurt the most important first impression.
//  - Sidebar / SuperAdminLayout / Chatbot: layout shell rendered on every
//    page; lazy-loading these causes flicker on each navigation.
import ProtectedRoute from './components/ProtectedRoute';
import LandingPage from './components/LandingPage';
import { PRIVACY, TERMS, COOKIES } from './components/legal/legalContent';
import Sidebar from './components/Sidebar';
import Chatbot from './components/Chatbot';
import TopHeader from './components/layout/TopHeader';
import OnboardingModal from './components/onboarding/OnboardingModal';
import SuperAdminLayout from './superadmin/SuperAdminLayout';
import useSidebarCollapsed from './hooks/useSidebarCollapsed';

// LAZY — every routed page. Each becomes its own chunk, loaded on first visit
// to that route and cached thereafter. This is what keeps the initial bundle
// (and first paint) small.
const Dashboard = lazy(() => import('./components/Dashboard'));
const Profile = lazy(() => import('./components/Profile'));
const MyApplications = lazy(() => import('./components/MyApplications'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const ClaimAccount = lazy(() => import('./components/ClaimAccount'));
const AccountSettings = lazy(() => import('./components/AccountSettings'));
// Unified Document Builder — ONE component serves résumé, cover letter, and resignation
// (docType prop). Replaced the three near-duplicate builders (docs/document-builder-platform-plan.md).
const DocumentBuilder = lazy(() => import('./components/builder/DocumentBuilder'));
const PublicJobBoard = lazy(() => import('./components/PublicJobBoard'));
const LegalPage = lazy(() => import('./components/legal/LegalPage'));
const PesoAdminProfile = lazy(() => import('./components/PesoAdminProfile'));
const PesoAdminDashboard = lazy(() => import('./components/PesoAdminDashboard'));
const PesoAdminOverview = lazy(() => import('./components/PesoAdminOverview'));
const PesoAdminATS = lazy(() => import('./components/PesoAdminATS'));
const SmartReferralQueue = lazy(() => import('./components/SmartReferralQueue'));
const Events = lazy(() => import('./components/Events'));
const PesoEventManager = lazy(() => import('./components/PesoEventManager'));
const WalkInRegistration = lazy(() => import('./components/WalkInRegistration'));
const SavedJobs = lazy(() => import('./components/SavedJobs'));
const Trash = lazy(() => import('./components/Trash'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));
const Messages = lazy(() => import('./components/Messages'));
const Referrals = lazy(() => import('./components/Referrals'));
const AiRecommendedPanel = lazy(() => import('./components/AiRecommendedPanel'));
const FailedReferralsPanel = lazy(() => import('./components/FailedReferralsPanel'));

const PlatformOverview = lazy(() => import('./superadmin/features/overview/PlatformOverview'));
const UserAccounts = lazy(() => import('./superadmin/features/accounts/UserAccounts'));
const JobModeration = lazy(() => import('./superadmin/features/moderation/JobModeration'));
const PlatformReports = lazy(() => import('./superadmin/features/reports/PlatformReports'));
const SystemSettings = lazy(() => import('./superadmin/features/settings/SystemSettings'));
const AuditTrail = lazy(() => import('./superadmin/features/audit/AuditTrail'));
const PlatformHealth = lazy(() => import('./superadmin/features/health/PlatformHealth'));
const WorkflowAutomation = lazy(() => import('./superadmin/features/automation/WorkflowAutomation'));
const ProactiveReferralsMonitor = lazy(() => import('./superadmin/features/proactive/ProactiveReferrals'));
const EmailDelivery = lazy(() => import('./superadmin/features/email/EmailDelivery'));
const SmsDelivery = lazy(() => import('./superadmin/features/sms/SmsDelivery'));
const JobAlerts = lazy(() => import('./superadmin/features/jobalerts/JobAlerts'));

// A unified wrapper to persist the Sidebar/Chatbot across all protected routes.
// `sidebar-collapsed` on <main> lets page shells reclaim the space a collapsed
// sidebar frees, instead of leaving it as dead margin (see index.css).
const AppLayout = ({ children }) => {
    const sidebarCollapsed = useSidebarCollapsed();
    return (
        <div className="flex min-h-screen bg-canvas transition-colors duration-300">
            <Sidebar />
            <main className={`flex-1 w-full overflow-x-hidden flex flex-col min-w-0 pt-16 md:pt-0 ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                {/* Persistent profile/notifications bar across every job-seeker module */}
                <TopHeader />
                <div className="flex-1">
                    {children}
                </div>
            </main>
            <Chatbot />
            {/* Post-registration onboarding — self-gates to incomplete job seekers */}
            <OnboardingModal />
            {/* 🚨 FIX: Removed <ChatWidget /> here to prevent obstruction with the Chatbot */}
        </div>
    );
};

// Shown briefly while a route's code chunk downloads on first visit. Matches the
// existing auth-loading spinner so lazy-loading introduces no new visual style.
const RouteFallback = () => (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
    </div>
);
function App() {
    const { user, loading, login } = useAuth();
    const currentRole = normalizeRole(user?.role);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-canvas">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
            </div>
        );
    }

    return (
        <NotificationProvider>
            <ChatProvider>
                <BrowserRouter>
                    <Suspense fallback={<RouteFallback />}>
                    <Routes>
                        
                        {/* DYNAMIC ROOT ROUTE */}
                        <Route path="/" element={
                            !user ? <LandingPage onLoginSuccess={login} />
                            : currentRole === ROLE_KEYS.SUPER_ADMINISTRATOR ? <Navigate to="/admin/dashboard" replace />
                            : currentRole === ROLE_KEYS.PESO_ADMINISTRATOR ? <Navigate to="/peso-admin/dashboard" replace />
                            : currentRole === ROLE_KEYS.PESO_STAFF ? <Navigate to="/peso-admin/jobs" replace />
                            : <AppLayout><Dashboard /></AppLayout>
                        } />

                        {/* Public landing, reachable by AUTHENTICATED users too. The `/`
                            route redirects a logged-in user to their dashboard, so this
                            dedicated path lets the shared-nav "Home" button show the
                            landing page without logging out (frontend routing only). */}
                        <Route path="/home" element={<LandingPage onLoginSuccess={login} />} />

                        <Route path="/reset-password" element={<ResetPassword />} />

                        {/* Public walk-in account claim (#7) — pre-auth; the claim code
                            is the credential. Signs the seeker in on success. */}
                        <Route path="/claim" element={<ClaimAccount />} />

                        {/* PUBLIC legal pages — standalone, shareable, indexable URLs (SKILL §56
                            follow-up). Content is the SAME shared source the Landing signup-consent
                            modals render, so the two can't drift. No auth. */}
                        <Route path="/privacy" element={<LegalPage doc={PRIVACY} />} />
                        <Route path="/terms" element={<LegalPage doc={TERMS} />} />
                        <Route path="/cookies" element={<LegalPage doc={COOKIES} />} />

                        {/* GENERAL routes every authenticated role — including the limited
                            PESO Staff — may use: account settings, the notification centre,
                            and the public board. (Referral + messaging surfaces are in the
                            next block, which deliberately EXCLUDES peso_staff.) */}
                        <Route element={<ProtectedRoute allowedRoles={['applicant', 'employer', 'admin', 'peso_staff']} />}>
                            <Route path="/job-board" element={<AppLayout><PublicJobBoard /></AppLayout>} />
                            <Route path="/settings" element={<AppLayout><AccountSettings user={user} /></AppLayout>} />
                            <Route path="/notifications" element={<AppLayout><NotificationCenter /></AppLayout>} />
                            {/* PESO Events & Announcements — the seeker view (published events).
                                The EVENT_ANNOUNCEMENT notification deep-links here. */}
                            <Route path="/events" element={<AppLayout><Events /></AppLayout>} />
                        </Route>

                        {/* SHARED — seeker + PESO Manager + Super Admin. NOT peso_staff:
                            referral data and the messaging hub are outside a publication
                            staff member's remit. */}
                        <Route element={<ProtectedRoute allowedRoles={['applicant', 'employer', 'admin']} />}>
                            <Route path="/messages" element={<AppLayout><Messages /></AppLayout>} />
                            <Route path="/referrals" element={<AppLayout><Referrals /></AppLayout>} />
                            <Route path="/referrals/recommended" element={<AppLayout><AiRecommendedPanel /></AppLayout>} />
                            <Route path="/referrals/failed" element={<AppLayout><FailedReferralsPanel /></AppLayout>} />
                        </Route>

                        {/* APPLICANT PROTECTED ROUTES */}
                        <Route element={<ProtectedRoute allowedRoles={['applicant']} />}>
                            <Route path="/profile" element={<AppLayout><Profile /></AppLayout>} />
                            {/* Consolidated: one authoritative My Applications page. The old
                                external-tracker Kanban (/jobs) redirects here so bookmarks +
                                notification deep links keep working (2026-08-07 refactor). */}
                            <Route path="/my-applications" element={<AppLayout><MyApplications /></AppLayout>} />
                            <Route path="/jobs" element={<Navigate to="/my-applications" replace />} />

                            <Route path="/builder" element={<AppLayout><DocumentBuilder docType="resume" user={user} /></AppLayout>} />
                            <Route path="/resignation-builder" element={<AppLayout><DocumentBuilder docType="resignation" user={user} /></AppLayout>} />
                            <Route path="/cover-letter" element={<AppLayout><DocumentBuilder docType="cover-letter" user={user} /></AppLayout>} />
                            <Route path="/saved-jobs" element={<AppLayout><SavedJobs /></AppLayout>} />
                            <Route path="/trash" element={<AppLayout><Trash /></AppLayout>} />
                        </Route>

                        {/* JOB PUBLICATION — PESO Manager AND the limited PESO Staff
                            (co-worker) share this one surface. Staff-published vacancies are
                            attributed to the office Manager server-side (D2), so the Manager's
                            ATS/referral pipeline sees their applicants with no ownership break. */}
                        <Route element={<ProtectedRoute allowedRoles={['employer', 'peso_staff']} />}>
                            <Route path="/peso-admin/jobs" element={<AppLayout><PesoAdminDashboard /></AppLayout>} />
                            {/* Event Announcements — Manager + Staff (events:manage). */}
                            <Route path="/peso-admin/events" element={<AppLayout><PesoEventManager /></AppLayout>} />
                        </Route>

                        {/* PESO Manager-only PROTECTED ROUTES (referral decisions, ATS,
                            analytics, office profile — NOT publication staff). */}
                        <Route element={<ProtectedRoute allowedRoles={['employer']} />}>
                            {/* /dashboard is the operational command center (analytics).
                                PesoAdminDashboard.jsx keeps its filename but is the job
                                manager (above), not the dashboard. */}
                            <Route path="/peso-admin/dashboard" element={<AppLayout><PesoAdminOverview /></AppLayout>} />
                            <Route path="/peso-admin/walk-in" element={<AppLayout><WalkInRegistration /></AppLayout>} />
                            <Route path="/peso-admin/ats" element={<AppLayout><PesoAdminATS /></AppLayout>} />
                            <Route path="/peso-admin/smart-referrals" element={<AppLayout><SmartReferralQueue /></AppLayout>} />
                            <Route path="/peso-admin/profile" element={<AppLayout><PesoAdminProfile /></AppLayout>} />
                            {/* Backward-compatible redirects for any existing /employer/* links */}
                            <Route path="/employer/dashboard" element={<Navigate to="/peso-admin/dashboard" replace />} />
                            <Route path="/employer/ats" element={<Navigate to="/peso-admin/ats" replace />} />
                            <Route path="/employer/profile" element={<Navigate to="/peso-admin/profile" replace />} />
                        </Route>

                        {/* DEDICATED ADMINISTRATOR MODULE */}
                        <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/admin/dashboard" element={<SuperAdminLayout><PlatformOverview /></SuperAdminLayout>} />
                            <Route path="/admin/users" element={<SuperAdminLayout><UserAccounts /></SuperAdminLayout>} />
                            
                            {/* Job Seeker Verification decommissioned (2026-08-01): the verification
                                queue and its /admin/verification* routes were removed by product decision. */}
                            
                            <Route path="/admin/jobs" element={<SuperAdminLayout><JobModeration /></SuperAdminLayout>} />
                            <Route path="/admin/reports" element={<SuperAdminLayout><PlatformReports /></SuperAdminLayout>} />
                            <Route path="/admin/settings" element={<SuperAdminLayout><SystemSettings /></SuperAdminLayout>} />
                            <Route path="/admin/audit" element={<SuperAdminLayout><AuditTrail /></SuperAdminLayout>} />
                            <Route path="/admin/health" element={<SuperAdminLayout><PlatformHealth /></SuperAdminLayout>} />
                            <Route path="/admin/automation" element={<SuperAdminLayout><WorkflowAutomation /></SuperAdminLayout>} />
                            <Route path="/admin/proactive" element={<SuperAdminLayout><ProactiveReferralsMonitor /></SuperAdminLayout>} />
                            <Route path="/admin/email" element={<SuperAdminLayout><EmailDelivery /></SuperAdminLayout>} />
                            <Route path="/admin/sms" element={<SuperAdminLayout><SmsDelivery /></SuperAdminLayout>} />
                            <Route path="/admin/job-alerts" element={<SuperAdminLayout><JobAlerts /></SuperAdminLayout>} />
                        </Route>
                        
                        {/* SAFE CATCH-ALL */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                    </Suspense>
                </BrowserRouter>
            </ChatProvider>
        </NotificationProvider>
    );
}

export default App;
