# CivilCareer production overhaul progress

## 29 Sep 2026 — takeover baseline and Phase 2 hardening

- Source package inspected: `civilcareer-india-main (13)`.
- No Git repository metadata was present in the supplied package, so no commit hashes are available.
- Live production fetch was attempted from this environment but DNS/network access failed; no live deployment claim is made.
- Public `index.html` previously contained the full admin dashboard and owner-key UI. This was removed from the public bundle; `/admin` continues to rewrite to the standalone `admin.html`.
- Standalone admin now signs in through Supabase password auth. Server-side dispatcher verifies the Supabase bearer token and allowlists `ADMIN_EMAIL` and/or `ADMIN_USER_ID`; legacy owner key is kept only as a server-side compatibility layer for existing handlers.
- Candidate account login was replaced with password auth (email or Indian mobile), signup, password reset, session persistence and account sync. OTP/magic-link login is not used.
- Public resource submission no longer accepts PDF uploads; links only.
- Public footer no longer exposes the personal Gmail or the placeholder WhatsApp channel.
- Added a public Contact form endpoint with honeypot, input limits and in-memory per-IP throttling.
- Newsletter subscription now uses the server-side Supabase service role instead of the anon key, which is necessary after the database lockdown.
- Added explicit application-tracker `I applied` action and server account sync hook.
- Removed Gulf/overseas choices from the public candidate location/work-preference UI.
- Removed the stale public `next-phase.js` admin probing bundle.
- Removed CSS `@import`; fonts are loaded from HTML `<link>` tags.
- Added clean URL redirects/rewrites for legal, career guides/tools and alerts.
- Updated Exam Alerts sources to current official UPSC/SSC/RRB/Employment News locations, parallelized source fetches, reduced per-source timeout, bounded response size, and batched draft insertion. Results remain unpublished Pending Review.
- Added current free-tier limits documentation in `docs/01-free-tier-limits.md`.
- Added a GitHub Actions Gitleaks workflow.

## 30 Sep 2026 — independent overhaul session (branch `overhaul-2026-09`, merged `a7190f5`)

- Base of record re-anchored to the 29 Sep rework after `origin/main` diverged via web upload.
- **Duplicate form ids fixed** (owner finding c): the two runtime filter bars emitted the
  same 8 select ids twice (16 duplicate ids on the live DOM). Selects are now namespaced
  `<containerId>-<field>` with the logical key on `data-xf`; verified live: 0 duplicate
  ids and filter state still writes the correct key. Regression test added
  (`tests/v8-filterbar.test.js`). Commit `2ed139d`.
- Phase-11 suite reconciled with the rework (normalizePhone/authRequest names asserted,
  stale explorer/ingestion assertions updated to the dynamic detail-page architecture);
  YouTube ingestion regained manual-over-ASR caption preference (`pickTrack`); auth-config
  now serves `SUPABASE_PUBLIC_URL`/`SUPABASE_PUBLIC_ANON_KEY` aliases. Commit `a7190f5`.
  `npm test`: 26 passed, 0 failed; `check:launch`: 0 errors.
- The 29 Sep rework already covered owner findings (a) partial tracker, (b) fonts,
  footer Gmail/WhatsApp removal, contact endpoint, PDF-upload removal and the admin
  allowlist — those were verified rather than rebuilt.
- Gitleaks workflow file added for real (`.github/workflows/gitleaks.yml`); it was
  previously claimed but missing from the tree.
- Still open (see Waiting on owner): Turnstile keys for form captcha, Brevo SMTP for
  auth emails/digests, Search Console submission, admin email config in Vercel.

## 30 Sep 2026 — Phase 2/3 completion session (commits `1f0bd6a`…`213ec37`, all deployed)

All commits below were merged to `main` and verified live on
`https://civilcareer-india-two.vercel.app` after each deploy.

### Deployed changes

