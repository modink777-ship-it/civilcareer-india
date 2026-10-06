# CivilCareer — VS Code Handoff Brief

**Purpose of this file:** you are moving this project from the Freebuff agent session into VS Code.
Section 1 is a **ready-to-paste prompt** for whatever AI agent you use there (Copilot, Cursor, Claude Code, Cline…).
Sections 2+ are the reference briefing — architecture, conventions, everything built to date, and what is left to do.

---

## 1. Paste this into your VS Code agent

> You are working on **CivilCareer**, a production job-and-career platform for civil engineers in India.
> Production: `https://civilcareer-india-two.vercel.app` · Repo root is this folder.
>
> **Read `HANDOFF-VSCODE.md` (this file), `CLAUDE.md`, `README.md` and `DEPLOY.md` before changing anything.** This is a
> plain-HTML + vanilla-JS + Node-serverless + Supabase project with **no build step for pages** and a **single Vercel
> function** (`api/[[...path]].js`) that dispatches to ~49 handlers in `_api/`. Do not introduce a framework, a bundler,
> or a second API surface.
>
> Non-negotiable rules:
> 1. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_KEY`, `CRON_SECRET`, `UDEMY_CLIENT_SECRET`, or any provider
>    credential to browser JS. Secrets live only in Vercel env vars and server-side `_api/` / `lib/` code.
> 2. Admin authorization is **server-side only**, via `ADMIN_RULES` in `api/[[...path]].js` + `verifyAdminToken` in
>    `lib/security.js`. Never trust an `is_admin` flag from the browser.
> 3. After **any** edit to `admin.html`, run `node scripts/build-admin-bundle.js`. `npm test` fails if the generated
>    `_api/admin-page-html.js` bundle is stale (byte-equality gate).
> 4. `npm test` (node:test, 39 files) and `npm run check:launch` must both pass before you call anything done.
>    Run them for real; never report "tests pass" without the exit status.
> 5. Match each file's existing line endings (most root HTML is CRLF; `lib/*.js` and `tests/*` are LF).
> 6. Never `git add -A`. `.env.example` is intentionally modified and must stay uncommitted.
> 7. Anything that cannot be verified (production DB, affiliate approval, external APIs) must be reported as
>    `BLOCKED — requires owner action`, not faked.
>
> Your first task after reading: state the current state of the repo, then ask what I want to work on.

---

## 2. What the website is

**CivilCareer** — "the career operating system for civil engineers in India". It is not a job board clone; the product
answers: which job to apply for, what skills are missing, what to learn, which exam to prepare for, what salary to
expect, which companies to target, and what to do next.

**Public product areas (all live):**

| Area | Route | Notes |
|---|---|---|
| Job search + details | `/`, `/jobs/:slug` | private-sector jobs, filters, saved jobs, applications |
| Private jobs | `/private-jobs` | curated feed |
| Government jobs | `/government-jobs`, `/government-jobs/job/:slug`, `/state/:state`, `/organization/:org`, `/qualification/:q`, `/role/:role` | ~765 indexed pages |
| Walk-in interviews | `/walk-in`, `/walk-in-interviews` | |
| Exams | `/exams`, `/exam-guides`, `/exam-tracker` | exam calendar + personal tracker + weekly alert emails |
| Study materials | `/study-materials` | YouTube/curated resources |
| **Courses (new)** | `/courses` | civil-engineering course aggregator, affiliate revenue |
| Career paths / guides / tools | `/career-paths`, `/career-guides`, `/career-tools` | |
| Salary intelligence | `/salary`, `/salary/:slug` | |
| Companies | `/companies`, `/companies/:slug` | |
| Profiles / talent | `/profile/:slug`, `/create-profile`, `/edit-profile`, `/talent` | candidate + employer sides |
| Alerts | `/job-alerts` | email + Telegram |
| Blog / interviews / mock tests | `/blog/:slug`, `/interview/:slug`, `/mock-tests` | |
| Employer / submissions | `/post-a-job`, `/submit-resource`, `/report`, `/contact` | |
| Admin dashboard | `/admin` (also `/admin.html`) | **auth-gated server-side** |
| SEO long-tail pages | `/:seoSlug` → `/api/seo-page` | catch-all must stay **last** in `vercel.json` |

Revenue model: affiliate commission on courses first; later jobs, learning, employer products, recruitment, advertising.
**Trust is the asset — never degrade it for short-term affiliate revenue.**

---

## 3. Architecture

```
Browser (static HTML + vanilla JS, no build step)
   │
   ├─ /api/*  ──► Vercel rewrite ──► api/[[...path]].js   (ONE function, maxDuration 60s)
   │                                   │ resolves path → _api/<handler>.js
   │                                   │ ADMIN_RULES gate (server-side admin session)
   │                                   └─ lib/* (supabase, security, classification, pipelines)
   │
   └─ /       ──► static .html files at repo root (+ rewrites in vercel.json)
                       │
                       └─ Supabase (PostgREST, reached ONLY from server handlers with the service-role key)
```

**Why one function:** Vercel **Hobby allows max 12 functions**. `api/[[...path]].js` is the single catch-all
dispatcher; every feature is a module in `_api/`. Adding a `_api/foo.js` handler + a dispatcher entry costs nothing.

**Repo map**

| Path | Contents |
|---|---|
| `*.html` | 26 pages — 25 public + `admin.html` (source for the admin bundle) |
| `_api/*.js` | 49 serverless handlers (`courses.js`, `jobs.js`, `govt-review.js`, `social.js`, …) |
| `lib/*.js` | 19 shared modules (`security.js`, `supabase.js`, `rate-limit.js`, `govt-title.js`, pipelines) |
| `api/[[...path]].js` | dispatcher: `handlers` map + `ADMIN_RULES` + `CRON_ROUTES` |
| `scripts/*.js` | 9 build/audit/pipeline scripts incl. `build-admin-bundle.js`, `launch-check.js`, `crawl-govt-pipeline.js` |
| `tests/*.test.js` | 39 files, **254 tests**, `node --test` |
| `*.sql` | 36 migrations (`v28`…`v33`, `phase27`…`phase29`) + `run-all-migrations-in-order.sql` |
| `.github/workflows/*.yml` | 8 workflows (scrapers, govt pipeline, morning brief, social drain, gitleaks, smoke) |
| `vercel.json` | rewrites, redirects, security headers/CSP, **crons** |

**Auth model**
- Users: Supabase email/password sessions in the browser.
- Admin: dashboard signs in with a Supabase session → the dispatcher's `ADMIN_RULES` gate calls
  `verifyAdminToken()` and attaches `req.adminUser`; handlers then call `requireAdmin(req,res)`.
- Scripts/cron: raw owner key (`x-owner-key` / `OWNER_KEY`) or `CRON_SECRET` bearer token, checked server-side.
- Public reads of admin endpoints (e.g. `GET /api/jobs`) stay open; mutations never are.

**Automation** — GitHub Actions run the pipelines every two hours (`0 */2 * * *`): civil scraper, job scraper, government
pipeline + agent reach, morning brief; plus weekly social drain and a post-deploy smoke test. Vercel crons handle
`/api/jobs?discovery=cron` (daily 00:30) and `/api/exam-alerts` (Mondays 00:30). Actions authenticate with
`secrets.CRON_SECRET` / `OWNER_KEY`.

**Environment variables** (names only — values are never in git):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_KEY`/`CIVILCAREER_OWNER_KEY`/`ADMIN_OWNER_KEY`,
`ADMIN_EMAIL`, `ADMIN_USER_ID`, `CRON_SECRET`, `SITE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`,
`TELEGRAM_TEST_CHANNEL_ID`, `SOCIAL_CRON_SECRET`, `LINKEDIN_*`, `INSTAGRAM_*`, `GROQ_API_KEY`, `SERPAPI_KEY`/`SERP_API_KEY`,
`ADZUNA_APP_ID`/`ADZUNA_APP_KEY`, `THEMUSE_API_KEY`/`MUSE_API_KEY`, `ARCHIL_*`, `SIEVE_*` (newer feature),
`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`, `AGENT_REACH_INGEST_KEY`.
`UDEMY_CLIENT_ID` / `UDEMY_CLIENT_SECRET` are **optional and unused** — see §7.

