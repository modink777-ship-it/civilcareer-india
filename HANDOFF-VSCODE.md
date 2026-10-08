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
| `lib/*.js` | 20 shared modules (`security.js`, `supabase.js`, `rate-limit.js`, `govt-title.js`, `civil-classifier.js`, `course-civil.js`, pipelines) |
| `api/[[...path]].js` | dispatcher: `handlers` map + `ADMIN_RULES` + `CRON_ROUTES` |
| `scripts/*.js` | 12 build/audit/pipeline scripts incl. `validate-course-import.js` (checks a course seed file against the API's real import rules — `npm run check:seed`), `build-admin-bundle.js`, `launch-check.js`, `crawl-govt-pipeline.js`, and two owner-run proofs: `verify-govt-publish.js` (government publish → public → delete) and `smoke-admin-endpoints.js` (which admin tab has real data, and which credential each route wants) |
| `tests/*.test.js` | 45 files, **321 tests**, `node --test` |
| `*.sql` | 37 migrations (`v28`…`v34`, `phase27`…`phase29`) + `run-all-migrations-in-order.sql` |
| `.github/workflows/*.yml` | 7 workflows (scrapers, govt pipeline, morning brief, social drain, gitleaks, smoke) |
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

#### 5.1b Directory scope — Udemy + Coursera, Civil Engineering only (2026-10-08)

`/courses` stopped being a general learning catalogue. It is now a **Civil-Engineering-only discovery directory
for Udemy and Coursera**, with **no affiliate/commission requirement**. Same tables, same endpoints, narrower rules:

- **`lib/course-civil.js`** — the single source of scope: `SUPPORTED_PROVIDERS`, `COURSE_SPECIALIZATIONS`
  (29 labels), `classifyCourse()` and the two notice strings. It is built **on top of** `lib/civil-classifier.js`
  (the government-pipeline engine) instead of beside it, so "civil engineering" means one thing product-wide. The
  course-only vocabulary (AutoCAD & Civil 3D, STAAD.Pro, ETABS, Revit/BIM, Primavera P6, quantity surveying,
  estimation, RCC/steel design, foundations, soil mechanics, highway/traffic, water/hydraulics, environmental,
  surveying, concrete technology, building materials, construction technology, GATE / SSC JE / RRB JE / state AE-JE)
  lives here; nothing in the govt classifier was modified. Other branches (mechanical/electrical/…) and generic
  courses (programming, AI, marketing, finance, Excel, graphic design, generic AutoCAD, generic PMP) are excluded,
  and an unrecognised course is excluded too — a wrong listing is worse than a missing one.
- **`v34-courses-civil.sql`** (additive, **not yet applied — run it**): `description`, `specialization`,
  `civil_verified`; `price_inr` drops NOT NULL/DEFAULT so **0 = free, NULL = the provider did not say** (v32 could
  not tell "free" from "unknown", and the old default would have shown FREE for a price nobody supplied).
  RLS is untouched: `courses_published_read` stays the only policy, so the new columns are publicly readable
  only on published rows.
- **Provider verdict, re-verified live today rather than assumed:** Udemy still states *"Access to the Affiliate API
  on Udemy has been discontinued since 1/1/2025"*, and `api.coursera.org/robots.txt` still carries
  `Disallow: /api/` — Coursera's legacy catalogue endpoint answers, but calling it would violate robots and its
  terms, so CivilCareer does not. Nothing is scraped, guessed or fabricated. `POST ?action=run` returns the
  spec's exact sentence: *"Automatic provider API access not configured; manual/bulk Civil Engineering course
  import remains available."*
- **The pipeline exists; only the provider fetch is missing.** `stageDiscovery(providerId, items)` normalizes →
  applies the Civil Engineering filter → deduplicates (provider+external_id, then normalized URL) → stores with
  `is_published:false` for review. Tests drive it with a sample feed; a future authorized adapter just calls it.
- **Scope gate on every entry:** bulk import and discovery reject a row whose platform is not Udemy/Coursera, or
  whose text does not classify as Civil Engineering, reporting the reason per row. An import can never
  self-verify (`civil_verified` stays false), so nothing discovered is ever auto-published.
- **Publish gate in `_api/courses.js`:** `is_published:true` is refused (409 + the classifier's reason) unless the
  course classifies as Civil Engineering or the admin explicitly sets `civil_verified`. The admin UI offers that
  override from the server's refusal message — the browser never re-implements the classifier.
- **Public page:** heading *"Civil Engineering Courses"*, subtitle *"Discover Civil Engineering courses from Udemy
  and Coursera"*, filters **Provider (All/Udemy/Coursera) · Civil Engineering specialization · Category · Career
  stage · Free/Paid · Search**, cards carrying thumbnail / provider / title / instructor / rating / duration /
  price / short description and **View Course →** to the provider, plus the required notice: *"Courses are provided
  by third-party platforms. CivilCareer does not sell these courses. Verify course details and pricing on the
  provider's website."* The affiliate sentence (and `rel="noopener sponsored"`) appears **only** when a rendered
  card actually carries an `affiliate_url`; a plain provider link is never labelled one. A price the provider did
  not publish renders as *"Price not provided"*, never as FREE.
- **Admin tab:** scope statement, the API's exact provider-access notice, a stats row including **No civil match**,
  per-row classification badges (*Needs classification*, *Civil verified*, the specialization), and editor fields for
  specialization, description, course URL and category. Discovered/imported rows land in **Pending review**.

### 5.1c Per-specialization landing pages + a verified 71-course seed (2026-10-08, commits `aac75d6` + this one)

- **SEO landing pages — commit `aac75d6`.** `/courses/<slug>` serves one server-rendered page per Civil
  Engineering specialization (slug helpers in `lib/course-civil.js`, handler in `_api/courses-page.js`), following
  the repo's existing programmatic-SEO pattern. Built from **published rows only**, with `Course`/`ItemList`
  JSON-LD carrying only provider-published fields; an empty specialization is served honestly and `noindex`ed and
  is kept out of the sitemap; unknown slugs 302 to the directory. `vercel.json` rewrites `/courses/:slug` before
  the `/:seoSlug` catch-all. 15 tests in `tests/course-pages.test.js`.
- **Seed catalogue — `config/courses-seed.json` (this commit).** 71 real Udemy/Coursera Civil Engineering courses.
  Every URL was fetched on 2026-10-08 and confirmed live: Coursera directly (`coursera.org/learn` is allowed by
  its robots.txt), Udemy through the skill's r.jina.ai reader, and two URLs whose first fetch served a soft
  redirect were re-verified through Exa. Titles, descriptions, ratings, enrolment and instructors are the
  providers' own figures read that day; **no prices were read**, so price stays NULL and cards say "Price not
  provided". 60 rows deliberately carry no specialization — the import runs `classifyCourse()` live — while 11
  rows the classifier refused (L&T steel/bridge/ground courses, an HSE course) carry a specialization assigned
  after reading the provider page, the same override an admin has. The file's `_meta` records method, exclusions
  and counts.
- **Validator — `scripts/validate-course-import.js` (`npm run check:seed`).** Runs a seed file through the API's
  own `importItem()` + `directoryScope()` (no database, no network), plus URL-host/provider matching and in-file
  duplicate detection, and refuses rows with the API's exact reasons. It also warns about honesty overrides
  (`is_published`, `civil_verified`, unknown fields) instead of letting them pass silently. Exit 0/1, 4 tests in
  `tests/course-seed.test.js`; the committed seed validates **71/71 clean**.
- **Mobile fix found while driving the page:** `styles.css` pins every `<nav>` at ≤1050px for the site menu, which
  floated `/courses`' related-links box over the filters and would have mangled the pager once the catalogue grew
  past 24 rows. Both are now `div role="navigation"` (the same fix the landing pages use), and a new
  `.co-pager[hidden]` rule makes the pager genuinely hide on single-page results.

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
| Branch / HEAD | `main`, equal to `origin/main`, working tree clean except the intentionally-uncommitted `.env.example` |
| Tests | **321 / 321 pass, 0 fail, exit 0** (`npm test`) |
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

1. **Run `v33-admin-audit.sql` and `v34-courses-civil.sql`** in the Supabase SQL editor. Until v33 is applied the
   audit trail silently records nothing (auth still works — the writer returns `false` rather than throwing). Until
   v34 is applied `/courses` keeps working: the public list falls back to the v32 columns, sets
   `columnsMissing:true` and names the migration, so descriptions and the specialization filter are the only
   missing pieces.
2. **Rotate the admin password** that was shared in chat, then press **"Sign out everywhere"** in `/admin`.
   The TTL + revoke code is deployed, but the exposed credential itself cannot be invalidated from here.
3. **RLS behaviour** on `courses`/`course_clicks` is unverified against the real database (no SQL access from the
   agent environment). The migrations are written to be service-role-write-only (v34 adds three columns and no
   policy, so the new fields inherit `courses_published_read`), but confirm it in the Supabase dashboard.
4. **`course_clicks` has never recorded a row in production** — there are no published courses yet, so the insert path
   is only proven locally.
5. **Re-submit `/sitemap.xml` in Google Search Console** (148 → 796 URLs).

**Product reality**

6. **No automated course discovery exists — verified again today, not assumed.** Udemy's Affiliate API was
   **discontinued 2025-01-01** (Udemy's own page still says so) and `api.coursera.org/robots.txt` **disallows
   `/api/`**, so Coursera's legacy catalogue endpoint is not called either. `/api/course-discovery?action=run`
   answers with the exact sentence: *"Automatic provider API access not configured; manual/bulk Civil Engineering
   course import remains available."* The working path is **Bulk import** (paste JSON → drafts → review → publish) or
   per-course entry. The staging pipeline behind a future adapter already exists and is tested.
7. **The catalog is still empty in production — a verified seed is ready to import.** `config/courses-seed.json`
   holds 71 real, URL-verified Udemy/Coursera Civil Engineering courses (method, field provenance and the two
   reviewed-and-excluded courses are in the file's `_meta`). To load it: run `v34-courses-civil.sql` in Supabase
   **first** (the seed uses the v34 `description`/`specialization` columns — the import refuses rather than
   half-writes without them), then `npm run check:seed` (must print `Result: OK`), then paste the file into
   admin → Courses → Bulk import. Every row lands as a **draft** for your review; nothing is public until you
   publish it. Measure views/clicks/CTR before adding more.
8. **Affiliate links are optional and currently unused** — `affiliate_url` may stay NULL on every row; the
   directory needs no affiliate revenue. When one is set, only that link is marked sponsored (`rel="noopener
   sponsored"` + the conditional notice); a plain provider URL never is.

**Not tested**

9. Non-Chromium browsers and real mobile devices; tablet/mobile visual QA beyond responsive rendering.
10. The signed-in production admin bundle (it is auth-gated; anonymous callers correctly receive only the sign-in shell).

---

## 8. Suggested next work

1. **Import the seed and measure.** `config/courses-seed.json` (71 URL-verified courses) → `npm run check:seed`
   → admin → Courses → Bulk import → review each draft → publish, then read views/clicks/CTR to guide curation.
2. **Wire courses into the career flow:** recommend courses on job/career pages from `target_roles` + `career_stage` of
   *published* courses only, so the platform answers "what should I learn next?".
3. **When a provider grants authorized access, wire its adapter to `stageDiscovery()`** — the
   normalize → civil filter → dedupe → pending-review chain already exists and is tested, so only the fetch is
   missing. Do not scrape: Udemy's terms and Coursera's `robots.txt` both forbid it.
4. ~~SEO surface for the catalog~~ — **done in `aac75d6`**: `/courses/<slug>` per-specialization landing pages
   with `ItemList`/`Course` structured data from published rows only (see 5.1c).
5. **Referral-driven `course_clicks` analytics** on the admin tab (popular categories/roles, CTR) to guide curation.

---

## 9. How to work in this repo

```bash
npm install                 # only dependency: @supabase/supabase-js (dev: none — tests use node:test)
npm test                    # 321 tests, stub fetch, no credentials needed
npm run check:syntax        # parse every JS/JSON file
npm run check:launch        # launch-readiness audit
npm run check:seed          # validate config/courses-seed.json against the real import rules
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
| `aac75d6` | Give every Civil Engineering specialization an indexable landing page |
| `a63e114` | Scope the course directory to Civil Engineering, and say plainly that no provider API is configured |
| `f870690` | Also serve the generated sitemap at `/sitemap` |
| `399b3e6` | Serve the generated sitemap at `/sitemap.xml` instead of 404ing |
| `ce6d2a1` | Bound and audit the admin session after the owner credential was exposed in chat |
| `42e3d12` | Add the course aggregator so CivilCareer answers what to learn, not only where to apply |
| `1806921` | Fix the repair patch that failed on every live run |
| `9df0895` | Guard published titles on every pipeline run |
| `1740ec3` | Peel wrapped titles in the repair tool + tests |
| `8e65739` | Treat crawler 403s as transient throttling |
| `8af1e8d` | Regenerate the admin bundle + govt-review UI work |
