# Make.com Migration Guide — rebuilding the PESO referral automation (2026-09)

A complete, click-by-click guide to reproduce your one n8n workflow ("My workflow 2") as a Make.com
scenario, with idempotency and credit safety. **Behaviour is identical — only the host changes.**

Your n8n workflow is 3 linear nodes: **Webhook (`POST /referral-completed`) → Google Sheets: Append
Row → Send Email (SMTP)**. We rebuild exactly that, and add one idempotency guard n8n didn't have.

---

## 0. What the backend sends (the contract)

When a referral is fully complete, the backend POSTs this JSON to the automation webhook:

```json
{
  "event": "referral.completed",
  "referenceNumber": "REF-2026-0001",
  "matchScore": 87,
  "reviewedAt": "2026-09-13T02:15:00.000Z",
  "applicant": { "name": "Juan Dela Cruz", "email": "juan@example.com" },
  "job":       { "title": "Warehouse Associate", "company": "ABC Trading" },
  "employer":  { "name": "ABC Trading HR", "email": "hr@abctrading.com" },
  "reviewer":  "PESO Kabankalan"
}
```

> ⚠️ **Key difference from n8n:** n8n exposed these under `$json.body.…`. **Make's custom webhook
> exposes them at the top level** of the webhook module's output, so your mappings are
> `{{1.referenceNumber}}`, `{{1.applicant.name}}`, etc. — **no `.body`**. (`1` = the webhook module.)

---

## 1. Prerequisites

- A free **Make.com** account (Europe or US region is fine).
- The **Google account** that owns the Sheet **"PESO Referral Report"**
  (`https://docs.google.com/spreadsheets/d/19f0hCK6hy7cf977N0n6lVaJGfTWd-MhPrxVUeF2e7KA`). Its
  `Sheet1` already has the 7 header columns (Reference Number, Applicant, Applicant Email, Job Title,
  Company, Match Score, Reviewed At).
- A **Gmail** (or SMTP) account for the notification email.
- Access to the **Render** dashboard (to set `AUTOMATION_WEBHOOK_URL`).

---

## 2. Build the scenario

### Module 1 — Custom webhook (the trigger)
1. Create a new scenario → click the first module → search **Webhooks** → **Custom webhook**.
2. **Add** a webhook, name it `peso-referral-completed` → **Save**.
3. Make shows a URL like `https://hook.eu2.make.com/xxxxxxxx`. **Copy it** — this replaces your n8n
   `/webhook/referral-completed` URL. (You'll paste it into Render in step 4.)
4. Leave it listening; you'll feed it a sample in step 5 so Make learns the data shape.

### Module 2 — Idempotency guard (Data Store: get)
This is the one thing to ADD so a retry or an admin **Replay** can't double-log / double-email.
1. First create the store: left sidebar → **Data stores** → **Add** → name `peso_referrals_done`,
   Data structure → **Add** a field `key` (Text). Small; the free plan includes it.
2. Back in the scenario, add **Data store → Get a record**:
   - Data store: `peso_referrals_done`
   - Key: `{{1.referenceNumber}}`
   - **If "Get a record" errors with "record not found" on a NEW reference number:** that's expected
     (nothing to get yet). Right-click the module → **Add error handler → Resume** (return an empty
     record) so a first-time referral doesn't halt the scenario.
3. Add the **Filter on the connector that LEAVES this module** — i.e. the line **between
   "Data store – Get a record" (module 2) and "Google Sheets – Add a Row" (module 3)**, NOT the line
   going *into* module 2. (A filter reads the output of the module *before* it; placing it before
   module 2 gives Make's error *"Filter … references inaccessible module … [2]"* because module 2
   hasn't run yet.) Click the wrench/spanner on that outgoing connector → **Set up a filter**:
   - Label: `not yet processed`
   - Condition: `Data store – Get a record: Key` (`{{2.key}}`) → **Does not exist** (i.e., the record
     wasn't found → first time we've seen this reference number). Only then do the Sheet + email run.

> Simpler alternative if you'd rather not use a Data Store: a **Google Sheets → Search Rows** filtered
> by Reference Number, then a filter. But Search Rows emits nothing when there's no match (so it can't
> gate "run only if absent") — the Data Store pattern above is the clean, reliable one.
>
> Robust alternative (no filter): make **module 2 = Data store → Add a record** (key =
> `{{1.referenceNumber}}`). A duplicate key ERRORS — attach an error handler set to **Ignore** so a
> repeat exits quietly; a new key succeeds and continues. This uses the insert itself as the lock, so
> you can drop the separate "mark processed" module (step 2.5).

### Module 3 — Google Sheets: Add a Row
1. Add **Google Sheets → Add a Row**. Connect your Google account.
2. Spreadsheet: **PESO Referral Report** (search by name, or paste the ID above).
3. Sheet: **Sheet1**.
4. Map the 7 columns **exactly** (this mirrors the n8n node one-for-one):

   | Sheet column | Value to map |
   |---|---|
   | Reference Number | `{{1.referenceNumber}}` |
   | Applicant | `{{1.applicant.name}}` |
   | Applicant Email | `{{1.applicant.email}}` |
   | Job Title | `{{1.job.title}}` |
   | Company | `{{1.job.company}}` |
   | Match Score | `{{1.matchScore}}` |
   | Reviewed At | `{{1.reviewedAt}}` |

### Module 4 — Send the notification email
Add **Gmail → Send an Email** (or **Email → Send an Email** for SMTP). Connect the account, then:

- **To:** see the recipient decision below. To match n8n **exactly**, use `angelopamalacsao@gmail.com`.
  To send to the actual employer (recommended), use `{{1.employer.email}}`.
- **Subject:** `New PESO Referral: {{1.applicant.name}} for {{1.job.title}}`
- **Content type:** Text (plain)
- **Body** (mirror the n8n template verbatim):
  ```
  {{1.employer.name}},

    PESO Kabankalan has referred {{1.applicant.name}} for your {{1.job.title}} vacancy.

    Reference: {{1.referenceNumber}}
    AI Compatibility: {{1.matchScore}}%

    The applicant has been notified and issued an official referral letter.
  ```

> 📌 **Recipient plan (decided):** use **your own address** (`angelopamalacsao@gmail.com`) for now so
> the end-to-end test doesn't email real employers. **Once the flow is verified end to end, switch the
> To field to `{{1.employer.email}}`** so the notification reaches the actual employer. (The payload
> already carries `employer.email`; nothing else changes.)

### Module 5 — Data store: mark processed
Add **Data store → Add/replace a record** (so the next duplicate is caught by module 2):
- Data store: `peso_referrals_done`
- Key: `{{1.referenceNumber}}`
- (field `key` can just be `{{1.referenceNumber}}` too)

### Module 6 — Webhook response (200)
Add **Webhooks → Webhook response** as the LAST module:
- Status: `200`
- Body: `OK`

This makes the backend receive `200` only **after** the Sheet + email succeed, so the backend's
retry/Undispatched logic stays meaningful (if a module errors, the webhook returns non-2xx and the
backend retries with backoff, then shows it on the Workflow Automation page for a manual replay).

**Save** the scenario and toggle it **ON** (scheduling: "Immediately", the default for webhooks).

---

## 3. Connect the backend (Option 2 — already coded)

The backend now reads a provider-neutral variable (with the old n8n one as fallback):

- On **Render** → your backend service → **Environment** → add:
  `AUTOMATION_WEBHOOK_URL = <the Make webhook URL from step 2.3>`
- (Optional) `AUTOMATION_DISPATCH_TIMEOUT_MS` (default 15000).
- Remove/ignore the old `N8N_WEBHOOK_URL` once you've cut over (it's only a fallback now).
- **Redeploy** so the new env var loads.

