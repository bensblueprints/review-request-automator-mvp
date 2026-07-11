import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star, Users, Send, Inbox, FileText, Settings as SettingsIcon, LogOut,
  Plus, Upload, Trash2, Pencil, MessageSquare, Mail, Check, X, BellOff,
  BarChart3, ExternalLink, FlaskConical
} from 'lucide-react';
import { api, timeAgo } from './api.js';
import Login from './components/Login.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'requests', label: 'Requests', icon: Send },
  { id: 'feedback', label: 'Feedback', icon: Inbox },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
];

const input =
  'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500';
const btn =
  'inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-sm rounded-lg px-3.5 py-2 transition-colors disabled:opacity-50';
const btnGhost =
  'inline-flex items-center gap-1.5 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm rounded-lg px-3.5 py-2 transition-colors';

function Card({ children, className = '' }) {
  return <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl ${className}`}>{children}</div>;
}

function StatusBadge({ status, dryRun }) {
  const map = {
    sent: 'bg-emerald-500/15 text-emerald-400',
    queued: 'bg-sky-500/15 text-sky-400',
    failed: 'bg-red-500/15 text-red-400',
    skipped: 'bg-zinc-500/15 text-zinc-400'
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${map[status] || map.skipped}`}>
      {status}{dryRun ? ' · dry' : ''}
    </span>
  );
}

