import React from 'react';
import SuperAdminSidebar from './SuperAdminSidebar';
import useSidebarCollapsed from '../hooks/useSidebarCollapsed';

/**
 * SUPER ADMINISTRATOR LAYOUT — the shell for every /admin route.
 *
 * WHAT: sidebar plus main content, for the Super Administrator only. The other
 * two roles use AppLayout in App.jsx.
 *
 * ── WHY IT DIFFERS FROM AppLayout ──────────────────────────────────────────
 * There is deliberately NO TopHeader here, which has one consequence worth
 * knowing: no notification bell. NotificationContext therefore skips its fetch
 * for this role — a request whose result nothing could render.
 *
 * The Super Administrator governs the platform rather than working inside it.
 * They are not an applicant receiving referral updates or an administrator being
 * messaged by applicants, so the per-user notification stream that AppLayout is
 * built around does not apply. Operational signals belong on the Platform
 * Overview and in the audit log, not in a bell.
 *
 * ── WHY THIS LIVES HERE AND NOT IN App.jsx ─────────────────────────────────
 * It was previously declared inline in App.jsx while an EMPTY
 * admin/layouts/AdminLayout.jsx sat in the tree looking like the real thing.
 * Anyone opening that file to change the admin shell would have edited a
 * zero-byte decoy and seen no effect. One definition, in the module it belongs
 * to.
 *
 * `sidebar-collapsed` is read from the same shared hook AppLayout uses, so the
 * collapse preference carries across both shells for a user who holds more than
 * one role over time.
 */
const SuperAdminLayout = ({ children }) => {
    const sidebarCollapsed = useSidebarCollapsed();

    return (
        <div className="flex min-h-screen bg-canvas transition-colors duration-300">
            <SuperAdminSidebar />
            <main className={`flex-1 w-full overflow-x-hidden ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                {children}
            </main>
        </div>
    );
};

export default SuperAdminLayout;
