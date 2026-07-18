# ⭐ Askback

## Demo



https://github.com/user-attachments/assets/dc00790a-0aa0-43d4-a67f-9a7f49663801



**Get more Google reviews on autopilot. Pay once — not $289/mo.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Askback is a self-hosted review-request tool for local businesses. After every job or visit, it sends your customer a short SMS or email — *"How did we do?"* — with a one-tap rating link. Happy customers (4–5 stars) get a direct link to your Google review page. Unhappy customers (1–3 stars) get a private feedback form that goes straight to you, so you can fix the problem before it becomes a public one-star review.

It's the core of what Podium charges **$289+/month** for — as a tool you own forever, running on your own $5 VPS or your desktop, with your own Twilio and SMTP credentials.

![screenshot](docs/screenshot.png)

## ✋ Honest compliance note

Askback implements **customer-experience routing, not review suppression**. Every customer is asked the same question, every rating is recorded, and nothing stops an unhappy customer from posting publicly. The rating only decides *where feedback goes first* — public review page vs. your private inbox. Google's guidelines prohibit *discouraging negative reviews*; asking everyone for feedback and offering unhappy customers a direct line to the owner is the standard, TOS-compliant pattern. Keep it that way.

## Features

- 📱 **SMS + email review requests** — BYO Twilio and/or SMTP. Your credentials, your sender reputation, Twilio's ~$0.008/SMS pricing instead of a platform markup.
- 🎯 **Smart routing** — 4–5 stars → your Google review page (click-through tracked). 1–3 stars → private feedback form → your Feedback inbox.
- 📇 **Customers** — add manually or import a CSV from your booking/invoicing tool (`name, phone, email, job_ref` — common header aliases accepted).
- ✍️ **Templates with merge fields** — `{{name}}`, `{{business}}`, `{{link}}`, `{{job_ref}}`; separate initial + follow-up templates per channel.
- 🔁 **Automatic follow-up** — one polite reminder after N days if there's no response. Never more than one; guaranteed at the database level.
- 🛑 **STOP opt-out honored** — inbound Twilio webhook handles STOP/START; opted-out numbers are never messaged again.
- 📊 **Campaign stats** — requests sent, response rate, star distribution, review click-throughs, unresolved feedback.
- 🧪 **Dry-run mode** — `DRY_RUN=1` runs the whole pipeline (render, queue, log) without sending anything. Test your templates safely.
- 🔒 **Every send is queued + logged** in SQLite before dispatch. Secrets are masked in every API response.

## Quick start

```bash
npm i
npm run build
cp .env.example .env   # set ADMIN_PASSWORD, Twilio/SMTP creds
npm start              # → http://localhost:5362
```

**Run it as a desktop app, or deploy to a $5 VPS when you need it public:**

```bash
npm run desktop        # Electron window, auto-logged-in, data in your user profile
# or
docker compose up -d   # VPS mode, SQLite persisted in a volume
```

For SMS opt-outs, point your Twilio number's inbound webhook at `POST {BASE_URL}/webhooks/twilio/sms`.

## Askback vs Podium

| | **Askback** | **Podium** |
|---|---|---|
| Price | **$34 once** | $289+/mo ($3,468+/yr) |
| SMS costs | Twilio direct (~$0.008/msg) | bundled + marked up |
| Review requests + smart routing | ✅ | ✅ |
| Private feedback inbox | ✅ | ✅ |
| Follow-up reminders | ✅ | ✅ |
| Your data | your SQLite file | their cloud |
| Self-hosted / offline | ✅ | ❌ |
| Contract | none — MIT source | annual |

*Podium does much more (payments, webchat, team inbox). If you only need the review engine — the part most customers buy it for — Askback pays for itself in 4 days.*

## ☕ Skip the setup — get the 1-click installer

Want the packaged Windows installer with everything wired up? Grab it on Whop: **https://whop.com/benjisaiempire/askback-app

## Tech stack

Node 20 + Express + better-sqlite3 · React 18 + Vite + Tailwind 4 + Framer Motion + Lucide · Twilio + Nodemailer (BYO creds) · Electron desktop wrapper · Docker

## Tests

```bash
npm test   # boots the real server with DRY_RUN=1 — full pipeline, zero real sends
```

## License

MIT © 2026 Ben (bensblueprints)

## macOS build

See [MAC-BUILD.md](MAC-BUILD.md). Quickest path: GitHub **Actions** tab -> run the **Mac Build** (`mac-build.yml`) workflow to get a downloadable `.dmg` (unsigned - right-click -> Open on first launch).
