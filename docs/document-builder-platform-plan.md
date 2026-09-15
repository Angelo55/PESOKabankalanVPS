# Document Builder Platform — Architecture & UX Blueprint

> **✅ SHIPPED (2026-08-08).** All five phases were built and pushed to `main` (HEAD `ee0da67`).
> The blueprint below is the design of record; what actually shipped, plus two follow-up fixes
> (cover-letter draft dup-row recovery, resignation "Generate Body with AI" via a shared service),
> is recorded in **development-history §30** and **UI addendum §16**. Track A (`@react-pdf/renderer`)
> was chosen and verified (Phase 0 GO in-browser). `src/bufferPolyfill.js` was needed for photo export.
> `npm test` = 74. The §12 résumé→scoring constraint was preserved.

**Status:** SHIPPED (was: Planning — approved direction). **Date:** 2026-08-08.
**Scope:** Unify the three Job Seeker document builders (Resume, Cover Letter, Resignation)
into one framework with a **Template Gallery**, a **live WYSIWYG preview**, and streamlined
Dashboard navigation — while **preserving** the Resume Assistant → AI Compatibility Scoring
synchronization contract (see §12, a hard constraint).

Companion to `SKILL.md` (§7.4 scoring, §7.6 builders, §18.5 re-scoring) and
`references/ui-ux-and-responsive-layout.md` (card system, empty states, design tokens).
This is a blueprint; no application behaviour changes on merge of this doc.

---

## 0. Grounding — what exists today (evidence)

| Fact | Source |
|---|---|
| Three near-duplicate 4-step wizards: `Fill In → Improve (AI) → Translate → Generate`. | `ResumeBuilder.jsx`, `CoverLetterBuilder.jsx`, `ResignationBuilder.jsx` |
| **No preview anywhere** — the first sight of the document is the downloaded PDF. | all three builders (export = blob download) |
| **No real template system.** Resume carries a vestigial `templateId: 'FF3B04BA-…'` (dead PDFMonkey UUID). `/api/resume/templates` reads images from an empty `templates/` dir. Cover/resignation have no template concept. | `ResumeBuilder.jsx:12`, `resumeRoutes.js:28` |
| Rendering is **server-side pdfkit, imperative** (`doc.text`/`doc.moveDown`). One hardcoded resume layout; one shared business-letter layout for cover+resignation. Page size = **LETTER**, not A4. | `services/resumePdfService.js`, `services/letterPdfService.js` |
| Resume draft syncs structured JSON → `uploaded_resumes.parsed_text` and enqueues re-scoring. **Coupled to the AI matching engine.** | `routes/resumeRoutes.js:110-136` |
| Intermediate "Create with AI / Create Manually" screen routes to `?mode=ai|manual`; `mode=ai` just jumps resume to step 2 + imports `ai_profile_data`. | `Dashboard.jsx:238` (`CreationModal`) |
| Routes: `/builder`, `/cover-letter`, `/resignation-builder`; APIs `/api/resume`, `/api/cover-letter`, `/api/resignation`. | `App.jsx:173-175` |

**Diagnosis:** the two requested features (template selection + live preview) are exactly what
the current architecture makes impossible, because the layout logic lives in Node and isn't
reachable by the browser. The fix must move the **single source of layout truth** somewhere both
the preview and the export can share.

---

## 1. Committed decision — rendering engine

