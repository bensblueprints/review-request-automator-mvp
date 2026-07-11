// Tiny dependency-free CSV parser (handles quoted fields + escaped quotes)
// and the customer-import row validator.

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  name: ['name', 'customer', 'customer_name', 'client', 'client_name', 'full_name'],
  phone: ['phone', 'phone_number', 'mobile', 'cell'],
  email: ['email', 'email_address', 'e-mail'],
  job_ref: ['job_ref', 'job', 'job_id', 'invoice', 'invoice_number', 'order', 'order_id', 'reference']
};

function mapHeader(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && !(field in map)) map[field] = i;
    }
  });
  return map;
}

// Returns { rows: [validCustomer...], errors: [{ row, error }] }
function importRows(csvText) {
  const parsed = parseCsv(csvText);
  if (parsed.length < 2) {
    return { rows: [], errors: [{ row: 0, error: 'CSV needs a header row and at least one data row' }] };
  }
  const map = mapHeader(parsed[0]);
  if (map.name == null) {
    return { rows: [], errors: [{ row: 0, error: 'header must include name (aliases: customer, client, full_name…)' }] };
  }
  const rows = [], errors = [];
  for (let i = 1; i < parsed.length; i++) {
    const cells = parsed[i];
    const get = (f) => (map[f] != null ? String(cells[map[f]] ?? '').trim() : '');
    const name = get('name');
    const phone = get('phone');
    const email = get('email');
    if (!name) { errors.push({ row: i + 1, error: 'name is required' }); continue; }
    if (!phone && !email) { errors.push({ row: i + 1, error: 'need a phone or an email' }); continue; }
    rows.push({ name, phone, email, job_ref: get('job_ref') });
  }
  return { rows, errors };
}

module.exports = { parseCsv, importRows };
