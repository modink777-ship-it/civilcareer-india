# Changelog

All notable changes to CivilCareer India. The project uses a single production package with no
build step; version tags in `index.html` (`?v=…`) and the service-worker cache name are bumped
on every change so returning visitors always receive the newest HTML/CSS/JS.

---

## 2026-09-26 (Phase 1–10 production implementation) — `?v=20260926-100` · SW `civilcareer-v19-phase10-20260926`

Merged the Phase 10 final-launch package into the existing production codebase. Phase 10 was
used as the primary source; earlier phases only as reference; every change was classified
first (adopt / already-exists / superseded) and production's newer fixes were preserved.

### Added (new feature layers)
- **Candidate accounts (Phase 5):** `api/account.js` (Supabase magic-link sessions verified
  server-side; profile, saved jobs, viewed events, application tracking, explainable For You
  recommendations), `api/auth-config.js`, `account.js` (self-injecting UI, guest-first,
  merges guest saved jobs), `supabase-v11-account-layer.sql` (additive + RLS).
- **Alerts & retention (Phase 7):** `api/alerts.js` — per-candidate alert preferences, admin
  evaluation endpoint that **queues** deliveries without claiming to send email,
  `supabase-v12-alerts-retention.sql`. The owner-key env var was corrected to `OWNER_KEY`.
- **Employer trust (Phase 8):** `api/employers.js` (owner-managed profiles; public endpoint
  serves Verified profiles only; verification associates matching jobs), admin verification
  section, `supabase-v13-employer-trust.sql`.
- **Health & hardening (Phase 9):** `api/health.js` (non-secret readiness), `lib/security.js`
  (constant-time owner-key compare, failure limiting, same-origin enforcement),
  `scripts/launch-check.js`, `.env.example`, the full `tests/` suite, npm scripts.

### Jobs API (server-side, bounded, projected)
- Public listing is now **paginated** (default 40, max 100) with `meta{page,total,pages,
  has_next}`; filters/search/expiry run **server-side** (sector, state, city, role, company,
  qualification, work type, posted-days, min monthly salary, gov scope, sort).
- **Public field projection:** only allow-listed fields are exposed; internal review, quality,
  ingestion and duplicate metadata never reach candidates; private application emails are
  withheld when flagged private.
- **`GET /api/jobs?summary=1`** returns real active Private/Government counts (count queries,
  60s public cache) — homepage stats use it with a safe fallback; no invented numbers.
- **Expiry:** public list/single queries exclude `expires_at` in the past (NULL retained for
  legacy rows, still checked by `isExpired`); salary schema only emitted with a known unit,
  LPA converted to annual rupees, ambiguous units omitted.
- **Discovery hardening:** SSRF-safe URL validation (localhost/private ranges/protocols
  blocked), quality flags (missing company/location/application URL, short description,
  trusted-source-location-missing) stored via `supabase-v14-data-quality.sql`.
- Duplicate check is now targeted server-side lookups instead of a 1,000-row scan.
- **Preserved from production:** CRON_SECRET/owner cron auth, AI failover enrichment,
  company-careers track, review-first POST defaults, separate rotating RSS parser.
- Same-origin enforcement + Server-Timing on the jobs API; public responses get bounded
  s-maxage caching, admin responses `private, no-store`.

### Front end
- Private + Government explorers now fetch **server-side paginated** data with Previous/Next
  pagers; `window.__ccPrivateJobs` / `window.__ccGovernmentJobs` are separate caches so the
  two explorers can never overwrite each other's selected-job data; detail lookup falls back
  across page caches, search results and the first page. Production's honest loading/empty/
  failed states, filter chips, drawer mirrors and salary filter all kept.
- **Search is server-side** for jobs (60-result bounded) plus client exam/resource matching.
- PDF.js and Tesseract are **lazy-loaded** only when a PDF import/OCR actually needs them.
- Universal search, homepage, For You and the admin jobs list all handle pagination metadata;
  admin gains a jobs filter toolbar and pagers.
- Service worker: duplicate `fetch` listener removed (one navigate-handling path), cache
  bumped to `civilcareer-v19-phase10-20260926`.
- Admin (standalone + SPA): employer verification UI; job lists paginated; discovery result
  score label reads "Relevance", never a match percentage.
