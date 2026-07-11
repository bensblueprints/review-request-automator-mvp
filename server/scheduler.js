// Follow-up loop (mirrors Remindly's scheduler). Every SCHED_INTERVAL_MS:
// find original requests that were sent, have NO response, NO follow-up yet,
// and are older than followup_days — then queue+log a follow-up reminder.
//   * EVERY send is logged first: the follow-up row is inserted BEFORE
//     dispatch, and UNIQUE(parent_request_id) makes double-sends impossible —
//     even across restarts.
//   * SMS opt-outs (STOP) skip with a logged reason.
//   * DRY_RUN short-circuits inside senders — the row is still logged.
const { getSettings, normPhone } = require('./db');
const { renderTemplate, mergeFields, publicLink } = require('./render');
const senders = require('./senders');

function startScheduler(db, intervalMs = 30000) {
  const insertFollowup = db.prepare(`
    INSERT OR IGNORE INTO requests
      (customer_id, parent_request_id, channel, token, to_addr, subject, body,
       status, skip_reason, dry_run, created_at, sent_at)
    VALUES (@customer_id, @parent_request_id, @channel, @token, @to_addr, @subject, @body,
            @status, @skip_reason, 0, @now, NULL)
  `);
  const isOptedOut = db.prepare('SELECT phone FROM opt_outs WHERE phone = ?');

  async function dispatch(rowId, { channel, to, body, subject, settings }) {
    try {
      const result = await senders.send({ channel, settings, to, body, subject });
      db.prepare("UPDATE requests SET status = 'sent', dry_run = ?, sent_at = ? WHERE id = ? AND status = 'queued'")
        .run(result && result.dryRun ? 1 : 0, Date.now(), rowId);
    } catch (e) {
      if (e.code === 'NO_CREDENTIALS') {
        db.prepare("UPDATE requests SET status = 'skipped', skip_reason = 'no credentials' WHERE id = ? AND status = 'queued'")
          .run(rowId);
        console.warn(`[scheduler] follow-up #${rowId} skipped — ${channel} credentials not configured`);
      } else {
        db.prepare("UPDATE requests SET status = 'failed', skip_reason = ? WHERE id = ? AND status = 'queued'")
          .run(String(e.message || e).slice(0, 500), rowId);
        console.warn(`[scheduler] follow-up #${rowId} failed: ${e.message}`);
      }
    }
  }

  const tick = () => {
    try {
      const now = Date.now();
      const settings = getSettings(db);
      const days = Number(settings.followup_days);
      if (!Number.isFinite(days) || days <= 0) return; // follow-ups disabled
      const cutoff = now - days * 86400000;

      // Original sent requests past the follow-up window with no response and
      // no follow-up (queued/sent/skipped — any logged attempt counts).
      const due = db.prepare(`
        SELECT r.*, c.name AS customer_name, c.phone AS customer_phone,
               c.email AS customer_email, c.job_ref AS customer_job_ref
        FROM requests r
        JOIN customers c ON c.id = r.customer_id
        WHERE r.parent_request_id IS NULL
          AND r.status = 'sent'
          AND r.sent_at <= @cutoff
          AND NOT EXISTS (SELECT 1 FROM responses x WHERE x.request_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM requests f WHERE f.parent_request_id = r.id)
      `).all({ cutoff });

      for (const r of due) {
        const customer = {
          name: r.customer_name, phone: r.customer_phone,
          email: r.customer_email, job_ref: r.customer_job_ref
        };
        const to = r.channel === 'email' ? String(customer.email || '').trim() : String(customer.phone || '').trim();
        const tpl = db.prepare("SELECT * FROM templates WHERE channel = ? AND kind = 'followup' ORDER BY id LIMIT 1").get(r.channel)
          || db.prepare("SELECT * FROM templates WHERE channel = ? ORDER BY id LIMIT 1").get(r.channel);
        if (!tpl) continue;
        const fields = mergeFields(customer, settings, publicLink(settings, r.token));
        const body = renderTemplate(tpl.body, fields);
        const subject = renderTemplate(tpl.subject || 'How did we do?', fields);
        const base = {
          customer_id: r.customer_id, parent_request_id: r.id, channel: r.channel,
          token: r.token, to_addr: to, subject, body, now, skip_reason: null
        };

        if (!to) {
          insertFollowup.run({ ...base, status: 'skipped', skip_reason: r.channel === 'sms' ? 'no phone number' : 'no email address' });
          continue;
        }
        if (r.channel === 'sms' && isOptedOut.get(normPhone(to))) {
          insertFollowup.run({ ...base, status: 'skipped', skip_reason: 'opted out (STOP)' });
          continue;
        }
        const info = insertFollowup.run({ ...base, status: 'queued' });
        if (info.changes === 0) continue; // row already exists → never double-send
        dispatch(info.lastInsertRowid, { channel: r.channel, to, body, subject, settings });
      }
    } catch (e) {
      console.error('[scheduler] tick error:', e.message);
    }
  };

  const timer = setInterval(tick, intervalMs);
  tick(); // run immediately on boot
  return () => clearInterval(timer);
}

module.exports = { startScheduler };
