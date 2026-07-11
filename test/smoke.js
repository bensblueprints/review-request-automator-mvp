// Askback smoke test — boots the real server with DRY_RUN=1 (zero real sends),
// exercises the full pipeline: customer → send (queued+logged) → public rating
// page → smart routing (4-5 public / 1-3 private) → click-through → STOP
// opt-out honored → secrets masked. Kills ONLY the spawned server child.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 5462; // offset port — other build agents run concurrently
const ADMIN_PASSWORD = 'smoke-test-password';
const DB_PATH = path.join(__dirname, 'smoke.db');
const BASE = `http://127.0.0.1:${TEST_PORT}`;

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

let serverProc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, tries = 40, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(delay);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual'
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  console.log('1. Booting Askback on port', TEST_PORT, 'with DRY_RUN=1 + temp DB');
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ADMIN_PASSWORD,
      DB_PATH,
      DRY_RUN: '1',
      // A real-looking Twilio secret so we can assert masking; DRY_RUN
      // short-circuits before any network call — nothing is ever sent.
      TWILIO_ACCOUNT_SID: 'ACsmoketest000000000000000000000',
      TWILIO_AUTH_TOKEN: 'super-secret-twilio-token',
      TWILIO_FROM: '+15550009999',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_PASS: 'super-secret-smtp-pass',
      BUSINESS_NAME: 'Smoke Plumbing Co',
      GOOGLE_REVIEW_URL: 'https://g.page/r/smoke-review',
      FOLLOWUP_DAYS: '0',
      SCHED_INTERVAL_MS: '60000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));

  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  console.log('   Auth: wrong password → 401, unauthenticated → 401, login → 200');
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  cookie = '';
  assert.strictEqual((await api('/api/customers')).status, 401, 'admin API must require auth');
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } })).status, 200);

  console.log('2. Create customers (manual + CSV import)');
  const alice = (await api('/api/customers', {
    method: 'POST', body: { name: 'Alice Happy', phone: '+1 (555) 000-1111', email: 'alice@example.com', job_ref: 'JOB-1' }
  }));
  assert.strictEqual(alice.status, 201);
  const bob = (await api('/api/customers', {
    method: 'POST', body: { name: 'Bob Grumpy', phone: '555-000-2222', job_ref: 'JOB-2' }
  }));
  assert.strictEqual(bob.status, 201);

  const csvRes = await api('/api/customers/import', {
    method: 'POST',
    body: { csv: 'name,phone,email,invoice\n"Carol, T." ,5550003333,carol@example.com,INV-9\nNoContact,,,\n' }
  });
  assert.strictEqual(csvRes.status, 200);
  assert.strictEqual(csvRes.data.imported, 1, 'exactly one valid CSV row must import');
  assert.strictEqual(csvRes.data.errors.length, 1, 'contact-less row must be rejected');
  console.log(`   imported=${csvRes.data.imported} errors=${csvRes.data.errors.length}`);

  console.log('3. Send SMS request (DRY_RUN) → logged as sent with dry_run=1, zero real sends');
  const send1 = await api(`/api/customers/${alice.data.id}/send`, { method: 'POST', body: { channel: 'sms' } });
  assert.strictEqual(send1.status, 201);
  assert.strictEqual(send1.data.status, 'sent', 'dry-run send must be marked sent');
  assert.strictEqual(send1.data.dry_run, 1, 'dry_run flag must be 1');
  assert.ok(send1.data.token && send1.data.body.includes(send1.data.token), 'rendered body must contain the public link token');
  assert.ok(send1.data.body.includes('Alice'), 'merge field {{name}} must render');
  assert.ok(send1.data.body.includes('Smoke Plumbing Co'), 'merge field {{business}} must render');
  const tokenA = send1.data.token;

  const send2 = await api(`/api/customers/${bob.data.id}/send`, { method: 'POST', body: { channel: 'sms' } });
  assert.strictEqual(send2.status, 201);
  const tokenB = send2.data.token;

  console.log('4. Public rating page renders (no auth) + smart routing');
  const page = await fetch(`${BASE}/r/${tokenA}`);
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('How did we do?'), 'rating page must render');
  assert.ok(html.includes('Smoke Plumbing Co'), 'rating page must show business name');
  assert.strictEqual((await fetch(`${BASE}/r/not-a-real-token`)).status, 404, 'bad token must 404');

  // 5 stars → public routing
  const rate5 = await api('/api/public/rate', { method: 'POST', body: { token: tokenA, rating: 5 } });
  assert.strictEqual(rate5.data.routed_to, 'public', '5 stars must route public');
  assert.strictEqual(rate5.data.review_url, 'https://g.page/r/smoke-review');
  // click-through tracked then 302 to the Google review URL
  const go = await fetch(`${BASE}/r/${tokenA}/go`, { redirect: 'manual' });
  assert.strictEqual(go.status, 302);
  assert.strictEqual(go.headers.get('location'), 'https://g.page/r/smoke-review');

  // 2 stars → private routing + feedback captured
  const rate2 = await api('/api/public/rate', { method: 'POST', body: { token: tokenB, rating: 2 } });
  assert.strictEqual(rate2.data.routed_to, 'private', '2 stars must route private');
  assert.strictEqual(rate2.data.review_url, null, 'private route must not expose the review URL');
  await api('/api/public/feedback', { method: 'POST', body: { token: tokenB, feedback: 'The sink still leaks.' } });
  const inbox = await api('/api/feedback');
  assert.strictEqual(inbox.data.length, 1, 'private inbox must hold exactly the 1-3 star response');
  assert.strictEqual(inbox.data[0].feedback_text, 'The sink still leaks.');
  assert.strictEqual(inbox.data[0].rating, 2);
  const badRating = await api('/api/public/rate', { method: 'POST', body: { token: tokenA, rating: 9 } });
  assert.strictEqual(badRating.status, 400, 'rating outside 1-5 must 400');

  console.log('5. STOP opt-out honored: webhook → opt_outs row → send blocked with 409');
  const twiml = await fetch(`${BASE}/webhooks/twilio/sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'From=%2B15550001111&Body=STOP'
  });
  assert.strictEqual(twiml.status, 200);
  const twimlBody = await twiml.text();
  assert.ok(twimlBody.includes('<Response>') && twimlBody.includes('unsubscribed'), 'STOP must get a TwiML confirmation');
  const blocked = await api(`/api/customers/${alice.data.id}/send`, { method: 'POST', body: { channel: 'sms' } });
  assert.strictEqual(blocked.status, 409, 'send to opted-out number must 409 — nothing queued');
  const optOuts = await api('/api/opt-outs');
  assert.strictEqual(optOuts.data.length, 1);
  assert.strictEqual(optOuts.data[0].phone, '5550001111', 'phone must be stored normalized');
  // START re-subscribes
  await fetch(`${BASE}/webhooks/twilio/sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'From=%2B15550001111&Body=START'
  });
  assert.strictEqual((await api('/api/opt-outs')).data.length, 0, 'START must clear the opt-out');

  console.log('6. Every send is logged: DB rows match, no send bypasses the requests table');
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const reqRows = db.prepare('SELECT * FROM requests ORDER BY id').all();
  assert.strictEqual(reqRows.length, 2, 'exactly the two dispatched sends must be logged (409 send queued nothing)');
  assert.ok(reqRows.every((r) => r.dry_run === 1 && r.status === 'sent'), 'all rows must be dry-run sends');
  const clicked = db.prepare('SELECT clicked_at FROM requests WHERE token = ?').get(tokenA);
  assert.ok(clicked.clicked_at > 0, 'click-through must be recorded in SQLite');
  db.close();

  console.log('7. Stats: exact numbers');
  const stats = (await api('/api/stats')).data;
  assert.strictEqual(stats.requests_sent, 2);
  assert.strictEqual(stats.responses, 2);
  assert.strictEqual(stats.response_rate, 100);
  assert.strictEqual(stats.clicks, 1);
  assert.strictEqual(stats.star_distribution[5], 1);
  assert.strictEqual(stats.star_distribution[2], 1);
  assert.strictEqual(stats.avg_rating, 3.5);
  assert.strictEqual(stats.private_feedback, 1);
  assert.strictEqual(stats.unresolved_feedback, 1);

  console.log('8. Secrets are masked in settings responses');
  const settings = (await api('/api/settings')).data;
  assert.strictEqual(settings.twilio_auth_token, '********', 'twilio token must be masked');
  assert.strictEqual(settings.smtp_pass, '********', 'smtp pass must be masked');
  const raw = JSON.stringify(settings);
  assert.ok(!raw.includes('super-secret-twilio-token'), 'raw twilio secret must never appear');
  assert.ok(!raw.includes('super-secret-smtp-pass'), 'raw smtp secret must never appear');
  assert.strictEqual(settings.dry_run, true);
  assert.strictEqual(settings.sms_configured, true);
  // saving masked placeholders back must NOT clobber the real secrets
  await api('/api/settings', { method: 'PUT', body: { twilio_auth_token: '********', business_name: 'Smoke Plumbing Co' } });
  assert.strictEqual((await api('/api/settings')).data.sms_configured, true, 'masked save must keep creds intact');

  console.log('\n✅ All Askback smoke tests passed (DRY_RUN — zero real SMS/emails sent)');
}

async function cleanup(code) {
  if (serverProc && !serverProc.killed) serverProc.kill(); // ONLY the spawned child
  await sleep(300);
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* windows lock */ }
  }
  process.exit(code);
}

main()
  .then(() => cleanup(0))
  .catch(async (err) => {
    console.error('\n❌ Smoke test failed:', err.message);
    await cleanup(1);
  });