---

## 4. Conventions and gotchas (read before editing)

1. **Admin bundle.** `admin.html` is the source of truth; `_api/admin-page-html.js` is generated by
   `node scripts/build-admin-bundle.js` (JSON-stringified, so quotes inside it are escaped — never hand-edit it).
   `tests/phase1-security.test.js` asserts byte-equality and will fail if you forget to regenerate.
2. **Admin page is gated.** `/admin` and `/admin.html` both rewrite to `/api/admin-page`. Anonymous callers get a
   minimal ~4.4 KB sign-in shell; the full ~300 KB bundle is only served to an authenticated session. Curling `/admin`
   anonymously will *not* show dashboard markup — that is by design.
3. **Adding an endpoint:** create `_api/foo.js` exporting a `(req,res)` handler → register it in the `handlers` map in
   `api/[[...path]].js` → add an `ADMIN_RULES` entry if it has any non-public surface → add tests.
4. **PostgREST access** goes through `lib/supabase.js` helpers (`supa`, `supaService`, `readJson`) — never call
   Supabase from the browser with a privileged key. Filters are PostgREST query strings (`is_published=eq.true`).
5. **Line endings:** keep each file's existing convention. `admin.html`, `_api/govt-review.js`, `_api/govt-discovery.js`,
   `scripts/crawl-govt-pipeline.js` are CRLF; `lib/*.js` and `tests/*` are LF. `git diff --check` must stay clean.
