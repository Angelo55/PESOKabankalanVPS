# SMS Notification Channel — Evaluation & Architecture (#8)

**Status (2026-08-23): ARCHITECTURE BUILT + provider-agnostic. Production SMS via
Semaphore is DEFERRED (unfunded).** The full channel is implemented and tested behind
a swappable provider abstraction; it ships **dark** (nothing sends unless a provider is
configured AND `sms_notifications_enabled` is on AND the recipient has a verified,
opted-in phone). See **§8 "Deferred — production Semaphore rollout"** below for why it
is on hold and exactly how to resume. A zero-cost **`console` dev provider** validates
the whole workflow without credits (§6).

## 1. Why
Walk-in and rural Job Seekers (#7) may have no Gmail, no reliable internet, or only a
basic phone. Email + in-app alone can't reach them. SMS closes that gap for the
critical events: **application status, referral issued/accepted, event announcements.**

## 2. Target architecture — channel-based notifications
Today `notificationService` writes an **in-app** row (+ socket), and email is a
*separate* path (`mailService`/`email_outbox`). The proposal unifies delivery behind
one router so business logic isn't duplicated per channel:

```
Domain event  →  notificationService (single writer)  →  Channel Router
                                                            ├─ In-App   (always — the durable row, §0.11)
                                                            ├─ Email    (if a verified email exists)
                                                            └─ SMS      (if a verified phone + opt-in exist)
```

- **In-app stays the durable deliverable** (row first, §0.11). Email/SMS are
  best-effort side channels chosen by the recipient's **available + verified** contact
  info — so a walk-in with a phone but no email gets SMS + in-app; an online seeker
  gets email + in-app.
- **One business rule, many channels:** call sites keep calling `notifyUser(...)`; the
  router decides the channels from the recipient. No per-channel duplication.
- **SMS behind an abstraction** (`services/smsService.js`, already scaffolded): callers
  use `sendSms()`/`isSmsConfigured()`; the concrete provider is env-selected and hidden,
  so switching providers is an env change, not a rewrite.

## 3. Provider evaluation
| Provider | Fit | Cost / msg (PH) | Delivery status | Notes |
|---|---|---|---|---|
| **Semaphore** (PH-local) | **Recommended to spike first** | ~₱0.50–1.00/credit | Status API + webhooks | PH-focused, sender-name (no long code), simple `POST /v4/messages`. Lowest friction for a Kabankalan LGU. |
| **Twilio** | Robust fallback | ~$0.02–0.05 + number rental | Excellent callbacks/retries | Best DX/reliability; higher cost, needs a messaging number/sender registration. |
| **Movider / iTexMo / Vonage** | Alternatives | low–mid, local | varies | Viable if Semaphore/Twilio don't fit procurement. |

**Recommendation:** spike **Semaphore** (register the LGU sender name), keep **Twilio**
as the abstraction's second provider. Both are already stubbed in `smsService.js`.

Per-provider due diligence to confirm before enabling: **cost/message, monthly cap,
rate limits, delivery-status callbacks, retry/failed handling, opt-in/consent, phone
verification, sender-name/number registration, template approval.**

## 4. Data model (proposed migration, additive)
```
users.phone_verified_at DATETIME NULL       -- set after an OTP-to-phone succeeds
users.sms_opt_in        BOOLEAN DEFAULT 0    -- explicit consent to receive SMS
sms_outbox (                                 -- mirrors email_outbox (§18.3)
  id, user_id, to_number, template_key, body,
  status ENUM('pending','processing','sent','failed'),
  provider, provider_message_id, attempts, next_run_at, created_at )
```
`users.phone` already exists (used by the profile + walk-in). Drain `sms_outbox` with an
`smsWorker` following the **same outbox pattern** (§7.5/§18.1 — the 7th worker: atomic
claim, backoff, dead-letter, stuck-reclaim). **No new async mechanism** (§0.5/§7.5).

## 5. Consent, verification, templates, audit
- **Opt-in + phone verification first:** OTP to the phone (reuse the §7.9 discipline —
  `crypto.randomInt`, TTL, attempt caps) before any SMS; `sms_opt_in` gate on top.
- **Templates keyed** (`REFERRAL_ISSUED`, `EVENT_ANNOUNCEMENT`, `APPLICATION_STATUS`…),
  centralized — not inline strings.
- **Delivery status + retries** via the outbox + provider callback; dead-letter surfaces
  on a Super Admin monitor (like Email Delivery, §18.3).
- **Audit** every send in the outbox; never log full PII message bodies in plain logs.
- **Cost control:** per-day caps + candidate limits (like job alerts, §18.7).

## 6. Rollout (flag-gated, ship-dark) — **DELIVERED**
1. ✅ `smsService` abstraction — inert (`SMS_PROVIDER` unset ⇒ no-op).
2. ✅ Semaphore `send()` HTTP call implemented (form-encoded `POST /api/v4/messages`,
   number sent without the leading `+`, optional `SEMAPHORE_SENDER_NAME`). Twilio kept
   as a ready stub to prove swappability.
3. ✅ Migration **044** (`sms_outbox`, `phone_verifications`, `users.phone_verified_at`
   / `sms_opt_in`) + `smsOutboxRepository`/`smsOutboxService`/`smsWorker` (the 7th
   outbox worker) + `phoneVerifyService` (OTP-to-phone) + the seeker phone-verify/opt-in
   UI (`components/profile/SmsAlertsCard.jsx`).
4. ✅ **Channel router** in `notificationService` (in-app always, §0.11; SMS to a verified
   + opted-in phone) behind `sms_notifications_enabled`. SMS fan-out types:
   `REFERRAL_ISSUED`/`REFERRAL_ENDORSEMENT` and the account-lifecycle pair
   `ACCOUNT_SUSPENDED`/`ACCOUNT_REACTIVATED`. Super Admin **SMS Delivery** monitor at
   `/admin/sms`. **Dedupe buckets (2026-08-24):** the fan-out dedupe key uses an HOUR
   bucket for referral events (absorbs a pipeline double-fire) but a **per-MINUTE** bucket
   for the deliberate `ACCOUNT_*` lifecycle actions, so every real suspend/reactivate sends
   (an hour bucket had suppressed a repeat suspension). **Actionable links** via
   `utils/appUrl.js` (env-driven base URL): referral SMS → `/referrals`, reactivation
   email+SMS → sign-in; **walk-in claim SMS → `/claim`** (absolute link + code + "open &
   enter code to activate" instruction; `claimBaseUrl()` now uses `appUrl`, fixing a
   relative-`/claim` fallback when `FRONTEND_URL` was unset locally); all auth-gated (no
   token, no auto-login). Suspension keeps the office-contact text (a blocked account
   can't sign in).
5. ⏸ **Cohort enable / production rollout — DEFERRED (see §8).**

### Development / testing WITHOUT credits (the `console` provider)
Set `SMS_PROVIDER=console` (alias `log`) and enable `sms_notifications_enabled`. The
`console` provider "delivers" every SMS to the **server log** (the OTP code is printed),
so the entire workflow is exercisable locally at zero cost: phone verification, walk-in
claim phone-OTP, referral SMS fan-out, and the delivery monitor all work end-to-end.
It is DEV-ONLY (never a real carrier) and, being behind the same abstraction, is
replaced by Semaphore later with a single env change — no business-logic change.

### Real-delivery dev testing WITHOUT Semaphore credits (the `textbee` provider, 2026-08-23)
[TextBee](https://textbee.dev) is an open-source SMS gateway that turns a registered
Android phone into the sender — a **temporary, low-cost** way to test REAL delivery while
Semaphore is unfunded. Wired as the `textbee` provider in `smsService.js` behind the same
abstraction (Semaphore untouched). Verified API: `POST https://api.textbee.dev/api/v1/gateway/send-sms`,
header `x-api-key`, JSON `{ recipients:[E.164], message }`; it sends from the phone's own
number so there is **no sender name** (any `TEXTBEE_SENDER_NAME` is ignored) — the **device**
is the endpoint. Env (local/Render only, NEVER committed):
```
SMS_PROVIDER=textbee
TEXTBEE_API_KEY=…            # x-api-key; keep secret, rotate if exposed
TEXTBEE_DEVICE_ID=…         # optional — targets a specific phone; omit to use the default device
```
Then enable `sms_notifications_enabled` + a verified/opted-in phone. Switching back to
`console` or forward to `semaphore` is a one-line env change — no code change.

## 6a. Deferred — production Semaphore rollout (RESUME HERE)
**Why on hold (2026-08-23):** the team cannot fund SMS credits at this stage —
Semaphore quoted ≈ **₱2,800 for 5,000 credits**, and the account (`account_name`
"PESO Kabankalan", `account_id` 81552) is still **`status: "Pending"`** with
`credit_balance: 0`, so live sends return HTTP 403. This is a funding/provisioning
gap, **not** a code gap: the integration authenticates and is otherwise ready.

**Kept intact (do NOT remove/redesign):** `services/smsService.js` (Semaphore + Twilio
providers), migration 044, the outbox/worker/router/monitor/UI, and the
`SMS_PROVIDER`/`SEMAPHORE_*` config. The app runs normally with SMS disabled.

**To resume (no code change unless noted):**
1. Fund + activate the Semaphore account (status → `Active`, load credits). Verify:
   `curl "https://api.semaphore.co/api/v4/account?apikey=KEY"` → `Active`, balance > 0.
2. On the host, set `SMS_PROVIDER=semaphore` + `SEMAPHORE_API_KEY` (and, once a custom
   LGU sender name is APPROVED, `SEMAPHORE_SENDER_NAME`; leave unset to use the default
   sender). Retype on Render — no trailing space (SKILL §13).
3. Enable **SMS notifications** in Super Admin → Settings (`sms_notifications_enabled`).
4. Smoke-test with your own number: Profile → verify phone → opt in → trigger a referral
   → confirm the text + `/admin/sms` shows `sent`. Roll back anytime by flipping the flag
   or unsetting `SMS_PROVIDER` (→ the channel goes dark; in-app + email unchanged).
Optional future work (only if Semaphore proves unreliable/costly): wire the Twilio
`send()` (already stubbed) — again an env change, not a rewrite.

## 7. Invariants to hold
0.1 (an SMS failure never fails the primary action — best-effort, outbox) · 0.11 (in-app
row is the durable deliverable; SMS is additive) · §7.5 (reuse the outbox, no new async) ·
consent/DPA (opt-in + verification required) · cost bounded (per-day caps).

## What's built vs deferred
- **Built (2026-08-23):** the ENTIRE architecture — `smsService` (Semaphore wired +
  Twilio stub + `console` dev provider; `toE164PH`; never throws, §0.1), migration 044,
  `smsOutboxRepository`/`smsOutboxService`/`smsWorker` (7th outbox), `phoneVerifyService`,
  the `notificationService` channel router (referral events only), the `/admin/sms`
  monitor, and the seeker phone-verify/opt-in card. `npm test` covers it
  (`test/smsChannel.test.js`). Validate locally with `SMS_PROVIDER=console` (§6).
- **Deferred (funding):** turning on the **production Semaphore** provider — the account
  is unfunded/Pending (credits ≈ ₱2,800/5,000). Resume steps in **§6a**. Everything is
  kept intact and the app runs normally with SMS disabled; enabling it is env + a flag,
  no code change.
