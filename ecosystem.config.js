// PM2 process definition for the single-VPS deployment.
//
// Two processes so a worker crash never takes the API down (SKILL §25):
//   peso-api    — the Express + Socket.IO web server (API only; WORKER_MODE=web)
//   peso-worker — the six background outbox/scoring workers (node worker.js)
//
// Env values themselves come from the `.env` file (loaded by the app), NOT from
// here — this file only sets WORKER_MODE to split the roles. Never put secrets
// in this committed file.
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     # persist across reboots
//   pm2 logs peso-api           # tail logs
module.exports = {
  apps: [
    {
      name: 'peso-api',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', WORKER_MODE: 'web' },
    },
    {
      name: 'peso-worker',
      script: 'worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
