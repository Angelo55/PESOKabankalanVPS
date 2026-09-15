# Compliance & Security Runbook — owner/operational actions (2026-09)

These items came out of the system audit (`docs/system-audit-2026-09.md`) but are **human or
dashboard actions that cannot be done in code** — they need someone with the Google/Render/
Cloudflare consoles, or the PESO/LGU's authority as the data controller. The **code side** of
each (where one exists) is already shipped; this runbook is the remaining one-step-each list.

---

## 1. Secret rotation  ⚠️ do before public launch

Secrets were previously committed to the repo (and remain in git history). **Rotating the value
makes the leaked copy dead**, which is faster and safer than trying to scrub history. Code that
embedded a fallback secret has been fixed (§56/§58) so nothing depends on the leaked values — but
that means the env vars below MUST be set or the feature breaks.

| Secret | Rotate where | Then set on Render | Notes |
|---|---|---|---|
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → the OAuth 2.0 Client → **Reset secret** | env `GOOGLE_CLIENT_SECRET` | The hardcoded fallback was removed (`authRoutes.js`) — Google sign-in now REQUIRES this env var. |
| `JWT_SECRET` | Generate a new long random value (e.g. `openssl rand -hex 48`) | env `JWT_SECRET` | Rotating **invalidates all existing sessions** (everyone re-logs-in) — do it in a low-traffic window. The socket `'fallback_secret_key'` was removed (`socketServer.js`), so this must be set. |
| R2 API token | Cloudflare → R2 → Manage API Tokens → roll the token | env `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Secret was pasted in chat (2026-09). Public bucket URL is unaffected. |

After rotating, redeploy Render so the new values load. Optional: purge the old `.env` from git
history with `git filter-repo`/BFG — but once rotated, the old values are inert.

---

## 2. NPC (National Privacy Commission) registration  — PESO/LGU responsibility

An employment portal processing residents' PII (names, contacts, résumés, employment history)
falls under the **Data Privacy Act of 2012 (RA 10173)**. The data controller (PESO Kabankalan /
the LGU) should, if not already done:

- [ ] **Designate a Data Protection Officer (DPO)** and register their contact with the NPC.
- [ ] **Register the data processing system** at register.privacy.gov.ph (NPC registration is
      generally required when processing sensitive personal information or the data of ≥1,000
      individuals — an employment portal typically qualifies).
- [ ] Maintain a **Record of Processing Activities** (what is collected, why, where it flows —
      the subprocessor list in the Privacy Policy is the starting inventory: DeepSeek/OpenRouter,
      DeepL, Cloudflare R2, the email provider, Google sign-in).
- [ ] Have a **personal-data-breach response procedure** (72-hour NPC notification rule).

This is an organizational/legal filing, not a code task.

---

## 3. Data retention period  — decision needed, then encode it

The Privacy Policy currently says data is kept "as long as your account remains active or as
required by Philippine data-retention rules" — it names **no concrete period**. Decide one
(with the DPO / records officer), aligned with DOLE/LGU records schedules. A reasonable starting
proposal to react to:

- **Active accounts:** retained while active.
- **Inactive job-seeker accounts:** anonymize or delete **N years** after last login (suggest
  3–5 yrs).
- **Application / referral / placement records:** retained per DOLE reporting needs (these feed
  the Accomplishment Report), then archived/anonymized.

Once the number is set: (a) update the retention wording in `components/legal/legalContent.jsx`
(§57 — one source, flows to the modals + `/privacy` page), and (b) a scheduled purge/anonymize
job can be built to enforce it (deferred code item — not yet implemented).

---

## 4. DPO / counsel sign-off on the legal wording

The Privacy Policy, Terms, and Cookie Policy (in `components/legal/legalContent.jsx`, rendered on
`/privacy`·`/terms`·`/cookies` and the signup modals) are **accurate to the system** but are
drafting, not legal sign-off. Have the designated DPO / counsel review before public launch,
specifically:

- [ ] The subprocessor list + **cross-border transfer** basis (AI/email providers process abroad).
- [ ] The **retention period** (once §3 is decided).
- [ ] The **data-subject request** process (access/correction/deletion — currently "via account
      settings or the PESO office").
- [ ] Terms: liability, acceptable use, suspension grounds for a government service.

---

## Code side — already shipped (for reference)
- Removed the hardcoded `GOOGLE_CLIENT_SECRET` fallback (`authRoutes.js`) and the
  `'fallback_secret_key'` socket JWT fallback (`socketServer.js`) — §58.
- Privacy Policy corrected + subprocessors disclosed + cookie notice — §56.
- Standalone legal pages + one shared content source — §57.
- Socket.IO send throttle + content cap; body-size limit 50mb→15mb; vacancy-panel dialog
  semantics + Escape — §58.
