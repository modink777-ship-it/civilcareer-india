# Free-tier verification list (checked 2026-09-29)

Every service below is free-tier only. Limits drift — re-check each dashboard quarterly. "On breach" = what CivilCareer does so the site degrades instead of dying.

| Service | Free tier (verified today) | On breach → graceful degradation |
|---|---|---|
| **Supabase** (database + auth) | 500 MB database per project; **projects pause after ~7 days of database inactivity**; max 2 active projects; 5 GB egress/month; 50k MAUs. Sources: supabase.com/pricing, supabase.com/docs/guides/platform/free-project-pausing. | Scheduled keep-alive (a tiny `SELECT 1` via GitHub Actions every 3 days — inactivity is measured on **database** activity, not API traffic). Data stays lean: auto-purge expired jobs > 180 days, archive notifications to a JSON export. Alert at 400 MB via a weekly size query. |
| **Cloudflare Pages** (hosting target) | Unlimited bandwidth, 500 builds/month, 20,000 files/site, 25 MB/file. Functions: 100k requests/day free. | Static pages unaffected by function limits; APIs stay under 100k/day easily at current traffic. If builds run out, deploys pause — a GitHub Action notify step covers it. |
| **Cloudflare Cron Triggers / GitHub Actions** (schedulers) | CF cron: included with Workers/Pages free. GH Actions: **2,000 free minutes/month on private repos** (public repos unlimited); scheduled workflows can be delayed at peak; note GitHub's March 2026 self-hosted runner fee does **not** affect hosted minutes. | 4-hourly discovery ≈ 180 runs × ~30 s ≈ 90 min/month — uses < 5% of quota. Keep-alive ≈ 10 runs × 1 min. Safe. |
| **Gemini API** (admin-side drafting only) | Free tier exists with per-day/per-minute limits that change frequently — read live numbers from the AI Studio dashboard; do not hard-code them. | Admin-only use (never user-facing), batch 1 PDF/notification per call, cache extracted results in Supabase, catch 429 with exponential backoff, and every feature has a fully manual entry path. Nothing publishes automatically. |
| **Brevo** (email digest — recommended over Resend for daily digests) | **300 emails/day** (~9,000/month), 100k contacts; unused sends don't roll over. Source: help.brevo.com free-plan FAQ. | One digest per user per day — 300/day covers ~300 subscribers. Cap enrollment, queue overflow to the next day, and show "digest paused" honestly if the cap binds. Resend's 3,000/month (100/day rolling) is worse for daily digests; keep it as backup. |
| **Web Push (VAPID)** | Free forever — browser push has no per-message cost. | None. Store subscriptions in Supabase; purge dead endpoints on 410. |
| **Telegram bot** | Free. | Rate limit 30 msg/s (bot API); we send ~1.5 s per job — safe. State-wise channels are free. |
| **Cloudflare Turnstile** (spam protection) | Free, unlimited validations. | If Turnstile is down, fall back to the existing honeypot + rate limits rather than blocking submissions. |
| **Cloudflare Web Analytics** | Free, no cookie. | None. |
| **Search** | Postgres full-text search (inside Supabase free) or client-side Fuse.js. | FTS runs in the existing DB — no extra service. |
| **Custom domain** (optional, the only possible cost) | ~₹800–1,500/yr if you choose it. Decision left to you. Steps when ready: buy → Cloudflare DNS (free) → add domain in CF Pages → set CNAME → enable HTTPS → update SITE_URL + Search Console. | — |

## Migration note (zero cost, from the GOAL)

Vercel Hobby **forbids commercial use** — the platform must move before monetization. Target: **Cloudflare Pages**.
- What ports cleanly: all static pages, the SPA, service worker, Turnstile, Web Analytics, cron scheduling.
- What needs work: the single Node catch-all (`api/[[...path]].js`) becomes Pages **Functions** (`functions/api/[[route]].js` — same syntax, same handlers), Supabase calls unchanged, `vercel.json` rewrites move to `functions/_routes.json` + a `_redirects` file.
- Crons: `/api/exam-alerts` (04:00 IST) and `/api/govt-discovery` (03:00 IST) re-home to GitHub Actions curl with secrets, or CF cron — both free.
- Vercel keeps serving until the CF version passes the full test checklist (doc 05), then DNS flips. Zero downtime, zero cost.
