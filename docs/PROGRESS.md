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

## 30 Sep 2026 — Phases 5–6 completion session (commits `1bde1b5`…`da34154`, all deployed)

Everything below was verified live in a browser (with the `civilcareer-v22-sw-bypass-20260930`
service worker's caches cleared before each check) and by `npm test`.

### Phase 5 — UI

- **P5.1 Dark mode** (`1bde1b5`): `styles.css` dark overrides under `html[data-theme="dark"]`;
  `theme.js` (new) in the `<head>` of all 7 HTML pages (no flash; follows
  `prefers-color-scheme` by default, override in `localStorage.cc_theme`); `.theme-toggle`
  nav button cycles moon/sun. Live-verified at 360px in both themes.
- **P5.3 Government Cards | Table toggle** (`71cd55f`, empty-table fix `94ff4ed`):
  `#govViewCards`/`#govViewTable` buttons, preference in `localStorage.cc_gov_view`,
  table built from the same fetched data (Post/Authority/Location/Deadline/Vacancies/Status).
  First-click-verified live: the initial build filled the `<tbody>` before the table
  skeleton existed, so the first switch showed 0 rows — `ensureGovTableSkeleton()` now
  runs on every fetch. Verified: 13 rows render, toggle round-trips, persists.
- **P5.4 Share / Report on jobs** (`39340c1`, mobile-wrap fix `da34154`): WhatsApp
  intent + Report link on the compact explorer card (`discovery-v9.js` — this is the
  renderer the explorers actually use; the earlier v8 `jobCard` edit was shadowed by
  it), and on the dedicated job detail page (`v8.js` `openJob`). `.cc-compact-actions`
  now wraps so the links stay on-card at phone widths. Verified live: 40/40 private
  cards + 13/13 gov cards carry the links; Report routes through the SPA to /report;
  detail page verified at 375px in dark mode.

### Phase 6 — Growth, compliance, ops

- **P6.1 Cloudflare migration prep** (`7b10771`): `docs/06-cloudflare-migration.md` —
  Node catch-all → Pages Function adapter mapping, `_redirects`/`_headers`, cron →
  GitHub Actions, exact switch steps and rollback plan (DNS TTL 60s first; Vercel
  stays intact as rollback). No DNS changes made.
- **P6.2 DPDP deletion** (`073cb7c`): `_api/account.js` `delete_account` deletes all
  candidate-owned rows then bans the auth user via the Supabase admin API;
  `account.js` "Delete my data" button with confirm; `legal.html` DPDP sections
  (consent basis, withdraw/erase, access/correct, nominate, data-collection and
  listing-source disclosure, grievance redressal).
- **P6.3 Programmatic SEO** (`5a869b9`, regex fix `66d9233`): 10 roles × 12 cities
  path space (`/site-engineer-jobs-in-pune` etc.) pre-seeds the private explorer
  filters; unique title/description with the real live count, rewritten hero, and
  BreadcrumbList + FAQPage JSON-LD from live data (counts never invented).
  Verified live on /site-engineer-jobs-in-pune. Known cosmetic: after boot the SPA
  pushState rewrites the URL to /private-jobs; page works, URL cosmetics later.
- **P6.4 Admin KPI report** (`f51d0ae`): `_api/analytics.js` GET (owner-gated) adds a
  `kpi` block (weekly active users, new alert subscribers, applications tracked,
  apply rate per 1k views, page views, listings verified, scam reports) computed
  with `Promise.allSettled`; `admin.html` renders it above the metrics. Owner-key
  session required to view live.
- **P6.5 Salary explorer — SKIPPED**: API returns parseable salary data for only
  ~13 of 300 rows in messy free text; an explorer would look invented. Prerequisite:
  numeric salary normalization at ingestion.

### Data-quality fix found during verification (`dfdaca7`)

The owner's round-1 sector reclass (13 rows) was undone within ~2 days: discovery
drafts were classified from `title + snippet` only — the company name never reached
the Private veto, and the bare token `department` matched JD section headers like
"Department: Projects / Estimation". `classifyJobSector(title, snippet, company)` now
passes the employer through, and `department`/`commission` were replaced with the
qualified forms (`department of`, `public works`, `examination authority`,
`public service commission`). Simulated against the live rows before shipping:
11 of 13 flip to Private, 2 genuine rows stay Government, zero regressions in
`tests/phase12-sector-quality.test.js` (extended with the live JD-header cases).
Owner SQL for the 11 live rows: `supabase-v18-sector-fix.sql` (also contains the
still-pending subscriber dedupe + unique constraint).

### Verification this session

- `npm test`: 28 passed, 0 failed (includes new sector regression cases).
- `node scripts/launch-check.js`: 0 errors, 1 warning (`SITE_URL` not set locally).
- Live checks: gov Cards|Table toggle round-trip with data; share/report links on
  cards and detail; /report SPA route; programmatic page meta/JSON-LD/filters;
  dark + light at 375px (gov cards, job detail); contact form 201 with Turnstile
  token, 400 without (earlier in session).

### Waiting on owner (this session)

1. ~~Run `supabase-v18-sector-fix.sql` steps 1–2 (reclass ~11 rows)~~ DONE 30 Sep:
   Government now 3 rows (QCI, NTCPWC, Live Connections), Private 733. Step 3
   (subscriber dedupe + `subscribers_email_key` unique constraint) still to run
   if not already done.
2. Sign in at /admin with the allowlisted owner email to see the KPI report.
3. Brevo SMTP (Phase 2.9 steps above) — still pending; blocks the second-account
   admin-denial demo and alert emails.

## 30 Sep 2026 — dark-mode contrast + admin auth hotfixes (commits `75ada8e`…`64aa5d2`)

- **Dark mode invisible text**: scripted WCAG scan (alpha-composited backgrounds) found
  headings stuck at light `--navy` (worst 1.0:1 — literally invisible), brand-blue
  links at ~2.4:1, and light surfaces never darkened (`.empty-state`, `.quick-card`,
  `.filters`, dialogs, chips, trust/safety strips). Rounds 2–3 in `styles.css` flip
  them; verified by re-scan.
- **Admin "Administrator access denied" + all tabs on Loading**: three stacked causes —
  (a) `ADMIN_EMAIL` on the deployment differed from the address the owner signs in
  with (sign-in succeeded, every gated call 403'd); the allowlist now accepts a
  comma-separated list, dot-insensitive for Gmail. (b) `loadAll` used one
  `Promise.all` so one failed endpoint blanked every tab — sources now settle
  independently with retry notes. (c) Supabase access tokens expire after ~1h with
  no refresh — 401s now rotate once via `/api/admin-auth` (new, server-verified
  allowlist) and retry; `auth=1` GETs on jobs/exams/materials select the admin scope
  so drafts, Pending Review and agent-reach items are visible in Jobs/Discovery/
  Agent Reach. SW cache bumped to `civilcareer-v23-admin-auth-fix-20260930`.
- **Footer layout**: below 1100px the grid drops to two columns; the bottom row is
  tightened (no large gaps).
- **Owner steps**: add the sign-in address to `ADMIN_EMAIL` in Vercel (comma-separated
  with the existing one), redeploy, hard-refresh /admin (or clear SW caches once).
## Phase 13 — Production integrity patch (2026-09-30)
- Removed the duplicate direct `/api/govt-discovery.js` function; government discovery is now centralized through `api/[[...path]].js` → `_api/govt-discovery.js`.
- Replaced spoofable `vercel-cron` User-Agent authentication with `CRON_SECRET` bearer authentication.
- Public government listings now require an HTTPS official `.gov.in`/`.nic.in` or explicit official PSU/board/recruitment hostname; employer-name heuristics alone cannot authorize publication.
- Added source verification fields to the government feed.
- Removed unused stale `next-phase.js`.
- Added route-specific static HTML metadata shells for key landing routes and rewrote those routes to their shells.
- Added regression tests in `tests/phase13-production-integrity.test.js`.

## 2 Oct 2026 — Phase 0: gap report (branch `audit`, commit `ad619e8`)

- P0 gate PASSED: the repo's v27 SQL was stale; both files were
  overwritten byte-for-byte with the owner's FINAL applied versions
  (is_test, last_attempt_at, media_url, approved_content_hash,
  caps_timezone all present). The two v27 files are now FROZEN and are
  never edited again. New migrations start at v28.
- Baseline `npm test`: 35 tests, 32 pass, 3 PRE-EXISTING failures
  (phase13-production-integrity: stray api/govt-discovery.js still
  present + missing .github/workflows/govt-pipeline.yml; govt-pipeline
  + govt-crawler-hardening: missing govt-pipeline.yml). The civil
  classifier itself passes. These are P1/P8 deliverables, not regressions.
- Wrote docs/00-gap-report.md: v27 gate check, baseline run, branch
  topology (incl. the social-engine name-collision resolution), full
  Block A-H gap table with file:line evidence, free-tier limits with
  doc pages, prompt-vs-codebase conflicts, owner checklist, dead-code list.
- Branch topology: P0 lives on `audit` (branched from `social-engine`
  HEAD). P2 will fast-forward the existing `social-engine` branch onto
  the chain so the name is reused without deleting anything.
- Status words: gap report IMPLEMENTED; nothing claimed TESTED beyond the
  test run above.
- Open blockers: none for P0.
- Owner manual steps: none new yet (v27 already applied in Supabase).

## 2 Oct 2026 — Phase 1: security hardening (branch `security-hardening`)

- A1 subscribe service-role: VERIFIED — `_api/subscribe.js` writes
  to `/rest/v1/subscribers` with the service-role Bearer; the anon
  key is never used. Re-tested end-to-end by the new suite.
- A2 RLS-dependent features: `_api/account.js` verifies the bearer
  against Supabase Auth, then scopes every read/write to
  `user_id = u.id` with the service-role key; Supabase RLS
  policies remain the backstop (owner audit via docs/rls-audit.sql).
- A3 admin page gated: `/admin` and `/admin.html` rewrite to the new
  `_api/admin-page` function. Anonymous and non-allowlisted callers
  get a minimal sign-in shell; the generated `admin.html` bundle is
  served only after `verifyAdminToken` (Bearer or `cc_admin_session`
  cookie). `admin.html` sets/clears the session cookie on
  login/refresh/signOut; `scripts/build-admin-bundle.js` regenerates
  `_api/admin-page-html.js` (tests assert a byte-identical
  round-trip between bundle and source admin.html).
- A4 anonymous writes hardened: `subscribe.js` now runs per-IP
  rateLimit (10) → honeypot → Turnstile verification → validation
  → service-role write. `account.js` POST/DELETE writes are
  per-IP rate-limited (60) BEFORE auth so unauthenticated floods
  are bounded too.
- A5 RLS audit script: added `docs/rls-audit.sql` — read-only,
  uses `pg_tables.rowsecurity` + `has_table_privilege` + a
  `pg_policies` inventory (deliberately NOT
  `information_schema.tables.row_security`, the v27 verify-section
  mistake). Owner runs it in the Supabase SQL editor.
- A6 secret hygiene: full `git log -p --all` scan found ZERO
  secrets (no provider tokens, JWTs, AWS/GitHub/Slack keys, or
  PEM material). Rotation list (variable NAMES only, never
  values) written to `docs/secret-rotation-list.md`;
  `.gitignore` reconfirmed; gitleaks workflow already active.
- A7 render-time escaping: `_api/seo-page.js` escapes every scraped
  field in job cards (esc()) AND inside the JSON-LD `<script>`
  blocks (jsonLd() unicode-escapes `<`, `>`, `&`, U+2028/U+2029
  to prevent script breakouts); `_api/jobs.js` HTML render escapes
  role/company/location via escapeHtml; `_api/account.js`
  cleanProfile already type-checks and slices. CSP still carries
  `script-src 'unsafe-inline'` because existing pages use inline
  scripts — tightening it is a breaking change, deferred and
  documented here per the gap report.
- A8 regression tests: `tests/phase1-security.test.js` now has 27
  tests — escapeHtml unit, seo-page escaping, subscribe (405 GET,
  429 after 10, honeypot with no DB write, 400 missing Turnstile,
  200 with verified token + service-role Bearer, fail-open on
  Turnstile network error, 400 invalid email/pref), account (429
  after 60 writes, 401 unauthenticated even when unconfigured),
  admin-page gate (shell for anonymous, fail-closed when
  unconfigured, shell for non-allowlisted valid session, full
  bundle for allowlisted, cookie credential, dot-insensitive Gmail,
  ADMIN_USER_ID match, vercel.json /admin + /admin.html rewrites,
  dispatcher registration, bundle == admin.html byte-for-byte,
  admin.html cookie wiring), and stray `api/govt-discovery.js`
  stays removed.
- Two regressions found by the new tests and fixed: (1) seo-page
  JSON-LD interpolated raw scraped text — fixed with jsonLd();
  (2) `_api/account.js` userFromToken called config() before
  checking the Authorization header, so unauthenticated requests on
  an unconfigured deployment returned 500 instead of 401 — the
  header check now runs first.
- Suite: 59 tests, 56 pass, 3 fail — the 3 are the documented P0
  baseline failures (missing `.github/workflows/govt-pipeline.yml`,
  a P8 deliverable; docs/00-gap-report.md §2). No P1 regressions.
- Status words: A1–A8 IMPLEMENTED and TESTED by the new suite;
  A5's SQL audit is owner-run (no Supabase access from this
  environment, so it is not claimed as executed).
- Open blockers: none.- Owner manual steps: run `docs/rls-audit.sql` in Supabase and review the §2/§6 output (expect zero rows); keep `docs/secret-rotation-list.md` for any future exposure.

## 2 Oct 2026 — Phase 2: Social Content Engine F1–F8 (branch `social-engine`)

Gap-report deliverables F1–F8 on top of the frozen v27 schema
(`supabase-v27-social-engine.sql`, already applied in Supabase per the P0
gate; rollback in `supabase-v27-social-engine-rollback.sql`).

- **F1 `lib/social-core.js`** — pure rule layer shared by the API and the
  publishers: the 7-field `approved_content_hash` (ASCII 0x1F-joined,
  cleared on edit), `truth_hash` recomputed from the LIVE source row at
  publish time (the stored `truth_state` alone is never trusted), per-platform
  field limits, the 2-minute `publishing`→`uncertain` rule, the test-send
  exemption (`is_test` never counts toward caps, rollup or the
  already-published check), timezone-aware daily caps that count `uncertain`,
  `last_error`/`response_snapshot` secret redaction, and ledger→suggestion
  rollup.
- **F2 `lib/social-templates.js`** — one template per
  `<entity>.<event>.<discriminator>` key rendering a source record into the
  four content surfaces (Telegram text, LinkedIn post, Instagram caption,
  WhatsApp copy) plus the on-site link. Telegram stays plain text (no
  parse_mode) so unusual exam/company names can never break delivery.
- **F3 `lib/social-publishers.js`** — every platform send goes through it with
  a uniform result shape. Telegram is fully implemented (channel posts; the
  private test channel is preferred when `TELEGRAM_TEST_CHANNEL_ID` is set);
  LinkedIn and Instagram sends are wired and FAIL CLOSED with an explicit
  "not implemented" error so the ledger records the attempt honestly instead
  of silently skipping a platform.
- **F4 `_api/social.js` + dispatcher** — admin-only `/api/social` (single
  segment, `op` on query/body like `/api/interview`): settings GET/PATCH,
  connections metadata + register/verify/primary/enable/disable, ledger read,
  and create/edit/approve/reject/publish/test/resolve. Publish runs
  Truth Lock → claim → send → rollup. Registered in `api/[[...path]].js`
  with every method admin-only; dashboard sessions elevate through the
  allowlist while the real owner key keeps working for scripts.
  `SOCIAL_CRON_SECRET` is deliberately NOT a cron credential —
  `CRON_ROUTES` stays exam-alerts + govt-discovery only, so scheduler access
  to social routes can never imply discovery-crawler access.
- **F5 `admin.html` Social tab** — queue with status filters and per-row
  badges (suggestion / truth / ledger), approve / reject / archive /
  publish / test-send / regenerate (offered when the truth state is stale),
  an expandable send ledger with manual retry/cancel for uncertain/failed
  rows, the engine settings form (kill switch, require approval, per-platform
  daily caps, caps timezone, post footer, default hashtags), and non-secret
  connection management. Bundle regenerated via `scripts/build-admin-bundle.js`;
  the phase1-security byte-identical round-trip assertion still holds.
- **F6 `_api/exam-tracker.js`** — `application_open` transitions no longer
  call `api.telegram.org` directly; they create a suggestion through the
  engine in-process (same runtime, no network self-call). With
  `require_approval` ON (the default) the announcement waits in the Social
  tab; OFF publishes immediately with Truth Lock, one-send-per-platform and
  daily caps still enforced. The engine's unique index makes it
  once-per-change. Best-effort as before — an engine hiccup never fails the
  exam save.
- **F7 `_api/admin-jobs.js`** — the legacy direct Telegram auto-post is now
  gated behind `LEGACY_TELEGRAM_AUTOPOST` (default `true`/`1` = ON, keeping
  the pre-engine behaviour alive). Phase 3 flips it off and job
  announcements flow through the engine queue instead.
- **F8 `.env.example`** — documents `LINKEDIN_API_VERSION`,
  `SOCIAL_CRON_SECRET` (reserved for the Phase 3 scheduled drain; kept
  separate from `CRON_SECRET`) and the Turnstile pair.

### Verification

- `node --check` on all 8 touched/new JS files: 0 failures.
- `tests/phase16-social-engine.test.js`: 33 tests, 33 pass — F1 hashes /
  locks / caps / redaction, F2 template snapshots, F3 publisher fail-closed
  behaviour + test-channel preference, F4 handler auth (401 before any
  config is revealed, OPTIONS same-origin CORS, unknown ops rejected without
  touching the database, dispatcher registration + admin-only rule, the
  in-process exam-tracker call contract), F5 admin tab wiring, F6 no direct
  telegram.org calls remain, F7 legacy gate, F8 env documentation.
- Full `npm test`: 92 tests, 89 pass, 3 fail — the 3 are the documented
  pre-existing baseline failures (missing `.github/workflows/govt-pipeline.yml`,
  a P8 deliverable; `docs/00-gap-report.md` §2). No Phase-2 regressions.

- Status words: F1–F8 IMPLEMENTED and TESTED by the new suite.
- Open blockers: none.
- Owner manual steps: none new for this phase (v27 SQL already applied per
  the P0 gate). When the Phase 3 scheduled drain lands, set
  `SOCIAL_CRON_SECRET` in Vercel; until then it is reserved and unconsumed.
  Keep `LEGACY_TELEGRAM_AUTOPOST=true` until Phase 3 wires job publishes
  into the engine.


## 2 Oct 2026 — Phase 3: Social Content Engine Phase 2 (branch `social-engine`) — PARTIAL

- Deadline Radar service added for `job` and `govt_job` verified sources.
- Radar events implemented: newly announced, applications open, 7 days, 3 days,
  24 hours, closing today, and closed.
- Non-fixed government deadlines are skipped; no relative date is invented.
- Update detection compares protected fields and uses `previous_apply_end`
  when a government deadline is extended.
- `SOCIAL_CRON_SECRET` uses constant-time comparison in `_api/social-cron.js`.
- GitHub Actions scheduler added at `17,47 * * * *` and the duplicate legacy
  scheduler is left manual-only.
- Admin Run Now now triggers Radar generation and the approved queue drain.
- Private-job legacy Telegram autopost default switched OFF; published private jobs
  are queued through the Social Engine path.
- Deterministic SVG graphics core was added as the P4 foundation.

### Verification
- Gitleaks: TESTED — PASS.
- Vercel Preview: CONFIGURED/TESTED by Vercel integration — deployment reported Ready.
- Social Engine CI: current full suite is still failing on the legacy radar test module,
  an admin-bundle byte-sync check, and one stale scheduler assertion. These are recorded
  in `docs/BLOCKERS.md`; no success is claimed for the full P3 suite.
- Status: P3 PARTIAL.

### Open blockers
- Repository write safety currently prevents replacing the legacy `lib/social-radar.js`
  and regenerating `_api/admin-page-html.js` directly through the integration.
- The next autonomous pass should resolve those test/bundle blockers before declaring
  P3 TESTED.

## 2 Oct 2026 — Phase 3 verification closure (branch `social-engine`)

- Resolved the prior P3 blockers: legacy radar regex parsing, protected admin bundle drift, the static Exam Tracker test mismatch, and the new CI lockfile assumption.
- Added continuous `.github/workflows/ci.yml` covering syntax and the full `npm test` suite.
- Current verification: CI **PASS**, 135/135 tests passing; Social Engine Phase 1 Tests **PASS**; Gitleaks **PASS**.
- Manual helper verification: P3 radar returned expected 7-day, 3-day, and closing-today/24-hour events for fixed dates.
- Status word: **TESTED**.
- Open production blocker: Vercel currently reports build-rate-limit and the connected Vercel scope is unauthorized for `modinsaheb`; no production deployment is claimed from this environment.

## 2 Oct 2026 — Phase 4 graphics

- Branch: `social-engine-3`
- Added deterministic SVG-to-JPEG export using `sharp` 0.35.5.
- Added admin-only JPEG generation plus automatic public Supabase Storage bucket creation/upload for `social-graphics`.
- Added 1080x1080 and 1080x1350 regression coverage, SVG escaping coverage, and 8 MB output guard.
- CI: **PASS** on commit `242d80f`; syntax and full test suite passed.
- Status word: **TESTED**.

## 2 Oct 2026 — Phase 6 Instagram Login

- Branch: `social-engine-5`
- Replaced legacy Facebook-Graph Instagram publishing with the Instagram Login route using `graph.instagram.com`.
- Enforced public JPEG media URLs and split container creation from final `media_publish`.
- Added ledger-backed `needs_second_step`, 60-second poll guard, 24-hour expiry, Truth Lock/content-lock recheck, and an Admin second-step action.
- CI: **PASS** on commit `c0fee84a46760f0a7f5c3239b0904d27e2988007`; syntax + full test suite green.
- Status word: **TESTED**. No real Instagram post was performed; production credentials/controlled test publication remain owner-side configuration.

## 2 Oct 2026 — Phase 7 Daily Radar preview

- Branch: `social-engine-6`
- Added an admin-only Daily CivilCareer Radar preview endpoint and Admin panel.
- Preview computes due events from verified job/government rows and rendered platform variants without inserting suggestions or sending posts.
- Protected admin bundle regenerated after UI changes.
- CI: **PASS** on commit `32beeb2673ecab7650e8074f297656d47ab3b575`; 146/146 tests passing, syntax checks passing.
- Status word: **TESTED**. Radar remains preview-only as required for this phase.

## 2 Oct 2026 — Phase 8: Government pipeline hardening
- Branch: govt-pipeline
- Canonical government discovery now uses the shared civil classifier; hard negatives are excluded from staging and discipline_unknown remains needs_info.
- Added cron-protected government expiry sweep.
- CI: PASS on verified head 7ef108380ef25bf4cb5c4164da9ba33f94d10306.
- Status word: TESTED.

## 2 Oct 2026 — Phase 9: Government public pages
- Branch: govt-public-pages
- Added SSR government landing/detail handler and URL-family rewrites.
- CI: PASS on verified head 0ff3440b60c94cef3f68668dbf5b9869ba796d18.
- Status word: TESTED.

## 2 Oct 2026 — Phase 10: SEO/performance
- Branch: seo-performance
- Added active government JobPosting JSON-LD and active government detail URLs to sitemap, plus standalone legal sitemap entries.
- CI: PASS on verified head fb0ab1810a1457bd3159803fd3eedbbaa00623b5.
- Status word: TESTED. No Lighthouse score claimed.

## 2 Oct 2026 — Phase 11: Trust/legal
- Branch: trust-legal
- Added standalone Disclaimer, explicit legal links, India-only wording, and data-use notices on collecting forms.
- CI: PASS on verified head 94464291e6bb6a37759db797d70a85b6aea4998e.
- Status word: TESTED.

## 2 Oct 2026 — Phase 12: Operations
- Branch: operations
- Added private Supabase key-table backup workflow, hourly site health checks, and operations runbook.
- CI: PASS on verified head fef916adda938da6caf391033e8f9495cfd1bfcd.
- Status word: TESTED.

## 2 Oct 2026 — Phase 13: Docs/final
- Branch: docs-final
- Updated README, Social Engine README/runbook, government runbook, environment notes, and added FINAL-REPORT.md.
- Production promotion remains blocked by current Vercel connector authorization for scope modinsaheb.
- Status word: TESTED. Final docs/release CI is green on commit b6b2249ebce4e07aff1b5f38b8abf41438b7dc3b; Vercel production promotion remains connector-scope blocked.

## 2 Oct 2026 — Landing-page SEO copy follow-up
- Branch: seo-page-copy
- Updated homepage, private jobs, government jobs, exams, study materials, and career guides page copy/metadata.
- Commit: `a8488b13ef42990771563ecf864f61adfe4b14e2` (pushed; author corrected to the owner email).
- Checks: syntax and launch checks passed; launch check reports `SITE_URL` unset. Six edited pages have unique titles and canonical URLs. Test suite: 161 passed, 1 failed (`A8 admin bundle: generated file matches admin.html byte-for-byte`).
- PR merged to `main` by owner as `d7892b2`. Production pages verified afterward; clean `/exams` route remained incorrect and is tracked below.

## 2 Oct 2026 — Exams clean-route follow-up
- Branch: `fix/exams-route` (based on merged `main`).
- Moved the exact `/exams` rewrite before `/exams/:path*`; added an order/destination regression test.
- Fix commit: `faa963a4e72ec96d5478dd4f6dac067479208d58` (pushed to origin).
- Tests: focused SEO/routing tests 3/3 passed; syntax check passed; full suite 162 passed, 1 failed on the existing A8 generated-admin-bundle byte-sync assertion.
- Status: route fix IMPLEMENTED and TESTED locally; production NOT YET VERIFIED.
- Owner step: review the preview deployment, then merge the PR. Recheck `/exams` title and canonical after production deployment.

## Production issue follow-up — site and admin reliability
- Branch: `fix/site-and-admin-errors`, stacked on `fix/exams-route`; do not merge directly to `main`.
- Jobs: paginated list requests now take precedence over a catch-all router's synthetic `slug=jobs`, preventing a detail response such as `{job:null}` from replacing `{jobs,meta}`.
- Homepage: removed rotating background photos from the home hero and shortened the small-screen first viewport; other route backgrounds remain available. Also removed a bootstrap exception when an optional form is absent.
- Interview moderation: pending questions require the owner key; database/table errors are returned explicitly, with a v26 setup instruction when its table is missing.
- Public theme: the existing public-site toggle was verified to switch themes; no theme implementation change was needed. The admin dashboard remains a fixed dark interface.
- Regression coverage added for the job list/router collision, optional forms, home hero rules, interview access/error behavior, and database grants.
- Validation: focused regressions 7/7 passed; full suite 169/170 passed. The remaining A8 generated-admin-bundle byte-sync assertion is pre-existing and unrelated; syntax checks pass with the existing local `SITE_URL` warning.
- Supabase owner action (no database access is available from this workspace): in the Supabase SQL Editor, run `supabase-v25-portfolio-reviews.sql`, then `supabase-v26-blog-interview.sql`. These scripts create only the missing feature tables/columns, preserve existing rows, enable RLS, revoke browser-role table privileges, and leave access to the server-side `service_role` API. Do not run an older variant of these files.
- After applying each script, verify `rowsecurity = true` for `engineer_profiles`, `profile_projects`, `company_reviews`, `blog_posts`, and `interview_questions`; verify `anon` and `authenticated` have no table privileges and `service_role` retains API access. Retry Reviews and Interview tabs afterward.
- Vercel deployment remains blocked by the reported free daily deployment limit. No preview or production fix is claimed until Vercel accepts a deployment and live API/browser checks pass.

## 3 Oct 2026 — Main-branch UI and API reliability follow-up

- Working directly on `main` at `9162844`; no branch switch or production promotion performed.
- Homepage: the animated SVG is now an absolutely positioned decorative layer instead of occupying normal layout flow; mobile hero content stays in the first viewport.
- Dark theme: improved contrast for the career-tools row, language controls, stats, trust strip, and highlighted/how-it-works sections.
- Jobs: the production site was observed returning a populated private-jobs list (751 active opportunities) and rendering job cards. This was a live observation before these changes, not a deployment verification.
- Reviews: public list/detail and review-submit calls now use the catch-all's explicit supported aliases; list fetch surfaces non-2xx API errors.
- Interview and Blog: both API handlers use authenticated server-side PostgREST requests against the v26 schema; added actionable missing-table errors and retained the existing public/admin response contracts.
- Blog detail views still increment the view count; admin edits can change a slug without creating a duplicate post.
- SQL: quoted `"current_role"` in the v25 review schema to avoid the reported Postgres parse error.
- Regenerated `_api/admin-page-html.js` from `admin.html`; the main-branch baseline had a stale admin bundle that caused the full-suite bundle-sync test to fail.
- Regression tests cover hero/dark contrast, company review routes, blog response mapping, interview PostgREST reads and the quoted SQL identifier.
- Validation: `npm test` 175/175 passed; `npm run check:syntax` reported 0 errors (existing local `SITE_URL` warning); `git diff --check` passed. Local browser smoke check at 390px in dark mode showed the hero at y=65px, heading at y=176px, positioned SVG as absolute, readable stat labels, and hidden tools row; desktop hero also remained within the first viewport.
- Commit `8e23bdb` was committed on `main` and pushed to `origin/main` after owner approval of the possible automatic deployment.
- Post-push production check still sees the previous deployed build: jobs API returns 200 with jobs, company reviews return 200, but Blog and Interview still return 500 and the hero SVG is still in normal flow. The new commit has not yet been verified live; Vercel's free daily deployment limit was previously reported.