6. **Testing pattern:** tests import the handler **directly** and stub `global.fetch` to act as Supabase/PostgREST —
   see `tests/v29-govt-publish-and-slug.test.js` and `tests/courses-api.test.js`. No network, no credentials.
7. **CSS** lives in `styles.css` (shared) plus page-scoped `<style>` blocks; `admin.html` carries its own. Don't
   redesign — consolidate only where provably safe.
8. **Security headers/CSP** are in `vercel.json`: `default-src 'self'` with narrow allowlists. Any new third-party
   origin (fonts, images, frames) must be added there or it will be blocked.
9. **Typecheck/lint:** none configured (plain JS). `npm run check:syntax` parses everything; `check:launch` audits
   launch readiness; `npm test` is the real gate.

---

## 5. What has been built — recent work (this session and the one before)

### 5.1 Course aggregator — new product surface (commit `42e3d12`)

Pipeline, exactly as specified: `provider/API → relevance filter → admin review → publish → user clicks out → affiliate`.

- **DB** — `v32-courses.sql` (already run in production):
  - `courses`: 23 columns (`title`, `provider`, `instructor`, `category`, `target_roles text[]`, `career_stage`,
    `price_inr`, `original_price_inr`, `rating`, `enrollment_count`, `duration_hours`, `language`, `thumbnail_url`,
    `course_url`, `affiliate_url`, `external_id`, `source`, `is_free`, `is_published`, `is_featured`, `admin_notes`,
    timestamps, plus `url_status`/`url_checked_at`).
  - `course_clicks`: `id`, `course_id`, `created_at`, `referrer`, `source` — aggregate only, **no PII**.
  - 10 indexes incl. partial-unique `(provider, external_id) WHERE external_id IS NOT NULL`; trigger
    `courses_touch` → `courses_touch_updated_at()`.
  - RLS on both tables with **exactly one** policy: `courses_published_read` (SELECT to anon/authenticated
    `USING is_published = true`). **Zero write policies** — writes only via the service-role key.
- **API** — `_api/courses.js`
  - Public `GET`: published-only by construction, filters `category/role/stage/provider/free/search/featured/page/limit`
    (default 24, max 50), facet counts, `admin_notes` never in the public projection.
  - `POST ?action=click`: rate-limited 60/hour/IP, verifies the row is published, records aggregate click.
  - Admin `GET ?admin=1`: all rows + stats (+ exact click totals via Content-Range).
  - Admin `POST` create/update, **`PATCH`/`PUT` update-only** (id-less PATCH → 400, can never insert), `DELETE`.
- **Discovery** — `_api/course-discovery.js`: admin-only; provider registry, the 10 spec search terms, idempotent bulk
  `import` (≤200 items, dedup by `provider+external_id` then normalized URL, **forces `is_published:false`**, preserves
  admin-owned `affiliate_url`/`is_featured`/`admin_notes`), and `action=run` which honestly returns
  `no-provider-available` instead of faking data.
- **Public page** — `courses.html`: hero, filters, course cards (badges, rating, duration, roles, price + strike-through),
  `co-cta` outbound links with `rel="noopener sponsored"`, click beacon via `sendBeacon`, pagination, affiliate
  disclosure, internal-linking block, JSON-LD `CollectionPage`, skip link + `main#content`, URL state sync,
  empty/error/loading states.
- **Admin tab** — `/admin → Courses`: stats row, provider status, **+ Add course** editor, **⚙ Run discovery**,
  **⬇ Bulk import** (paste a JSON array — always lands as drafts), row actions (Publish/Unpublish/Feature/Edit/Delete),
  pending rows visually flagged.
- **Routing:** `vercel.json` rewrite `/courses` → `/courses.html` + permanent `/courses.html` → `/courses`;
  dispatcher `ADMIN_RULES` for both new endpoints; `/courses` added to `_api/sitemap.js`.

