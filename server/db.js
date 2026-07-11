const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  // Under Electron the Node-ABI binding won't load; use the vendored Electron prebuild.
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

// Normalize a phone number for matching/opt-out storage:
// digits only, leading US country code stripped ("+1 (555) 000-1111" -> "5550001111").
function normPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

// 22-char URL-safe base62 token (crypto-strong, no ESM dep).
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function genToken(len = 22) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const nativeBinding = nativeBindingPath();
  const db = new Database(dbPath, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      job_ref TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      parent_request_id INTEGER,                        -- set on follow-up reminders
      channel TEXT NOT NULL,                            -- sms|email
      token TEXT NOT NULL,                              -- public "how was it?" link token
      to_addr TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',            -- queued|sent|failed|skipped
      skip_reason TEXT,
      dry_run INTEGER NOT NULL DEFAULT 0,
      clicked_at INTEGER,                               -- Google review link click-through
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      UNIQUE(parent_request_id)                        -- at most one follow-up per request
    );
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL UNIQUE,
      rating INTEGER NOT NULL,                          -- 1..5
      feedback_text TEXT NOT NULL DEFAULT '',
      routed_to TEXT NOT NULL,                          -- public|private
      resolved INTEGER NOT NULL DEFAULT 0,              -- owner marked private feedback handled
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      channel TEXT NOT NULL,                            -- sms|email
      kind TEXT NOT NULL DEFAULT 'initial',             -- initial|followup
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opt_outs (
      phone TEXT PRIMARY KEY,                           -- normalized digits
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_token ON requests(token);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, sent_at);
    CREATE INDEX IF NOT EXISTS idx_responses_request ON responses(request_id);
  `);

  // Seed default templates exactly once (first boot on a fresh DB).
  const seeded = db.prepare("SELECT value FROM settings WHERE key = '_templates_seeded'").get();
  if (!seeded) {
    const now = Date.now();
    const ins = db.prepare(
      'INSERT INTO templates (name, channel, kind, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    ins.run('SMS review request', 'sms', 'initial', '',
      'Hi {{name}}, thanks for choosing {{business}}! How did we do? It takes 10 seconds: {{link}} Reply STOP to opt out.', now);
    ins.run('SMS follow-up', 'sms', 'followup', '',
      'Hi {{name}}, just checking in from {{business}} — we\'d love to hear how we did: {{link}} Reply STOP to opt out.', now);
    ins.run('Email review request', 'email', 'initial', 'How did we do, {{name}}?',
      'Hi {{name}},\n\nThanks for choosing {{business}}! Could you take 10 seconds to tell us how we did?\n\n{{link}}\n\nYour feedback genuinely helps us improve.\n\n— {{business}}', now);
    ins.run('Email follow-up', 'email', 'followup', 'Quick follow-up from {{business}}',
      'Hi {{name}},\n\nJust a friendly nudge — we\'d still love to hear how your experience with {{business}} went:\n\n{{link}}\n\nThanks!\n— {{business}}', now);
    db.prepare("INSERT INTO settings (key, value) VALUES ('_templates_seeded', '1')").run();
  }

  return db;
}

const DEFAULT_SETTINGS = {
  business_name: '',
  google_review_url: '',
  base_url: '',
  followup_days: '3',
  twilio_account_sid: '',
  twilio_auth_token: '',
  twilio_from: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: ''
};

const SECRET_KEYS = ['twilio_auth_token', 'smtp_pass'];

function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  // env fills in anything not set via the settings page
  if (process.env.BUSINESS_NAME) out.business_name = process.env.BUSINESS_NAME;
  if (process.env.GOOGLE_REVIEW_URL) out.google_review_url = process.env.GOOGLE_REVIEW_URL;
  if (process.env.BASE_URL) out.base_url = process.env.BASE_URL;
  if (process.env.FOLLOWUP_DAYS) out.followup_days = process.env.FOLLOWUP_DAYS;
  if (process.env.TWILIO_ACCOUNT_SID) out.twilio_account_sid = process.env.TWILIO_ACCOUNT_SID;
  if (process.env.TWILIO_AUTH_TOKEN) out.twilio_auth_token = process.env.TWILIO_AUTH_TOKEN;
  if (process.env.TWILIO_FROM) out.twilio_from = process.env.TWILIO_FROM;
  if (process.env.SMTP_HOST) out.smtp_host = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) out.smtp_port = process.env.SMTP_PORT;
  if (process.env.SMTP_USER) out.smtp_user = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) out.smtp_pass = process.env.SMTP_PASS;
  if (process.env.SMTP_FROM) out.smtp_from = process.env.SMTP_FROM;
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.value !== '' && r.value != null && r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  }
  return out;
}

function setSettings(db, obj) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, String(v ?? ''));
    }
  });
  tx(Object.entries(obj));
}

module.exports = { openDb, normPhone, genToken, getSettings, setSettings, DEFAULT_SETTINGS, SECRET_KEYS };
