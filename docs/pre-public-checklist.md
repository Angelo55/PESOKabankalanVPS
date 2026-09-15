# Pre-Public Checklist — rotate secrets before the repo goes public

**Why this exists.** `.env` was committed earlier in this repo's history, so every
secret it ever held is recoverable from the git history even though `.env` is now
gitignored. Removing the file now does **not** un-leak it. Before the repository is
ever made public (or shared beyond the current trusted circle), **rotate every
secret below** — generate a new value at the provider, update the deployment env
(Render), and invalidate the old one. Rotating is the only real fix; scrubbing git
history is secondary and easy to get wrong.

> This is a checklist, not an automated task — each rotation happens in the
> provider's own console. Work top-down; the auth/DB ones are the highest blast
> radius.

## Rotate (highest blast radius first)

- [ ] **`JWT_SECRET`** — signs every auth token **and** peppers the OTP hash
      (`otpService`). Rotating it invalidates all existing sessions (users re-login)
      and any in-flight OTP codes — expected and fine. Highest priority: a leaked
      JWT secret lets anyone mint valid tokens for any account.
- [ ] **Database (`DB_PASSWORD`, and rotate `DB_USER` if feasible)** — the TiDB
      account. A leak is full read/write to live citizen data. Rotate in the TiDB
      console, update Render env, redeploy.
- [ ] **Email primary (`EMAIL_APP_PASSWORD` / `EMAIL_PASS`)** — the Gmail app
      password. Revoke it in the Google account's App Passwords and issue a new one.
- [ ] **Email fallback (`EMAIL_FALLBACK_PASS`)** — the Brevo SMTP key. Regenerate
      it in Brevo → SMTP & API; the old key stops working immediately.
- [ ] **`OPENROUTER_API_KEY`** — regenerate in the OpenRouter dashboard.
- [ ] **`DEEPSEEK_API_KEY`** — regenerate in the DeepSeek console (still used by
      some direct calls).
- [ ] **`DEEPL_API_KEY`** — regenerate in the DeepL account.
- [ ] **Google OAuth (`GOOGLE_CLIENT_SECRET`)** — rotate the client secret in the
      Google Cloud Console (OAuth credentials). The client id is not secret.

## Deprecated / dead — remove from env, no rotation needed

- [ ] `PDFMONKEY_API_KEY`, `COVER_LETTER_TEMPLATE_ID` — PDFMonkey was retired
      (self-hosted pdfkit now). Delete the lines.
- [ ] `CORESIGNAL_API_KEY` — superseded; delete if present.
- [ ] Any `GITHUB_*` OAuth vars — GitHub OAuth was fully removed. Delete.

## After rotating

- [ ] Confirm the app still boots and a login + an OTP signup + a test email all
      work against the new values (Platform Health `/admin/health` covers DB, mail,
      and AI at a glance).
- [ ] Consider scrubbing `.env` from git history (`git filter-repo` or BFG) **after**
      rotation — but treat rotation as the real fix; history scrubbing is defence in
      depth, and every fork/clone already made keeps the old history.
- [ ] Verify `.gitignore` still excludes `.env` (it does) and that no `.env`,
      `.env.*`, or `* copy` backup file is tracked (`git ls-files | grep -i env`).

_Referenced from the architecture skill §3 ("`.env` still exists in the GitHub
history — rotate all secrets before ever making the repo public")._
