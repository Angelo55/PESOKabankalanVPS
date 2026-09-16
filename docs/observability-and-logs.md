# PESO Kabankalan — Logs & Observability (VPS deployment)

**Why this doc exists:** on Render/Vercel you got logs from a web dashboard. This system
now runs on your **own VPS** (AWS EC2 + Nginx + PM2 + Supabase), so most logs live **on
the server** — you read them by SSHing into the EC2 console. A few pieces (database,
email) still have their own web dashboards. This is the complete map: what each log is,
where it lives, how to view it, and when to reach for it.

Mental model of the request path (so you know which log to check):

```
Browser ──HTTPS──> Nginx ──proxy──> Node API (peso-app, PM2) ──> Supabase (Postgres)
                    │                     │                          └─ DB logs → Supabase dashboard
                    │                     ├─ background workers (referrals, email, sms, scoring…)
                    │                     └─ email → Brevo (HTTP API) → Brevo dashboard
                    └─ serves the built SPA (dist) + access/error logs on disk
```

---

## 1. Backend app logs — PM2 (the main one; ≈ Render's backend logs)

**What:** everything the Node app prints — `[DB] Connected`, `[Worker] …`, `[Mail] …`,
errors, stack traces. This is your first stop for almost anything backend.

**Where:** managed by PM2; raw files at `~/.pm2/logs/peso-app-out-0.log` (stdout) and
`~/.pm2/logs/peso-app-error-0.log` (stderr).

**How (run in the EC2 console):**
```bash
pm2 logs peso-app                          # live tail — watch in real time (Ctrl+C to stop)
pm2 logs peso-app --lines 200 --nostream   # print the last 200 lines and exit
pm2 logs peso-app --err  --lines 200 --nostream   # errors/crashes only
pm2 monit                                  # live dashboard in the terminal: CPU/mem + logs
pm2 status                                 # is it online? restart count (↺)? uptime?
pm2 info peso-app                          # details incl. the exact log file paths
```
Grep the raw file for something specific:
```bash
grep -i "\[Mail\]"  ~/.pm2/logs/peso-app-out-0.log | tail -20
tail -f ~/.pm2/logs/peso-app-error-0.log   # follow errors live
```

**When:** app behaving wrong, worker failures, DB connection issues, email/SMS problems,
"did the server restart?" A climbing `↺` in `pm2 status` = the app is crash-looping →
read `--err`.

---

## 2. Web / request logs — Nginx (≈ Vercel's request logs)

**What:** every HTTP request that hit the site (method, path, status code, IP, user-agent)
and web-tier errors (502 Bad Gateway, TLS problems, upstream timeouts).

**Where:** `/var/log/nginx/access.log` and `/var/log/nginx/error.log`.

**How:**
```bash
sudo tail -f /var/log/nginx/access.log     # live request stream
sudo tail -f /var/log/nginx/error.log      # 502s, upstream/TLS errors
sudo grep " 500 " /var/log/nginx/access.log | tail   # find server errors
```

**When:** "is the site even getting requests?", a 502 (means Nginx is up but can't reach
the Node app — check PM2), TLS/cert issues, or to see traffic/abuse patterns.

---

## 3. OS / service logs — journalctl

**What:** systemd service logs (Nginx service, the OS itself), useful when a service
won't start or the box misbehaves.

**How:**
```bash
journalctl -u nginx -f      # follow the nginx service
journalctl -xe              # most recent errors with context
journalctl -f               # follow everything system-wide
```

**When:** Nginx won't start/reload, reboots, out-of-memory kills, disk issues.

---

## 4. Database logs — Supabase dashboard (this one IS a web dashboard)

**What:** Postgres query logs, API/Auth/Storage logs, connection and performance reports.

**Where:** **Supabase Dashboard → your project → Logs** (and **Reports** for metrics).

**When:** slow queries, connection-limit errors, RLS/permission denials, or confirming
the DB side of an issue you saw in the app's `[DB]` lines. The **SQL Editor** (same
dashboard) is where you run read-only checks like `SELECT COUNT(*) …`.

---

## 5. Email logs — Brevo dashboard (web dashboard)

**What:** every transactional email — sent, delivered, bounced, opened, blocked.

**Where:** **Brevo Dashboard → Transactional → Logs / Statistics.**

**When:** "did the OTP / password-reset / notification actually go out?" The app's
`[Mail]` lines tell you it *tried*; Brevo tells you what happened after. Sender is
`mail@pesokabankalan.tech`.

---

## 6. In-app observability (no SSH needed — from the Super Admin portal)

Logged in as Super Admin at https://pesokabankalan.tech/admin:
- **Platform Health** — DB reachability + latency, mail/AI configuration, referral-worker
  stuck/failed counts, object-storage driver. A quick "is everything healthy?" view.
- **Audit** — every admin action (role changes, suspensions, settings changes).
- **Email / SMS delivery monitors** — outbox status for notifications.

**When:** a fast health/operational check without opening a terminal.

---

## 7. Want the Render/Vercel-style WEB dashboard back? → PM2 Plus

Free tier gives a hosted web UI with live logs, CPU/mem metrics, and exception tracking
for `peso-app`. One-time setup on the EC2:
```bash
pm2 plus     # prints a link — open it, sign in, and it connects this server to pm2.io
```
Then you view logs/metrics at app.pm2.io from any browser. (Heavier alternatives if you
ever outgrow it: Better Stack/Logtail, Papertrail, Grafana Loki.)

---

## 8. IMPORTANT — set up log rotation (do this once)

PM2 log files grow **without limit** and will eventually fill the 20 GB disk. Cap them:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M     # rotate a log once it hits 10 MB
pm2 set pm2-logrotate:retain 14        # keep the last 14 rotated files
```
(Nginx logs already rotate automatically via Ubuntu's `logrotate`.)

---

## 9. Cheat sheet — which log for which symptom

| Symptom | Look here first |
|---|---|
| Site won't load at all | `pm2 status` + `/var/log/nginx/error.log` |
| **502 Bad Gateway** | Nginx error log (Nginx is up, Node is down) → then `pm2 logs peso-app --err` |
| App error / worker failing / referral not processing | `pm2 logs peso-app --err --lines 200 --nostream` |
| `[DB]` errors / slow queries / DB unreachable | `pm2 logs` `[DB]` lines → **Supabase → Logs** |
| OTP / reset / notification email missing | app `[Mail]` lines → **Brevo → Transactional → Logs** |
| SMS not sending | `pm2 logs` `[SmsWorker]` → `/admin → SMS` monitor |
| App keeps restarting (`↺` climbing) | `pm2 logs peso-app --err` (find the crash) |
| "Is it even getting traffic?" | `/var/log/nginx/access.log` |
| Service won't start after reboot | `journalctl -u nginx -xe` |
| Quick health snapshot (no SSH) | `/admin → Platform Health` |

**Golden rule:** start at `pm2 logs peso-app` — it covers ~80% of backend questions.
```
