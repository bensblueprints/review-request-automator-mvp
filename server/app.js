const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { openDb, normPhone, genToken, getSettings, setSettings, SECRET_KEYS } = require('./db');
const { startScheduler } = require('./scheduler');
const { renderTemplate, mergeFields, publicLink } = require('./render');
const { importRows } = require('./csv');
const { ratingPage, notFoundPage } = require('./public-page');
const senders = require('./senders');

const SESSION_COOKIE = 'ab_session';

function createApp({ dbPath, adminPassword, autologinToken = null, schedIntervalMs = 30000, port = null } = {}) {
  const db = openDb(dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cookieParser());

  const stopScheduler = startScheduler(db, schedIntervalMs);
  app.locals.db = db;
  app.locals.stopScheduler = stopScheduler;

  // ── helpers ────────────────────────────────────────────────────────────────
  const findCustomer = db.prepare('SELECT * FROM customers WHERE id = ?');
  const findTemplate = db.prepare('SELECT * FROM templates WHERE id = ?');
  // Public link tokens always resolve to the ORIGINAL request (follow-ups share it).
  const findRequestByToken = db.prepare('SELECT * FROM requests WHERE token = ? AND parent_request_id IS NULL');
  const isOptedOut = db.prepare('SELECT phone FROM opt_outs WHERE phone = ?');

  function requireAuth(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    if (token && db.prepare('SELECT id FROM sessions WHERE token = ?').get(token)) return next();
    res.status(401).json({ error: 'unauthorized' });
  }

  function createSession(res) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax' });
  }

  function customerOptedOut(customer) {
    const p = normPhone(customer.phone);
    return !!(p && isOptedOut.get(p));
  }

  function serializeCustomer(c) {
    const lastReq = db.prepare(
      'SELECT id, channel, status, dry_run, sent_at, created_at FROM requests WHERE customer_id = ? AND parent_request_id IS NULL ORDER BY created_at DESC LIMIT 1'
    ).get(c.id);
    const requestsSent = db.prepare(
      "SELECT COUNT(*) AS n FROM requests WHERE customer_id = ? AND status = 'sent'"
    ).get(c.id).n;
    const lastResp = lastReq
      ? db.prepare('SELECT rating, routed_to, at FROM responses WHERE request_id = ?').get(lastReq.id)
      : null;
    return {
      ...c,
      opted_out: customerOptedOut(c),
      requests_sent: requestsSent,
      last_request: lastReq || null,
      last_response: lastResp || null
    };
  }

  // ── public rating page (no auth by design) ─────────────────────────────────
  app.get('/r/:token', (req, res) => {
    const request = findRequestByToken.get(req.params.token);
    if (!request) return res.status(404).send(notFoundPage());
    const customer = findCustomer.get(request.customer_id);
    const settings = getSettings(db);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(ratingPage({
      token: request.token,
      businessName: settings.business_name,
      customerName: customer ? customer.name : ''
    }));
  });

  // Click-through to the Google review page — tracked, then 302.
  app.get('/r/:token/go', (req, res) => {
    const request = findRequestByToken.get(req.params.token);
    if (!request) return res.status(404).send(notFoundPage());
    if (!request.clicked_at) {
      db.prepare('UPDATE requests SET clicked_at = ? WHERE id = ?').run(Date.now(), request.id);
    }
    const url = getSettings(db).google_review_url;
    if (!url) return res.redirect(`/r/${request.token}`);
    res.redirect(url);
  });

  // ── Twilio inbound webhook (public, form-encoded, replies TwiML) ───────────
  // Configure in the Twilio console: Messaging → A MESSAGE COMES IN →
  //   POST  {BASE_URL}/webhooks/twilio/sms
  app.post('/webhooks/twilio/sms', express.urlencoded({ extended: false }), (req, res) => {
    const from = normPhone((req.body || {}).From || '');
    const raw = String((req.body || {}).Body || '').trim();
    const word = raw.toUpperCase().split(/\s+/)[0] || '';
    let reply = null;

    try {
      if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word)) {
        if (from) {
          db.prepare('INSERT OR IGNORE INTO opt_outs (phone, at) VALUES (?, ?)').run(from, Date.now());
        }
        reply = 'You have been unsubscribed and will receive no more messages. Reply START to re-subscribe.';
      } else if (['START', 'UNSTOP'].includes(word)) {
        if (from) db.prepare('DELETE FROM opt_outs WHERE phone = ?').run(from);
        reply = 'You are re-subscribed.';
      }
    } catch (e) {
      console.error('[webhook] error:', e.message);
    }

    res.set('Content-Type', 'text/xml');
    res.send(reply
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`
      : '<?xml version="1.0" encoding="UTF-8"?><Response/>');
  });

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  }

  // ── JSON body parsing from here on ─────────────────────────────────────────
  app.use(express.json({ limit: '2mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'askback' }));

  // ── public rating API (no auth — driven by the /r/:token page) ─────────────
  app.post('/api/public/rate', (req, res) => {
    const { token, rating } = req.body || {};
    const request = findRequestByToken.get(String(token || ''));
    if (!request) return res.status(404).json({ error: 'unknown token' });
    const stars = Math.floor(Number(rating));
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'rating must be 1-5' });
    }
    // Smart routing: 4-5 → public Google review page, 1-3 → private feedback.
    // The rating is ALWAYS recorded either way — routing only decides where
    // the customer is pointed next, never whether their feedback is collected.
    const routed_to = stars >= 4 ? 'public' : 'private';
    const now = Date.now();
    const existing = db.prepare('SELECT * FROM responses WHERE request_id = ?').get(request.id);
    if (existing) {
      db.prepare('UPDATE responses SET rating = ?, routed_to = ?, at = ? WHERE id = ?')
        .run(stars, routed_to, now, existing.id);
    } else {
      db.prepare('INSERT INTO responses (request_id, rating, feedback_text, routed_to, at) VALUES (?, ?, ?, ?, ?)')
        .run(request.id, stars, '', routed_to, now);
    }
    const settings = getSettings(db);
    res.json({
      ok: true,
      routed_to,
      review_url: routed_to === 'public' ? (settings.google_review_url || null) : null
    });
  });

  app.post('/api/public/feedback', (req, res) => {
    const { token, feedback } = req.body || {};
    const request = findRequestByToken.get(String(token || ''));
    if (!request) return res.status(404).json({ error: 'unknown token' });
    const response = db.prepare('SELECT * FROM responses WHERE request_id = ?').get(request.id);
    if (!response) return res.status(400).json({ error: 'rate first' });
    db.prepare('UPDATE responses SET feedback_text = ? WHERE id = ?')
      .run(String(feedback || '').trim().slice(0, 5000), response.id);
    res.json({ ok: true });
  });

  // ── auth ───────────────────────────────────────────────────────────────────
  app.post('/api/login', (req, res) => {
    if ((req.body || {}).password !== adminPassword) return res.status(401).json({ error: 'wrong password' });
    createSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  // Desktop mode auto-login (Electron passes a one-shot token).
  app.get('/auth/auto', (req, res) => {
    if (autologinToken && req.query.token === autologinToken) createSession(res);
    res.redirect('/');
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

  // ── customers CRUD ─────────────────────────────────────────────────────────
  function validateCustomer(body, res, { partial = false } = {}) {
    const out = {};
    if (!partial || body.name !== undefined) {
      out.name = String(body.name || '').trim();
      if (!out.name) { res.status(400).json({ error: 'name is required' }); return null; }
    }
    if (!partial || body.phone !== undefined) out.phone = String(body.phone || '').trim();
    if (!partial || body.email !== undefined) out.email = String(body.email || '').trim();
    if (!partial || body.job_ref !== undefined) out.job_ref = String(body.job_ref || '').trim();
    return out;
  }

  app.get('/api/customers', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
    res.json(rows.map(serializeCustomer));
  });

  app.post('/api/customers', requireAuth, (req, res) => {
    const v = validateCustomer(req.body || {}, res);
    if (!v) return;
    if (!v.phone && !v.email) return res.status(400).json({ error: 'need a phone or an email' });
    const info = db.prepare(
      'INSERT INTO customers (name, phone, email, job_ref, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(v.name, v.phone, v.email, v.job_ref, Date.now());
    res.status(201).json(serializeCustomer(findCustomer.get(info.lastInsertRowid)));
  });

  app.put('/api/customers/:id', requireAuth, (req, res) => {
    const customer = findCustomer.get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'not found' });
    const v = validateCustomer(req.body || {}, res, { partial: true });
    if (!v) return;
    const merged = { ...customer, ...v };
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ?, job_ref = ? WHERE id = ?')
      .run(merged.name, merged.phone, merged.email, merged.job_ref, customer.id);
    res.json(serializeCustomer(findCustomer.get(customer.id)));
  });

  app.delete('/api/customers/:id', requireAuth, (req, res) => {
    const customer = findCustomer.get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'not found' });
    const reqIds = db.prepare('SELECT id FROM requests WHERE customer_id = ?').all(customer.id).map((r) => r.id);
    const tx = db.transaction(() => {
      for (const id of reqIds) db.prepare('DELETE FROM responses WHERE request_id = ?').run(id);
      db.prepare('DELETE FROM requests WHERE customer_id = ?').run(customer.id);
      db.prepare('DELETE FROM customers WHERE id = ?').run(customer.id);
    });
    tx();
    res.json({ ok: true });
  });

  // ── CSV import ─────────────────────────────────────────────────────────────
  // Accepts raw CSV as text/csv or text/plain body, or JSON { csv: "..." }.
  // Header: name, phone, email, job_ref (aliases accepted).
  app.post('/api/customers/import', requireAuth, (req, res) => {
    const csv = typeof req.body === 'string' ? req.body : String((req.body || {}).csv || '');
    if (!csv.trim()) return res.status(400).json({ error: 'empty CSV' });
    const { rows, errors } = importRows(csv);
    const now = Date.now();
    const ins = db.prepare('INSERT INTO customers (name, phone, email, job_ref, created_at) VALUES (?, ?, ?, ?, ?)');
    const ids = [];
    const tx = db.transaction(() => {
      for (const r of rows) ids.push(ins.run(r.name, r.phone, r.email, r.job_ref, now).lastInsertRowid);
    });
    tx();
    res.json({ imported: ids.length, ids, errors });
  });

  // ── send a review request ──────────────────────────────────────────────────
  // Logged FIRST (status 'queued'), then dispatched; DRY_RUN short-circuits
  // inside senders so the row is still fully rendered + logged with dry_run=1.
  app.post('/api/customers/:id/send', requireAuth, async (req, res) => {
    const customer = findCustomer.get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'not found' });
    const body = req.body || {};
    const channel = body.channel === 'email' ? 'email' : 'sms';
    const to = channel === 'email' ? String(customer.email || '').trim() : String(customer.phone || '').trim();
    if (!to) return res.status(400).json({ error: channel === 'sms' ? 'customer has no phone number' : 'customer has no email address' });

    // STOP opt-out is honored BEFORE anything is queued.
    if (channel === 'sms' && isOptedOut.get(normPhone(to))) {
      return res.status(409).json({ error: 'customer has opted out (STOP)' });
    }

    let template = body.template_id ? findTemplate.get(body.template_id) : null;
    if (template && template.channel !== channel) {
      return res.status(400).json({ error: `template #${template.id} is a ${template.channel} template` });
    }
    if (!template) {
      template = db.prepare("SELECT * FROM templates WHERE channel = ? AND kind = 'initial' ORDER BY id LIMIT 1").get(channel);
    }
    if (!template) return res.status(400).json({ error: `no ${channel} template configured` });

    const settings = getSettings(db);
    const token = genToken();
    const fields = mergeFields(customer, settings, publicLink(settings, token, port));
    const rendered = renderTemplate(template.body, fields);
    const subject = renderTemplate(template.subject || 'How did we do?', fields);

    const info = db.prepare(`
      INSERT INTO requests (customer_id, parent_request_id, channel, token, to_addr, subject, body, status, dry_run, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 'queued', 0, ?)
    `).run(customer.id, channel, token, to, subject, rendered, Date.now());
    const requestId = info.lastInsertRowid;

    try {
      const result = await senders.send({ channel, settings, to, body: rendered, subject });
      db.prepare("UPDATE requests SET status = 'sent', dry_run = ?, sent_at = ? WHERE id = ?")
        .run(result && result.dryRun ? 1 : 0, Date.now(), requestId);
    } catch (e) {
      if (e.code === 'NO_CREDENTIALS') {
        db.prepare("UPDATE requests SET status = 'skipped', skip_reason = 'no credentials' WHERE id = ?").run(requestId);
      } else {
        db.prepare("UPDATE requests SET status = 'failed', skip_reason = ? WHERE id = ?")
          .run(String(e.message || e).slice(0, 500), requestId);
      }
    }

    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    res.status(201).json({ ...row, link: publicLink(settings, token, port) });
  });

  // ── request log ────────────────────────────────────────────────────────────
  app.get('/api/requests', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const rows = db.prepare(`
      SELECT r.*, c.name AS customer_name,
             x.rating, x.routed_to, x.at AS responded_at
      FROM requests r
      LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN responses x ON x.request_id = r.id
      ORDER BY r.created_at DESC LIMIT ?
    `).all(limit);
    res.json(rows);
  });

  // ── private feedback inbox ─────────────────────────────────────────────────
  app.get('/api/feedback', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT x.*, r.customer_id, c.name AS customer_name, c.phone, c.email, c.job_ref
      FROM responses x
      JOIN requests r ON r.id = x.request_id
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE x.routed_to = 'private'
      ORDER BY x.at DESC
    `).all();
    res.json(rows);
  });

  app.post('/api/feedback/:id/resolve', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM responses WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE responses SET resolved = ? WHERE id = ?')
      .run(row.resolved ? 0 : 1, row.id);
    res.json(db.prepare('SELECT * FROM responses WHERE id = ?').get(row.id));
  });

  // ── templates CRUD ─────────────────────────────────────────────────────────
  function validateTemplate(body, res) {
    const name = String(body.name || '').trim();
    if (!name) { res.status(400).json({ error: 'name is required' }); return null; }
    const channel = body.channel === 'email' ? 'email' : 'sms';
    const kind = body.kind === 'followup' ? 'followup' : 'initial';
    const tbody = String(body.body || '').trim();
    if (!tbody) { res.status(400).json({ error: 'body is required' }); return null; }
    return { name, channel, kind, subject: String(body.subject || '').trim(), body: tbody };
  }

  app.get('/api/templates', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM templates ORDER BY channel, kind, id').all());
  });

  app.post('/api/templates', requireAuth, (req, res) => {
    const v = validateTemplate(req.body || {}, res);
    if (!v) return;
    const info = db.prepare(
      'INSERT INTO templates (name, channel, kind, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(v.name, v.channel, v.kind, v.subject, v.body, Date.now());
    res.status(201).json(findTemplate.get(info.lastInsertRowid));
  });

  app.put('/api/templates/:id', requireAuth, (req, res) => {
    const tpl = findTemplate.get(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'not found' });
    const v = validateTemplate({ ...tpl, ...(req.body || {}) }, res);
    if (!v) return;
    db.prepare('UPDATE templates SET name = ?, channel = ?, kind = ?, subject = ?, body = ? WHERE id = ?')
      .run(v.name, v.channel, v.kind, v.subject, v.body, tpl.id);
    res.json(findTemplate.get(tpl.id));
  });

  app.delete('/api/templates/:id', requireAuth, (req, res) => {
    const tpl = findTemplate.get(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM templates WHERE id = ?').run(tpl.id);
    res.json({ ok: true });
  });

  // ── opt-outs ───────────────────────────────────────────────────────────────
  app.get('/api/opt-outs', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM opt_outs ORDER BY at DESC').all());
  });

  app.delete('/api/opt-outs/:phone', requireAuth, (req, res) => {
    db.prepare('DELETE FROM opt_outs WHERE phone = ?').run(normPhone(req.params.phone));
    res.json({ ok: true });
  });

  // ── campaign stats ─────────────────────────────────────────────────────────
  app.get('/api/stats', requireAuth, (req, res) => {
    const customers = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
    const requestsSent = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'sent'").get().n;
    const initialSent = db.prepare(
      "SELECT COUNT(*) AS n FROM requests WHERE status = 'sent' AND parent_request_id IS NULL"
    ).get().n;
    const followupsSent = requestsSent - initialSent;
    const responses = db.prepare('SELECT COUNT(*) AS n FROM responses').get().n;
    const clicks = db.prepare('SELECT COUNT(*) AS n FROM requests WHERE clicked_at IS NOT NULL').get().n;
    const privateFeedback = db.prepare(
      "SELECT COUNT(*) AS n FROM responses WHERE routed_to = 'private'"
    ).get().n;
    const unresolved = db.prepare(
      "SELECT COUNT(*) AS n FROM responses WHERE routed_to = 'private' AND resolved = 0"
    ).get().n;
    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of db.prepare('SELECT rating, COUNT(*) AS n FROM responses GROUP BY rating').all()) {
      if (r.rating >= 1 && r.rating <= 5) stars[r.rating] = r.n;
    }
    const ratedTotal = Object.values(stars).reduce((a, b) => a + b, 0);
    const avgRating = ratedTotal
      ? Math.round((Object.entries(stars).reduce((a, [s, n]) => a + Number(s) * n, 0) / ratedTotal) * 10) / 10
      : null;
    res.json({
      customers,
      requests_sent: requestsSent,
      initial_sent: initialSent,
      followups_sent: followupsSent,
      responses,
      response_rate: initialSent ? Math.round((responses / initialSent) * 1000) / 10 : null,
      clicks,
      click_rate: requestsSent ? Math.round((clicks / initialSent || 0) * 1000) / 10 : null,
      star_distribution: stars,
      avg_rating: avgRating,
      private_feedback: privateFeedback,
      unresolved_feedback: unresolved,
      opt_outs: db.prepare('SELECT COUNT(*) AS n FROM opt_outs').get().n
    });
  });

  // ── settings (secrets ALWAYS masked in responses) ──────────────────────────
  function maskedSettings() {
    const s = getSettings(db);
    for (const k of SECRET_KEYS) s[k] = s[k] ? '********' : '';
    s.dry_run = senders.isDryRun();
    s.sms_configured = senders.hasSmsCreds(getSettings(db));
    s.email_configured = senders.hasEmailCreds(getSettings(db));
    s.webhook_path = '/webhooks/twilio/sms';
    return s;
  }

  app.get('/api/settings', requireAuth, (req, res) => res.json(maskedSettings()));

  app.put('/api/settings', requireAuth, (req, res) => {
    const body = { ...(req.body || {}) };
    for (const k of SECRET_KEYS) {
      if (body[k] === '********') delete body[k]; // masked, unchanged
    }
    setSettings(db, body);
    res.json(maskedSettings());
  });

  // ── static frontend ────────────────────────────────────────────────────────
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/webhooks') || req.path.startsWith('/r/')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp };
