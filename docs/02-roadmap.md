# Roadmap — P0 this week · P1 in 30 days · P2 in 60–90 days

Effort in focused hours. Order inside each phase = execution order. Nothing destructive happens without your explicit go.

## P0 — Security & trust (this week, ~1.5–2 days)

| # | Task | Effort | Notes |
|---|---|---|---|
| 1 | **Fix RLS: enable on all tables, deny-all default, narrow `anon` insert-only policies for `employer_submissions`, `resource_submissions`, `reports`, `alerts` (with check). All other access via service role server-side.** | 1–2 h | You apply 6–8 SQL statements in the Supabase SQL editor (I'll hand you the exact script and re-probe live after). Highest risk item on the site. |
| 2 | Strip the admin UI from the public bundle: remove the admin section from index.html, remove admin code from app.js; /admin (admin.html) becomes the only admin surface. | 3–4 h | Cuts the bundle too — helps PERF-1. |
| 3 | Turnstile + per-IP rate limits on Post a Job, Submit Resource, Report, subscribe. | 3–4 h | Turnstile free; rate limiting pattern already in lib/security.js. |
| 4 | Replace Gmail contact with contact form + /api/contact (Brevo free, 1 email/day to an inbox). | 1–2 h | Brevo free verified in doc 01. |
| 5 | Fix/remove WhatsApp placeholder link; click-test Telegram. | 15 min | TRUST-1. |
| 6 | Surface `source_url` + `last_verified` + Verified badge on cards and job pages; auto-mark past-deadline rows "Applications closed" (already hidden from feeds). | 4–6 h | Fields exist server-side already. |
| 7 | Unauthenticated-API hardening pass: rate-limit /api/agent, cache headers on auth-config. | 1–2 h | SEC-3/SEC-5. |
| 8 | Fake-claim sweep: every "verified/updated daily/human-reviewed" claim on the site either gets a mechanism or gets removed. | 2 h | Make trust provable or silent. |
| 9 | Verify Search Console, submit sitemap. | 30 min | You click; I prep the steps. |

## P1 — within 30 days (~2–3 weeks part-time)

1. **Move hosting to Cloudflare Pages** (zero cost; plan in doc 01). 6–10 h + your dashboard clicks. P1-first because it blocks monetization plans, not trust.
2. **Design system "Blueprint Navy & Brass"** (spec in doc 03) across all pages + style-guide page. 2–3 days. Light/dark, AA contrast, 360px-first.
3. **SSR/pre-render the 6 main pages** — extend the proven /jobs/<slug> pattern (Perf 100). Kills SEO-1/SEO-3 and PERF-1 together. 2–3 days.
4. **Merge Government + Govt table** into one page with Table/Card toggle; 301 the old URL. 4–6 h.
5. **Nav → 6 items** (Jobs, Govt Jobs, Exams, Prepare, For You, Alerts); Post a Job / Submit / Report to footer/employer area. 2–3 h.
6. **Alerts system**: signup above the fold + after every listing; email digest (Brevo, one/user/day), Web Push (VAPID), Telegram; filters role/state/sector; daily/weekly; one-click unsubscribe; DPDP consent + deletion. 3–4 days.
7. **Public job fields**: add salary/deadline/vacancies to the public projection; "Not disclosed" + market range fallback. 2–4 h.
8. **Government depth sprint**: notification page template (org, posts, category/state vacancies, pay, age+relaxation, fees, key dates, selection, syllabus, official PDF/apply links, "what changed"), Eligibility Checker, calendar with .ics + "closing in 7 days" strip, first 5 state pages + first 5 org pages (SSC JE, RRB JE, CPWD, NHAI, MES). 1–2 weeks. The differentiator.
9. Company pages + verified-employer flag. 2–3 days.
10. 404 fix for bad job slugs (30 min — can land this week with P0).

## P2 — 60–90 days

1. Study hub: syllabus pages, topic notes, PYQs, interview Q&A by role. 1–2 weeks.
2. Career guides (SSC JE vs PWD vs private; Diploma vs BE; GATE/ESE; QS progression; skills per role). 3–5 days.
3. Resume builder + ATS checker (client-side, free). 3–5 days.
4. Salary explorer from listing data. 2–3 days.
5. Employer portal: draft preview, verification (domain email/GST/LinkedIn), scam-language detection, mandatory expiry, edit/close-by-email link, views/clicks dashboard. 1–2 weeks.
6. Known Scams page + report review-time target. 1–2 days.
7. Hindi UI + summaries, then Tamil/Telugu/Marathi/Kannada. Progressive.
8. Monetization experiments **only after** traffic: featured jobs, employer plans. Never charge candidates.
9. Weekly metrics report (doc 05 defines the metrics): WAU, alert subscribers, apply-click rate, % listings verified < 7 days, scam reports/1k views, organic clicks, profile completion.

## Explicitly deferred / skipped (with reasons)

- **Monetization now** — Vercel Hobby forbids it; also premature pre-traffic. After the CF move only.
- **PDF uploads in Submit Resource** — removed per the goal; links only.
- **Paid anything** — none of the above uses a paid service; the only optional cost is a domain.
- **Automated publishing** — never. Discovery → review queue → human publish, already enforced in code.
- **Multi-language first** — English core first; Hindi lands in P2 when there's content worth translating.
