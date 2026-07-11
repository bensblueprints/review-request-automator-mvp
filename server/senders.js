// Send drivers: BYO Twilio (SMS) + BYO SMTP (email).
// The app decides *whether* to send; this module only knows *how*.
// DRY_RUN=1 short-circuits before any network call — the rendered payload is
// still queued+logged by the caller, so the full pipeline is testable without
// ever touching Twilio or an SMTP server. Missing creds behave like dry-run
// failure with code NO_CREDENTIALS so requests are marked 'skipped', not lost.

function isDryRun() {
  return String(process.env.DRY_RUN || '') === '1';
}

function hasSmsCreds(settings) {
  return !!(settings.twilio_account_sid && settings.twilio_auth_token && settings.twilio_from);
}

function hasEmailCreds(settings) {
  return !!settings.smtp_host;
}

async function sendSms(settings, to, body) {
  if (isDryRun()) return { dryRun: true };
  if (!hasSmsCreds(settings)) {
    const err = new Error('no credentials');
    err.code = 'NO_CREDENTIALS';
    throw err;
  }
  const twilio = require('twilio'); // lazy: keeps boot fast and dry-run twilio-free
  const client = twilio(settings.twilio_account_sid, settings.twilio_auth_token);
  const msg = await client.messages.create({ from: settings.twilio_from, to, body });
  return { sid: msg.sid };
}

async function sendEmail(settings, to, subject, body) {
  if (isDryRun()) return { dryRun: true };
  if (!hasEmailCreds(settings)) {
    const err = new Error('no credentials');
    err.code = 'NO_CREDENTIALS';
    throw err;
  }
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 587,
    secure: Number(settings.smtp_port) === 465,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined
  });
  await transport.sendMail({
    from: settings.smtp_from || settings.smtp_user || 'askback@localhost',
    to,
    subject,
    text: body
  });
  return {};
}

// Unified dispatch. Returns { dryRun?: true } on success; throws on failure
// (err.code === 'NO_CREDENTIALS' when BYO creds are missing).
async function send({ channel, settings, to, body, subject }) {
  if (channel === 'email') return sendEmail(settings, to, subject || 'How did we do?', body);
  return sendSms(settings, to, body);
}

module.exports = { send, sendSms, sendEmail, isDryRun, hasSmsCreds, hasEmailCreds };
