// Merge-field rendering for review-request templates.
// Supported fields: {{name}}, {{business}}, {{link}}, {{job_ref}}.
// Unknown fields are left as-is so typos are visible instead of silent.

function renderTemplate(template, fields) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    k in fields ? fields[k] : m
  );
}

// Build the merge-field map for a customer + public link.
function mergeFields(customer, settings, link) {
  return {
    name: customer.name || '',
    business: settings.business_name || 'our business',
    link,
    job_ref: customer.job_ref || ''
  };
}

// The public "how was it?" URL for a request token.
function publicLink(settings, token, fallbackPort) {
  const base = String(settings.base_url || '').replace(/\/+$/, '')
    || `http://localhost:${fallbackPort || process.env.PORT || 5362}`;
  return `${base}/r/${token}`;
}

module.exports = { renderTemplate, mergeFields, publicLink };
