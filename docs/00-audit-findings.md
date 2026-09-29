# CivilCareer — Step 0 Audit (2026-09-29)

Live site: https://civilcareer-india-two.vercel.app · repo commit `16dc4c3`
Method: live route loading, unauthenticated API probing (including write probes), Lighthouse 12 mobile (local Chromium), live-API data-quality scan, source inspection. Search Console was **not** directly accessible — indexing was estimated from Google search; confirm inside Search Console before relying on it.

## Route health (Step 0.1)

| Route | Status | Notes |
|---|---|---|
| / , /for-you, /private-jobs, /government-jobs, /govt-jobs, /exams, /study-materials, /career-paths, /post-a-job, /submit-resource, /report, /job-alerts, /about, /legal | 200 | All render (SPA except legal). |
| /jobs/<real-slug> | 200 | Server-rendered, Lighthouse mobile **Perf 100 / SEO 100 / LCP 1.0s**. |
| /jobs/civil-engineer-jobs (nonexistent slug) | **500** | Should be **404** (soft-404 risk for SEO). |
| /sitemap.xml | 200 | 758 URLs. |
| /robots.txt | 200 | Correctly disallows /admin, /admin.html, /api/. |

## Data quality (live API scan, first 100 of 736 jobs)

- Total listings: **736** — summary endpoint reports **723 private / 13 government**. The core differentiator (government depth) is nearly empty.
- **0 expired** listings visible in the first 100 (deadline-based expiry works).
- **5 duplicate** role+company pairs in the first 100 (~5%).
- **100% missing salary, deadline and vacancies in the public API response** — the public field projection (`PUBLIC_JOB_FIELDS`) omits these columns entirely, so the UI cannot show them without a code change (the data may still exist server-side).
- Every job has a slug (736/736).

## Unauthenticated API surface (Step 0.4)