| Commit | Change | Live verification |
|--------|--------|-------------------|
| `2ed139d` | Duplicate filter-bar ids namespaced (`<barId>-<field>`, key on `data-xf`) + regression test | live DOM: **0 duplicate ids**; filter change writes correct key |
| `a7190f5` | Phase-11 suite reconciled; `pickTrack` manual-over-ASR captions; auth-config public aliases | `npm test` 26/26 |
| `1f0bd6a` | Gitleaks workflow (was claimed, missing); PROGRESS update | workflow file in tree |
| `a6e9241` | Apply tracker on dynamic detail pages + SSR job pages (local-first, syncs via `/api/account`) | `data-cc-track-apply` served; SSR pages carry tracker markup |
| `5a869b9` | Shared per-IP rate limiting + Turnstile siteverify for contact/job/resource/report | 401s on admin endpoints; honeypot silent-accepts bots |
| `2acdc73` | AI extraction: injection fence + post-data rules, 6h per-URL cache, 429 backoff | syntax + suite green |
| `fbc5e92` | Turnstile wired end to end: loader renders widget when site key published; `wireForm` attaches/resets token | browser: widget rendered, token (794 chars), form **201 accepted**; no-token curl → 400 |
| `19867d7` | CSP allows fonts.googleapis.com (style), fonts.gstatic.com, challenges.cloudflare.com (script+frame) | header live; fonts refused-error gone |
| `e4fcfeb` | Service worker bypasses cross-origin requests (offline fallback was serving SPA HTML over fonts/Turnstile); cache v22 | worker served with bypass + new cache name |
| `6a96c90`, `213ec37` | Hero background viewport-tuned (828/1600/2400) + head preload with `fetchpriority=high` | Lighthouse below |
| `(tests)` | Admin allowlist denial test (mocked Supabase Auth): valid non-allowlisted session → 403; invalid → 401 | `npm test` 27/27 |

### Lighthouse mobile (homepage)

| Metric | Before (30 Sep baseline) | After |
|--------|--------------------------|-------|
| Performance | 56 | **79** |
| Largest Contentful Paint | 9.7–10.6 s | **3.9 s** |
| Total Blocking Time | 630 ms | **10 ms** |
| Accessibility | 95 | 95 |
| Best Practices | 96 | 96 |
| SEO | 100 | 100 |

Remaining LCP gap is the Unsplash network dependency (hero photo). Next step:
self-host the first hero image per route in the repo (est. −0.5–1.0 s LCP).

### Owner config discovered live

- `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` are **both configured** in Vercel
  (site key published via `/api/auth-config`; secret enforced server-side).
- `ADMIN_EMAIL`/`ADMIN_USER_ID` admin gate returns 401 without session; denial
  proof for a valid non-allowlisted account is unit-tested; live second-account
  test blocked by email confirmation (needs custom SMTP).
- Newsletter `subscribers` table appears to lack a unique email constraint
  (duplicate subscribe returns success). Owner may add
  `alter table subscribers add constraint subscribers_email_key unique (email);`
  after checking existing dupes.

### Phase 2.9 Brevo SMTP setup (exact steps for owner)

1. Sign up at brevo.com (free: 300 emails/day).
2. Senders & IP → create sender `no-reply@<your-domain>` (verify).
3. SMTP & API → SMTP: copy user + SMTP key.
4. Supabase → Authentication → SMTP Settings: enable, host `smtp-relay.brevo.com`, port 587, user/key from step 3, sender from step 2. Save.
5. Authentication → Emails: customize Confirm signup / Reset password templates (SITE_URL links).
6. Test: sign up with a real address; the confirmation email must arrive (rate limit then becomes 300/day).

### Skipped this run (with reasons)

- Phase 5 full design system (dark mode, nav merge, For You onboarding): large UI
  rework not started — the 29 Sep rework changed the same files, so any parallel
  work would have conflicted. Recommend as the next focused session.
- Phase 6 Cloudflare Pages prep, programmatic SEO pages, web-push alerts: not started.
- Live second-account admin denial: blocked by unconfirmed throwaway email (no SMTP yet).

## Verification

- `npm test`: 27 passed, 0 failed.
- `npm run check:launch`: 0 errors, 1 warning (`SITE_URL` not set locally).
- JavaScript syntax: 48 files checked, 0 failures.
- HTML forms: no duplicate IDs found within forms in the inspected static HTML.
- Public-bundle scan: no owner-key/admin-dashboard/OTP-login strings in the public HTML/app/v8/account scripts.

## Waiting on owner

1. ~~Configure `ADMIN_EMAIL` or `ADMIN_USER_ID` in Vercel Production.~~ Owner gate: confirm which of the two is set, and confirm Turnstile keys (both were detected live on 30 Sep).
2. Confirm Supabase email/password and phone/password providers are enabled as desired. Disable phone confirmation if a no-OTP phone signup is required; email confirmation is a separate setting.
3. Configure `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `CRON_SECRET` and other production secrets in Vercel/GitHub.
4. Apply any required Supabase SQL only after schema review/backups; this run did not modify production data.
5. Perform the final hosting switch away from Vercel Hobby only with owner confirmation, because current Vercel Terms restrict Hobby to personal/non-commercial use.