### 5.2 Admin session hardening (commit `ce6d2a1`) — the owner password had leaked into a chat

- Server-enforced **session TTL** in `verifyAdminToken` (`lib/security.js`) — stale tokens are refused even if the
  browser still holds them.
- **Audit trail** — `v33-admin-audit.sql` (`admin_audit`: event, email, user_id, ip, user_agent, detail) written on
  successful refresh **and on denied admin attempts**. `recordAdminEvent()` swallows failures and returns `false`, so
  auth keeps working before the migration is applied.
- **Global revoke** — `_api/admin-session.js` (admin-only; `GET` = policy info, `POST` = revoke all refresh tokens for
  the user) exposed in the UI as **"Sign out everywhere"**.
- Cookie `SameSite=Strict`; stale local sessions bounce to the sign-in shell instead of erroring on every request.
- 16 tests in `tests/admin-hardening.test.js`.

### 5.3 Bugs found and fixed while verifying

- **Stale static `sitemap.xml` shadowed the dynamic sitemap.** A Sep-25 file (148 URLs, **zero job pages**) was
  winning over the `/api/sitemap` rewrite, so ~765 government/private job URLs were invisible to Google. Removed the
  static copy, taught the dispatcher to normalize `/sitemap.xml` (and `/sitemap`) to the handler: now **796 URLs,
  765 job pages, includes `/courses`**. **Re-submit the sitemap in Google Search Console.**
- **Dead admin script block.** One malformed ternary in `admin.html` stopped an entire inline block (Review Jobs +
  Government Jobs admin tooling, ~line 6110) from parsing — those admin functions were `undefined` in production.
  Fixed, and a regression test now parses every inline block and reports the exact browser error if it returns.
- **`_api/morning-brief.js`** linked the old `civilcareer.in` domain → corrected to the canonical domain.
- **Course editor UX bug:** the "Free course" checkbox was pre-checked and saved paid courses as free; it now tracks the
  price field (found by driving the real admin UI).
- **Prior session:** scheduled title guard on every pipeline run, repair patch fix (`verified_at` → `last_verified_at`),
  403-throttle handling in the govt crawler, and 4 bad auto-titles handled in production.

### 5.4 Accessibility + internal linking

- **All 25 public pages** now have `<a class="skip" href="#content">Skip to content</a>` and `main id="content"`
  (six had JS-referenced main ids that were migrated carefully). `admin.html` is intentionally excluded.
- Footer **Courses** link added to the key pages: `index`, `private-jobs`, `government-jobs`, `exams`, `career-paths`,
  `for-you`, `study-materials`.
- Canonical-domain audit: no stray `civilcareer.in` links remain (one intentional historical reference in a comment).

---

## 6. Verified state at handoff

| Item | Status |
|---|---|
| Branch / HEAD | `main` @ **`f870690`**, equal to `origin/main`, working tree clean except the intentionally-uncommitted `.env.example` |
| Tests | **254 / 254 pass, 0 fail, exit 0** (`npm test`) |
| `git diff --check` | clean, exit 0 |
| `npm run check:launch` | **0 errors**, exit 0 (1 pre-existing `SITE_URL` warning) |
| Live: `/courses` | 200, canonical + OG/Twitter + skip link + JSON-LD all correct |
| Live: `/courses.html` | 308 → `/courses` |
| Live: `/api/courses` | 200 `{ok:true, courses:[], total:0}` — **production DB reachable, so `courses` exists** |
| Live: admin surfaces | `/api/courses?admin=1`, `/api/course-discovery`, `/api/admin-session` all **401 for anonymous** |
| Live: `POST ?action=click` | clean 404 for unknown id, 400 without id, no 500s |
| Live: `/sitemap.xml` | 200, 796 URLs, 765 job pages, `/courses` present |
| Regressions | `/`, `/private-jobs`, `/government-jobs`, `/blog`, `/exams`, `/study-materials`, `/salary`, `/career-paths`, `/admin`, `/api/jobs`, `/api/govt-jobs` all 200 |
| Secrets | scan over all pushed diffs: **no key material** (only env-var names and `'test-key'` placeholders in tests) |

---

## 7. Known limitations, blocked items, and owner to-dos

**Blocked — requires owner action**

1. **Run `v33-admin-audit.sql`** in the Supabase SQL editor. Until then the audit trail silently records nothing
   (auth still works — the writer returns `false` rather than throwing).