| Endpoint | Status unauth | Verdict |
|---|---|---|
| /api/jobs, /api/exams, /api/materials, /api/employers, /api/health | 200 | Intended public reads. |
| /api/analytics, /api/reports, /api/*-submissions, /api/extract | 401 | Correctly protected. |
| /api/account, /api/alerts | 401 | Correctly protected. |
| /api/govt-discovery | 200 (GET info) | Only metadata; scrape run needs owner key/cron. Acceptable. |
| /api/agent | 400 invalid session | Session-scoped for-you memory; writes need a valid UUID session id. Low risk, but unauthenticated writes exist. |
| **Supabase REST via shipped anon key** | **201 INSERT / 204 DELETE on `jobs` and `exams`** | **CRITICAL — see SEC-1.** |

### Security probe performed (and cleaned up)
Using only the anon key that `GET /api/auth-config` ships to every browser, I inserted a test row into `jobs` (HTTP **201**), deleted it (204), inserted into `exams` (201) and deleted it (204). All probe rows were removed. Anyone — not just me — can do this today, including mass-deleting the whole table.

## Findings table

| # | Issue | Severity | Fix | Effort |
|---|---|---|---|---|
| SEC-1 | **RLS open on `jobs`/`exams` (and likely all tables): anon key INSERT+DELETE works. Combined with the anon key shipped by `/api/auth-config`, anyone can alter or erase all data.** | **Critical** | Supabase SQL: enable RLS on every table; deny-all by default; add narrow `anon` policies only where genuinely needed (e.g. insert into `employer_submissions`, `resource_submissions`, `reports`, `alerts` with `with check`; select on nothing — all reads go through the server using the service-role key). Re-probe after. | 1–2 h |
| SEC-2 | Full admin UI ships in the public bundle (`index.html` line 58 admin section; ~35 admin symbols in `app.js`: owner-key login, AI importer, discovery, notification reader, monetization tab). | High | Delete the admin section from index.html; strip admin code from app.js; admin lives only at /admin (admin.html) behind real server-side auth (P0). | 4–8 h |
| SEC-3 | `/api/auth-config` publishes Supabase URL+anon key; harmless only after RLS is fixed. | Medium | Keep endpoint (client needs it for auth later) but treat as public after SEC-1; add Cache-Control. | 15 min |
| SEC-4 | No captcha/rate limit on public forms (Post a Job, Submit Resource, Report, subscribe). Spam honeypot only. | High | Cloudflare Turnstile (free) + per-IP rate limiting in handlers (lib/security.js pattern already exists). | 3–4 h |
| SEC-5 | `/api/agent` accepts unauthenticated writes (session-scoped profile/preferences/interactions). | Medium | Rate-limit per IP; size-limit payloads; consider Turnstile on onboarding save. | 1–2 h |
| SEC-6 | AI importer sends pasted/scraped text to Gemini — prompt-injection surface. | Medium | Server-side sanitisation, strict output schema, nothing publishes without human approval (already the rule — enforce with a test). | 2–3 h |
| SEC-7 | Admin auth is a static owner key compared in client code paths; no 2FA, no real session. | High | Move to Supabase email OTP/magic link + TOTP 2FA for the single admin account; owner key retired. | 1–2 days |
| LEG-1 | Footer contact is a personal Gmail (`modin7174@gmail.com`). | Medium | Replace with a contact form (POST /api/contact → email via Brevo free) or a role inbox. | 1–2 h |
| TRUST-1 | WhatsApp channel URL is a placeholder (`whatsapp.com/channel/0029VaBoldDesign`). | Medium | Replace with the real invite or remove the button. Telegram link needs manual verification too (t.me/CivilCareerIndiaJobs). | 15 min |
| TRUST-2 | Public API omits salary/deadline/vacancy fields → UI cannot show them; "salary on every listing" goal impossible today. | High | Add the columns to `PUBLIC_JOB_FIELDS` in `_api/jobs.js` (data-side check first), then show "Not disclosed" + market estimate. | 2–4 h |
| TRUST-3 | No visible "Last verified" / "Source: <domain>" on listings; no Verified badge pipeline. | High | Both fields already exist server-side (`last_verified`, `source_url`) — surface them in list cards + job page; add Verified badge keyed on `review_state='Published'` + human check flag. | 4–6 h |
| DATA-1 | Government listing count = 13. The main differentiator is empty. | High | Point govt-discovery at official sources; enrich exam rows (fixed today: detail-page enrichment landed in `16dc4c3`); backfill SSC JE / RRB JE / PSC AE-JE pages manually. | ongoing |
| DATA-2 | ~5% duplicate role+company pairs. | Medium | `findDuplicateJob` exists on POST; add the same guard to discovery insert paths + a one-off dedupe script. | 2–3 h |
| SEO-1 | Only ~2 pages in Google's index (homepage, legal) vs 758 sitemap URLs. | High | Verify property in Search Console, submit sitemap; JS-only rendering on SPA pages is the likely cause — extend the SSR pattern (already proven on /jobs/<slug>, Perf 100) to listings and static pages. | 1–2 days |
| SEO-2 | Nonexistent job slug returns 500 (soft-404). | Medium | Return 404 + a styled "not found" page from `renderJobPage`. | 30 min |
| SEO-3 | SPA pages render client-side only → weak crawling; title/OG duplication risk across pages. | High | Pre-render the 6 main pages (build-time or edge function), per-route canonical/OG (partially exists). | 2–3 days |
| PERF-1 | Homepage Lighthouse mobile **Performance 56** — LCP 9.7s, TBT 630ms, main-thread 3.9s, DOM 2,020 nodes; job page scores 100 → the gap is the SPA bundle. | High | Code-split admin + charts out of the public bundle, lazy-load below-fold pages, trim/defer hero animations (hero-3d, visual-backgrounds), ship the Blueprint design system lean. | 2–4 days |
| PERF-2 | Six scripts + heavy CSS on the homepage; admin/form code loaded by everyone. | High | Same fix as PERF-1/SEC-2; target LCP < 2.5s, Perf ≥ 90. | included |
| A11Y-1 | Lighthouse Accessibility 95: contrast failures on muted text (0 items surfaced in the detail dump — audit again after the palette lands; muted greys on navy are the usual offenders). | Medium | Design-system tokens (doc 03) are pre-checked to AA; re-run Lighthouse after. | included |
| COMPAT-1 | No 360px-specific issues found in code (viewport meta present, fluid grids), but manual device test pending — flagged, not verified. | Low | Do a real 360×640 4G pass during P0. | 1 h |
| MONET-0 | Monetization tab exists in the public bundle while Vercel Hobby forbids commercial use. | High | Covered by SEC-2 (removal) + hosting move (doc 02). | included |

## Lighthouse mobile (before)

| Page | Perf | A11y | Best Practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| / (SPA homepage) | **56** | 95 | 96 | 100 | **9.7 s** | 630 ms | 0 |
| /jobs/<slug> (SSR) | **100** | 94 | — | 100 | 1.0 s | — | — |

## Google indexing (estimate — verify in Search Console)

`site:civilcareer-india-two.vercel.app` returns ~2 results (/, /legal.html). Sitemap has 758 URLs. Either Google has not crawled most URLs or it renders the SPA poorly. Search Console URL Inspection on a job page + listing page will settle which. Action: verify property, submit sitemap, then move listings to SSR.

## What was NOT testable from here

- Search Console (no property access) — indexing numbers above are estimates.
- Real 360px device on throttled 4G — emulated Lighthouse only; manual pass scheduled.
- Telegram/WhatsApp link liveness from this network — needs a manual click-test by the owner.
- Inside the Supabase dashboard (no credentials locally) — RLS fix must be applied in the dashboard/SQL editor by the owner, or paste me a session where I can guide it step by step.
