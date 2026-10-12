# PESO Kabankalan — VPS Deployment Runbook (copy-paste)

Detailed, copy-paste companion to `DEPLOYMENT.md`. Target: **one Ubuntu VPS +
Nginx + PM2**, app on the **Supabase (Postgres)** path, same-origin (no CORS).

Replace every `<PLACEHOLDER>`. The repo root **is** the backend (server.js,
package.json, `ecosystem.config.js` live at the clone root); the SPA is the
`job-tracker-frontend/` subfolder.

| Placeholder | Meaning |
|---|---|
| `<VPS_IP>` | Public IPv4 of your VPS |
| `<SUPABASE_SESSION_POOLER_URL>` | `postgresql://postgres.<ref>:<url-encoded-pw>@aws-0-<region>.pooler.supabase.com:5432/postgres` (Supabase → Settings → Database → Connection string → **Session pooler**) |

Domain: **pesokabankalan.tech** (apex + `www`).

---

## 0. Preconditions
- Ubuntu 22.04+ VPS with a sudo user and public IPv4 `<VPS_IP>`.
- Registrar access for `pesokabankalan.tech` (today its A record points at a Sedo
  **parking IP** `91.195.240.94` — you will repoint it).
- Supabase project already provisioned, schema applied (done).
- The Google OAuth client you already use locally.

## 1. DNS — do this FIRST (cert issuance needs it to resolve)
At your registrar:
- `A  @    -> <VPS_IP>`
- `A  www  -> <VPS_IP>`
- Remove the parking `A` record (`91.195.240.94`). Remove any `AAAA` unless it
  points at the VPS's real IPv6.

Verify before continuing (allow for propagation):
```bash
dig +short pesokabankalan.tech
dig +short www.pesokabankalan.tech
```
Both must return `<VPS_IP>`.

## 2. Server base packages
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs nginx git
sudo npm i -g pm2
node -v && nginx -v && pm2 -v
```

## 3. Clone + install
```bash
sudo mkdir -p /var/www && sudo chown "$USER:$USER" /var/www
git clone https://github.com/Angelo55/PESOKabankalanVPS.git /var/www/pesokabankalan
cd /var/www/pesokabankalan
npm ci
(cd job-tracker-frontend && npm ci)
```
App root = `/var/www/pesokabankalan`. SPA = `/var/www/pesokabankalan/job-tracker-frontend`.

## 4. Backend environment
```bash
cd /var/www/pesokabankalan
cp .env.example .env
nano .env
```
Set at minimum:
- `JWT_SECRET=` → generate: `openssl rand -hex 48`
- `DB_CLIENT=postgres`
- `DATABASE_URL=<SUPABASE_SESSION_POOLER_URL>` — **session pooler**, not the direct
  `db.<ref>.supabase.co` host (that is IPv6-only on the free tier). URL-encode
  special chars in the password (`@`→`%40`, `#`→`%23`, …), or use an alphanumeric one.
- `DB_SSL=true`
- `FRONTEND_URL=https://pesokabankalan.tech`
- `CORS_ORIGINS=https://pesokabankalan.tech,https://www.pesokabankalan.tech`
- `PUBLIC_API_URL=https://pesokabankalan.tech`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (same as local),
  `GOOGLE_REDIRECT_URI=https://pesokabankalan.tech/api/auth/google/callback`
- Email — a VPS allows outbound SMTP, so Gmail works: `EMAIL_USER` +
  `EMAIL_APP_PASSWORD` (or Brevo/Resend HTTP keys).
- `STORAGE_DRIVER=local` (the VPS disk is persistent) **or** keep `r2` + the `R2_*`
  vars if job images already live in R2.
