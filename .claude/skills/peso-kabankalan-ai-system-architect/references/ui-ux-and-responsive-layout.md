# PESO Kabankalan — UI/UX, Responsive Layout & Card System

**Addendum to `peso-kabankalan-ai-system-architect`. Not a replacement.**

The parent `SKILL.md` remains authoritative for architecture, data model, RBAC,
the referral outbox, migrations, and every non-negotiable in its §0. This file
extends it with the **presentation layer**: the design standards, responsive
rules, component ownership, and interaction patterns established during the
2026-07-19/20 development sessions (UI/UX, card organisation, Trash, analytics, and the data-contract fixes they surfaced).

Read this **in addition to** `SKILL.md` §10 (UI/UX conventions) whenever a task
touches a page shell, a card, a grid, a filter bar, a colour, or anything that
must behave differently on touch. Where this file and `SKILL.md` §10 overlap,
this file is the more specific and more recent statement; where they conflict on
architecture (not presentation), `SKILL.md` wins.

---

## 1. Design principles

These are the "why" behind everything below. When a new case is not covered,
decide by these.

| # | Principle | Consequence |
|---|---|---|
| 1.1 | **Content type dictates width, not consistency for its own sake.** | A form page and a card grid legitimately have different caps. Document the reason so the difference does not look accidental (§3). |
| 1.2 | **Neutral typography, colour as accent.** | Resting text is near-black; green is reserved for actions, icons, links, hover and active states (§2.2). |
| 1.3 | **Contrast is guaranteed by construction, not by inspection.** | Surfaces are pinned to known lightness bands and each declares its own ink, so an unreadable pairing cannot be introduced by accident (§6.3). |
| 1.4 | **Capability, not screen width, decides interaction affordances.** | Hover-revealed controls key off `(hover: hover)`, never a `md:` breakpoint — a touch tablet at 1024px is still a touch device (§7). |
| 1.5 | **One definition, many consumers.** | Shared card controls, palette, filters and sort live in one module; pages import them. A style that exists twice will drift. |
| 1.6 | **Layout must not depend on a maintained breakpoint list.** | Prefer `auto-fill/minmax` and capability queries over hand-written breakpoint ladders that silently rot (§4). |
| 1.7 | **Degraded and empty states are part of the design, not an afterthought.** | Every list surface defines "no data", "no results", and "loading" (§5.4). |

---

## 2. Design system foundations

### 2.1 Colour

The board's earlier "Radiant Fields" experiment was **deliberately reduced** to a
restrained accent system after review. The current state:

| Token | Value | Use |
|---|---|---|
| **Deep Green** | `#4F7942` | Primary actions, icons, links, focus rings, active states. 5.07:1 on white and under white text — safe both ways. |
| **Deep Green (hover)** | `#3E6234` | Solid-button hover. |
| **Mint** | `#A8D5BA` | Dark-mode counterpart of Deep Green for icons/text. |
| **Ink** | `text-gray-900` / `dark:text-white` | All headings and card titles. |
| **Secondary text** | `text-gray-500` / `dark:text-gray-400` | Company lines, meta, subtitles. |
| **Vibrant Gold** | `#FFD700` | **One** highlight only: the active category chip's count badge. Never text on a light surface (1.6:1). |
| Legacy PESO green | `#1a4a38` / `#99e742` | **Retired from the redesigned pages.** Still present elsewhere in the system (sidebar, chatbot, landing). Do not reintroduce on the pages in §9. |

**Rule:** if it is resting typography, it is neutral. If it is an action, an
icon, a hover, or an active indicator, it may be Deep Green.

### 2.2 Typography

- Page title: `text-2xl sm:text-3xl font-black tracking-tight text-gray-900`
  (wide-canvas pages may use `text-3xl sm:text-4xl`).
- Page subtitle: `text-sm font-medium text-gray-500`, `mt-1`.
- Card title: `text-sm sm:text-base font-black text-gray-900`, `line-clamp-2`.
- Card secondary: `text-xs font-semibold text-gray-500`, `line-clamp-1`.
- Section label / column header: `text-[11px] font-black uppercase tracking-wider text-gray-500`.
- Never use gradient-clipped text (`bg-clip-text`) for headings — removed
  system-wide in this session.

### 2.3 Elevation, radii, spacing

| Property | Value |
|---|---|
| Card radius | `rounded-3xl` (grid cards) · `rounded-xl` (Kanban cards) · `rounded-2xl` (controls, popovers) |
| Card shadow (rest) | `shadow-[0_2px_10px_rgba(15,23,42,0.05)]` |
| Card shadow (hover) | `shadow-[0_10px_28px_rgba(15,23,42,0.10)]` + `hover:-translate-y-1` |
| Control shadow | `shadow-[0_1px_4px_rgba(15,23,42,0.04)]` |
| Border (neutral) | `border-gray-200/80 dark:border-gray-700/60` |
| Page padding | `p-3 sm:p-5 lg:p-6` (never `p-8`) |
| Card padding | `p-4` (compact grid) · `p-5 sm:p-6` (panels) |
| Grid gap | `gap-4 sm:gap-5` or `gap-5 sm:gap-6` |
| Transition | `transition-all duration-300 ease-out` (cards) · `transition-colors` (buttons) |

**No gradients on cards or headings.** Gradients survive only on the landing
page and mascot backdrop, which are marketing surfaces.

---

## 3. Page width taxonomy & sidebar responsiveness

### 3.1 The three width classes

Width is chosen by **content type** (principle 1.1):

| Class | Cap | Pages | Rationale |
|---|---|---|---|
| **Form-first** | `max-w-5xl` (1024px) | Identity & Profile | A handful of inputs stretched across a wide monitor is oversized and hard to scan. Deliberately **outside** the widening rule — it stays put in both sidebar states. |
| **Wide canvas** | `max-w-7xl` (see §3.2) | Public Job Board, Saved Vacancies, My Referrals, Referral Register, Job Publication Manager, My Applications (Kanban) | Grids, boards and column-based lists convert every pixel into another visible column or more room per column. |

> **Width follows the CONTENT PRIMITIVE, not the page's job.** Saved Vacancies
> and My Referrals were initially capped narrow (5xl/6xl) because their *first*
> implementations used large cards and a fixed 2-column grid — extra width just
> stretched a few tiles. Once both moved to compact cards on an `auto-fill` grid,
> extra width started adding **columns** instead, so they were promoted to the
> wide-canvas class. The lesson: re-evaluate the cap whenever a page's grid
> primitive changes. A page only deserves a narrow cap if extra width would
> stretch its content rather than multiply it.

### 3.2 Sidebar-aware widening (`max-w-7xl` only)

`AppLayout` / `AdminLayout` stamp `sidebar-collapsed` onto `<main>` when the
sidebar is collapsed. `index.css` then widens **only `.max-w-7xl`**:

```css
main .max-w-7xl { transition: max-width 300ms ease; }

@media (min-width: 1280px) {
  main .max-w-7xl                   { max-width: 1536px; }  /* expanded  */
  main.sidebar-collapsed .max-w-7xl { max-width: 1740px; }  /* collapsed */
}
```

**The 204px delta is deliberate**: it equals the sidebar's own expanded→collapsed
delta (288px → 80px). The shell therefore absorbs exactly the width the sidebar
releases, keeping side gutters visually identical between states (~28px vs ~30px
measured at 1920px). Toggling never shifts the page's sense of balance.

Guarded to `≥1280px` because below that the shell is already fluid — widening
would be a no-op. The transition matches the sidebar animation and is disabled
under `prefers-reduced-motion`.