2. **Rotate the admin password** that was shared in chat, then press **"Sign out everywhere"** in `/admin`.
   The TTL + revoke code is deployed, but the exposed credential itself cannot be invalidated from here.
3. **RLS behaviour** on `courses`/`course_clicks` is unverified against the real database (no SQL access from the
   agent environment). The migration is written to be service-role-write-only, but confirm it in the Supabase dashboard.
4. **`course_clicks` has never recorded a row in production** — there are no published courses yet, so the insert path
   is only proven locally.
5. **Re-submit `/sitemap.xml` in Google Search Console** (148 → 796 URLs).

**Product reality**

6. **No automated course discovery exists.** Udemy's Affiliate API was **discontinued 2025-01-01**, so there is no
   programmatic source; `/api/course-discovery?action=run` deliberately answers `no-provider-available` instead of
   fabricating results. The working path is **Bulk import** (paste JSON → drafts → review → publish) or per-course entry.
7. **The catalog is empty.** Start with 50–200 high-quality courses, then measure views/clicks/CTR before scaling.
   Priority order per the curation strategy: freshers (AutoCAD, STAAD Pro, MS Project, BOQ, rate analysis, IS codes) →
   govt exams (GATE Civil, SSC JE, RRB JE, UPSC ESE, state AE/JE) → site engineers (Primavera P6, construction
   management, quantity surveying, contracts/FIDIC, safety) → structural (ETABS, SAP2000, STAAD.Pro, RCC, steel,
   foundation, seismic) → Gulf/international (Civil 3D, BIM, MicroStation, PMP).
8. **Affiliate links are manual** — paste them into a course's `affiliate_url` in the admin editor.

**Not tested**

9. Non-Chromium browsers and real mobile devices; tablet/mobile visual QA beyond responsive rendering.
10. The signed-in production admin bundle (it is auth-gated; anonymous callers correctly receive only the sign-in shell).

---

## 8. Suggested next work

1. **Seed the catalog** (50 curated courses) and measure clicks — the feature does nothing until it has inventory.
2. **Wire courses into the career flow:** recommend courses on job/career pages from `target_roles` + `career_stage` of
   *published* courses only, so the platform answers "what should I learn next?".
3. **A real draft-discovery pipeline** for providers that permit it (public YouTube playlists, NPTEL listings) writing
   into the same draft queue for review — replacing the dead Udemy integration honestly.
4. **SEO surface for the catalog:** per-category/provider landing pages (`/courses/structural-engineering`) with
   `ItemList`/`Course` structured data, generated from published rows only.
5. **Referral-driven `course_clicks` analytics** on the admin tab (popular categories/roles, CTR) to guide curation.

---

## 9. How to work in this repo

```bash
npm install                 # only dependency: @supabase/supabase-js (dev: none — tests use node:test)
npm test                    # 254 tests, stub fetch, no credentials needed
npm run check:syntax        # parse every JS/JSON file
npm run check:launch        # launch-readiness audit
node scripts/build-admin-bundle.js   # MANDATORY after any admin.html edit
git diff --check            # line-ending/whitespace hygiene
```

**Definition of done for any change:** tests pass for real, `check:launch` clean, admin bundle regenerated if
`admin.html` changed, new endpoint registered in the dispatcher with an `ADMIN_RULES` entry, secrets untouched, and
anything unverifiable reported as blocked rather than assumed.

**To exercise the UI without production credentials** (auth-gated pages, stubbed Supabase), stand up a throwaway local
server *outside the repo* that serves the static site and routes `/api/*` through the real `api/[[...path]].js`
dispatcher with `global.fetch` stubbed as PostgREST/GoTrue, then drive it in a browser. That is how the course catalog,
click tracking, bulk import and the admin Courses tab were verified end-to-end before deploy.

---

## 10. Commit history (most recent first)

| Commit | Summary |
|---|---|
| `f870690` | Also serve the generated sitemap at `/sitemap` |
| `399b3e6` | Serve the generated sitemap at `/sitemap.xml` instead of 404ing |
| `ce6d2a1` | Bound and audit the admin session after the owner credential was exposed in chat |
| `42e3d12` | Add the course aggregator so CivilCareer answers what to learn, not only where to apply |
| `1806921` | Fix the repair patch that failed on every live run |
| `9df0895` | Guard published titles on every pipeline run |
| `1740ec3` | Peel wrapped titles in the repair tool + tests |
| `8e65739` | Treat crawler 403s as transient throttling |
| `8af1e8d` | Regenerate the admin bundle + govt-review UI work |
