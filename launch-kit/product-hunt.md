# Product Hunt — Askback

**Name:** Askback

**Tagline (60 chars):** Get more Google reviews. Pay once, not $289/mo like Podium.

**Description (260 chars):**
Askback texts/emails your customers after every job: "How was it?" 4–5 stars → your Google review page. 1–3 stars → a private note to you first. BYO Twilio/SMTP, self-hosted, SQLite, MIT source. $34 once instead of Podium's $289/mo.

**Full description:**
Local businesses live and die by Google reviews, and the tools that automate asking for them (Podium, Birdeye, NiceJob) all cost $250–400 a month — for what is essentially a text message and a star-rating page.

Askback is that engine as a product you own:

- Add a customer (or import a CSV from your booking tool) and hit send — SMS via your own Twilio account, or email via your own SMTP.
- The customer taps a star rating on a clean mobile page. 4–5 stars → straight to your Google review link (click tracked). 1–3 stars → a private feedback form that lands in your inbox, so you hear about the problem before the internet does.
- One automatic follow-up after N days if they don't respond. STOP opt-outs honored automatically via Twilio webhook.
- Stats: response rate, star distribution, click-throughs.

Runs as a desktop app or on a $5 VPS (Docker included). Dark UI, dry-run mode for testing templates. Everyone is asked the same question — nothing suppresses negative feedback, it just routes where it goes first.

**Maker first comment:**
Hi PH 👋 I run marketing for local businesses and kept watching them pay Podium $289/mo mostly for one feature: the automated "how did we do?" text after a job. That's ~$3,500/yr for a message template and a redirect.

So I built Askback: bring your own Twilio ($0.008/text) and SMTP, host it yourself (or run the desktop app), pay once. The smart-routing flow is the honest version — every rating is recorded, unhappy customers just get a direct line to the owner *first*. I use it for my own clients. Source is MIT on GitHub; the paid version is just the convenience installer. Happy to answer anything about deliverability, Twilio setup, or the compliance side.

**Gallery shots (5):**
1. Dashboard — stat tiles + star-distribution bars (dark UI).
2. Customer list with one-click "send SMS / send email" actions.
3. The customer-facing mobile rating page (star tap → routing).
4. Private feedback inbox with a 2-star complaint marked "Resolve".
5. Templates editor showing merge fields + follow-up template.
