async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body != null ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/me'),
  login: (password) => req('/api/login', { method: 'POST', body: { password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  stats: () => req('/api/stats'),
  customers: () => req('/api/customers'),
  createCustomer: (body) => req('/api/customers', { method: 'POST', body }),
  updateCustomer: (id, body) => req(`/api/customers/${id}`, { method: 'PUT', body }),
  deleteCustomer: (id) => req(`/api/customers/${id}`, { method: 'DELETE' }),
  importCsv: (csv) => req('/api/customers/import', { method: 'POST', body: { csv } }),
  sendRequest: (id, body) => req(`/api/customers/${id}/send`, { method: 'POST', body }),
  requests: (limit = 200) => req(`/api/requests?limit=${limit}`),
  feedback: () => req('/api/feedback'),
  resolveFeedback: (id) => req(`/api/feedback/${id}/resolve`, { method: 'POST' }),
  templates: () => req('/api/templates'),
  createTemplate: (body) => req('/api/templates', { method: 'POST', body }),
  updateTemplate: (id, body) => req(`/api/templates/${id}`, { method: 'PUT', body }),
  deleteTemplate: (id) => req(`/api/templates/${id}`, { method: 'DELETE' }),
  optOuts: () => req('/api/opt-outs'),
  removeOptOut: (phone) => req(`/api/opt-outs/${encodeURIComponent(phone)}`, { method: 'DELETE' }),
  settings: () => req('/api/settings'),
  saveSettings: (body) => req('/api/settings', { method: 'PUT', body })
};

export function timeAgo(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
