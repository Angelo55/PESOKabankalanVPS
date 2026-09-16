// PM2 process definition for the single-VPS deployment.
//
// SINGLE-PROCESS (SKILL §25): one process runs the Express + Socket.IO API AND the
// six background outbox/scoring workers, so the workers share the SAME `io` and
// worker-originated real-time (referral-issued, live score updates, notifications)
// reaches clients. WORKER_MODE is intentionally UNSET here — do NOT set
// WORKER_MODE=web without a socket.io Redis adapter, or worker->client real-time
// goes dark (§25). PM2 autorestart covers a crash; fine on a 2 GB box.
//
// Env values come from the `.env` file (loaded by the app), NOT from here. Never put
// secrets in this committed file.
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     # persist across reboots
//   pm2 logs peso-app           # tail logs
//
// FUTURE (only WITH Redis): to isolate a worker crash from the API, split into two
// processes AND add a socket.io Redis adapter so emits bridge across them. The split
// config is kept commented below for that day.
module.exports = {
  apps: [
    {
      name: 'peso-app',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '900M',
      env: { NODE_ENV: 'production' }, // WORKER_MODE unset => API + workers in ONE process (shared io)
    },
  ],
  // --- FUTURE: worker split (requires a Redis adapter for real-time — §25) ---
  // Replace the apps array above with the two below only after wiring socket.io-redis:
  //   { name: 'peso-api',    script: 'server.js', cwd: __dirname, instances: 1, exec_mode: 'fork',
  //     autorestart: true, max_memory_restart: '512M', env: { NODE_ENV: 'production', WORKER_MODE: 'web' } },
  //   { name: 'peso-worker', script: 'worker.js',  cwd: __dirname, instances: 1, exec_mode: 'fork',
  //     autorestart: true, max_memory_restart: '512M', env: { NODE_ENV: 'production' } },
};
