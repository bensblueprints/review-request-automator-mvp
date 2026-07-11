require('dotenv').config();
const path = require('path');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5362;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'askback.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const SCHED_INTERVAL_MS = Number(process.env.SCHED_INTERVAL_MS) || 30000;

const app = createApp({
  dbPath: DB_PATH,
  adminPassword: ADMIN_PASSWORD,
  schedIntervalMs: SCHED_INTERVAL_MS,
  port: PORT
});

app.listen(PORT, () => {
  console.log(`Askback listening on http://localhost:${PORT}`);
  if (ADMIN_PASSWORD === 'admin') {
    console.log('⚠ Using default admin password — set ADMIN_PASSWORD in .env for production.');
  }
  if (String(process.env.DRY_RUN || '') === '1') {
    console.log('DRY_RUN=1 — requests are rendered, queued and logged but nothing is really sent.');
  }
});
