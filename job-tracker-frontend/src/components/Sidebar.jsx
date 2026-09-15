/**
 * SIDEBAR — primary navigation for Job Seekers and PESO Administrators.
 *
 * WHAT: the role-aware link list, the unread message badge, and the
 * collapse/expand control.
 *
 * ── ONE COMPONENT, TWO LINK SETS ───────────────────────────────────────────
 * The role picks which array of links renders; the chrome is identical. Keeping
 * one component means a change to navigation styling cannot drift between the
 * two roles, and switching role does not restructure the page.
 *
 * The role is read through normalizeRole() — never compared to a raw string.
 * The stored value for a PESO administrator is 'peso_administrator', with
 * 'employer' surviving as a legacy alias, and a direct comparison against
 * either one silently renders the wrong menu.
 *
 * ── COLLAPSE IS MANUAL AND PERSISTED ───────────────────────────────────────
 * The state is stored in localStorage['sidebarCollapsed'] so it survives
 * navigation and reloads. Hover-to-expand was REMOVED deliberately: the sidebar
 * expanded whenever the pointer crossed it on the way somewhere else, which
 * reflowed the page under the user's cursor mid-click.
 *
 * Unlike the auth token, this is a durable UI preference with no security
 * meaning, which is why localStorage is right here and sessionStorage is right
 * there.
 *
 * ── THE MESSAGE BADGE ──────────────────────────────────────────────────────
 * Reads the unread count from ChatContext, so it updates live over the existing
 * socket. It does not open its own connection or poll — see ChatContext for why
 * there is exactly one socket in the app.
 */