- `Employer verified` badge on cards (explicit wording; no overstatement).
- English-only and India-only preserved; no match percentages anywhere.

## 2026-09-26 (Agent Reach integration)

### Added
- **`api/agent-reach-ingest.js`** — authenticated ingestion endpoint for the external **Agent
  Reach** tool (`Authorization: Bearer <AGENT_REACH_INGEST_KEY>`). Accepts a single item or an
  `items` batch of `job` and `resource`/`video`/`note` records; validates payloads with
  per-item errors; maps jobs onto the existing `jobs` schema and resources onto `materials`.
  **Everything lands as `published:false` / `review_state:'Pending Review'` — a `published:true`
  in the payload is ignored by design.** Duplicate detection matches on external id and
  source URL: pending records are updated in place, published/rejected records are never
  touched, so re-running a sync is always safe. `GET …?status=1` is a key probe.
- **Admin → Agent Reach inbox** (`admin.html`) — pending/published/rejected counts, per-item
  type badge, source, ingestion date and link; *Review* detail modal shows every extracted
  field; *Edit* reuses the existing job/material editors (an inbox edit saves without
  publishing); *Publish* and *Reject* (mark, or delete permanently) are explicit actions.
  Materials now also expose Publish/Unpublish in the admin list.
- **`scripts/agent-reach-sync.ps1`** — example sync script (env-var keys, repeatable).
- **`supabase-agent-reach.sql`** — additive migration: ingestion metadata + review columns on
  `jobs` and `materials`, backfills, and dedupe/queue indexes. Safe to run repeatedly.

### Changed (review-first safety)
- **`api/jobs.js`** — generic job creation no longer defaults to `published:true`; new jobs
  enter as `published:false` / `Pending Review`. Explicit admin publishing (the editor's
  "Save & Publish" or a Publish PATCH) still works exactly as before.
- **`api/materials.js`** — creating a material no longer hard-sets `published:true`; new
  materials start unpublished/pending. Existing published materials are untouched.

### Docs
- README gained an **Agent Reach Integration** section (setup, request/response examples,
  migration steps, admin workflow, security notes) plus the new API and env-var entries.

## 2026-09-25 (discovery build) — `?v=20260925-300` · SW `civilcareer-v18-discovery-20260925`

### Added
- **Company career-page discovery (`lib/company-careers.js`).** A curated list of **35 top Indian
  construction, EPC, infrastructure, real-estate and public-sector employers**. For each company
  in the run's rotating slice the reader:
  1. fetches the company's own homepage and **discovers** its real careers URL from its
     "Careers / Jobs / Join us / Work with us" links — subdomains (`careers.acme.com`) and ATS
     portals are followed, job aggregators and social networks are not;
  2. reads those pages for vacancies, preferring **schema.org `JobPosting` JSON-LD** (the
     structured block Google for Jobs requires, emitted by most ATS platforms) over job-detail
     anchors, and dropping postings whose `validThrough` has already passed;
  3. reports, per company, exactly what happened.
  A company careers page is a *trusted India* source, so a posting that omits a location is
  accepted while one that explicitly names Dubai/London/etc. is still rejected.
- **Free-AI failover chain for discovery enrichment (`lib/ai-models.js`).** Up to 12 drafts per run
  are enriched through eleven free tiers (Groq → Gemini → Cerebras → OpenRouter → Mistral →
  GitHub Models → Together → Hugging Face → DeepSeek → Cloudflare → Cohere), so extraction keeps
  working when one free limit runs out. It **only ever fills blanks** — it never overwrites what
  the source or the pipeline established, never invents a salary/city/company, never decides
  admission, and never fails the run. Several keys per provider are supported in one variable.
- **`GET /api/extract?status=1&key=<OWNER_KEY>`** — reports which free AI tiers are configured and
  which are on cooldown. Surfaced in the admin Health check as **AI providers**.
- **Per-company discovery reporting** in Source Status, and a richer GitHub Actions log/summary.

### Changed
- **Discovery now runs every 4 hours.** `.github/workflows/job-scraper.yml` moved from a daily
  cron to `0 */4 * * *` and now triggers the deployed endpoint, so the pipeline has exactly one
  implementation (`api/jobs.js`) instead of a second one in CI. Vercel's cron stays as a
  once-a-day safety net because Vercel restricts sub-daily schedules to paid plans.