- AI: `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `DEEPL_API_KEY`.
- Feature flags as desired (referral/scoring/proactive/job-alerts).

**`WORKER_MODE`:** leave it — `ecosystem.config.js` sets `WORKER_MODE=web` for the
API process and runs the workers in the separate `peso-worker` process. Don't also
run workers in the API.

## 5. Frontend env + build — ON THE VPS
```bash
cd /var/www/pesokabankalan/job-tracker-frontend
cp .env.example .env
nano .env    # VITE_API_URL=https://pesokabankalan.tech/api  ;  VITE_GOOGLE_CLIENT_ID=<public client id>
npm run build   # emits dist/ with the PROD API URL baked in
```
> `VITE_*` values are **baked into the build**. Never deploy a `dist/` built with a
> localhost `VITE_API_URL` — users' browsers would call localhost. Always build on
> the VPS (or with prod env).

## 6. Start with PM2
```bash
cd /var/www/pesokabankalan
pm2 start ecosystem.config.js
pm2 save
pm2 startup      # run the exact command it prints (installs the systemd unit)
pm2 logs peso-api --lines 50
```
Expect in the log: `[DB] Connected (postgres) to …` + `[DB] Server: PostgreSQL 17.x`
and `[Mail] Provider 'primary' verified.` `peso-worker` should log its six workers.

## 7. Nginx + HTTPS
```bash
sudo cp /var/www/pesokabankalan/deploy/nginx.conf.example /etc/nginx/sites-available/pesokabankalan
# confirm `root` = /var/www/pesokabankalan/job-tracker-frontend/dist  (it already is)
sudo ln -s /etc/nginx/sites-available/pesokabankalan /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d pesokabankalan.tech -d www.pesokabankalan.tech
sudo systemctl reload nginx
```

> **Renewal check (2026-10-13):** a certificate issued in `standalone` mode cannot renew while Nginx holds port 80.
> Confirm `sudo grep -E "^(authenticator|installer)" /etc/letsencrypt/renewal/pesokabankalan.tech.conf` shows
> `nginx` for both (edit them if not), then `sudo certbot renew --cert-name pesokabankalan.tech --dry-run`.
> Current host: public `13.215.135.101` (dev-history §74.8); the old `56.10.113.135` is gone.

## 8. Google console (OAuth for the domain)
Google Cloud → APIs & Services → Credentials → your OAuth client:
- Authorized JavaScript origins: `https://pesokabankalan.tech`
- Authorized redirect URIs: `https://pesokabankalan.tech/api/auth/google/callback`
Keep the localhost entries for dev.

## 9. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 10. Validate (the go-live checklist)
```bash
curl -s https://pesokabankalan.tech/api/health          # {"status":"success",...}
```
- `https://pesokabankalan.tech` loads over HTTPS; no CORS/socket errors in the console.
- `pm2 logs peso-api` shows `[DB] Connected (postgres)` + mail verified.
- Google login + one authed action round-trips.

## 11. Ops notes (read these)
- **Logs & observability:** where every log lives (PM2 backend, Nginx, journalctl,
  Supabase DB dashboard, Brevo email dashboard, in-app Health) + a symptom→log cheat
  sheet + PM2-logrotate setup → **`docs/observability-and-logs.md`**. First stop for
  almost anything: `pm2 logs peso-app`.
- **Supabase free tier PAUSES on idle** → the first request after idle can fail
  (the `econnrefused` we hit during setup). The app degrades gracefully (no crash),
  but users see errors until it wakes. Mitigate with a keep-alive cron —
  `*/5 * * * * curl -s https://pesokabankalan.tech/api/health >/dev/null` — or a paid
  Supabase tier. For a government-facing service, plan for this.
- **Migrations:** on the Postgres path the schema is owned by `postgres/schema.sql`
  (already applied to Supabase) and `initDB()` never runs. `npm run migrate`
  (`scripts/migrate.js`) is the **MySQL/TiDB** path — do **not** run it against
  Supabase. New Postgres DDL goes through a Supabase migration / `schema.sql`.
- **Deploys/updates:**
  ```bash
  cd /var/www/pesokabankalan && git pull
  npm ci && (cd job-tracker-frontend && npm ci && npm run build)
  pm2 reload ecosystem.config.js
  ```
- **Secrets:** never commit `.env`; rotate anything exposed. `trust proxy` is already
  set in the app (§50.1), so `req.ip` is correct behind Nginx.
- **`.env` for the two PM2 processes** is the single `/var/www/pesokabankalan/.env`
  (both processes load it); only `WORKER_MODE` differs, and PM2 sets that per process.