**Consequences for new pages:**
- Want sidebar-aware widening? Use `max-w-7xl`.
- Want a fixed compact shell? Use `max-w-5xl` / `max-w-6xl` — these are
  intentionally *outside* the rule and stay put in both sidebar states.
- Never add a second widening rule for another cap without also re-deriving the
  delta, or the equal-gutter property breaks.

### 3.3 Collapse state plumbing

`hooks/useSidebarCollapsed.js` is the single read-side.

- Sidebars persist **and broadcast** via `publishSidebarCollapsed()`.
- **Why a custom event:** the native `storage` event only fires in *other* tabs,
  so a same-tab toggle would never notify the layout. The hook also listens to
  `storage` so multiple tabs stay in sync.
- Storage access is `try/catch`-wrapped — private mode degrades to "expanded"
  rather than throwing.
- **Never** write `localStorage['sidebarCollapsed']` directly; that bypasses the
  broadcast and desynchronises the layout.

---

## 4. Responsive grid patterns

### 4.1 Fluid card grids (preferred)

```jsx
<div className="grid gap-4 sm:gap-5 auto-rows-fr
                grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
```

- `auto-fill/minmax` picks the column count from available space — **no
  breakpoint ladder to maintain** (principle 1.6), and it automatically benefits
  from the sidebar widening in §3.2.
- `min(<floor>,100%)` is **mandatory**: without it the floor overflows viewports
  narrower than the floor.
- `auto-rows-fr` equalises row heights so cards in a row match regardless of
  content length.

**Floors in use:** `240px` (Saved Vacancies, Referrals tiles) · `320px` (Job
Publication Manager) · `340px` (Public Job Board).

### 4.2 Equal-height cards

Grid stretch alone is not enough — the card must opt in:

```jsx
<div className="h-full min-h-[480px] flex flex-col">   {/* card */}
  …
  <div className="mt-auto">…footer…</div>              {/* pins to bottom */}
</div>
```

`h-full` + `auto-rows-fr` gives equal heights; `min-h` holds the design target
when a row is sparse; `line-clamp-*` stops long text from bloating a card.

### 4.3 Horizontal scrollers

Carousels/rows use native scroll with `overflow-x-auto custom-scrollbar`.
Scroll-snap (`snap-x`/`snap-start`) is appropriate for **carousels only** — see
§8.2 for why it must never be used on a filter bar.

**Single-event carousel** (LandingPage PESO Events, dev-history §45 — SUPERSEDES the
earlier two-row shelf of §34/§38). One hero slide at a time (`LandingEventSlide`), the
uploaded `banner_image` as the primary visual with a bottom scrim; a GPU `translateX`
track (`flex` of `basis-full` slides, `transition-transform duration-700`) autoplays
right→left, with **dynamic pagination dots** (one `role="tab"` per published event),
hover-revealed prev/next arrows (§7 `.reveal-on-hover` — so they are always visible on
touch), touch swipe, and full ARIA (`role="region" aria-roledescription="carousel"`;
each slide `role="group" aria-roledescription="slide"` + `aria-label="N of M: title"`,
inactive slides `aria-hidden` with `tabIndex=-1` so focus never lands behind them).
Autoplay pauses on hover / focus-within, resets its timer on any manual nav (keyed on
`index`), and is disabled under `prefers-reduced-motion` (which — via the global
index.css rule — also collapses the slide transition to 0). Edge cases: **1 event** →
static hero, no autoplay/arrows/dots (`single = count <= 1`); **0 events** → the section
renders its purposeful empty state instead (the carousel is never mounted).

**Infinite loop (§45.5) — clone technique.** The track is `[cloneOfLast, ...events,
cloneOfFirst]`; `pos` (extended index) starts at 1, and a real slide i lives at `pos i+1`.
Moving onto a **clone** (pos 0 or count+1) animates FORWARD in-direction, then a JUMP with
the transition momentarily OFF resets `pos` to the clone's real twin (0→count, count+1→1) —
so last→first and first→last never show the old modulo-`translateX(-index*100%)` REWIND. Two
hard-won rules: the clone→real jump is **`setTimeout(SLIDE_MS+40)`-driven, NOT `transitionend`**
(a concurrent React re-render retargets the transform so the event never fires → `pos` runs
away), and the transition is re-enabled with **`setTimeout(30)`, NOT `requestAnimationFrame`**
(rAF is paint-gated, so a backgrounded/non-painting tab would leave the carousel stuck with
the transition off). Dots/ARIA read `realIndex = ((pos-1)%count+count)%count` (correct on the
clone frame); autoplay and manual nav share one `step()`. Do NOT revert to a modulo transform
or a transitionend/rAF snap.

**Poster quality & framing (§45.4).** The poster is the primary visual, so it must stay
SHARP and never be cropped or distorted: render it with **`object-contain`** over a
**blurred, scaled copy of itself** as a backdrop (`object-cover scale-110 blur-2xl
opacity-50`) — portrait A4 posters and landscape banners both display in FULL and the
frame never looks empty. The frame is deliberately tall (`h-[24rem] sm:h-[30rem]
lg:h-[34rem]`) — not a small strip. **Never `object-cover` (crops posters) and never a
raster hover `scale` on the poster** (upscaling interpolates → blur); the subtle zoom
lives only on the blurred backdrop. Banners are base64-in-DB (§41) and uploaded via
`PesoEventManager.fileToBannerDataUrl` (keeps the original verbatim when ≤2000px & under
the store cap, else 2000px/q0.92 with a white matte — do NOT restore the old destructive
1000px/q0.82 downscale). True retina/responsive `srcset` needs R2 (deferred §41 phase).

> The 2026-08 owner directive "strictly two-row, no arrows/dots/autoplay" (§34/§38)
> was **deliberately reversed** by the 2026-09 owner request for a premium single-event
> carousel. Same data source (`GET /api/events?scope=upcoming&limit=12`, banner always
> included) — a presentation refactor only; the shelf's edge-fade affordance (old §38 C2)
> is gone with the shelf. Do NOT restore the two-row shelf.

---

## 5. The card system

### 5.1 Anatomy (grid card)

```
┌─────────────────────────────┐
│ media band (fixed h-44)     │  optional; fixed so all content starts at same y
├─────────────────────────────┤
│ icon/avatar   [controls]    │  controls: pin · colour · destructive
│ Title (line-clamp-2)        │  text-gray-900 font-black
│ Company (line-clamp-1)      │  text-gray-500
│ meta chips (wrap)           │  location · setup · openings
│ description (line-clamp-3)  │  optional
│ ── mt-auto ──────────────── │
│ salary / deadline           │
│ ── divider ──────────────── │
│ hint            [CTA]       │
└─────────────────────────────┘
```

### 5.2 States

| State | Treatment |
|---|---|
| Rest | neutral border, soft shadow |
| Hover | lift `-translate-y-1`, deeper shadow, border → `#4F7942`/35, image `scale-105`, title → Deep Green (untinted cards only) |
| Pinned | border → `#4F7942`/40 (untinted only; a coloured card keeps its own border) |
| Labelled | full-surface tint — see §6 |
| Filled/complete | neutral dark badge `bg-slate-900/85 text-white` |
| Focus | `focus-visible:ring-2 ring-[#4F7942] ring-offset-2` on every interactive element |

### 5.3 Vacancy-state labels

Use the shared helpers from `jobs/JobCard.jsx` — never re-derive locally:

- `isJobFilled(job)` — status `Filled`/`Closed` **or** `referred_count >= positions_available` (count wins over flag).
- `filledLabel(job)` — **"Vacancy Filled"** (1 position) / **"Vacancies Filled"** (many).

### 5.4 Required empty/degraded states

