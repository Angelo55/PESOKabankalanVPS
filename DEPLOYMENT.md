# PESO Kabankalan — VPS + Supabase deployment

This repository is the **VPS / Supabase** implementation line, kept separate from
the original Vercel + Render + TiDB production system. It runs the same
application code with the database re-platformed to PostgreSQL (Supabase) and the
whole stack served from one VPS behind Nginx.

- **App:** Node/Express + Socket.IO API and the six background workers; React/Vite SPA.
- **Database:** PostgreSQL (Supabase), via the mysql2-compatible pg adapter
  (`dbPgAdapter.js`), selected with `DB_CLIENT=postgres`. See `postgres/README.md`.
- **Web tier:** Nginx serves the built SPA and reverse-proxies `/api` + `/socket.io`
  to the Node API (same origin — no CORS needed in that topology).
- **Process manager:** PM2 (`ecosystem.config.js`) — API and workers as two processes.

## Prerequisites

- A VPS (Ubuntu) with Node 20+, Nginx, and PM2 (`npm i -g pm2`).
- A Supabase project with the schema applied (`postgres/README.md` → bootstrap).
- The DNS A/AAAA records for `pesokabankalan.tech` (and `www`) pointing at the VPS.

## Steps

1. **Clone & install**
   ```bash
   git clone https://github.com/Angelo55/PESOKabankalanVPS.git /var/www/pesokabankalan
   cd /var/www/pesokabankalan
   npm ci
   (cd job-tracker-frontend && npm ci)
   ```

2. **Configure environment** — copy the templates and fill in real values.
   ```bash
   cp .env.example .env                                  # backend
   cp job-tracker-frontend/.env.example job-tracker-frontend/.env
   ```
   Set `DB_CLIENT=postgres` and the Supabase `DATABASE_URL` (session-pooler URI,
   `DB_SSL=true`). Set `FRONTEND_URL`/`CORS_ORIGINS`/`PUBLIC_API_URL` to the real
   domain and `GOOGLE_REDIRECT_URI` to match the Google console. **Never commit `.env`.**

3. **Build the SPA**
   ```bash
   (cd job-tracker-frontend && npm run build)   # emits job-tracker-frontend/dist
   ```

4. **Start the app with PM2**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save && pm2 startup      # survive reboots
   ```
   `peso-api` serves the API (`WORKER_MODE=web`); `peso-worker` runs the workers.

5. **Nginx + HTTPS**
   ```bash
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/pesokabankalan
   sudo ln -s /etc/nginx/sites-available/pesokabankalan /etc/nginx/sites-enabled/
   # edit `root` to the absolute dist path, then:
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d pesokabankalan.tech -d www.pesokabankalan.tech
   ```

## Validation checklist

- `curl -s https://pesokabankalan.tech/api/health` → `{"status":"success",...}`
- SPA loads over HTTPS; Socket.IO connects (no CORS/handshake errors in console).
- `pm2 logs peso-api` shows `[DB] Connected (postgres) …` and mail providers verified.
- A login + one authed action round-trips against Supabase.

## Rollback / isolation

This deploy is fully reversible and isolated: the original Vercel + Render + TiDB
production is untouched, and switching this VPS back to MySQL is just
`DB_CLIENT=mysql` + the `DB_*` vars. Nothing here writes to the original
production database.