function Stars({ n }) {
  return (
    <span className="text-amber-400 text-sm tracking-tight">
      {'★'.repeat(n)}<span className="text-zinc-700">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.stats().then(setStats).catch(() => {}); }, []);
  if (!stats) return <p className="text-zinc-500 text-sm">Loading…</p>;
  const tiles = [
    ['Customers', stats.customers],
    ['Requests sent', stats.requests_sent],
    ['Follow-ups', stats.followups_sent],
    ['Responses', stats.responses],
    ['Response rate', stats.response_rate != null ? `${stats.response_rate}%` : '—'],
    ['Review clicks', stats.clicks],
    ['Avg rating', stats.avg_rating ?? '—'],
    ['Unresolved feedback', stats.unresolved_feedback]
  ];
  const maxStar = Math.max(1, ...Object.values(stats.star_distribution));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <h3 className="text-sm font-medium text-zinc-300 mb-4">Star distribution</h3>
        <div className="space-y-2">
          {[5, 4, 3, 2, 1].map((s) => (
            <div key={s} className="flex items-center gap-3">
              <Stars n={s} />
              <div className="flex-1 h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(stats.star_distribution[s] / maxStar) * 100}%` }}
                  className={`h-full rounded-full ${s >= 4 ? 'bg-emerald-500' : 'bg-red-400'}`}
                />
              </div>
              <span className="text-xs text-zinc-500 w-8 text-right">{stats.star_distribution[s]}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Customers ────────────────────────────────────────────────────────────────
function CustomerModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial || { name: '', phone: '', email: '', job_ref: '' });
  const [error, setError] = useState('');
  const save = async () => {
    try {
      if (initial?.id) await api.updateCustomer(initial.id, form);
      else await api.createCustomer(form);
      onSaved();
    } catch (e) { setError(e.message); }
  };
  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div onClick={(e) => e.stopPropagation()} className="space-y-4">
          <h3 className="font-semibold">{initial?.id ? 'Edit customer' : 'Add customer'}</h3>
          {['name', 'phone', 'email', 'job_ref'].map((f) => (
            <label key={f} className="block">
              <span className="text-xs text-zinc-400 uppercase tracking-wide">{f.replace('_', ' ')}</span>
              <input className={`${input} mt-1`} value={form[f] || ''}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
            </label>
          ))}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button className={btnGhost} onClick={onClose}>Cancel</button>
            <button className={btn} onClick={save}><Check className="w-4 h-4" /> Save</button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Customers({ notify }) {
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null); // null | {} | customer
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const load = useCallback(() => api.customers().then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const send = async (c, channel) => {
    try {
      const r = await api.sendRequest(c.id, { channel });
      notify(`Request ${r.status}${r.dry_run ? ' (dry run)' : ''} → ${r.to_addr}`);
      load();
    } catch (e) { notify(e.message, true); }
  };

  const doImport = async () => {
    try {
      const r = await api.importCsv(csv);
      notify(`Imported ${r.imported} customers${r.errors.length ? `, ${r.errors.length} rows skipped` : ''}`);
      setCsvOpen(false); setCsv(''); load();
    } catch (e) { notify(e.message, true); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button className={btn} onClick={() => setModal({})}><Plus className="w-4 h-4" /> Add customer</button>
        <button className={btnGhost} onClick={() => setCsvOpen(!csvOpen)}><Upload className="w-4 h-4" /> Import CSV</button>
      </div>
      {csvOpen && (
        <Card className="p-4 space-y-3">
          <p className="text-xs text-zinc-500">Paste CSV with a header row: <code>name, phone, email, job_ref</code></p>
          <textarea className={`${input} min-h-28 font-mono text-xs`} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <button className={btn} onClick={doImport}>Import</button>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
              {['Name', 'Contact', 'Job', 'Last request', 'Last rating', ''].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30">
                <td className="px-4 py-3 font-medium">
                  {c.name}
                  {c.opted_out && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-400"><BellOff className="w-3 h-3" /> STOP</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-400">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-3 text-zinc-500">{c.job_ref || '—'}</td>
                <td className="px-4 py-3">
                  {c.last_request ? (
                    <span className="flex items-center gap-2">
                      <StatusBadge status={c.last_request.status} dryRun={c.last_request.dry_run} />
                      <span className="text-xs text-zinc-500">{timeAgo(c.last_request.sent_at || c.last_request.created_at)}</span>
                    </span>
                  ) : <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3">{c.last_response ? <Stars n={c.last_response.rating} /> : <span className="text-zinc-600">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 justify-end">
                    <button title="Send SMS request" disabled={!c.phone || c.opted_out} onClick={() => send(c, 'sms')}
                      className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-amber-400 disabled:opacity-30">
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button title="Send email request" disabled={!c.email} onClick={() => send(c, 'email')}
                      className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-amber-400 disabled:opacity-30">
                      <Mail className="w-4 h-4" />
                    </button>
                    <button title="Edit" onClick={() => setModal(c)} className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button title="Delete" onClick={async () => { await api.deleteCustomer(c.id); load(); }}
                      className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-600">No customers yet — add one or import a CSV.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
      {modal && <CustomerModal initial={modal.id ? modal : null} onClose={() => setModal(null)}
        onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}

// ── Requests log ─────────────────────────────────────────────────────────────
function Requests() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.requests().then(setRows).catch(() => {}); }, []);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
            {['Customer', 'Channel', 'To', 'Status', 'Response', 'Clicked', 'When'].map((h) => (
              <th key={h} className="px-4 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-800/60">
              <td className="px-4 py-3">{r.customer_name || '—'}{r.parent_request_id && <span className="ml-1.5 text-xs text-sky-400">follow-up</span>}</td>
              <td className="px-4 py-3 text-zinc-400">{r.channel}</td>
              <td className="px-4 py-3 text-zinc-400">{r.to_addr}</td>
              <td className="px-4 py-3"><StatusBadge status={r.status} dryRun={r.dry_run} />{r.skip_reason && <span className="ml-2 text-xs text-zinc-500">{r.skip_reason}</span>}</td>
              <td className="px-4 py-3">{r.rating ? <Stars n={r.rating} /> : <span className="text-zinc-600">—</span>}</td>
              <td className="px-4 py-3">{r.clicked_at ? <ExternalLink className="w-4 h-4 text-emerald-400" /> : <span className="text-zinc-600">—</span>}</td>
              <td className="px-4 py-3 text-xs text-zinc-500">{timeAgo(r.sent_at || r.created_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-600">No requests sent yet.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

// ── Feedback inbox ───────────────────────────────────────────────────────────
function Feedback() {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.feedback().then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      {rows.map((f) => (
        <Card key={f.id} className={`p-5 ${f.resolved ? 'opacity-60' : ''}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{f.customer_name || 'Unknown customer'}</span>
                <Stars n={f.rating} />
                <span className="text-xs text-zinc-500">{timeAgo(f.at)}</span>
              </div>
              <p className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">{f.feedback_text || <span className="text-zinc-600">No written feedback (rating only).</span>}</p>
              <p className="mt-2 text-xs text-zinc-500">{[f.phone, f.email, f.job_ref].filter(Boolean).join(' · ')}</p>
            </div>
            <button className={f.resolved ? btnGhost : btn} onClick={async () => { await api.resolveFeedback(f.id); load(); }}>
              {f.resolved ? 'Reopen' : <><Check className="w-4 h-4" /> Resolve</>}
            </button>
          </div>
        </Card>
      ))}
      {rows.length === 0 && <p className="text-zinc-600 text-sm text-center py-10">No private feedback yet. 1–3 star ratings land here instead of your public review page.</p>}
    </div>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────
function Templates({ notify }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.templates().then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      if (editing.id) await api.updateTemplate(editing.id, editing);
      else await api.createTemplate(editing);
      setEditing(null); load();
    } catch (e) { notify(e.message, true); }
  };

  return (
    <div className="space-y-4">
      <button className={btn} onClick={() => setEditing({ name: '', channel: 'sms', kind: 'initial', subject: '', body: '' })}>
        <Plus className="w-4 h-4" /> New template
      </button>
      <p className="text-xs text-zinc-500">Merge fields: <code>{'{{name}} {{business}} {{link}} {{job_ref}}'}</code></p>
      <div className="grid md:grid-cols-2 gap-3">
        {rows.map((t) => (
          <Card key={t.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{t.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{t.channel} · {t.kind}</span>
                <button onClick={() => setEditing(t)} className="p-1 rounded hover:bg-zinc-700 text-zinc-400"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={async () => { await api.deleteTemplate(t.id); load(); }} className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            {t.subject && <p className="text-xs text-zinc-400">Subject: {t.subject}</p>}
            <p className="text-xs text-zinc-500 whitespace-pre-wrap">{t.body}</p>
          </Card>
        ))}
      </div>
      {editing && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={() => setEditing(null)}>
          <Card className="w-full max-w-lg p-6" >
            <div onClick={(e) => e.stopPropagation()} className="space-y-3">
              <h3 className="font-semibold">{editing.id ? 'Edit template' : 'New template'}</h3>
              <input className={input} placeholder="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <div className="flex gap-2">
                <select className={input} value={editing.channel} onChange={(e) => setEditing({ ...editing, channel: e.target.value })}>
                  <option value="sms">SMS</option><option value="email">Email</option>
                </select>
                <select className={input} value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  <option value="initial">Initial</option><option value="followup">Follow-up</option>
                </select>
              </div>
              {editing.channel === 'email' && (
                <input className={input} placeholder="Subject" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
              )}
              <textarea className={`${input} min-h-32`} placeholder="Body — use {{name}}, {{business}}, {{link}}" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              <div className="flex gap-2 justify-end">
                <button className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
                <button className={btn} onClick={save}><Check className="w-4 h-4" /> Save</button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_FIELDS = [
  ['Business', [
    ['business_name', 'Business name'],
    ['google_review_url', 'Google review URL'],
    ['base_url', 'Public base URL of this install'],
    ['followup_days', 'Follow-up after N days (0 = off)']
  ]],
  ['Twilio (BYO — SMS)', [
    ['twilio_account_sid', 'Account SID'],
    ['twilio_auth_token', 'Auth token', true],
    ['twilio_from', 'From number (E.164)']
  ]],
  ['SMTP (BYO — email)', [
    ['smtp_host', 'Host'],
    ['smtp_port', 'Port'],
    ['smtp_user', 'User'],
    ['smtp_pass', 'Password', true],
    ['smtp_from', 'From address']
  ]]
];

function Settings({ notify }) {
  const [s, setS] = useState(null);
  const [optOuts, setOptOuts] = useState([]);
  useEffect(() => {
    api.settings().then(setS).catch(() => {});
    api.optOuts().then(setOptOuts).catch(() => {});
  }, []);
  if (!s) return <p className="text-zinc-500 text-sm">Loading…</p>;
  const save = async () => {
    try { setS(await api.saveSettings(s)); notify('Settings saved'); }
    catch (e) { notify(e.message, true); }
  };
  return (
    <div className="space-y-5 max-w-2xl">
      {s.dry_run && (
        <Card className="p-4 flex items-center gap-3 border-amber-500/40">
          <FlaskConical className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">DRY_RUN is on — requests are rendered, queued and logged, but nothing is really sent.</p>
        </Card>
      )}
      <div className="flex gap-3 text-xs">
        <span className={`px-2 py-1 rounded-full ${s.sms_configured ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>SMS {s.sms_configured ? 'configured' : 'not configured'}</span>
        <span className={`px-2 py-1 rounded-full ${s.email_configured ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>Email {s.email_configured ? 'configured' : 'not configured'}</span>
      </div>
      {SETTINGS_FIELDS.map(([group, fields]) => (
        <Card key={group} className="p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">{group}</h3>
          {fields.map(([key, label, secret]) => (
            <label key={key} className="block">
              <span className="text-xs text-zinc-400">{label}</span>
              <input className={`${input} mt-1`} type={secret ? 'password' : 'text'} value={s[key] || ''}
                onChange={(e) => setS({ ...s, [key]: e.target.value })} />
            </label>
          ))}
        </Card>
      ))}
      <Card className="p-5 space-y-2">
        <h3 className="text-sm font-medium text-zinc-300">SMS opt-outs (STOP)</h3>
        <p className="text-xs text-zinc-500">Inbound STOP replies land here via the Twilio webhook (<code>{s.webhook_path}</code>). Opted-out numbers are never messaged.</p>
        {optOuts.map((o) => (
          <div key={o.phone} className="flex items-center justify-between text-sm">
            <span>{o.phone} <span className="text-xs text-zinc-500">{timeAgo(o.at)}</span></span>
            <button className="text-xs text-zinc-400 hover:text-red-400" onClick={async () => { await api.removeOptOut(o.phone); setOptOuts(await api.optOuts()); }}>remove</button>
          </div>
        ))}
        {optOuts.length === 0 && <p className="text-xs text-zinc-600">None.</p>}
      </Card>
      <button className={btn} onClick={save}><Check className="w-4 h-4" /> Save settings</button>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api.me().then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  const notify = useCallback((msg, isError) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  if (authed === null) return null;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const TabBody = { dashboard: Dashboard, customers: Customers, requests: Requests, feedback: Feedback, templates: Templates, settings: Settings }[tab];

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-zinc-800 p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2 font-semibold px-2 py-3 mb-2">
          <Star className="w-5 h-5 text-amber-400" /> Askback
        </div>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
        <div className="mt-auto">
          <button onClick={async () => { await api.logout(); setAuthed(false); }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 w-full">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <h1 className="text-xl font-semibold mb-6 capitalize">{tab}</h1>
        <TabBody key={tab} notify={notify} />
      </main>
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl text-sm shadow-xl ${toast.isError ? 'bg-red-500/90 text-white' : 'bg-zinc-800 border border-zinc-700 text-zinc-100'}`}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