Every list surface defines three: **no data at all**, **no results for the
current filters** (with a "Clear filters" action), and **loading**. Standard
empty-state block:

```jsx
<div className="text-center py-20 bg-white/70 rounded-3xl border border-gray-200/70 shadow-sm">
  <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl
                   bg-gray-100 border border-gray-200 mb-4">
    <Icon size={30} className="text-[#4F7942]" />
  </span>
  <h3 className="text-xl font-black text-gray-900">…</h3>
  <p className="text-gray-500 mt-1 font-medium">…</p>
</div>
```

### 5.5 Layout-preserving card skeletons (2026-09)

A loading skeleton must mirror the STRUCTURE, DIMENSIONS, and RESPONSIVE GRID of the
content it replaces, so nothing reflows when data arrives (principle 1.7 + no CLS).

`components/Skeleton.jsx` has **two** card-skeleton families — use the one that matches the
real card:

- **`SkeletonJobCard` / `SkeletonCardGrid`** — the **media-band** card (144px banner + `p-5`,
  **300px** grid floor). Used by the Public Job Board and PESO Dashboard (their cards show a
  featured image). Leave these alone.
- **`SkeletonCompactCard` / `SkeletonCompactCardGrid`** — the **compact** card (NO media band,
  `p-4`, a 40px icon tile + two control dots, a status/source pill, a two-line title, a company
  line, bordered meta chips, a `pt-2.5 border-t` footer; **240px** grid floor). Used by **Saved
  Vacancies** and **My Applications**, which share the same card shell (§9, `cardTheme`).

The compact skeleton's box model (`h-full min-h-[180px] rounded-3xl border` + inner `p-4 flex
flex-col`) and its grid (`auto-fill / minmax(min(240px,100%),1fr)`, `auto-rows-fr`) are
**identical** to the real card + grid, so the column count matches at every breakpoint
(desktop → mobile) and the grid lands in place on load.

**Rules:**
- A card-based module's skeleton reuses the module's own grid className (or the matching
  `Skeleton*CardGrid`) — never a hand-rolled placeholder with different dimensions. **My
  Applications** reuses its `CARD_GRID` constant + `SkeletonCompactCard` so the two can't drift.
- Skeleton the surrounding chrome too when it shifts the grid: **Saved Vacancies** also
  skeletons its filter bar + status tabs so the grid doesn't jump down when they appear (that
  jump existed before). **My Applications** already skeletons its header + KPI strip + filters.
- Card count fills a typical first viewport (~8) — enough to cover the visible area without an
  over-long shimmer.
- Adding a new compact card-based module? Reuse `SkeletonCompactCard(Grid)`; only add a new
  skeleton family when a genuinely different card shape (e.g. a new media band) appears.
- **Page-specific structural skeleton (§48):** a form/layout page whose structure is unique (not a
  card grid) gets its OWN skeleton that mirrors that structure, not a generic `SkeletonForm`.
  **`SkeletonProfile`** does this for **Identity & Profile** — it reproduces the real `Profile.jsx`
  layout (header; 12-col grid = left summary card with avatar circle/name/buttons/Basic-Info +
  right column with the Profile-Strength card and the tabbed form card of labelled field rows),
  with the same `max-w-5xl` shell and `rounded-3xl border bg-surface/60` card box model, so nothing
  reflows on load. Keep it in structural sync with the page if the columns/cards change.

---

## 6. Pinning & colour labels

Shared feature across **Saved Vacancies** and **My Applications (Kanban)**.

### 6.1 Data model (migration 015)

Both `saved_jobs` and `usertrackedjobs` carry:

| Column | Type | Meaning |
|---|---|---|
| `is_pinned` | `BOOLEAN NOT NULL DEFAULT FALSE` | Pin-to-top priority |
| `color_label` | `VARCHAR(20) NULL` | Palette **key** (`'teal'`), never a hex |

**Why the key, not a hex:** the UI owns the colours, so light/dark variants can
be retuned without a data migration, and an unknown key degrades to "no label"
instead of injecting arbitrary CSS.

### 6.2 API contract

`PATCH /api/saved-jobs/:jobId/preferences`
`PATCH /api/tracked-jobs/:id/preferences`

- **True PATCH semantics** — only keys present in the body are written, so the
  pin toggle and colour picker never clobber one another.
- Colour keys validated server-side against an allow-list; unknown → `400`.
- Ownership enforced by `user_id` in the `WHERE` clause.
- Both `GET`s order `is_pinned DESC` first.

### 6.3 Contrast model (the important part)

Each colour declares its **own ink** alongside its surface, so text colour is
*data*, not a guess at call sites. Contrast is guaranteed **by construction**:
every surface sits in a known lightness band — `200` in light mode, `900/45%` in
dark — so dark ink always clears AA on light and light ink always clears it on
dark.

**Measured (light mode, surface-200 vs ink-950):**

| Colour | Ink | Muted | Colour | Ink | Muted |
|---|---|---|---|---|---|
| Red | 11.1:1 | 7.0:1 | Blue | **10.5:1** | 6.1:1 |
| Amber | 12.0:1 | 6.9:1 | Purple | 11.0:1 | 6.7:1 |
| Green | 11.8:1 | 6.8:1 | Pink | 10.9:1 | 6.8:1 |
| Teal | 11.5:1 | 6.5:1 | Gray | 14.5:1 | 8.3:1 |

Worst case **10.5:1** — AAA, versus the 4.5:1 AA requirement. Meta chips
(`bg-white/70` over tint) measure ~14:1.

**Adding a colour:** declare `surface`, `border`, `ink`, `inkMuted`, `swatch`,
`ring` in `COLOR_LABELS`, and add the key to the server allow-lists in
`savedJobRoutes.js` and `trackedJobRoutes.js`. If the new surface is genuinely
dark, declare light ink on that row — no call-site changes needed.

### 6.4 Surface tokens

- **Surface** `<colour>-200` (light) / `<colour>-900/45` (dark) — vibrant, not pale.
- **Border** one step above the surface (`300`) for a crisp edge.
- **Swatch** `400` — a step more saturated than the card so picker dots stay
  distinguishable at 24px.
- **Chips on a tint** `bg-white/70 dark:bg-black/20 border-black/5` — translucent,
  so one token works on *every* tint with no per-colour chip variants.
- Colour applies to the **entire card**, never a thin stripe (a stripe reads as
  decoration, not classification).

### 6.5 Pinning semantics

- `pinnedFirst(items)` — stable sort, pinned first, existing order otherwise.
- **In the Kanban, pinning is scoped to the card's own column.** Pinning is a
  priority cue, never a status change; a pinned card must never move between
  stages.
- Writes are **optimistic with rollback**: the card updates instantly, reverting
  to server truth on failure, so organising never feels laggy but cannot
  silently diverge from the database.

### 6.6 Multi-select (Saved Vacancies + My Applications)

One state machine in `jobs/useMultiSelect.js`, two entry points:

- **Desktop** — checkboxes (`SelectCheckbox` in `jobs/SelectionBar.jsx`); ticking
  one enters select mode. **The tick must call `ms.selectMode ? ms.toggle(id) :
  ms.enterWith(id)`** — plain `ms.toggle` never sets `selectMode`, so the toolbar
  (gated on `selectMode`) never appears (a real bug, fixed 2026-08-07). "Select all"
  is desktop-only: on touch it would sit one mis-tap away from Delete in a small toolbar.
- **The toolbar is the SHARED `BulkActionBar` + `BulkDeleteButton`** (both in
  `common/AdminUI`), used by BOTH Saved Vacancies and My Applications — ONE Bulk Actions
  design language (2026-08-07). The old delete-only `SelectionBar` shell was retired;
  only `SelectCheckbox` remains in `jobs/SelectionBar.jsx`. Do NOT reintroduce a second
  bulk toolbar — add bulk actions as children of `BulkActionBar`.
- **Touch** — **long-press 500ms** enters select mode and selects that card;
  further taps toggle. The gesture carries a **10px movement tolerance** (a
  scroll must never read as a press), fires `navigator.vibrate(35)` as its only
  feedback, and exposes `consumedLongPress()` so the click the browser fires
  afterwards can be swallowed instead of also opening the card.

Rules that must hold:

- Selection operates on **visible (filtered) rows only** — "Select all" can
  never sweep in items the user has filtered away.
- The selection key is the id the trash API expects (`saved_jobs.id`, aliased
  `saved_id` — NOT the vacancy id that `pj.*` also returns).
- **Kanban: dragging is disabled while selecting** (`isDragDisabled`) — a
  press-and-move would be ambiguous, and dragging a multi-selection is
  undefined. And `onDragEnd`'s index maths must use the SAME `pinnedFirst`
  ordering as render, or drops land in the wrong slot.
- Deselecting the last item exits select mode — never strand an empty toolbar.

### 6.7 Soft-delete Trash (7-day retention)

Migration 018: `deleted_at` on `saved_jobs` + `usertrackedjobs`, a
`(user_id, deleted_at)` index serving BOTH access paths, and — latent bug fix —
`UNIQUE (user_id, job_id)` on saved_jobs (the save endpoint's `INSERT IGNORE`
had no constraint to ignore against, so it silently duplicated; it is now a real
upsert whose `ON DUPLICATE KEY UPDATE deleted_at = NULL` **revives** a trashed
save instead of inserting a sibling row).

**The commit-first Undo contract** (`jobs/useTrashAction.js`): the soft delete
is written to the DB **before** the Undo toast shows, and Undo restores. Holding
the delete client-side until a toast expires loses the operation if the tab
closes — same user-visible behaviour, but Trash is the durable end state. The
toast itself uses `notify.action(title, msg, { label, onClick })` (8s window).

`routes/trashRoutes.js` is ONE router parameterised by `:type` over a frozen
`TYPE_MAP` allow-list (type never interpolates into SQL). Retention is enforced
by **lazy purge on every read** — no scheduler, and an unpurged expired row is
invisible (live lists filter `deleted_at IS NULL`) rather than incorrect.
Permanent delete guards on `deleted_at IS NOT NULL`: it can only destroy what is
already in Trash. Dialog/toast nouns are explicit singular/plural pairs
("Vacancy/Vacancies") — naive `+"s"` renders "vacancys".

The Trash page (`Trash.jsx`, `/trash`) shows both sources **categorised by
origin** — origin determines where Restore puts an item back, so hiding it would
make the action unpredictable. `days_left` is computed server-side; the UI never
re-derives the policy.

---

## 7. Input-capability accessibility (mobile action controls)

**The defect class:** `opacity-0 group-hover:opacity-100` (and its dimmed cousin
`opacity-45 hover:opacity-100`) makes controls unreachable on touch, because a
touch device has **no hover state at all**. This shipped twice in one session —
once for hidden controls, once for dimmed ones on coloured cards.

**The fix — capability queries, not breakpoints** (principle 1.4):

```css
.reveal-on-hover { opacity: 1; }        /* hidden-style controls  */
.dim-until-hover { opacity: 1; }        /* dimmed-style controls  */