**`@react-pdf/renderer` (client-side React → PDF).** One React component tree renders **both**
the on-screen preview (`<PDFViewer>`) and the exported PDF (`pdf(<Doc/>).toBlob()`) — so
**preview == export by construction** (zero drift, the #1 failure mode of resume builders).

Rationale over the alternatives:
- **vs. HTML/CSS + Puppeteer (headless Chromium):** Puppeteer is ~300–400 MB RAM + slow cold
  starts — a poor fit for Render's 512 MB free tier and it would force the $7 Starter instance
  (§25 infra roadmap). react-pdf runs entirely client-side: **no server CPU, no Chromium**.
- **vs. keep pdfkit + a parallel browser preview:** two renderers guarantee drift. Rejected.

**Tradeoffs accepted:** react-pdf supports a CSS subset (flexbox subset, no CSS grid, manual
page-breaks) and DOCX needs a separate library (§8). Both are manageable; a **Phase 0 spike**
de-risks the CSS subset against real templates before committing.

**Fallback:** keep the existing pdfkit services as a legacy/fallback export during migration, so
a client-render failure never hard-fails the export (invariant 0.1).

**Editing model:** structured **forms + a live rendered preview panel** — NOT a rich-text editor
(TipTap/Slate/Lexical). These documents are *structured data* feeding an AI scorer and templates;
freeform rich text would break the structured model and the compatibility sync (§12).

---

## 2. Target architecture — the Unified Document Builder Framework

Replace three parallel wizards with **one framework + three document definitions.**

```
DocumentBuilder (ONE shell)
├── useDocumentDraft(docType)   load / autosave / wipe / rescore-gating  (generalized from ResumeBuilder)
├── useDocumentAI(docType)      optimize / generate-body / translate — per-doc prompt map
├── TemplateGallery(docType)    gallery → sets draft.templateId
├── EditorPane(schema)          schema-driven structured forms
│   └── AI + Manual as MODES (a toolbar toggle), not routes
├── LivePreviewPane             renders <Template docType templateId data> live (react-pdf)
└── ExportBar                   PDF (react-pdf) + DOCX (docx lib) from the SAME data

Document definitions (data, not UI):
  resumeSchema  + resume templates      (KEEP structured JSON — feeds the scorer, §12)
  coverSchema   + cover-letter templates
  resignSchema  + resignation templates
```

Principles: schema-driven forms; **data model stays structured JSON** (draft wire format,
AI calls, and the resume→scorer sync unchanged); templates are pure presentation
`(structuredData) → rendered doc`; AI and Manual are modes in one workspace.

Shared across all three: template rendering, live preview, AI integration, autosave, export,
(future) version history, settings. Per-type: only the field schema + template set + prompt map.

---

## 3. Template management strategy

- **Templates as code (a registry), not DB rows** — at least for v1. Each template = a React
  component + metadata `{ id, docType, name, description, useCase, atsFriendly, category, thumbnail }`.
  Versioned in git, reviewable, **zero backend** to ship the gallery.
- **`templateId` becomes real** — repurpose the existing (currently dead) resume `templateId`
  to a registry key; add it into the cover/resignation draft JSON (no DDL — JSON columns).
- **Thumbnails:** render each template once against sample data, commit static preview images.
- **Inheritance / theming:** a shared layout primitive + design tokens (font, accent, spacing,
  A4/Letter) so "Modern Blue" vs "Modern Green" is one template + a theme, not two files.
- **Future:** promote the registry to a DB table only if admin/user-managed templates are wanted
  (numbered migration, §0.6). Not needed for v1 — do not over-build.

---

## 4. Template Gallery specification

A new step **before** the editor. Selecting a doc type from the Dashboard opens the gallery
immediately. Each card renders from metadata:

| Requirement | Field |
|---|---|
| Thumbnail preview | `thumbnail` |
| Template name | `name` |
| Short description | `description` |
| Recommended use case | `useCase` |
| ATS-friendly indicator | `atsFriendly` → badge (resume-relevant; letters may omit) |
| Modern / Professional label | `category` chip |

UX reuses the existing card system (`references/ui-ux-and-responsive-layout.md` §5): fluid
`auto-fill/minmax` grid, `EmptyState` when a set is empty, category/ATS filter chips, design
tokens (§24). "Select" sets `templateId` and enters the editor. A persistent "change template"
control inside the editor makes switching mid-edit one click (data is template-agnostic).

---

## 5. UI/UX redesign + navigation simplification

**Remove the intermediate screen.** Delete the `CreationModal` (`Dashboard.jsx:238`) and the
`?mode=ai|manual` branching. Dashboard doc buttons route **straight to the Template Gallery**.
AI vs Manual become **modes inside the editor**:
- **Manual** — edit the structured forms (default, always available).
- **AI Assistance** — inline generate/improve of the current section (existing `/optimize`,
  `/generate-body`, `/translate` calls). The old "AI import from profile" becomes a one-click
  "Prefill from my profile" button.

**Target flow (the requested 7 steps):**
```
Dashboard → pick doc type → Template Gallery → pick template
        → Editor: forms (manual) ⇄ AI assist  |  live A4 preview (updates as you type)
        → Export: PDF and/or DOCX (from the selected template)
```

**Layout:** two-pane on desktop (forms left, live paginated A4 preview right); stacked with a
"Preview" toggle on mobile (§10 mobile-first, §7 input-capability rules). Preview updates on a
~150–300 ms debounce. Switch page size to **A4** (or make it a template/setting) per requirement.

---

## 6. Export pipeline impact

- **PDF:** client-side `pdf(<Template data/>).toBlob()` → download. Server `/generate` endpoints
  stay as a fallback during migration, then retire for these three once parity is proven.
  **Referral letters are unrelated** — they keep their own pdfkit + outbox pipeline; do not touch.
- **DOCX (new):** client-side from the same structured data via the `docx` library
  (`Packer.toBlob()`), per-template mapping. DOCX is a parallel renderer off the same model —
  "clean and correct," not pixel-identical to the PDF (industry-normal).
- **Consistency:** PDF preview and PDF export are the same component (no drift). DOCX is a
  documented separate mapping.

---

## 7. Database requirements

**v1 needs zero migrations** (deliberate, to stay low-risk on live TiDB):
- Drafts already exist (`resumes.resume_data`, cover/resignation draft tables). Add `templateId`
  to the cover/resignation draft JSON — no DDL.
- Templates = code registry — no DDL.
- **Deferred, may justify one additive migration later:** version history
  (`document_versions(user_id, doc_type, snapshot_json, created_at)`, §0.6); a stored "My
  Documents" library (durable base64 per §0.13). Both out of v1.

---

## 8. Scalability

- Client-side rendering scales for free — preview + export run on the user's device; **no added
  server CPU, no Puppeteer memory, no impact on the §25 infra roadmap.**
- Adding a template = adding a file (O(1)); adding a doc type = a schema + template set + prompt
  map (the framework is reused). AI stays behind `aiClient` (failover + breaker, §17) + rate limit.

---

## 9. Risks & mitigations

| Risk | Sev | Mitigation |
|---|---|---|
| **Breaking the resume→scorer coupling** | High | §12 — hard constraint; structured JSON + `/resume/draft` contract unchanged; templates render *from* the model. |
| Preview/export drift | High | Track A = one renderer; drift impossible by construction. |
| react-pdf CSS limits bite a template | Med | Phase 0 spike on the 2–3 hardest templates before committing; pdfkit fallback. |
| Client export fails on old browser | Med | Fall back to server pdfkit `/generate` (0.1 — export never hard-fails). |
| DOCX fidelity vs PDF | Low/Med | Set expectations: DOCX editable/clean, PDF pixel-perfect. |
| Regression across 3 builders during unification | Med | Migrate **resume first**, prove parity, then fold in cover + resignation; keep old routes live until parity. |
| Bundle size (PDF/DOCX libs) | Low | Route-lazy the builder chunk (already the pattern in `App.jsx`). |

---

## 10. Development phases

- **Phase 0 — Spike & ratify. ✅ DONE (2026-08-08) — GO.** Prototyped react-pdf with 2 resume
  templates (Modern flexbox + skill chips; Professional serif + rules) at A4, off the real draft
  shape, on a public standalone route `/spike/resume-templates`
  (`src/components/spike/{resumeTemplates,ResumeTemplateSpike}.jsx`). **Verified in-browser:** the
  `<PDFViewer>` produced a real `blob:` PDF; editing a field regenerated it live (WYSIWYG);
  template switch worked; the `pdf().toBlob()` export ran; **zero console errors**. CSS subset is
  sufficient (flexbox, accent headings, chips, serif, rules, A4, `wrap={false}` — no CSS grid
  needed). **One caveat:** react-pdf adds ~1.44 MB / **484 KB gzip** to the builder route — but it's
  **route-lazy** (its own chunk; the main entry stayed 145 KB gzip), so it loads only when the
  builder opens. Acceptable vs. the alternative (server Chromium). ⚠️ The spike route is
  unauthenticated — **remove it (and the two spike files) before any production deploy**; keep
  `@react-pdf/renderer` (Phase 1 uses it).
- **Phase 1 — Framework + Resume.** `DocumentBuilder` shell, schema-driven forms,
  `useDocumentDraft`/`useDocumentAI`, Template Gallery, live preview, client PDF export. Migrate
  Resume first (exercises the scorer coupling, §12). Remove `CreationModal`; Dashboard → gallery.
  Keep pdfkit fallback.
- **Phase 2 — Cover Letter + Resignation** onto the framework; delete the duplicate builder files;
  retire `?mode=` everywhere.
- **Phase 3 — DOCX export** from the shared model (`docx`).
- **Phase 4 — Polish/extensibility:** theme variants/inheritance, A4/Letter toggle, richer
  library, mobile preview refinement, change-template-mid-edit.
- **Deferred (later milestones):** version history (one migration), saved "My Documents" library,
  user/admin-managed templates.

**Complexity: Medium-High, front-loaded.** Phase 1 is the bulk; 2–4 are cheap (framework reused).
Net churn deletes ~2 of 3 duplicate builders — a maintainability win.

---

## 11. Pre-flight (folds into `SKILL.md` §16)

Schema-driven, structured JSON preserved (§12); no migration in v1; templates render from the
model; export degrades to pdfkit fallback; card system + empty states + design tokens; A4;
mobile preview toggle; referral-letter pipeline untouched.

---

## 12. HARD CONSTRAINT — preserve the Resume Assistant → AI Scoring synchronization

**This platform must NOT decouple the Resume Assistant from the AI Compatibility Scoring engine.**
The sync between the builder, `uploaded_resumes.parsed_text`, and the scorer keeps the Job Seeker
profile, AI scores, the PESO ATS pipeline, the Smart Referral Queue, and AI-Recommended rankings
consistent. It is core business logic (§7.4, §18.5), not an implementation detail.

**Binding rules for all builder work:**
1. **The résumé stays structured JSON.** No move to freeform rich text/HTML for the resume — a
   template is presentation only; the data model that syncs to `parsed_text` is unchanged.
2. **The `/resume/draft` contract is unchanged.** It still persists JSON, syncs
   `uploaded_resumes.parsed_text`, and honours the client `rescore` flag
   (`resumeRoutes.js:130`, locked by `test/resumeRescoreGating.test.js`).
3. **`parsed_text` persistence stays unconditional** — never gate the text sync on the preview or
   template; the ATS view and the scorer input must never desync.
4. Templates, preview, and export are **downstream of** the structured model and never feed the
   scorer a different representation.

**Change-detection gating (IMPLEMENTED 2026-08-08 — the trigger optimization, not decoupling).**
Re-scoring already fires only on *meaningful* content change, via two defense-in-depth layers that
neither can swallow a real re-score:
- **Client layer (existing):** the builder computes an `aiSignature` over only the fields the
  scorer reads (summary/experience/education/skills) and sends `rescore: false` for cosmetic-only
  saves (`ResumeBuilder.jsx:32`); the backend gates the enqueue on `rescore !== false`
  (default-true). Opening/tab-switch/no-op autosave schedule nothing.
- **Server layer (new, ship-dark, migration 038):** the scoring **worker** computes a SHA-256 of
  the exact assembled scoring prompt (`aiScoringService.computeScoringSignature`,
  whitespace-normalized) and, when it matches `job_applications.last_scored_input_hash` from the
  last **successful** score, completes the job **without an AI call**. Safe because scoring is
  deterministic (temp 0, §21) — identical inputs yield an identical score. The guard is at
  **execution, not scheduling** (a mistake costs one redundant call, never a swallowed re-score),
  the hash covers exactly what's scored (built from the shared `buildScoringPrompt`, so no drift),
  it's written only on a real score (an AI outage can't poison the baseline). Flag
  `SCORING_INPUT_HASH_GUARD` — **applied + set true in prod (2026-08-08) → LIVE + verified** (§29).
  Files: `migrations/038_scoring_input_hash.sql`, `services/aiScoringService.js`,
  `repositories/applicationScoringRepository.js`, `services/applicationScoringWorker.js`,
  `test/scoringInputHashGuard.test.js`.

This is why the reverted server-side dirty-check (§18.5, `2464403`) is **not** repeated: that one
gated *scheduling* and silently swallowed real re-scores; this gates *execution* and cannot.

**Contract integrity across the chain (unchanged by any builder work):**
Resume Assistant → parsing → `parsed_text` persistence (unconditional) → scoring queue (enqueued on
real change) → scoring worker (input-hash skip when unchanged; NULL/apply-time-immutable rules
intact) → Applicant Pipeline (`current_match_score`; a skip keeps the deterministically-identical
value) → Smart Referral Queue / AI-Recommended (staging only after a real score; invariant 0.4).
