import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, Users,
    Briefcase, BarChart, Settings, LogOut,
    PanelLeftClose, PanelLeftOpen, ScrollText, Activity, Workflow, Mail, MessageSquare, Sparkles, UserPlus,
    Sun, Moon, Home } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { readSidebarCollapsed, publishSidebarCollapsed } from '../hooks/useSidebarCollapsed';
import SidebarTooltip from '../components/common/SidebarTooltip';

const SuperAdminSidebar = () => {
    const location = useLocation();

    // 🚨 RESTORED: Directly bind to the global authentication logout context
    const { logout } = useAuth();
    // Theme control — the Super Admin shell has no TopHeader, so the toggle lives in
    // the sidebar footer. Before this the portal had NO way to switch (or even apply)
    // a theme, because theme state used to live only in the job-seeker Sidebar.
    const { isDark, toggle } = useTheme();

    // Manual collapse/expand, persisted under the same key the job-seeker/PESO
    // sidebar uses so the choice stays consistent across the whole system.
    const [isCollapsed, setIsCollapsed] = useState(readSidebarCollapsed);
    // Persist AND broadcast so the layout shell widens page content in step.
    useEffect(() => {
        publishSidebarCollapsed(isCollapsed);
    }, [isCollapsed]);
    const isExpanded = !isCollapsed;

    // Grouped by responsibility (§ sidebar refactor): Overview · Governance ·
    // Operations · Insights. `divider` entries render as section headers.
    const navLinks = [
        { divider: 'Overview' },
        { name: 'Overview', desc: 'System-wide activity and platform health at a glance.', icon: <LayoutDashboard size={20} />, path: '/admin/dashboard' },
        { divider: 'Governance' },
        { name: 'User Management', desc: 'Manage every account, role, and suspension.', icon: <Users size={20} />, path: '/admin/users' },
        { name: 'Job Moderation', desc: 'Review, moderate, and remove posted vacancies.', icon: <Briefcase size={20} />, path: '/admin/jobs' },
        { name: 'Audit Trail', desc: 'Immutable log of administrative and security actions.', icon: <ScrollText size={20} />, path: '/admin/audit' },
        { divider: 'Operations' },
        { name: 'Platform Health', desc: 'Live status of services, workers, and dependencies.', icon: <Activity size={20} />, path: '/admin/health' },
        { name: 'Workflow Automation', desc: 'Monitor and replay the Make.com referral automation.', icon: <Workflow size={20} />, path: '/admin/automation' },
        { name: 'Email Delivery', desc: 'Transactional email outbox — monitor and resend.', icon: <Mail size={20} />, path: '/admin/email' },
        { name: 'SMS Delivery', desc: 'SMS outbox status and delivery monitoring.', icon: <MessageSquare size={20} />, path: '/admin/sms' },
        { name: 'AI Job Alerts', desc: 'Configure and monitor AI-matched job alerts.', icon: <Sparkles size={20} />, path: '/admin/job-alerts' },
        { name: 'Proactive Referrals', desc: 'Review AI-surfaced proactive referral candidates.', icon: <UserPlus size={20} />, path: '/admin/proactive' },
        { divider: 'Insights' },
        { name: 'Reports & Analytics', desc: 'Platform-wide reports and employment analytics.', icon: <BarChart size={20} />, path: '/admin/reports' },
    ];

    const renderLink = (link, idx) => {
        if (link.divider) {
            return (
                <div key={`div-${idx}`} className={`pt-4 pb-1.5 ${isExpanded ? 'px-4' : 'flex justify-center'}`}>
                    {isExpanded
                        ? <span className="text-[10px] font-black uppercase tracking-widest text-subtle">{link.divider}</span>
                        : <span className="w-4 h-px bg-line rounded-full" />}
                </div>
            );
        }
        const active = location.pathname === link.path;
        return (
            // ONE shared, viewport-clamped tooltip (portal) — contextual description on
            // hover/focus in both collapse states; label too when collapsed (icon-only).
            <SidebarTooltip
                key={link.path}
                label={link.name}
                description={link.desc}
                showLabel={!isExpanded}
            >
                <NavLink
                    to={link.path}
                    aria-label={!isExpanded ? link.name : undefined}
                    className={`relative flex items-center rounded-xl font-bold text-sm transition-all ${
                        active
                            ? 'bg-sunken text-content'
                            : 'text-muted hover:bg-sunken hover:text-content'
                    } ${isExpanded ? 'gap-3 px-4 py-3' : 'justify-center w-12 h-12 mx-auto'}`}
                >
                    <span className="shrink-0">{link.icon}</span>
                    {isExpanded && <span className="truncate">{link.name}</span>}
                </NavLink>
            </SidebarTooltip>
        );
    };

    return (
        <aside
            className={`hidden lg:flex flex-col h-screen sticky top-0 self-start bg-surface border-r border-line pt-6 transition-all duration-300 ${
                isExpanded ? 'w-64' : 'w-20'
            }`}
        >
            <div className={`mb-8 flex items-center ${isExpanded ? 'px-6 justify-between gap-2' : 'px-2 flex-col gap-2'}`}>
                {isExpanded ? (
                    <h2 className="text-2xl font-black text-content flex items-center gap-2 min-w-0">
                        <span className="w-8 h-8 shrink-0 rounded-xl bg-accent flex items-center justify-center text-accent-contrast text-sm">H</span>
                        <span className="truncate">Super Admin</span>
                    </h2>
                ) : (
                    <span className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-accent-contrast text-sm shrink-0">H</span>
                )}
                <button
                    onClick={() => setIsCollapsed((c) => !c)}
                    title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                    aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                    className="shrink-0 p-2 text-subtle hover:text-content hover:bg-sunken rounded-lg transition-all"
                >
                    {isExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                </button>
            </div>

            <nav className="flex-1 px-4 space-y-1 overflow-y-auto overflow-x-hidden">
                {navLinks.map(renderLink)}
            </nav>

            <div className="p-4 border-t border-line mt-auto space-y-2">
                <button
                    onClick={(e) => toggle(e)}
                    title={!isExpanded ? (isDark ? 'Light mode' : 'Dark mode') : undefined}
                    aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                    className={`group relative w-full flex items-center rounded-xl font-bold text-sm text-muted hover:bg-sunken transition-all ${
                        isExpanded ? 'gap-3 px-4 py-3 text-left' : 'justify-center w-12 h-12 mx-auto'
                    }`}
                >
                    <span className="relative w-5 h-5 shrink-0 inline-flex items-center justify-center">
                        <Sun size={20} className={`absolute transition-all duration-300 ${isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`} />
                        <Moon size={20} className={`absolute transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'}`} />
                    </span>
                    {isExpanded && <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
                    {!isExpanded && (
                        <span className="absolute left-14 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible transition-all whitespace-nowrap shadow-lg z-50 pointer-events-none">
                            {isDark ? 'Light mode' : 'Dark mode'}
                        </span>
                    )}
                </button>

                <NavLink
                    to="/admin/settings"
                    title={!isExpanded ? 'Settings' : undefined}
                    className={`group relative flex items-center rounded-xl font-bold text-sm text-muted hover:bg-sunken transition-all ${
                        isExpanded ? 'gap-3 px-4 py-3' : 'justify-center w-12 h-12 mx-auto'
                    }`}
                >
                    <Settings size={20} className="shrink-0" />
                    {isExpanded && <span>Settings</span>}
                    {!isExpanded && (
                        <span className="absolute left-14 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible transition-all whitespace-nowrap shadow-lg z-50 pointer-events-none">
                            Settings
                        </span>
                    )}
                </NavLink>

                {/* Home — the Super Admin shell has no TopHeader, so its Home control
                    lives here. Takes the admin to the public landing page without
                    logging out (the landing offers "Back to Dashboard"). */}
                <Link
                    to="/home"
                    title={!isExpanded ? 'Home' : undefined}
                    className={`group relative flex items-center rounded-xl font-bold text-sm text-muted hover:bg-sunken transition-all ${
                        isExpanded ? 'gap-3 px-4 py-3' : 'justify-center w-12 h-12 mx-auto'
                    }`}
                >
                    <Home size={20} className="shrink-0" />
                    {isExpanded && <span>Home</span>}
                    {!isExpanded && (
                        <span className="absolute left-14 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible transition-all whitespace-nowrap shadow-lg z-50 pointer-events-none">
                            Home
                        </span>
                    )}
                </Link>

                {/* 🚨 RESTORED: The Logout Action Button */}
                <button
                    onClick={() => logout()}
                    title={!isExpanded ? 'Logout' : undefined}
                    className={`group relative w-full flex items-center rounded-xl font-bold text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all ${
                        isExpanded ? 'gap-3 px-4 py-3 text-left' : 'justify-center w-12 h-12 mx-auto'
                    }`}
                >
                    <LogOut size={20} className="shrink-0" />
                    {isExpanded && <span>Logout</span>}
                    {!isExpanded && (
                        <span className="absolute left-14 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible transition-all whitespace-nowrap shadow-lg z-50 pointer-events-none">
                            Logout
                        </span>
                    )}
                </button>
            </div>
        </aside>
    );
};

export default SuperAdminSidebar;