- **`scripts/scrape-jobs.js` was rewritten.** It no longer scrapes: it authenticates and triggers
  `GET /api/jobs?discovery=cron`, then reports and notifies. The old Gulf (Dubai/Abu Dhabi/Qatar)
  and Karnataka-only Indeed feeds are gone — the server-side gates are India-only and civil-only.
- **Discovery tracks now start concurrently.** The news/feed track, the company careers track and
  the configured-provider track are started together and awaited afterwards, so a run costs the
  slowest track instead of the sum of all three.
- **One RSS/Atom parser for the project.** `lib/discovery-core.js` now exports `parseRssItems`
  (CDATA, entities, Atom `<link href>`); `api/jobs.js` delegates to it.
- `pipelineValidateItem` now carries through `sourceLabel`, `salary` and `employment_type` so a
  structured `JobPosting` keeps its real salary, contract type and a human source name.
- Admin Discovery copy (both `index.html` and `admin.html`) now describes automatic 4-hourly
  discovery instead of a manual web search plus a daily scraper.

### Fixed
- **Scheduled-discovery authorisation hole.** `GET /api/jobs?discovery=cron` was guarded only by
  the `vercel-cron/1.0` **user-agent**, which anyone can spoof — a stranger could have triggered
  discovery runs and burned the configured API quotas. It now requires the `CRON_SECRET` bearer
  token that Vercel Cron sends (or the owner key, which also lets the GitHub Action trigger the
  same pipeline). The old check survives only while `CRON_SECRET` is unset, so existing
  deployments do not break.
- **Stale health check.** `next-phase.js` probed `/api/discovery`, an endpoint that does not
  exist, so that row always failed. Replaced with the AI-provider status check.

### Verified
- 104 assertions pass in a new smoke test covering JSON-LD `@graph` extraction, expired/malformed
  posting rejection, job-link filtering (nav chrome, non-civil vocabulary, off-host links,
  mailto), homepage careers-URL discovery (subdomain found, aggregators skipped, ranking),
  rotation coverage of every company, and the end-to-end gates (India civil accepted;
  Gulf, UK, non-civil, older-than-30-days and no-URL records rejected).
- A live run over the first batch reached most career pages but read **zero** vacancies from
  them, because those pages render their vacancy lists in JavaScript (`L&T` announces
  "1378 Jobs Open Now" from client-side code). This is documented in the module header rather
  than hidden; the track works today for career pages that emit server-side JSON-LD and reports
  per company when a page carried nothing readable.

---

## 2026-09-25 — `?v=20260925-100` · SW `civilcareer-v17-explorer-20260925`

### Added
- **Viewed-jobs status.** Clicking/opening a job records `{ jobId, viewedAt }` in
  `localStorage` (`cc_viewed`) and shows a subtle `✓ Viewed · Today` / `· Yesterday` /
  `· N days ago` badge on the card. Never set by mere list appearance or by the default
  panel selection. No login required; the store is capped at 400 entries.
- **Honest statistics states.** `Loading…` → real count → **`Unable to load`**, with a retry
  hint. A genuinely empty database still shows `0`.
- **Honest private-jobs empty states.** "No private jobs are currently available" (loaded,
  empty) is now distinct from "Unable to load private jobs" (request failed, with a **Retry**
  button).
- **Government-only fields in the admin job form:** Recruitment Authority, Vacancies,
  Application Start Date, Application End Date, Age Limit, Application Fee, Last Verified and
  Online Apply URL — shown for Government/Public Sector, hidden for Private.
- **`salaryMonthly()`** normaliser so the salary filter tolerates monthly and annual figures.

### Changed
- **Jobs page is a true two-pane workspace.** 432 px scrollable job list + large sticky,
  independently scrollable detail panel; sticky filter bar; **all cards in the list share one
  size** with actions pinned to the bottom and titles line-clamped to two lines.
- Match explanations are now qualitative ("WHY THIS JOB FITS", `✓` / `△`, skill gap) and the
  panel heading no longer says "WHY YOU MATCH".
- Career Paths is a short article instead of the Career Map; all 14 civil roles remain as live
  links and still drive For You, matching, filters and search.
- India-wide copy in government counters, empty states, the search meta description and the
  PWA manifest shortcuts (no more "Karnataka"-only wording).
- Salary filter now compares like-for-like; jobs with no salary data are never removed by it.

