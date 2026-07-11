# Launch strategy — Askback

## Target communities

- **r/smallbusiness** — no direct self-promo; answer "how do I get more Google reviews?" threads with the honest playbook (ask everyone right after the job, make it one tap), mention the tool only when asked or in a monthly promo thread.
- **r/sweatystartup** (home services) — perfect ICP; share the "$289/mo vs $34 once" cost breakdown as a story post about building it for your own clients.
- **r/Entrepreneur** — "I replaced a $3,468/yr SaaS for my clients with a one-time tool" build story; rules allow lessons-learned posts with link in comments.
- **r/selfhosted** — straight tool announcement; emphasize SQLite, Docker, BYO Twilio, MIT. This crowd converts on ownership, not price.
- **r/Plumbing, r/electricians, r/HVAC trade subs** — never post the tool; participate and keep it in flair/profile. Trades hate being sold to.

## Show HN draft

**Title:** Show HN: Askback – self-hosted review requests (Podium is $289/mo)

I do marketing for local businesses. The single highest-ROI thing any of them do is text customers after a job asking for a Google review — and the SaaS that automates it costs $250–400/mo.

Askback is that engine, self-hosted: Node/Express/SQLite, React front-end, BYO Twilio + SMTP. Customer taps a star rating on a public page; 4–5 stars routes to your Google review link, 1–3 stars routes to a private feedback form first (everyone is asked, every rating is recorded — Google prohibits *discouraging* negative reviews, so the flow is routing, not gating; the README is explicit about this).

Technical bits HN might care about: every send is written to SQLite as 'queued' before dispatch, follow-ups are deduped with a UNIQUE constraint so restarts can't double-text anyone, STOP webhook handling, and a DRY_RUN mode the test suite uses to exercise the full pipeline with zero real sends. MIT licensed; the paid thing is just a packaged installer.

## SEO keywords

1. podium alternative
2. review request software self hosted
3. google review automation tool
4. get more google reviews app
5. sms review request tool
6. birdeye alternative cheap
7. review management for small business one time purchase
8. ask customers for reviews automatically
9. nicejob alternative
10. review request template sms

## AppSumo / PitchGround pitch

Askback gives every local business the one Podium feature they actually pay $289/mo for: automated "how did we do?" texts after every job, with smart routing — happy customers to your Google review page, unhappy ones to a private inbox first. BYO Twilio/SMTP so there's zero per-message markup, self-hosted with SQLite so there's zero lock-in, MIT source so there's zero trust required. Lifetime-deal buyers are exactly the "pay once, own it" audience this was built for — and at $34 retail there's comfortable margin for a $49–69 LTD tier with the installer, updates, and priority support.

## Pricing math

**$34 one-time.** Podium is $289/mo minimum → Askback pays for itself in **4 days**. Against Birdeye ($299/mo) or NiceJob ($75/mo): under two weeks. One retained customer from one caught 2-star complaint is worth more than the tool.
