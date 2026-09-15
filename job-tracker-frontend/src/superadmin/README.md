# Super Administrator subsystem

Everything the Super Administrator uses lives here. Feature-based: each folder
under `features/` owns one responsibility and is named after that
responsibility, not after the framework role it plays.

```
superadmin/
  SuperAdminLayout.jsx      the /admin shell (sidebar + content, no TopHeader)
  SuperAdminSidebar.jsx     navigation for the shell
  features/
    overview/     PlatformOverview   platform metrics + activity feed
    accounts/     UserAccounts       account matrix, status changes
    moderation/   JobModeration      listing review and takedown
    reports/      PlatformReports    system reports
    settings/     SystemSettings     administrator settings
    health/       PlatformHealth     live dependency status board
    automation/   WorkflowAutomation Make.com automation dispatch monitor + replay
    email/        EmailDelivery      transactional email outbox monitor + resend
```

Note: the `verification/` feature (VerificationQueue) was **removed (2026-08-01)**
when Job Seeker Verification was decommissioned.

## Naming

`SuperAdmin*` / feature nouns, never bare `Admin*`. "Admin" is ambiguous in this
codebase: `peso_administrator` is a *different role* with a *different portal*,
and the stored role value for a Super Administrator is literally `'admin'`. A
component called `AdminDashboard` gave no clue which of the two it served —
there is also a `PesoAdminDashboard`.

## Routes

URL paths stay `/admin/*`. They are bookmarked, they appear in notification deep
links, and renaming them would break both for no user-visible gain. The *code*
is renamed; the *addresses* are not.

## What was removed in the restructure

Nine files, none of which did anything:

- `AdminHeader.jsx`, `DataTable.jsx`, `StatCard.jsx`, `AdminContext.jsx`,
  `useAuditLog.js`, `AdminLayout.jsx` — all **0 bytes**. `AdminLayout.jsx` was
  the most misleading: the real layout was declared inline in `App.jsx`, so
  anyone editing that file to change the admin shell would have edited an empty
  decoy and seen nothing happen.
- `adminApi.js` — imported by nothing. It duplicated `src/api.js` with a
  hardcoded `localhost:5000` base URL and a `localStorage` token fallback that
  `AuthContext` deliberately removed. Harmless while unused; a security and
  environment bug the moment someone reached for it.
- `AdminEmployerVerification.jsx`, `JobSeekerVerification.jsx` — not routed.
  (The `VerificationQueue` page that replaced them has since been removed too —
  Job Seeker Verification was decommissioned 2026-08-01.)

## Conventions this subsystem follows

Same as the rest of the app — it is not a special case:

- Page shell `p-3 sm:p-5 lg:p-6`, never `p-8`. Cards `p-4 sm:p-6`.
- Titles `text-2xl sm:text-3xl lg:text-4xl`.
- Faces render through `components/common/Avatar`, never initials.
- Wide tables inside `overflow-x-auto`.
- HTTP through `src/api.js`, which attaches the bearer token.
- Every screen defines its empty and degraded state.

## Security note

Reaching these routes requires the `admin` role, but that check is UX. Every
`/api/admin/*` endpoint re-checks the role server-side. Rendering this shell
grants nothing on its own.