@media (hover: hover) and (pointer: fine) {
  .reveal-on-hover { opacity: 0; }
  .dim-until-hover { opacity: 0.45; }

  .group:hover .reveal-on-hover,
  .group:focus-within .reveal-on-hover,
  .reveal-on-hover:focus-visible { opacity: 1; }

  .group:hover .dim-until-hover,
  .group:focus-within .dim-until-hover,
  .dim-until-hover:hover,
  .dim-until-hover:focus-visible { opacity: 1; }
}
```

**Why not `md:opacity-0`:** a touch tablet in landscape at 1024px is
"desktop-width" but still cannot hover — a breakpoint fix leaves it broken.
`(hover: hover) and (pointer: fine)` targets the actual condition.

`:focus-within` / `:focus-visible` are included so the controls are keyboard
reachable — previously they were pointer-only even on desktop.

**Rule:** any control that hides or dims at rest **must** use one of these two
classes. Never hand-roll `opacity-0 group-hover:*` again.

---

## 8. Navigation & filter patterns

### 8.1 Category chips (Public Job Board)

**Full-width flex-wrap** (§71, SUPERSEDES the earlier 3-row horizontal-scroll
design). Chips flow left-to-right across the ENTIRE module content width and wrap
onto new rows; they never cluster on the left with dead space on the right:

```jsx
<div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Filter jobs by category">
  {/* inline <button> chips, shrink-0 so they keep natural size and wrap, never stretch */}