import React, { useState, useEffect } from "react";
import { NavLink, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { readSidebarCollapsed, publishSidebarCollapsed } from "../hooks/useSidebarCollapsed";
import {
  LayoutDashboard,
  User as UserIcon,
  Briefcase,
  MessageSquare,
  Bookmark,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  FileText,
  Search,
  Building2,
  Users,
  FileCheck2,
  Sparkles,
  RefreshCw,
  Trash2,
  UserPlus,
  Home,
  CalendarDays,
} from "lucide-react";
import { normalizeRole, ROLE_KEYS, getRolePortalLabel } from "../utils/roles";
import NotificationBell from "./layout/NotificationBell";
import ThemeToggle from "./common/ThemeToggle";
import SidebarTooltip from "./common/SidebarTooltip";

// 🚨 ENHANCEMENT: Imported Official Government Identification Media
import pesoLogo from "../assets/PESO LOGO.jpg";

const Sidebar = () => {
  const { user, logout, features } = useAuth();
  const { unreadCount } = useChat() || { unreadCount: 0 };

  // Manual collapse/expand, persisted so the choice survives navigation.
  const [isCollapsed, setIsCollapsed] = useState(readSidebarCollapsed);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Theme is owned by ThemeContext (mounted app-wide in main.jsx) and surfaced in the
  // TopHeader + this sidebar's mobile bar via <ThemeToggle>. The sidebar body is
  // navigation-only now — it no longer holds theme state or the toggle buttons.

  // Persist AND broadcast, so the layout shell can widen page content in step
  // with the collapse animation (see hooks/useSidebarCollapsed).
  useEffect(() => {
    publishSidebarCollapsed(isCollapsed);
  }, [isCollapsed]);

  const isExpanded = !isCollapsed;
  const normalizedUserRole = normalizeRole(user?.role);

  // 🚨 REGRESSION GUARD: Strict Role-Based Access Mapping (Preserved completely)
  const getNavLinks = () => {
    const links = [];

    switch (normalizedUserRole) {
      case ROLE_KEYS.JOB_SEEKER:
        // Grouped by workflow so related actions sit together (§ sidebar refactor):
        // Overview · Jobs & Opportunities · Applications · Communication · Profile & Tools.
        links.push(
          { isDivider: true, label: "Overview" },
          {
            path: "/",
            label: "Dashboard Overview",
            desc: "Your activity, applications, and account snapshot at a glance.",
            icon: <LayoutDashboard size={20} />,
          },
          { isDivider: true, label: "Jobs & Opportunities" },
          {
            path: "/job-board",
            label: "Public Job Board",
            desc: "Browse and search verified local vacancies from PESO Kabankalan.",
            icon: <Search size={20} />,
          },
          {
            path: "/events",
            label: "Events & Job Fairs",
            desc: "Upcoming job fairs and employment events you can attend.",
            icon: <CalendarDays size={20} />,
          },
          {
            path: "/saved-jobs",
            label: "Saved Vacancies",
            desc: "Jobs you've bookmarked to revisit and apply to later.",
            icon: <Bookmark size={20} />,
          },
          { isDivider: true, label: "Applications" },
          {
            // The single authoritative applications module (2026-08-07 consolidation):
            // one unified view of every application — PESO vacancy submissions (with live
            // status, AI compatibility, referral letters) AND imported/external records.
            // Replaces the former split of "My Applications" (/jobs external Kanban) and
            // "PESO Applications" (/my-applications); /jobs now redirects here.
            path: "/my-applications",
            label: "My Applications",
            desc: "Track every application's status, AI match, and referral letters.",
            icon: <Briefcase size={20} />,
          },
          {
            path: "/referrals",
            label: "My Referrals",
            desc: "Referral letters PESO has issued for you and their outcomes.",
            icon: <FileCheck2 size={20} />,
          },
          { isDivider: true, label: "Communication" },
          {
            path: "/messages",
            label: "Messages",
            desc: "Chat with the PESO office about jobs and referrals.",
            icon: <MessageSquare size={20} />,
            badge: unreadCount,
          },
          {
            path: "/trash",
            label: "Trash",
            desc: "Recently removed items — restore them or let them auto-clear.",
            icon: <Trash2 size={20} />,
          },
          { isDivider: true, label: "Profile & Tools" },
          {
            path: "/profile",
            label: "Identity & Profile",
            desc: "Manage your résumé details, skills, and personal information.",
            icon: <UserIcon size={20} />,
          },
          {
            path: "/builder",
            label: "Resume Assistant",
            desc: "Build and refine your résumé, cover letters, and documents.",
            icon: <FileText size={20} />,
          },
        );
        break;
      case ROLE_KEYS.PESO_ADMINISTRATOR:
        // Grouped by workflow: Overview · Jobs & Events · Applicants & Referrals ·
        // Organization · Communication. The Walk-In item sits in Jobs & Events and
        // appears only when the feature is enabled.
        links.push(
          { isDivider: true, label: "Overview" },
          {
            path: "/peso-admin/dashboard",
            label: "Dashboard",
            desc: "Office activity, pipeline, and key employment metrics overview.",
            icon: <LayoutDashboard size={20} />,
          },
          { isDivider: true, label: "Jobs & Events" },
          // "Job Publication Management" is the single home for creating,
          // publishing, editing, archiving and monitoring vacancies. It replaces
          // the former separate "Managed Listings" and "Post Vacancy" items,
          // which pointed at the same authoring surface (create lives inside it).
          {
            path: "/peso-admin/jobs",
            label: "Job Publication Management",
            desc: "Create, publish, edit, and monitor job vacancies.",
            icon: <Briefcase size={20} />,
          },
          {
            path: "/peso-admin/events",
            label: "Event Announcements",
            desc: "Publish and manage job fairs and employment events.",
            icon: <CalendarDays size={20} />,
          },
          // Walk-In Registration (#7) — Manager only, shown when the feature is on.
          ...(features?.walkInRegistration ? [{
            path: "/peso-admin/walk-in",
            label: "Walk-In Registration",
            desc: "Register walk-in job seekers at the PESO office.",
            icon: <UserPlus size={20} />,
          }] : []),
          { isDivider: true, label: "Applicants & Referrals" },
          {
            path: "/peso-admin/ats",
            label: "Applicant Pipeline",
            desc: "Review applicants and move them through hiring stages.",
            icon: <Users size={20} />,
          },
          {
            path: "/referrals/recommended",
            label: "AI Recommended",
            desc: "AI-suggested candidate matches for your open vacancies.",
            icon: <Sparkles size={20} />,
          },
          {
            path: "/peso-admin/smart-referrals",
            label: "Smart Referral Queue",
            desc: "Prioritized candidates ready to endorse, grouped by vacancy.",
            icon: <UserPlus size={20} />,
          },
          {
            path: "/referrals",
            label: "Referral Register",
            desc: "All issued referrals, letters, and placement outcomes.",
            icon: <FileCheck2 size={20} />,
          },
          {
            path: "/referrals/failed",
            label: "Failed Referrals",
            desc: "Referrals that didn't reach the reporting system — replay them.",
            icon: <RefreshCw size={20} />,
          },
          { isDivider: true, label: "Organization" },
          {
            path: "/peso-admin/profile",
            label: "Organization Profile",
            desc: "Your PESO office's public identity and contact details.",
            icon: <Building2 size={20} />,
          },
          { isDivider: true, label: "Communication" },
          {
            path: "/messages",
            label: "Messages",
            desc: "Chat with job seekers about applications and referrals.",
            icon: <MessageSquare size={20} />,
            badge: unreadCount,
          },
        );
        break;
      case ROLE_KEYS.PESO_STAFF:
        // The limited co-worker portal: Job Publication Management ONLY. No
        // Dashboard, ATS, referral queues/register, or organisation profile —
        // those are Manager-only (server-enforced too). Home + account controls
        // live in the TopHeader / sidebar footer.
        links.push(
          {
            path: "/peso-admin/jobs",
            label: "Job Publication Management",
            desc: "Create, publish, and manage job vacancies.",
            icon: <Briefcase size={20} />,
          },
          {
            path: "/peso-admin/events",
            label: "Event Announcements",
            desc: "Publish and manage job fairs and employment events.",
            icon: <CalendarDays size={20} />,
          },
        );
        break;
      case ROLE_KEYS.SUPER_ADMINISTRATOR:
        links.push(
          {
            path: "/super-admin/dashboard",
            label: "Platform Analytics",
            desc: "System-wide usage, accounts, and platform health metrics.",
            icon: <LayoutDashboard size={20} />,
          },
          {
            path: "/super-admin/users",
            label: "Account Matrix",
            desc: "Manage every user account, role, and access level.",
            icon: <Users size={20} />,
          },
          {
            path: "/super-admin/jobs",
            label: "Listing Moderation",
            desc: "Review, approve, and moderate posted job vacancies.",
            icon: <Briefcase size={20} />,
          },
          {
            path: "/super-admin/reports",
            label: "System Reports",
            desc: "Generate platform and employment reports.",
            icon: <FileText size={20} />,
          },
        );
        break;
      default:
        break;
    }

    return links;
  };

  const portalSubLabel = getRolePortalLabel(normalizedUserRole);
  const navLinks = getNavLinks();

  return (
    <>
      {/* ═════════════════════════════ MOBILE OVERLAY ═════════════════════════════ */}
      <div className="md:hidden fixed top-0 left-0 w-full z-50 bg-surface/90 backdrop-blur-md border-b border-line p-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          {/* 🚨 ENHANCEMENT: Replaced Prototype Badge with Verified PESO Logo */}
          <img
            src={pesoLogo}
            alt="PESO Kabankalan Logo"
            className="w-10 h-10 rounded-full object-contain bg-white shadow-sm"
          />
          <span className="font-black text-xl tracking-tight text-content">
            PESO Kabankalan
          </span>
        </div>
        {/* The bell rides in the mobile bar because TopHeader is `hidden md:flex`.
            Without this, a phone user never saw new applications or referral
            alerts at all. Same component the desktop header mounts. */}
        <div className="flex items-center gap-1">
          {/* Home takes any authenticated role to the public landing page without
              logging out (the landing offers "Back to Dashboard"). Mirrors the
              desktop TopHeader button, which is `hidden md:flex` on phones. */}
          <Link
            to="/home"
            aria-label="Go to Home page"
            title="Home / Landing page"
            className="p-2 text-muted hover:bg-sunken rounded-lg transition-colors"
          >
            <Home size={20} />
          </Link>
          {/* Theme toggle rides here too — TopHeader (which owns it on desktop) is
              `hidden md:flex`, so a phone would otherwise have no way to switch. */}
          <ThemeToggle className="w-9 h-9" />
          <NotificationBell variant="bare" />
          <button
            onClick={() => setIsMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 text-muted hover:bg-sunken rounded-lg transition-colors border-none bg-transparent cursor-pointer"
          >
            <Menu size={24} />
          </button>
        </div>
      </div>

      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-[100] flex">
          <div
            className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileOpen(false)}
          />

          <div className="relative w-72 max-w-[80%] bg-surface h-full shadow-2xl flex flex-col animate-in slide-in-from-left duration-300">
            <div className="p-6 border-b border-line flex justify-between items-center bg-sunken/50">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  {/* 🚨 ENHANCEMENT: Mobile Drawer Structural Branding */}
                  <img
                    src={pesoLogo}
                    alt="PESO Logo"
                    className="w-10 h-10 rounded-full object-contain bg-white shadow-sm"
                  />
                  <span className="font-black text-xl tracking-tight text-content">
                    PESO Kabankalan
                  </span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-accent-text mt-2 pl-1">
                  {portalSubLabel || "Employment Platform"}
                </span>
              </div>
              <button
                onClick={() => setIsMobileOpen(false)}
                className="p-2 text-subtle hover:text-content hover:bg-sunken rounded-full transition-colors border-none bg-transparent cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-1.5 custom-scrollbar">
              {navLinks.map((link, idx) =>
                link.isDivider ? (
                  <div key={`div-${idx}`} className="pt-4 pb-2 px-3">
                    <span className="text-[10px] font-black uppercase text-muted tracking-widest">
                      {link.label}
                    </span>
                  </div>
                ) : (
                  <NavLink
                    key={link.path}
                    to={link.path}
                    onClick={() => setIsMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-4 px-4 py-3 rounded-xl font-bold text-sm transition-all ${
                        isActive
                          ? "bg-accent-soft text-accent-text shadow-sm"
                          : "text-muted hover:bg-sunken hover:text-content"
                      }`
                    }
                  >
                    {link.icon}
                    <span className="flex-1 truncate">{link.label}</span>
                    {link.badge > 0 && (
                      <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black min-w-[20px] text-center shadow-sm">
                        {link.badge}
                      </span>
                    )}
                  </NavLink>
                ),
              )}
            </nav>

            {/* Mobile drawer footer: settings, theme toggle, and logout — the same
                actions the desktop sidebar footer carries, previously unreachable on phones. */}
            <div className="p-4 border-t border-line space-y-1.5 bg-sunken/50">
              <NavLink
                to="/settings"
                onClick={() => setIsMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-4 px-4 py-3 rounded-xl font-bold text-sm transition-all ${
                    isActive
                      ? "bg-accent-soft text-accent-text"
                      : "text-muted hover:bg-sunken"
                  }`
                }
              >
                <Settings size={20} />
                <span className="flex-1 truncate">Account Settings</span>
              </NavLink>
              <button
                onClick={logout}
                className="flex items-center gap-4 px-4 py-3 w-full rounded-xl font-bold text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all bg-transparent border-none cursor-pointer"
              >
                <LogOut size={20} />
                <span className="flex-1 truncate text-left">Secure Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════ DESKTOP SIDEBAR ═════════════════════════════ */}
      <aside
        className={`hidden md:flex flex-col h-screen sticky top-0 self-start bg-surface border-r border-line transition-all duration-300 shadow-[4px_0_24px_rgba(0,0,0,0.02)] ${isExpanded ? "w-72" : "w-20"}`}
      >
        {/* Desktop Header Identity Block */}
        <div
          className={`h-24 flex items-center border-b border-line relative overflow-hidden bg-sunken/50 ${isExpanded ? "px-4 gap-2" : "flex-col justify-center gap-1.5 px-2"}`}
        >
          {/* 🚨 ENHANCEMENT: Clean, floating Government Identity Seal */}
          {/* Government seal — sized up for prominence. Stays responsive: it
              scales back when the rail is collapsed so it never crowds the
              icon-only column. */}
          <div className={`${isExpanded ? "w-14 h-14" : "w-11 h-11"} shrink-0 bg-white rounded-full flex items-center justify-center shadow-sm border border-line overflow-hidden transition-all duration-300`}>
            <img
              src={pesoLogo}
              alt="PESO Icon"
              className="w-full h-full object-contain"
            />
          </div>

          {isExpanded && (
            <div className="flex flex-col whitespace-nowrap min-w-0 flex-1">
              <span className="font-black text-xl tracking-tight text-content truncate">
                PESO Kabankalan
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-accent-text mt-0.5 truncate">
                {portalSubLabel || "Employment Platform"}
              </span>
            </div>
          )}

          <button
            onClick={() => setIsCollapsed((c) => !c)}
            className="shrink-0 p-2 text-subtle hover:text-content hover:bg-sunken rounded-lg transition-all border border-transparent hover:border-line"
            title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {/* Primary Interactive Routes */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-6 px-3 space-y-1.5 custom-scrollbar">
          {navLinks.map((link, idx) =>
            link.isDivider ? (
              <div
                key={`div-${idx}`}
                className={`pt-4 pb-2 transition-all duration-300 ${isExpanded ? "px-4" : "text-center"}`}
              >
                {isExpanded ? (
                  <span className="text-[10px] font-black uppercase text-muted tracking-widest">
                    {link.label}
                  </span>
                ) : (
                  <div className="w-4 h-px bg-line mx-auto rounded-full"></div>
                )}
              </div>
            ) : (
              // ONE shared, viewport-clamped tooltip (portal) for every item — shows
              // the contextual description on hover/focus in BOTH collapse states, and
              // the label too when collapsed (icon-only). Replaces the old collapsed-
              // only, label-only inline tooltip. The native `title` is dropped so the
              // browser tooltip can't double with ours; an `aria-label` keeps the
              // collapsed icon accessible.
              <SidebarTooltip
                key={link.path}
                label={link.label}
                description={link.desc}
                showLabel={!isExpanded}
              >
                <NavLink
                  to={link.path}
                  aria-label={!isExpanded ? link.label : undefined}
                  className={({ isActive }) =>
                    // No `overflow-hidden` here — nothing overflows the item now that
                    // the tooltip is portalled, but keep it clip-free for the badge.
                    `flex items-center p-3 rounded-xl font-bold transition-all relative ${
                      isActive
                        ? "bg-accent-soft text-accent-text shadow-sm border border-accent/20"
                        : "text-muted hover:bg-sunken hover:text-content border border-transparent hover:border-line"
                    } ${!isExpanded ? "justify-center w-12 h-12 mx-auto" : "gap-4 px-4"}`
                  }
                >
                  <div className="min-w-[20px] flex items-center justify-center relative">
                    {link.icon}
                    {!isExpanded && link.badge > 0 && (
                      <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-black ring-2 ring-surface">
                        {link.badge > 9 ? "9+" : link.badge}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <>
                      <span className="flex-1 truncate text-sm">
                        {link.label}
                      </span>
                      {link.badge > 0 && (
                        <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black min-w-[20px] text-center shadow-sm">
                          {link.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </SidebarTooltip>
            ),
          )}
        </nav>

        {/* Unified Footer Actions (theme toggle relocated to the TopHeader) */}
        <div className="p-4 border-t border-line space-y-2 transition-colors bg-sunken/50 backdrop-blur-md">
          <button
            onClick={logout}
            title={!isExpanded ? "Secure Logout" : undefined}
            className={`group relative flex items-center gap-4 p-3.5 w-full rounded-2xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all bg-transparent border-none cursor-pointer ${!isExpanded ? "justify-center px-0 w-14 h-14 mx-auto" : ""}`}
          >
            <div className="min-w-[20px]">
              <LogOut size={20} />
            </div>
            {isExpanded && (
              <span className="font-semibold text-sm truncate">
                Secure Logout
              </span>
            )}
            {!isExpanded && (
              <span role="tooltip" className="absolute left-14 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible transition-all whitespace-nowrap shadow-lg z-50 pointer-events-none">
                Secure Logout
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
