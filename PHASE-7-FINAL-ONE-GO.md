# CivilCareer Phase 7 — Final One-Go Job Discovery

- Admin **Discovery → Search Now** runs an immediate public-web discovery using Google News RSS indexing.
- New results are inserted into the existing `jobs` table as **unpublished drafts**.
- Admin shows fresh discovery drafts from the last 24 hours with Review / Publish actions.
- A Vercel Cron invokes the existing `/api/jobs` function once per day at 00:30 UTC (06:00 IST), so no extra Vercel function is added.
- No paid API, login, scraping, or platform bypass is used.
- LinkedIn/Naukri/etc. are treated as public indexed sources where available; original pages remain the source of truth for review.
- Existing Phase 1–6 routes, UI, Supabase architecture, admin authentication, and SEO are preserved.