### Removed
- **The public site is English-only.** The `KN` language selector, the Kannada dictionary, the
  `cc_lang` preference and every `lang === 'kn'` / `kn-IN` branch are gone. The admin "Kannada
  title" / "Kannada eligibility" inputs were removed too.
- **Career Map** presentation from the homepage and the Career Paths page, including the
  "Explore the full map →" link and its CSS.
- **"HOW TO CHOOSE"** section and its four explanatory articles.
- **All job match percentages** — private cards, government cards, the selected-job panel,
  For You cards, the Career Hub match list and the `.cc-match` card badge. Matching still ranks
  internally; nothing numeric is displayed.
- **Stray hero caption text.** `visual-backgrounds.js` was appending a rotating
  `.cc-bg-label` ("INDUSTRIAL / EPC", …) inside the hero; the caption layer and its data were
  removed at origin.
- **Obsolete category-based private renderer** in `app.js` (`ROLE_HEADS` tiles +
  `activePrivateCategory`); the Civil Job Explorer in `v8.js` is now the single private
  renderer.
- **Ten dead stylesheets** (`premium-theme`, `premium-experience`, `premium-cleanup`,
  `portal-v16`, `styles-patch`, `styles-next-phase`, `styles-accenture-enterprise`,
  `ui-ux-phase4`, `mobile`, `css-fixes`), **four dead scripts** (`premium-experience.js`,
  `portal-v16.js`, `pwa-install.js`, `sw.js`), the duplicate `manifest.webmanifest`, the
  duplicate root icon set, an old committed ZIP, the stray root `workflows` file, the dead
  Jekyll CI workflow, and ~40 historical phase/fix markdown notes.
- Unused `MAPS` / `MAP_SKILLS` Career Map data in `cc-intelligence.js` and the stale
  `/css-fixes.css` link in `api/jobs.js`.

### Fixed
- `syncPrivateSalary()` `ReferenceError` (undefined `$sel`) that broke the salary dropdown and
  the ₹30K+ quick chip.
- Salary filter unit mismatch that hid **every** job with salary data.
- Quick-filter chips that could not be toggled off, and "Freshers" writing to the wrong control.
- `syncV8SectorFields()` used `$()` (an `getElementById` helper) with a CSS selector, so
  government-only fields were never actually hidden.
- Private jobs with `PRIVATE` / `Private Sector` / `private-sector` / `MNC` / missing sector
  values are no longer excluded by classification.
- Jobs with a missing optional location field are no longer dropped by State/City scope.
- Statistics no longer degrade to `0` when the API has simply failed.
- `sw.js` duplicate service worker removed; `/styles-patch.css` dropped from the precache list.

### Verified
- `node --check` on all JS. Zero references to removed assets. No console exceptions in the
  browser; the only network errors are `/api/*` 404s, expected without the serverless backend.
- Private-jobs pipeline, all quick filters, the Role dropdown, empty vs failed states, viewed
  status, card sizing (418×250 at 1440×900), sticky filter bar, independent panel scrolling,
  the admin government-field toggle, the Career Paths page and global search.

---

## 2026-09-24 — `?v=20260924-200` · SW `civilcareer-v16-homeclean-20260924`

- Homepage: removed the "I'M LOOKING FOR" intent chip bar, the "Fast, focused, civil-only"
  highlights row, the "Closing soon" + "Government exams" split section and the "Where Civil
  Careers Grow" grid.
- Moved "Simple and safe — How CivilCareer works" directly below the Government Civil Jobs
  section.
- `renderHome()` null-guards the removed `#closingSoon` / `#homeExams` targets.
- Section counters renumbered.

## 2026-09-24 — `?v=20260924-100` (premium pass)

- Compact job card + Civil Job Explorer (left list / right detail panel) with quick filters,
  salary filter, mirrors, sort and a why-match facet box.
- Shared normalisation helpers (sector, location, matching) so records with unexpected values
  never disappear.
- Single premium visual layer in `styles.css`; global search overlay; safety message moved
  inline with Live Statistics.

## Earlier

- National SEO landing routes, discovery engine and draft review queue, exam-PDF importer,
  AI job importer, daily scraper workflow, career guides / tools / exam guides / job alerts
  pages, migration to a single India-wide audience. Historical phase notes are summarised here
  and were removed from the production package.
