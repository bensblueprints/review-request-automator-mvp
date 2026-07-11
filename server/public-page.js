// The public "how was it?" rating page — served by the same Express app, no
// auth, no SPA dependency. Self-contained dark HTML with inline CSS/JS so it
// loads instantly on any customer phone.
//
// Flow: customer taps 1-5 stars → POST /api/public/rate
//   4-5 → "leave us a Google review" button → GET /r/:token/go (click tracked)
//   1-3 → private feedback form → POST /api/public/feedback
// Everyone is asked the same question; the rating only routes WHERE the
// feedback goes (public review page vs private inbox) — nothing is suppressed.

function esc(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]));
}

function ratingPage({ token, businessName, customerName }) {
  const biz = esc(businessName || 'us');
  const hi = customerName ? `Hi ${esc(customerName.split(' ')[0])} — ` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How did we do? — ${biz}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: #09090b; color: #fafafa; min-height: 100vh;
    display: grid; place-items: center; padding: 24px;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; background: #18181b;
    border: 1px solid #27272a; border-radius: 20px; padding: 36px 28px; text-align: center;
  }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  p.sub { color: #a1a1aa; font-size: 14px; margin-top: 10px; line-height: 1.5; }
  .stars { display: flex; justify-content: center; gap: 8px; margin: 28px 0 8px; }
  .stars button {
    background: none; border: none; cursor: pointer; padding: 4px;
    font-size: 40px; line-height: 1; color: #3f3f46; transition: transform .1s, color .1s;
  }
  .stars button:hover, .stars button.lit { color: #fbbf24; transform: scale(1.12); }
  .hidden { display: none; }
  textarea {
    width: 100%; min-height: 110px; margin-top: 16px; padding: 12px;
    background: #09090b; color: #fafafa; border: 1px solid #3f3f46;
    border-radius: 12px; font: inherit; font-size: 14px; resize: vertical;
  }
  textarea:focus { outline: none; border-color: #f59e0b; }
  .btn {
    display: inline-block; margin-top: 18px; padding: 12px 24px; width: 100%;
    background: #f59e0b; color: #09090b; font-weight: 600; font-size: 15px;
    border: none; border-radius: 12px; cursor: pointer; text-decoration: none;
  }
  .btn:hover { background: #fbbf24; }
  .note { color: #71717a; font-size: 12px; margin-top: 18px; }
  .thanks { font-size: 44px; margin-bottom: 12px; }
</style>
</head>
<body>
<div class="card">
  <div id="step-rate">
    <h1>How did we do?</h1>
    <p class="sub">${hi}thanks for choosing ${biz}. Tap a star to rate your experience.</p>
    <div class="stars" id="stars"></div>
  </div>

  <div id="step-public" class="hidden">
    <div class="thanks">🎉</div>
    <h1>Thank you!</h1>
    <p class="sub">We're thrilled you had a great experience. Would you take 30 seconds to share it publicly? It means the world to a local business.</p>
    <a class="btn" id="review-link" href="#">Leave us a Google review →</a>
  </div>

  <div id="step-private" class="hidden">
    <h1>We're sorry we missed the mark</h1>
    <p class="sub">Tell us what went wrong — this goes straight to the owner, and we'll make it right.</p>
    <textarea id="feedback" placeholder="What could we have done better?"></textarea>
    <button class="btn" id="send-feedback">Send to the owner</button>
  </div>

  <div id="step-done" class="hidden">
    <div class="thanks">🙏</div>
    <h1>Thank you</h1>
    <p class="sub">Your feedback went straight to the owner. We appreciate you giving us the chance to make it right.</p>
  </div>

  <p class="note">Powered by Askback · your rating routes where feedback goes — we read every one.</p>
</div>
<script>
  var TOKEN = ${JSON.stringify(token)};
  var starsEl = document.getElementById('stars');
  var chosen = 0;
  function show(id) {
    ['step-rate','step-public','step-private','step-done'].forEach(function (s) {
      document.getElementById(s).classList.toggle('hidden', s !== id);
    });
  }
  function paint(n) {
    Array.prototype.forEach.call(starsEl.children, function (b, i) {
      b.classList.toggle('lit', i < n);
    });
  }
  for (var i = 1; i <= 5; i++) (function (n) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = '★'; b.setAttribute('aria-label', n + ' stars');
    b.addEventListener('mouseenter', function () { if (!chosen) paint(n); });
    b.addEventListener('mouseleave', function () { if (!chosen) paint(0); });
    b.addEventListener('click', function () {
      chosen = n; paint(n);
      fetch('/api/public/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, rating: n })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.routed_to === 'public') {
          var a = document.getElementById('review-link');
          a.href = '/r/' + TOKEN + '/go';
          show('step-public');
        } else {
          show('step-private');
        }
      });
    });
    starsEl.appendChild(b);
  })(i);
  document.getElementById('send-feedback').addEventListener('click', function () {
    var text = document.getElementById('feedback').value.trim();
    fetch('/api/public/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, feedback: text })
    }).then(function () { show('step-done'); });
  });
</script>
</body>
</html>`;
}

function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Link not found</title>
<style>:root{color-scheme:dark}body{background:#09090b;color:#a1a1aa;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif}</style>
</head><body><p>This review link is invalid or has expired.</p></body></html>`;
}

module.exports = { ratingPage, notFoundPage };
