# Job Seeker Data-Processing Modules — Implementation Proposal

Refactor **Import Past Applications** and **Analyze My Resume** into production-ready,
reusable data-processing workflows with system-consistent modals, backdrop-click
closing, deterministic validation, explicit progress states, duplicate detection,
storage limits, and controlled persistence.

Status: **APPROVED — owner confirmed the §7 defaults (2026-09).** Import limits 2 MB /
500 rows / 5-per-day / 1,000 total; durable `import_batches` audit table; résumé keep
latest 3 versions + parsed-text-only (drop the binary after extraction); build order
A→B→C→D. **Phase A SHIPPED (shared `components/dataflow/ProcessingModal` + `StepProgress`; both
Dashboard modals retrofitted with backdrop-click-to-close guarded while busy, focus trap,
named progress, double-submit guards). **Phase B SHIPPED** (migration 049 `import_batches`;
`services/importService.js` deterministic parse/validate/normalize/dedupe/commit with the
limits; `POST /profile/import/preview` + `/commit`; `ImportPastApplicationsModal` review
flow; replaced the old destructive `/tracker/upload`. ⚠️ owner runs `npm run migrate` to
apply 049 before commit works in prod). **Phase C SHIPPED** (résumé pipeline hardened:
PDF via canonical `pdfTextService` + DOCX via new `mammoth` dep, 5 MB + PDF/DOCX-only
validation, the EXTRACTED text now persists to `uploaded_resumes` so analysis feeds AI
scoring, `AnalyzeResumeModal` review flow, parsed-text-only. RETENTION NOTE: `uploaded_resumes`
is one-row-per-user UPDATE-in-place (the builder/apply paths already work this way + the AI
scorer reads the latest), so retention is naturally bounded to 1 row — the proposal's "keep
latest 3 versions" assumed a versioned model that doesn't exist; no pruning is needed). Phase
D SHIPPED (`services/resumeAnalyzer.js` extracted so the route + harness share ONE analyzer;
`scripts/eval-resume-analysis.js` / `npm run eval:resume` samples Resume_datasets.csv across
categories and runs the real analyzer, reporting success rate / avg skills+experiences /
coverage; `--dry` skips AI). **ALL PHASES A–D COMPLETE.**** Grounded in the live schema (probed 2026-09) and the
current handlers, reusing existing tables, AI, auth, and profile/tracking functionality.

> **Post-completion integration verification (owner-raised, VERIFIED 2026-09; dev-history §49.5).**
> Import Past Applications is NOT an isolated feature. Its records are the SAME application-data domain
> used by the Dashboard "All Your Applications" section and the "My Applications" page. Confirmed
> end-to-end: `importService.commit` INSERTs into `usertrackedjobs` (`services/importService.js:271`) —
> the identical table/columns/status vocabulary the manual "add tracked application" flow writes
> (`routes/trackedJobRoutes.js:95`) — and every imported row surfaces through `GET /api/applications/unified`
> (`routes/applicationRoutes.js:143`, `imported` branch = `usertrackedjobs … deleted_at IS NULL`), the ONE
> feed behind both surfaces. Validation / dedupe / limits / preview / confirmation run BEFORE persistence;
> `import_batches` (mig 049) is a counts-only audit + idempotency ledger, NOT an application store; `commit`
> is append-only + idempotent (existing rows never updated/deleted); imported-row edits/deletes stay on the
> UNCHANGED `/tracked-jobs` routes; referrals stay FK-bound to `job_applications`. **No parallel data store,
> no duplicate application model, no second read path** — Import is simply another controlled way to create
> `usertrackedjobs` records.

---

## 0. Dataset reality-check (READ FIRST)

The two reference CSVs at the repo root are **generic public ML datasets**, not the
shape of these features' real data. Do NOT build field-mapping to their columns.

| CSV | Rows | Actual content | Correct use here |
|---|---|---|---|
| `job_past_applicatons_datasets.csv` | 73,462 | A **developer employment survey** (`Age, Accessibility, EdLevel, Gender, YearsCode, YearsCodePro, Country, PreviousSalary, HaveWorkedWith, ComputerSkills, Employed`). NOT application history. | **Volume/stress reference only** → proves we must cap rows/size. It is NOT the import schema. |
| `Resume_datasets.csv` | 66,015 | A **résumé-classification corpus** (`ID, Resume_str, Resume_html, Category`). NOT the profile fields the app stores. | **Validation harness** → feed `Resume_str` samples across categories through the analyzer to sanity-check extraction. Not a storage schema. |

**Consequence:** "Import Past Applications" maps to the app's real tracked-application
shape (below), and a user's real import file is a personal job-application export
(company / title / date / status), not the survey CSV.

---

## 1. Current state (what exists today)

**Import Past Applications** — `POST /api/profile/tracker/upload` (`upload.single('tracker')`,
`profileRoutes.js:617`): reads XLSX via SheetJS → sheet_to_json → runs an **AI validation
step** (`aiClient.chat`) → `INSERT INTO usertrackedjobs (user_id, company, job_title,
job_type, date_applied, status, link, notes)`. No preview, no dedupe, no size/row caps,
no idempotency. The AI-per-import step is fragile and cost-scales with row count.

**Analyze My Resume** — `POST /api/profile/upload` (`upload.single('resume')`,
`profileRoutes.js:485`): `aiClient.chat` → `INSERT INTO userprofiles (ai_profile_data,
is_ai_profile_visible, ai_insights_data) ON DUPLICATE KEY UPDATE`. Plus
`POST /api/profile/insights/generate`. Extraction store is `uploaded_resumes`.

Both modals in `Dashboard.jsx` are bespoke (custom overlays), use a generic spinner, and
lack backdrop-click-to-close.

### Live schema (reuse — do NOT create parallel tables)

- **`usertrackedjobs`** (114 rows) — the import target + the unified "My Applications"
  feed (§28). Cols: `user_id, company, job_title, job_type, date_applied(varchar),
  status(varchar), link, notes, job_description, work_setup, industry,
  application_source, interview_*, expected_salary, offered_salary, contact_*,
  is_pinned, color_label, deleted_at`.
- **`uploaded_resumes`** (17) — original+extracted: `file_name, file_url, parsed_text,
  skills_vector, uploaded_at`.
- **`userprofiles`** (18) — AI results: `ai_profile_data, ai_insights_data,
  is_ai_profile_visible, skills, preferred_roles, experience_level, career_goals`.
- (`applications` — a legacy 19-row table; NOT used by the unified feed. Do not target it.)

The three résumé artifacts the brief asks to keep separate **already are** separate
(file → `uploaded_resumes.file_url`, extracted → `parsed_text`, AI → `userprofiles.*`).

---

## 2. Shared architecture (`components/dataflow/` + `services/dataProcessing`)

Both modules are independent screens over ONE reusable stack.

**Frontend (`src/components/dataflow/`)**
- `ProcessingModal.jsx` — system-standard modal shell (§10/§24 tokens, `useFocusTrap`
  §35, `animate-in` enter, responsive `max-w`, sticky header w/ title + X). **Backdrop
  click closes only when idle**: `onClick={(e) => { if (e.target === e.currentTarget &&
  !busy) onClose(); }}`; content stops propagation; while a job is `processing/committing`
  the backdrop and X are **guarded** (X shows a "cancel?"/disabled state) so an in-flight
  import/analysis is never interrupted.
- `useProcessingJob.js` — the state machine: `idle → validating → uploading →
  processing → review → committing → done | error`. Exposes `busy`, `step`, `progress`,
  `error`, and a **submit guard** (ignores repeat clicks while not `idle/review/error`).
- `StepProgress.jsx` — explicit NAMED steps (not a bare spinner).
- `ValidationReport.jsx` / `ImportPreviewTable.jsx` — actionable per-row errors + preview.

**Backend (`services/`)** — `importService.js` (parse/validate/normalize/dedupe/commit)
and the existing resume path hardened. Backend is **authoritative** for limits, dedupe,
and persistence; frontend validation is UX-only.

---

## 3. Import Past Applications

### 3.1 Real expected columns (documented + template offered in the UI)
`company` (req), `job_title` (req), `date_applied`, `status`, `job_type`, `work_setup`,
`application_source`, `link`, `notes`, `expected_salary`, `industry`. Headers matched
case/space-insensitively with a small synonym map (`company|employer`, `job_title|
position|role`, `date_applied|applied_on|date`, `status|stage`). Unknown columns ignored.

### 3.2 Workflow (backend-authoritative)
`Select CSV/XLSX → client pre-check (type/size/rowcount) → POST /preview → parse (SheetJS,
CSV+XLSX) → validate + normalize each row → dedupe → return summary → user reviews →
POST /commit (confirmed rows) → transaction insert → import summary`.

- **Normalize:** trim; coerce `date_applied` to `YYYY-MM-DD` (reject unparseable →
  row error, not silent); canonicalize `status` to the app's set
  (`Applied|Under Review|Interview|Shortlisted|Rejected|Accepted|…`) via a map, else
  default `Applied` + a warning.
- **Dedupe:** within the file AND against the user's existing `usertrackedjobs`
  (excluding `deleted_at`) on normalized key `lower(company)|lower(job_title)|
  date_applied`. Duplicates are reported, not inserted.
- **Validate:** missing required (`company`/`job_title`) → row rejected with reason.
- **Preview/summary:** `{ valid: N, invalid: M (with reasons), duplicates: K, willImport: N }`.
  Nothing is written until `/commit`.
- **Commit:** insert ONLY valid, non-dup rows in ONE transaction; return counts.

### 3.3 Persistence + idempotency
- Persist **normalized rows into `usertrackedjobs`** — **do NOT store the raw CSV** (no
  audit requirement stated). No new table.
- **Idempotency:** the client generates an `import_id` (uuid) sent to both `/preview`
  and `/commit`; commit is a no-op if that `import_id` was already committed (guards
  double-click / refresh / retry). Cheapest impl: a short-TTL in-memory/`system_settings`-
  free guard keyed by `(user_id, import_id)`, or a tiny `import_batches` audit row if we
  want a durable record (decision below).

### 3.4 Limits (backend-enforced; 413/422 with a clear message)
| Limit | Proposed value | Why |
|---|---|---|
| File size | ≤ 2 MB | A personal tracker export is small; the 73K survey CSV (~10 MB) is rejected by design. |
| Rows per import | ≤ 500 | Bounds parse/AI/insert cost + the preview table. |
| Imports per day / user | ≤ 5 | Rate-limit runaway growth. |
| Total tracked apps / user | ≤ 1,000 active (`deleted_at IS NULL`) | Per-user storage cap; import that would exceed it is truncated + reported. |

**Drop the per-import AI validation** — replace with deterministic validation/normalize
(faster, free, predictable). AI is not needed to map columns.

### 3.5 Endpoints (replace the single `/tracker/upload`)
- `POST /api/profile/import/preview` — multipart file + `import_id`; returns the summary +
  the validated/normalized rows (client holds them for the confirm step; keeps the server
  stateless). Enforces size/row/rate/type limits here.
- `POST /api/profile/import/commit` — `{ import_id, rows }` (server RE-validates + RE-dedupes
  authoritatively, never trusts the client blob) → transaction insert → summary.

---

## 4. Analyze My Resume

### 4.1 Three distinct artifacts (keep separate — already are)
1. **Original file** → `uploaded_resumes.file_name` + `file_url`.
2. **Extracted text** → `uploaded_resumes.parsed_text` (+ `skills_vector`).
3. **AI analysis** → `userprofiles.ai_profile_data` + `ai_insights_data`.

### 4.2 Workflow
`Select → validate (PDF/DOCX, ≤ 5 MB) → upload → extract (pdfTextService) → AI analyze
(aiClient) → review insights → persist (parsed_text + curated AI fields only) → display`,
with explicit step-progress. Reuses `/profile/upload` (hardened) + `/profile/insights/
generate` + `pdfTextService` + `aiClient` — no new AI integration.

### 4.3 Storage / retention (backend-enforced)
| Control | Proposed value |
|---|---|
| File type | PDF, DOCX only |
| File size | ≤ 5 MB |
| Stored versions / user | Keep the **latest 3** `uploaded_resumes` rows; prune older on new upload |
| Original binary | **Decision below** — keep only the latest file, or keep `parsed_text` only and drop the binary after extraction (recommended: parsed_text-only; the résumé builder holds the structured doc separately) |
| AI results | Persist ONLY useful fields (skills, preferred_roles, experience_level, summary, insights) — never `Resume_html`/oversized blobs |

### 4.4 Validation harness (optional, from the corpus)
`scripts/eval-resume-analysis.js` feeds sampled `Resume_str` rows (across `Category`)
from `Resume_datasets.csv` through the analyzer to spot-check extraction quality — a dev
tool, not shipped in the app. Deferred unless wanted.

---

## 5. Backdrop-click + double-processing safety (both modals)
- Backdrop closes **only when idle/done/error** (`busy` guard); content `stopPropagation`;
  X always present but guarded mid-job. Escape mirrors the backdrop rule.
- **No duplicate processing:** `useProcessingJob` ignores repeat submits while busy; the
  commit endpoints are idempotent (`import_id`) / update-in-place (resume upsert).
- Large jobs stay within a single DB **transaction** (import) or the existing async AI
  path (resume); no long request blocking beyond the AI call already in place.

---

## 6. Frontend component structure
```
src/components/dataflow/
  ProcessingModal.jsx        # shared system modal (backdrop-guard, X, focus-trap, tokens)
  useProcessingJob.js        # idle→validating→…→done|error state machine + submit guard
  StepProgress.jsx           # named-step progress (no bare spinner)
  ValidationReport.jsx       # actionable per-row errors/warnings
  ImportPreviewTable.jsx     # valid / invalid / duplicate preview
src/components/dashboard/
  ImportPastApplicationsModal.jsx   # composes the above → /import/preview + /commit
  AnalyzeResumeModal.jsx            # composes the above → /profile/upload + /insights/generate
```
Dashboard opens these instead of the two bespoke overlays. Reuses `useFocusTrap` (§35),
design tokens (§24), `EmptyState` (§14).

---

## 7. Decisions to confirm before I build
1. **Import limits** — OK with 2 MB / 500 rows / 5-per-day / 1,000 total? (adjust any).
2. **Import audit** — keep a durable `import_batches` row per import (who/when/counts) for
   idempotency + history, or the lightweight stateless guard? (I lean: a tiny
   `import_batches` table — 1 additive migration — for real idempotency + a visible history.)
3. **Résumé retention** — keep the latest **3** versions? And keep the **binary** file or
   **parsed_text only** (recommended)?
4. **Build order** — suggested phases: **(A)** shared `dataflow` modal + backdrop/close +
   double-submit safety (fast, high-UX win, no schema), **(B)** Import pipeline
   (preview/commit + limits + dedupe), **(C)** Résumé pipeline hardening + retention,
   **(D)** optional validation harness. Ship A→B→C as separate PRs.

Once you confirm 1–4 I'll implement phase by phase (backend-authoritative, each build- and
prod-verified), reusing all existing tables/AI/auth.