No code change is needed for the switch — the Super-Admin **Workflow Automation** page and the
referral pipeline already point at whatever URL is configured.

---

## 4. Test end-to-end (against the real backend)

1. In Make, run the scenario **once** ("Run once") so it's listening.
2. Trigger a real `referral.completed`: sign in as **Super Admin → Workflow Automation**, or as the
   PESO admin, and use the **Replay** button on a completed referral (or approve a test referral end
   to end). The backend will POST to your Make webhook.
3. Verify: **(a)** a new row in the "PESO Referral Report" sheet, **(b)** the notification email
   arrives, **(c)** Make's execution log shows all modules green, **(d)** the backend's Workflow
   Automation page shows the referral as **Dispatched** (not Undispatched).
4. **Idempotency check:** hit **Replay** again on the SAME referral → the scenario should run module 1
   → 2, then **stop at the filter** (no new row, no second email). That proves the Data Store guard.

---

## 5. Cutover & retire n8n

1. Run **parallel** for a few real referrals if you like (point Render at Make while n8n still exists;
   only one URL is active at a time, so use the Replay button to re-drive a couple through Make).
2. Once verified, leave `AUTOMATION_WEBHOOK_URL` = Make in Render.
3. **Retire n8n:** turn off the n8n workflow and shut down the self-hosted instance — this removes the
   hosting + maintenance burden that motivated the migration. The backend keeps working regardless
   (invariant 0.10: referrals complete even with no automation).

---

## 6. Credit budget & monitoring (Free = 1,000 ops/month)

- **Per referral ≈ 4–6 ops:** webhook + data-store get + (filter, free) + sheet add + email + data-store
  add + response. Call it ~6 in the worst case.
- At, say, 100 completed referrals/month that's ~600 ops — inside 1,000. The **idempotency filter also
  saves credits**: a duplicate exits after ~2 modules.
- Watch **Make → Organization → Usage**. If you ever approach the cap, the downstream design means
  **referrals are never blocked** — un-synced ones just queue on the Workflow Automation page for a
  later replay (e.g., early next month when credits reset).

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Sheet row added but fields blank | You used `{{1.body.…}}` (n8n style). Make has no `.body` — use `{{1.referenceNumber}}` etc. |
| Backend shows referrals as **Undispatched** | Make webhook returned non-2xx or timed out (>15s). Check the Make execution log; ensure the Webhook Response module returns 200. Then **Replay** from the Automation page. |
| Duplicate rows/emails on replay | The Data Store guard (module 2 + filter) isn't gating — confirm the filter is `{{2.key}} Does not exist` and module 5 writes the key. |
| No email | Gmail/SMTP connection not authorized, or the **To** field is empty (check the recipient decision). |
| Webhook never fires | `AUTOMATION_WEBHOOK_URL` not set on Render, or not redeployed; or the scenario is OFF. |
| Credits climbing fast | A module is running on duplicates — verify the idempotency filter; consider batching Sheet writes if volume grows. |

---

## Appendix — n8n → Make node map

| n8n node | Make module | Notes |
|---|---|---|
| Webhook (`POST /referral-completed`) | Custom webhook | New URL → `AUTOMATION_WEBHOOK_URL` |
| *(none)* | Data store Get + Filter | **NEW** idempotency guard |
| Append row in sheet (7 cols) | Google Sheets → Add a Row | Same sheet, same 7 columns |
| Send an Email (SMTP, to owner) | Gmail/Email → Send | Decide: keep `angelopamalacsao@gmail.com` or use `{{1.employer.email}}` |
| *(none)* | Data store Add + Webhook response 200 | **NEW** mark-processed + explicit 200 |