```

- `shrink-0` on each chip → chips keep their natural size and DISTRIBUTE by
  wrapping, not by stretching individual buttons (an `auto-fit`/`auto-fill` grid
  that stretched chips is explicitly NOT wanted).
- On desktop the row fills the container edge-to-edge; on narrow screens the chips
  wrap to more rows — no `overflow-x`, so no horizontal scroll and no clipping.
- This matches the Landing's `LandingCategorySelector` (§65) so the two category
  controls read the same.

### 8.2 (retired) Scroll-position contract

The old `CategoryChips` horizontal-scroll track needed a scroll-position contract
(inline buttons + no scroll-snap + `scrollIntoView` on the clicked chip) so a
far-right selection didn't fling the track back to the start. **§71 removed the
scroll track entirely** (full-width wrap, above), so that contract no longer
applies to `CategoryChips` — every chip is always laid out and visible, and
selecting one cannot move the viewport. (The inline-`<button>` / no-nested-component
practice is still generally good for any list that reconciles in place, but it is
no longer load-bearing here.)

### 8.2.1 Sidebar navigation tooltips (`components/common/SidebarTooltip.jsx`, §72)

The ONE contextual helper tooltip for every role-based sidebar (Job Seeker, PESO
Admin, PESO Staff, the `employer` alias → PESO Admin, and the Super Admin portal).
Wrap a nav item; on hover OR keyboard focus it shows a concise `description` of what
the module is for — plus the `label` as a bold title line only when the rail is
COLLAPSED (icon-only). One reusable component; per-item copy is just a `desc` string
on each nav entry — never per-item tooltip markup.

- **Portal + `position: fixed`, measured from the item rect.** The sidebar navs use
  `overflow-x-hidden`, which clips a normally-positioned tooltip. Rendering into
  `document.body` with fixed coords escapes every overflow/stacking ancestor and lets
  the bubble be CLAMPED to the viewport (vertically centred on the item, opens right,
  flips left only if the right edge would overflow). `pointer-events-none` so it never
  intercepts a nav click or flickers as the cursor moves within the item.
- **Design-system surfaces, NOT a black bubble.** Same elevated-surface tokens as the
  dropdowns/cards: `bg-raised` + `border border-line` + `shadow-raised` + `rounded-xl`,
  text in `text-content` (label / expanded description) and `text-muted` (collapsed
  secondary line) — themes in light AND dark. Label `text-base`, description `text-sm`.
- **Motion = the dropdown language** (`dropdownMotion.js`): fade + a subtle 6px slide,
  **200ms ease-out**, on BOTH appear and disappear (mount → double-rAF → shown; hide
  keeps it mounted ~210ms for the exit); reduced-motion aware.
- **Accessibility/behaviour:** `onFocus`/`onBlur` give keyboard parity; the native
  `title` was dropped (so the browser tooltip can't double with ours) and an
  `aria-label` added on collapsed icon-only items. Does not touch collapse/expand,
  clicks, or the mobile drawer (touch — no hover; labels already shown there). Footer
  actions (logout/settings/theme/home) keep their existing label-only tooltips.

### 8.3 Shared filter bar theming

`jobs/JobFilterBar.jsx` is shared by the Public Job Board, Job Publication
Manager and Saved Vacancies. Styling is **opt-in** via `variant`:

- `variant="default"` — original glassy styling (currently unused; kept as a
  fallback).
- `variant="radiant"` — the current neutral surfaces with Deep Green
  focus/hover accents. All three consumers pass this.

**Padding hazard:** the base control class carries **no `padding-left`**. Callers
add their own (`pl-3.5` plain, `pl-10` when a leading icon sits inside). Baking a
default in meant the sort select carried both `pl-3.5` and `pl-10`; Tailwind
emits equal-specificity rules, and when the shorter one won, "Newest first"
rendered *underneath* its own icon and read as a stray glyph. **Never put a
padding utility in a shared class that callers also set.**

### 8.4 Document-library pattern (My Referrals / Referral Register)

Referrals are PDFs, so they render as a **file explorer**, not cards:

- Toolbar: search · status filter · sort · list⇄grid toggle · result count.
- List view: column headers `DOCUMENT | REFERENCE | STATUS | DATE | LETTER`,
  file icon, monospace reference, status pill, date, Open action.
- Mobile: `md:contents` dissolves the meta wrapper into grid columns on desktop
  while keeping a single wrapped meta row on phones.
- **One source of truth for status**: `deliveryState()` feeds *both* the status
  pill and the status filter, so a row can never render "Delivered" while being
  excluded by the "Delivered" filter. Status options list only states that
  actually occur, with counts.

### 8.5 Persisted view preferences & flicker-free hydration

The Referrals list⇄grid toggle is the reference implementation for any durable
per-user UI preference.

**Storage** — `user_ui_preferences (user_id, pref_key, pref_value)` behind
`GET/PUT /api/preferences[/:key]`, with keys AND values validated against
server-side allow-lists. One narrow key/value table absorbs future preferences
with no further production DDL. (It is `user_ui_preferences`, not
`user_preferences`, because a dead legacy table already owned that name and
`CREATE TABLE IF NOT EXISTS` matched on the NAME ONLY and silently did nothing —
see the pitfalls table.)

**Flicker-free restore requires TWO layers** — each alone has a gap:

1. **Synchronous localStorage mirror**, read inside `useState(initFn)`, so a
   returning user's layout is correct on the very first render — no
   list→grid flash. The DATABASE stays authoritative (survives new devices);
   the mirror is refreshed on every server read and user change, so it can lag
   at most one session.
2. **Hydration gate** — content and toolbar render only when
   `!(loading || !viewReady)`. Covers the no-cache first visit on a new device;
   both requests run in parallel, so the gate costs nothing beyond the slower
   of the two. The toolbar must be gated too: its toggle shows an ACTIVE state
   that would otherwise highlight the wrong option for a frame.

Also: gate the first **save** on `viewReady`, or the seeded default gets
written back over the user's stored choice on every mount. Storage access is
try/catch-wrapped; private mode degrades to the gated behaviour.

---

## 9. Component ownership & blast radius

Check ownership **before** restyling — several components are shared.

| Component | Consumers | Restyle freely? |
|---|---|---|
| `jobs/JobCard.jsx` | Public Job Board, `JobCategorySections` | ✅ board-exclusive |
| `jobs/CategoryChips.jsx` | Public Job Board | ✅ board-exclusive |
| `jobs/JobCategorySections.jsx` | Public Job Board | ✅ board-exclusive |
| `jobs/JobFilterBar.jsx` | Board, Job Publication Manager, Saved Vacancies | ⚠️ **shared** — change via `variant` |
| `jobs/CardLabels.jsx` | Saved Vacancies, My Applications | ⚠️ **shared** — both pages inherit changes |
| `jobs/useJobFilters.js` | Board, Admin, Saved Vacancies | ⚠️ **shared** logic |
| `common/AdminUI.jsx` — `BulkActionBar` + `BulkDeleteButton` | Saved Vacancies, My Applications (+ admin bulk grids) | ⚠️ **shared** — the ONE bulk toolbar; `SelectionBar` shell retired (§6.6) |
| `jobs/SelectionBar.jsx` — `SelectCheckbox` | Saved Vacancies, My Applications, ATS, Job Manager, AI-Recommended | ⚠️ **shared** — checkbox only now |
| `common/SearchDropdown.jsx` / `EmptyState.jsx` / `GettingStartedGuide.jsx` | system-wide | ⚠️ **shared** design system (§14–§15) |
| `common/UsageMeter.jsx` / `UsagePanel.jsx` / `InlineUsageMeter.jsx` + `hooks/useUsage.js` | Account Settings (seeker Usage tab), PESO Admin Overview; inline: Import modal, Certificate Library, My Applications (Saved Vacancies's inline meter was removed, §67) | ⚠️ **shared** quota indicators (dev-history §66) — reflect server usage from `GET /api/usage` / `/peso-admin/usage`; limits are defined in `config/quotas.js`, NEVER in the component. `InlineUsageMeter` is the shared inline strip (hook + compact card; `refreshKey` re-pulls on mutation) — reuse it, don't re-roll the hook per module |
| `hooks/useUnifiedApplications.js` — status system | My Applications, Dashboard table + chart | ⚠️ **shared** — `STAGE_STYLE`/`statusBadgeClass`/`statusRank`; add a stage HERE (§28.5) |
| `GebbieMascot.jsx` | Landing page, Chatbot | ⚠️ **shared** — uses `useId` for unique gradient ids |

**Pages covered by this addendum's standards:** Public Job Board, Saved
Vacancies, My Referrals, Referral Register, My Applications (Kanban), Job
Publication Manager, Identity & Profile.

**Not yet aligned:** the job-detail drawer on the Public Job Board and Saved
Vacancies retains its earlier styling.

---

## 10. Feature enhancements with UI contracts

Delivered the same session; the parent `SKILL.md` §7.7/§7.8 owns the
architecture, this section owns the presentation contract.

### 10.1 Notification bell (`TopHeader`)
Badge counts unread; **click OR hover** opens a panel with **New** and
**Earlier** sections; each row shows per-type icon, source module, description
and relative timestamp. Clicking marks read and deep-links; visiting a module
auto-clears its notifications. Add new types to `TYPE_META` **and** the
type→link map together.

**Hover-to-open (§47, 2026-09).** The bell AND the TopHeader avatar menu open on
hover as well as click. Hover is **capability-gated** — enabled only under
`matchMedia('(hover: hover) and (pointer: fine)')`, so a touch device never gets a
phantom hover (tap/click stays the interaction there; principle 1.4 / §7). Handlers
(`onMouseEnter`/`onMouseLeave`) sit on the `relative` WRAPPER (button + panel) with a
~180ms leave-close delay so the cursor can cross the gap into the panel without it
dismissing; the existing `animate-in slide-in-from-top-2` provides the slide-down.
Click, outside-click, Escape, and all menu contents / handlers / auth / notification
logic are unchanged. This relaxed the earlier "click, never hover" rule by owner
request — do NOT remove the capability gate or the click path.

### 10.2 Vacancy states
Filled postings stay **visible** with an honest label rather than disappearing;
Apply is replaced by a locked chip + banner. Admin cards show `N/M positions
referred` with a `FULL` chip.

### 10.3 Chatbot
Opens **only** on explicit intent (launcher, nudge pill, or AI-analysis request).
No auto-open — the idle timer and `user-confused` listener were removed
deliberately. Modal backdrop on every breakpoint (dim + light blur), animating
`opacity` only; backdrop owns click-outside-to-close, Escape is the keyboard
twin. Launcher is an "Ask Gebbie anything" pill fronted by the mascot.

### 10.4 Gebbie mascot
Amber bunny; the **only** green is the lime PESO sash. Animation rig is
class-based and reusable: `.gebbie-body` (bob), `.gebbie-shadow` (synced squash),
`.gebbie-sprout` (ear sway), `.gebbie-eyes` (blink), `.gebbie-wave-arm`
(wave-then-rest), hover perk-up. Speech bubble uses a calm rise-and-settle
entrance — no bounce. **All** of it belongs in the `prefers-reduced-motion`
block; add new mascot/backdrop classes there too.

### 10.5 Auth overlay
Compact split modal (`max-w-[880px]`, `max-h-[92vh]`, scrollable form pane),
single full-width "Continue with Google", inputs `py-2.5 sm:py-3 text-sm` with
leading icons and proper `autoComplete`. **GitHub sign-in is removed** — do not
reintroduce.

### 10.6 Dashboard analytics (Skill Demand + lifecycle KPIs)

**Skill Demand** (`dashboard/SkillDemandWidget.jsx` ←
`GET /api/analytics/skill-demand`) replaced the external "Top Platforms" widget,
which was irrelevant to a closed ecosystem. Demand is computed from a **curated
competency dictionary** (15 PESO-relevant buckets with synonym patterns matched
on word boundaries), NOT free-text tokenising — tokenising surfaces noise and
splits synonyms ("MS Office"/"Microsoft Office"). A posting counts **at most
once per competency**, so a bar honestly reads "N postings mention this". The
scan covers title/description/qualifications/education/experience because the
dedicated `skills` column is nearly empty on live data (1 of 16 postings); a
footnote explains sparse coverage rather than letting a thin chart look broken.
Recomputed per request — no cache to invalidate as postings change.

**Lifecycle KPIs** live in the four dashboard SUMMARY CARDS (Total Hired /
Interviews / Response Rate / This Month-with-delta), fed by
`GET /api/analytics/pipeline` — server-side, trash-aware, scoped to the viewer.
**One computation rule:** a standalone KPI strip duplicating these inside the
Pipeline Analytics card was built and then deliberately removed; the summary
cards previously ALSO recomputed the same figures client-side
(`calculateMetrics`, deleted). Any given metric must have exactly one
computation and one home. `MetricCard` gained an optional `sub` line so each
figure carries its own context ("2 hired out of 6 total applications").

### 10.7 Messaging (exactly-once + peer identity)

- **Exactly-once rendering:** the server broadcasts `receive_message` with
  `io.to(room)` — sender included, ON PURPOSE, echoing back a client-generated
  `tempId`. The sender's handler REPLACES its optimistic bubble (matching
  `tempId`) with the authoritative row — real DB id and server timestamp swap in
  for the placeholders — and ignores any already-present real id (idempotent
  under reconnect). Appending the echo blindly is what duplicated the sender's
  outgoing messages; suppressing the echo instead would strand fake ids.
- **Chat header identity:** the peer is resolved by **comparing user IDs**
  (`peso_admin_id === user.id`), symmetric for both participants. Never branch
  on the viewer's role STRING — `users.role` stores `peso_administrator`, and a
  `role === 'employer'` check silently showed viewers their own name. The
  conversations payload carries both participants' name/role/avatar (thumbs,
  §10.8) so the header shows photo + name + role badge.

### 10.8 Avatar pipeline (thumbnails)

Avatars are base64 data URIs on `users.avatar_url`, averaging **319KB** — any
list inlining them paid megabytes (measured ~2.2MB for a 7-applicant ATS job).
Migration 019 adds `users.avatar_thumb`; thumbnails are generated
**client-side with a canvas** (`utils/imageThumb.js`: 512px display + 96px
centre-cropped thumb, JPEG) — the browser already holds the decoded image, and
this avoids a native sharp/jimp dependency on Render.

Rules: list/roster queries select `COALESCE(u.avatar_thumb, u.avatar_url)` —
never the bare full-size column — and the COALESCE keeps pre-migration rows
falling back to the original instead of losing their photo. The avatar endpoint
accepts the pre-scaled pair, keeping raw multipart as a legacy fallback
(stored full-size, thumb NULL). Legacy avatars stay large until re-uploaded.
Related defect class to watch for: **column omission in SELECT lists** — the ATS
"always shows initials" bug was simply `avatar_url` missing from the query.

### 10.9 `verification_id_type` (identity document field)

`users.pwd_category` was carrying the government ID TYPE, conflating it with
genuine PWD classification (live data held both "Physical Disablity" and
"Philippine Passport" in the same column). Migration 019 runs the
**expand → migrate → contract** pattern: `verification_id_type` added and
backfilled (expand); reads use
`COALESCE(NULLIF(verification_id_type,''), NULLIF(pwd_category,''))` and the
profile write updates BOTH columns (migrate); `pwd_category` is dropped only in
a later, separate contract migration once verified live. **New code must never
read `pwd_category` directly.** This supersedes the §11 note in the parent
SKILL.md that documented the overload as a frozen compromise.

---

## 11. Pitfalls encountered (all were real defects)

| Pitfall | Symptom | Rule |
|---|---|---|
| Nested component in render | Category bar jumped to start on select | Inline elements in lists; never declare a component inside a render body |
| CSS scroll-snap on a filter bar | Track snapped away on DOM mutation | Snap is for carousels only |
| Duplicate padding utilities | Icon drawn over "Newest first" | Shared classes must not set a property callers also set |
| `group-hover` for visibility | Controls unreachable on touch (×2) | Use `.reveal-on-hover` / `.dim-until-hover` (§7) |
| Width cap outside the sidebar rule | Page stayed narrow when sidebar collapsed | Only `.max-w-7xl` widens (§3.2) |
| JSX comment after `return (` | Build failure — parsed as object literal | Put comments above the `return` |
| Pin sort vs drag index | Drops landed in the wrong slot | `onDragEnd` must use the **same** ordering as render |
| Enum too narrow | `WARN_DATA_TRUNCATED` rolled back the whole transaction | Check `INFORMATION_SCHEMA` before writing a new enum value; TiDB enums are append-only |
| Response-shape drift | Avatar vanished after re-login | Every auth entry point must return the same user shape |
| Backtick inside a JS template literal (SQL comment) | Backend crashed on nodemon restart — string terminated mid-query | Never write `` ` `` inside template-literal SQL, even in comments |
| `CREATE TABLE IF NOT EXISTS` matched on NAME only | Migration 016 "succeeded" but the table kept a legacy shape; queries hit `ER_BAD_FIELD_ERROR` at runtime | Verify shape via `INFORMATION_SCHEMA` after any IF-NOT-EXISTS create; resolve collisions with a NEW name, never a production DROP |
| mysql2 default `timezone: 'local'` on a UTC+8 host | Every timestamp read 8h in the past — "8h ago" on new notifications, Trash expiring early | The pool sets `timezone: 'Z'` (DB stores UTC); never compensate with manual offset maths |
| API envelope read one level too shallow | Resume toggle/insights vanished on re-login though data was stored | Unwrap with `res.data?.data ?? res.data`; check the wire shape, not memory |
| `rows[0]` on an UNORDERED multi-row table | `userprofiles` (no PK, no timestamp!) returned an arbitrary row — resume profile intermittently "disappeared" | Order deterministically by data-richness; verify a tiebreak column EXISTS before ordering by it |
| `io.to(room)` echo + blind optimistic append | Sender saw every outgoing message twice | Reconcile by `tempId` — replace the optimistic bubble, don't suppress the echo (§10.7) |
| Role compared to a raw string | Chat header showed the viewer their OWN name (`'employer'` never matches `peso_administrator`) | Resolve identity by user-ID comparison; compare roles only via `normalizeRole` |
| Column omitted from a SELECT list | ATS avatars always fell back to initials; earlier, the ID badge was blank | When a UI field is "always empty", check the query's column list before the renderer |
| Same metric computed in two places | Summary cards and KPI strip could drift (client `calculateMetrics` vs server endpoint) | One metric, one computation, one home (§10.6) |

---

## 12. Pre-flight checklist for UI work

Before shipping any presentation change:

1. **Ownership** — is the component shared (§9)? If yes, opt in via a variant/prop rather than restyling in place.
2. **Width** — does the page use the right cap for its content type (§3.1)? Does it need sidebar-aware widening (§3.2)?
3. **Grid** — `auto-fill/minmax` with a `min()` guard and `auto-rows-fr`, not a breakpoint ladder (§4.1).
4. **Equal heights** — `h-full` + `min-h` + `mt-auto` footer + line clamps (§4.2).
5. **Typography** — neutral ink; green only for actions/icons/hover/active (§2.1–2.2).
6. **Colour on cards** — full surface, per-colour ink, translucent chips (§6.3–6.4).
7. **Hover-revealed controls** — `.reveal-on-hover` / `.dim-until-hover`, never `group-hover` opacity (§7).
8. **Focus** — `focus-visible:ring-2 ring-[#4F7942]` on every interactive element; popovers close on Escape and outside click.
9. **Motion** — new animations registered in the `prefers-reduced-motion` block.
10. **States** — empty, no-results (with clear action), and loading all defined (§5.4).
11. **Persisted preference?** — numbered migration, server-side validation, owner-scoped `WHERE`, PATCH semantics, optimistic write with rollback (§6.1–6.2). For a UI-view preference, use `user_ui_preferences` + the two-layer flicker-free restore (§8.5).
12. **Timestamps** — trust the pool's `timezone: 'Z'`; never add manual offset maths, and clamp future-parsing values to "Just now" in relative formatters.
13. **Avatars in lists** — always `COALESCE(avatar_thumb, avatar_url)` (§10.8); never inline the full-size column in a multi-row payload.
14. **New metric or stat?** — one computation, one home (§10.6); if it already exists elsewhere, consolidate rather than duplicate.
15. **Destructive UX** — soft-delete with commit-first Undo (§6.7); permanent deletion only from Trash, guarded on `deleted_at IS NOT NULL`.
16. **Verify** — `npm run build`; for anything behind auth, state plainly what was not exercised.

---

## 13. File map

```
job-tracker-frontend/src/
  index.css                          §3.2 width rules · §7 hover-capability classes
  hooks/useSidebarCollapsed.js       §3.3 collapse broadcast + read hook
  App.jsx                            stamps `sidebar-collapsed` on <main> · /trash route
  utils/imageThumb.js                §10.8 canvas downscaling (512px + 96px pair)
  components/
    PublicJobBoard.jsx               wide canvas · category chips · card grid
    SavedJobs.jsx                    wide canvas · fluid grid · pin/colour · multi-select
    MyJobs.jsx                       Kanban · pin-per-column · colour · multi-select · dnd order
    Referrals.jsx                    wide canvas · document library · §8.5 view pref
    Trash.jsx                        §6.7 centralised trash, categorised by source
    Dashboard.jsx                    lifecycle KPI summary cards (§10.6) · resume restore
    Messages.jsx                     §10.7 tempId reconciliation · peer-by-id header
    PesoAdminATS.jsx                 compact ATS · avatar thumb · verification_id_type
    Profile.jsx                      form-first shell
    PesoAdminDashboard.jsx           wide canvas · admin cards
    GebbieMascot.jsx                 shared mascot (useId gradients)
    layout/TopHeader.jsx             notification bell panel · timeAgo scale + 30s tick
    dashboard/
      SkillDemandWidget.jsx          §10.6 competency-dictionary demand bars
    jobs/
      JobCard.jsx                    card + isJobFilled/filledLabel
      CardLabels.jsx                 COLOR_LABELS · cardTheme · PinButton ·
                                     ColorLabelPicker · pinnedFirst
      CategoryChips.jsx              full-width flex-wrap chips (§71)
      JobFilterBar.jsx               shared filter bar (variant themed)
      JobCategorySections.jsx        board browse rows
      useMultiSelect.js              §6.6 checkbox + long-press state machine
      useTrashAction.js              §6.7 confirm → commit-first delete → Undo toast
      SelectionBar.jsx               §6.6 SelectCheckbox ONLY (toolbar retired → AdminUI)
    common/
      AdminUI.jsx                    §6.6 BulkActionBar + BulkDeleteButton (the shared bulk toolbar)
      EmptyState.jsx / GettingStartedGuide.jsx / SearchDropdown.jsx  §14–§15 design system
db.js                                timezone: 'Z' — the pool-wide UTC contract
socketServer.js                      §10.7 tempId echo on receive_message
migrations/
  015_pin_and_color_labels.sql       is_pinned + color_label on both tables
  016_user_preferences.sql           SILENT NO-OP (name collision) — kept as record
  017_user_ui_preferences.sql        §8.5 the real preference store
  018_soft_delete_trash.sql          deleted_at + indexes + saved_jobs UNIQUE
  019_avatar_thumb_and_verification_id.sql  §10.8 thumb · §10.9 expand+backfill
routes/
  savedJobRoutes.js                  PATCH preferences · revive-on-resave upsert
  trackedJobRoutes.js                PATCH preferences · deleted_at filter
  trashRoutes.js                     §6.7 TYPE_MAP router, lazy purge
  preferenceRoutes.js                §8.5 GET/PUT allow-listed prefs
  analyticsRoutes.js                 §10.6 skill-demand + pipeline endpoints
  messageRoutes.js                   conversations carry both identities (§10.7)
```

---

## 14. Empty State design system (2026-08-07)

Empties are onboarding, not gaps (principle 1.7). One component family, token-styled,
reduced-motion-safe, used EVERYWHERE a surface can be empty. Every empty state must
answer three questions: **why is it empty · what is this module for · what to do next.**

### 14.1 `components/common/EmptyState.jsx`
The single full-surface empty. Props: `variant` (`default` new/no-data · `search`
no-results · `success` a positive "all caught up"), `size` (`sm` in-panel · `md`
full-page), `icon` (a lucide component or element), `title`, `description`,
`primaryAction`/`secondaryAction` (`{ label, to?, onClick?, icon? }` → a real
`<Link>`/`<button>` with a focus ring), and `children` (extra content). The icon tile
floats (`.es-float`); `success` pops (`.es-pop`). **Do not** hand-roll an empty `<div>`
with centered text again — use this so copy, spacing, motion and a11y stay uniform.

### 14.2 `components/common/GettingStartedGuide.jsx` (the GAM)
First-run onboarding checklist with a progress bar. Each step
`{ id, title, description, icon, done, action }` marks itself **done from a real signal**
(profile filled, résumé built, a job saved, a PESO application submitted, a referral
issued) — never a fake tour. The first not-done step is highlighted "do this next";
auto-hides when all done; dismissible (persisted in `localStorage['pk_gsg_dismissed']`).
Mounted on the seeker Dashboard, gated on `onboarding.loaded && !dismissed && !allDone`,
fed by one `Promise.allSettled` over `/profile`, `/resume/draft`, `/saved-jobs`,
`/applications/mine`, `/referrals/mine`.

### 14.3 Success-oriented empties
Where empty is an ACHIEVEMENT, use `variant="success"` (green tile, celebratory copy):
Smart Referral Queue (no pending recommendations), AI-Recommended (nothing to review),
Failed Referrals (all delivered), Workflow Automation (everything synced). Reserve it for
"caught up" — a brand-new-user empty stays `default`.

### 14.4 Motion
`.es-float` / `.es-pop` live in `index.css` under `@media (prefers-reduced-motion:
no-preference)` and are also `animation: none` in the reduce block, so reduced-motion
users get a static, complete layout. New empty-state animation goes there too.

### 14.5 Coverage
Seeker: Dashboard (GAM + widget empties), Public Job Board, Saved Vacancies, My PESO
Applications, My Referrals, Messages, Notification Center, Certificate Library, Trash,
My Jobs. PESO admin: Job Publication Manager, Applicant Pipeline, Smart Referral Queue,
AI-Recommended, Failed Referrals, Referral Register. Super Admin: Users, Job Moderation,
Audit Trail, Email Delivery, Workflow Automation. (Monitoring dashboards that render zeros
gracefully — Platform Overview/Reports/Health, Job-Alerts/Proactive monitors — are left as
compact one-liners on purpose; a full card is too heavy in those tight panels.)

---

## 15. Search dropdown (the unified search overlay, 2026-08-07)

`components/common/SearchDropdown.jsx` is the ONE search-with-suggestions component.
It replaced the old below-content "Recent / Suggested" chips (which consumed page space):
recent history and recommendations now live in a contextual overlay that opens on
focus/typing. `RecentSearches.jsx` was deleted — do not reintroduce a below-content chip
list; extend the dropdown instead.

### 15.1 Interaction contract
1. Focus/click opens the panel immediately.
2. Empty query → **Quick Filters + Recent + Suggested**.
3. Typing → **Matching Results** replace Recent/Suggested in real time.
4. Picking an option populates the field AND runs the search (`onSubmit`).
5. Enter runs a standard search on the raw text.
6. Outside click / Escape closes with a light `animate-in` (reduced-motion-safe).
Full keyboard nav (↑/↓ through options, Enter to pick/submit, Esc), ARIA
combobox+listbox with `aria-activedescendant`. `onMouseDown preventDefault` on options/
chips keeps input focus so a click lands before blur closes the panel.

### 15.2 API (parent owns data + actions; component owns interaction)
`value`/`onChange` (controlled text, drives live filtering) · `onSubmit(term)` (run +
record recent) · `recent`/`onRemoveRecent`/`onClearRecent` · `suggestions[]` (strings) ·
`results[]` (`{ key, label, sublabel?, icon?, onSelect? }`, computed by the parent from
`value`) · `quickFilters[]` (`{ key, label, icon?, active, onToggle }`) · `size`/`className`.

### 15.3 Recent-search memory — `hooks/useRecentSearches.js`
Per-module, **namespaced** localStorage (`recentSearches:<ns>`), dedup case-insensitive,
most-recent-first, capped, try/catch (private mode → in-memory). Record on a settled
debounce (~900ms) AND on explicit submit. Namespaces in use: `job-board`, `job-manager`,
`saved-jobs`, `ats-applicants`, `referral-register`.

### 15.4 Integration map (centralised, not per-module copies)
- **`jobs/JobFilterBar.jsx`** owns the dropdown for its THREE consumers (Public Job Board,
  Job Publication Manager, Saved Vacancies). Pass `searchNamespace` + `searchPlaceholder`;
  it derives Suggested = top categories, Quick Filters = top employment types, Results =
  `filters.filtered` while typing, and owns `useRecentSearches`. One change, three modules.
- **Applicant Pipeline** (`PesoAdminATS`) and **Referral Register** (`Referrals`) embed
  `SearchDropdown` directly (their own state): results from the live list, quick filters =
  ATS statuses / referral delivery-states.
- Smart Referral Queue has no free-text search (a ranked queue) — intentionally omitted.

---

## 16. Unified Document Builder UI (2026-08-08)

Presentation contract for the rebuilt builders (architecture in SKILL.md §7.6 + development-history
§30). ONE UI in `components/builder/` serves résumé / cover letter / resignation via a `docType` prop;
do NOT reintroduce the three separate builder screens or the "Create with AI / Manually" modal.

### 16.1 Two-step flow + layout
1. **Template Gallery** (`TemplateGallery.jsx`) opens first — reuses the card system (§5): fluid
   `auto-fill/minmax` grid, per-card thumbnail placeholder + name + description + recommended use case +
   ATS-friendly badge + Modern/Professional category chip. The active template shows a check; picking one
   enters the editor. (Real static thumbnails are a deferred polish item — a CSS "mini page" hints at the
   family for now.)
2. **Editor** — two-pane on `lg` (structured forms left, live A4 preview right, `lg:sticky`); on mobile a
   segmented **Edit / Preview** toggle switches panes (`hidden lg:block` + the toggle). Wide-canvas
   `max-w-7xl`. Header: back-to-dashboard, autosave chip (Saving/Saved), **Change Template** (→ gallery,
   content-preserving), Clear. Toolbar: AI actions (Prefill résumé-only, Translate), **A4 / US-Letter**
   segmented toggle (per-export, not persisted), DOCX + Export-PDF buttons.

### 16.2 Live preview
`LivePreview.jsx` renders the selected react-pdf template in a `<PDFViewer>` (dark canvas, `showToolbar=false`),
**debounced ~250 ms** so typing stays smooth; keyed on `templateId-pageSize` so a template/size switch
re-renders. The SAME component exports the PDF (`exportPdf` → `pdf().toBlob()` → download) — preview == export.
A résumé photo needs the `Buffer` polyfill (§30.1) or export throws.

### 16.3 AI woven into the form (not a separate mode)
`SchemaForm.jsx` renders inline AI: a field with `ai:'improve'` (résumé summary, letter body) shows an
"Improve with AI" button whose result is an **accept / redo / discard** review card under that field (never
auto-applied — manual edits preserved); a section with `generate` (cover + resignation body) shows a
"Generate Body with AI" button that applies directly. Loading/disabled states via `ai.busy`. Degrades on
failure (toast, draft untouched).

### 16.4 States, tokens, motion
Design-token styling throughout (`bg-surface`/`bg-sunken`/`text-content`/`text-muted`/`border-line`/
`bg-accent`/`accent-soft`, §24.1) — no hardcoded brand hex. Gallery uses `focus-visible:ring-accent`;
autosave/AI use spinner + success states; the builder loads behind an `isLoaded` spinner gate so the gallery
never flashes before the draft resolves. All builder motion respects `prefers-reduced-motion` (global rule).

### 16.5 Component ownership (add to §9)
| Component | Consumers | Restyle freely? |
|---|---|---|
| `builder/DocumentBuilder.jsx` | résumé + cover + resignation (docType) | ⚠️ **shared shell** — change once, affects all three |
| `builder/SchemaForm.jsx` · `TemplateGallery.jsx` · `LivePreview.jsx` | all three doc types | ⚠️ **shared** — driven by `documentSchemas`, not per-doc copies |
| `builder/templates/*` | the live preview + PDF export | ⚠️ react-pdf components; a new template is a file + a registry entry (`templates/index.js`) |

New doc types or templates extend `documentSchemas` + `templates/` — never fork the shell.