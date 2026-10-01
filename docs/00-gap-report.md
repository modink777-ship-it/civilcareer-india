# CivilCareer — Phase 0 Gap Report

Date: 2026-10-02. Engineer: lead (autonomous execution, P0→P13).
Live: https://civilcareer-india-two.vercel.app · Repo: `modink777-ship-it/civilcareer-india`
Branch at report time: `social-engine` (local) @ `5e61627`.

---

## 1. P0 mandatory gate — v27 file check: **PASSED**

The repo's committed v27 SQL was stale (old schema: `approved_text_hash`, no
`is_test`/`last_attempt_at`/`media_url`/`approved_content_hash`/`caps_timezone`,
UTC-day caps, table-level unique). The owner supplied the FINAL versions that are
**already applied in their Supabase**. Action taken this session: the two attached
finals were copied over the repo copies so the repo matches the applied state.

Verification (repo copies, `supabase-v27-social-engine.sql`):

| Required field | Count present |
|---|---|
| `is_test` | 3 |
| `last_attempt_at` | 3 |
| `media_url` | 2 |
| `approved_content_hash` | 3 |
| `caps_timezone` | 2 |

`diff` against the attached finals: **byte-identical** (both SQL and rollback).
The rollback drops all 10 named indexes explicitly (required for a clean re-apply).

**These two files are FINAL and are never edited again.** New migrations start at
**v28** and must use `pg_tables.rowsecurity` (the final v27's own verify section
uses `information_schema.tables.row_security` — that is the owner's applied file
and is left untouched; new code must not copy that mistake).

No early stop was required. Proceeding to P1.

## 2. Baseline test run (before any change)

`npm test` = `node --test tests/*.test.js` (19 files, `node:test`, zero deps).

Result: **35 tests, 32 pass, 3 fail** — all 3 are **pre-existing** failures, not
caused by this work. Root causes (all are P8 deliverables or P1 cleanup):

| Failing file | Root cause | Fixed in |
|---|---|---|
| `tests/phase13-production-integrity.test.js` | (a) stray `api/govt-discovery.js` still exists (test line 9 asserts it is gone); (b) `.github/workflows/govt-pipeline.yml` missing (test reads it) | P1 removes (a); P8 adds (b) |
| `tests/govt-pipeline.test.js` | ENOENT `.github/workflows/govt-pipeline.yml` (line 64) — the 6h pipeline workflow does not exist yet | P8 |
| `tests/govt-crawler-hardening.test.js` | ENOENT `.github/workflows/govt-pipeline.yml` (line 8) — same | P8 |

Note: the civil classifier itself PASSES inside `govt-pipeline.test.js`
("Government civil classifier tests: PASS") — only the workflow-file assertion
fails. These 3 failures are the baseline; they are not regressions.

## 3. Branch topology and the `social-engine` name collision

Local branches: `main`, `social-engine` (current, has the v27 commit `5e61627`),
`deploy-exam-tracker`, `backup/account-sdk-fix`, `local-main-backup-2026-10-01`.
Remotes: `origin/main`, `origin/overhaul-2026-09`, `origin/staging`,
`origin/p1/schema-backup-and-scale-plan`, `origin/v0/bold-redesign`,
`origin/vercel/install-vercel-speed-insights-qjpi4a`.

**Collision:** the mission's P2 branch name `social-engine` already exists locally
(it holds the v27 schema commit). Rules: never delete branches, stack in order.

**Resolution (documented per mission):** keep the existing `social-engine` branch
as the P2 branch and build the mission's work on top of it by fast-forwarding:

- P0 `audit` ← branched from current `social-engine` HEAD (carries the v27 sync
  + this report).
- P1 `security-hardening` ← branched from `audit`.
- P2 `social-engine` ← `git merge --ff-only security-hardening` onto the existing
  `social-engine` (valid because `security-hardening` descends from it), then P2
  commits are added on `social-engine`. The name is reused, nothing is deleted,
  and stacking is preserved: P2 contains P0+P1+P2 work.
- P3+ branch names (`social-engine-2` … `docs-final`) are free and stack normally.

Owner merges into `main` in order; because each branch contains its predecessors,
the ordered merge is conflict-free.

## 4. Gap table — Block A (P1, security)

`Exists?`: yes / partial / no. Evidence is `file:line`.

| Item | Exists? | Evidence | Risk | Action | Effort |
|---|---|---|---|---|---|
| A1 subscribe uses service key server-side | yes | `_api/subscribe.js:21` `SUPABASE_SERVICE_ROLE_KEY`; anon key never used | none on key exposure | retest e2e; add Turnstile+rate-limit (A4) | S |
| A2 logged-in features vs RLS (profile save, For You, alerts) | partial | `_api/account.js` `userFromToken` verifies bearer vs Supabase Auth, then service_role for all reads/writes; `cleanProfile` sanitizes | RLS policies on `candidate_profiles`/`candidate_saved_jobs`/`candidate_job_applications` must scope `user_id = auth.uid()`; if a policy is mis-scoped, one user could read another's data | verify each policy in Supabase; e2e test save/For-You/alerts; fix policies minimally | M |
| A3 admin UI not in public bundle + protected route | partial | admin dashboard removed from `index.html`; standalone `admin.html` served at `/admin` (`vercel.json` rewrite). Data endpoints gated by `requireAdmin` (`api/[[...path]].js` `requireAdmin`, 503 when `ADMIN_EMAIL`/`ADMIN_USER_ID` unset) | `/admin` serves `admin.html` to **anyone** — the UI bundle (structure, field names, admin surface) is publicly fetchable; only the JSON endpoints are protected | serve `admin.html` through an authenticated function (render-after-`requireAdmin`, like the `jobs?render=html` pattern); gate the `/admin` rewrite on it | M |
| A4 Turnstile + per-IP rate-limit on every public write form | partial | Present (server-side `verifyTurnstile`+`rateLimit`): `contact.js:2,8`, `employer-submissions.js:1`, `reports.js:1`, `resource-submissions.js:1`. **Missing:** `subscribe.js` (neither), `account.js` (neither; authenticated endpoint) | subscribe is an anonymous write — bot flood; profile writes are authenticated but unthrottled | add `rateLimit`+`verifyTurnstile` to `subscribe.js` (anonymous); add `rateLimit` to `account.js` writes (authenticated; Turnstile optional — see conflicts) | S |
| A5 RLS audit script in `docs/` | no | no `docs/*rls*` script exists | no repeatable proof that every public table has RLS on and no anon/authenticated privilege | add `docs/rls-audit.sql` using `pg_tables.rowsecurity` + `has_table_privilege`; owner runs it in Supabase | S |
| A6 git-history secret scan + rotate list + `.gitignore` | partial | `.gitignore` correct (`.env`, `.env.*`, `!.env.example`, `.freebuff/`, `*.zip`, `live-jobs-tmp.json`, `node_modules/`, `dist/`, `.vercel/`); Gitleaks workflow present (`.github/workflows/gitleaks.yml`) | a committed secret in history would remain valid until rotated | run history scan (`git log -p` / gitleaks); list key **names** to rotate (never values); confirm `.gitignore` | S |
| A7 sanitize scraped/user text before display; strict CSP | partial | `account.js` `cleanProfile` slices/type-checks; CSP in `vercel.json` headers | CSP has `script-src 'unsafe-inline'` (weakens XSS defence) and `connect-src … https://api.groq.com` (AI endpoint); HTML-returning `_api` handlers must escape scraped text | escape HTML at render in `_api` handlers that return HTML; tighten CSP only where it does not break existing inline scripts; document | M |
| A8 tests for each item | partial | `tests/phase1-security.test.js`, `tests/phase11-auth-and-explorer.test.js`, `tests/phase12-admin-allowlist.test.js` exist | new P1 items need regression tests | add tests: subscribe Turnstile/rate-limit, admin-page gate, stray-function removal | S |

## 5. Gap table — Block F (P2–P7, Social Content Engine)

Schema (v27) is **applied and final**. The engine **code does not exist yet** —
that is P2–P7. Current direct-send paths that must be re-routed/gated:

| Item | Exists? | Evidence | Risk | Action | Effort |
|---|---|---|---|---|---|
| F0 v27 schema applied | yes | `supabase-v27-social-engine.sql` (see §1) | none | none | — |
| F1 `lib/social-core.js` (Truth Lock, hash, guards) | no | absent | n/a | build (P2) | L |
| F2 `lib/social-templates.js` (per-platform content) | no | absent | n/a | build (P2) | L |
| F3 `lib/social-publishers.js` (Telegram/LinkedIn/Instagram) | no | absent | n/a | build (P2, P5, P6) | L |
| F4 `_api/social.js` + aliases in dispatcher + ADMIN_RULES | no | absent | n/a | build (P2) | M |
| F5 admin "Social" tab | no | `admin.html` has no Social tab | n/a | build (P2) | L |
| F6 exam-tracker re-route into engine | no | `_api/exam-tracker.js:139` `announceOpening()` posts direct Telegram (`:99` `api.telegram.org`) | bypasses Truth Lock/approval/caps | re-route to engine (P2) | M |
| F7 private-jobs hook gated by `LEGACY_TELEGRAM_AUTOPOST` | no | `_api/admin-jobs.js:13` imports `autoPostToTelegram`, `:269` fires it fire-and-forget on publish | unapproved direct posts | gate behind env (default on) (P2); flip off in P3 | S |
| F8 `.env.example` documents every variable | partial | has `LEGACY_TELEGRAM_AUTOPOST`, `TELEGRAM_TEST_CHANNEL_ID`, `ADMIN_EMAIL`/`ADMIN_USER_ID`, `LINKEDIN_*`, `INSTAGRAM_*`; **missing** `CRON_SECRET`, `SOCIAL_CRON_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `LINKEDIN_API_VERSION` | undocumented vars | complete (P2; finish P13) | S |
| F9 Deadline Radar events (P3) | no | absent | n/a | build (P3); migration v28 only if an events table is needed | L |
| F10 `_api/social-cron.js` + `SOCIAL_CRON_SECRET` + GH Action 30–60 min | no | `SOCIAL_CRON_SECRET` appears nowhere; Vercel Hobby crons run ≤1/day so GitHub Actions is required | n/a | build (P3) | M |
| F11 SVG graphics templates + `/api/social-graphics` (P4) | no | absent | n/a | build (P4); name the JPEG lib; document Hobby fit | L |
| F12 LinkedIn publisher (P5) | no | absent; `LINKEDIN_API_VERSION` not in env | n/a | build (P5) | M |
| F13 Instagram publisher (P6) | no | absent | n/a | build (P6) | M |
| F14 Daily Radar preview (P7) | no | absent | n/a | build (P7) | M |

## 6. Gap table — Block B (P8), C (P9), D (P10), E (P11), G (P12), H (P13)

| Item | Exists? | Evidence | Risk | Action | Effort |
|---|---|---|---|---|---|
| B1 govt pipeline tables (`govt_sources`,`govt_job_leads`,`govt_job_staging`,`govt_jobs`,`govt_job_posts`) | yes | `supabase-v19-govt-pipeline.sql`; `_api/govt-discovery.js`, `_api/govt-review.js`, `_api/govt-jobs.js` | stray direct function shadows dispatcher (§7) | reuse; remove stray (P1); add missing fields via v28+ only | M |
| B2 civil classifier `lib/civil-classifier.js` | yes | exists (`classifyPost`/`classifyNotification`, tiers A/B/C/U); classifier tests PASS | must hit zero false-positives on negatives, zero drops on unknowns | verify against mission fixtures (P8) | M |
| B3 6h GitHub Actions crawler | no | `.github/workflows/govt-pipeline.yml` missing (baseline test failure) | no scheduled discovery via the dedicated pipeline | create workflow calling `scripts/crawl-govt-pipeline.js` (P8) | S |
| B4 admin review queue tabs/filters | partial | `admin.html` has govt review UI; verify tabs Pending/Needs info/Approved/Rejected/Duplicates + filters | may be incomplete | complete to spec (P8) | M |
| C1 `/government-jobs` + counters/chips/filters/cards-table | partial | `government-jobs.html` exists; `_api/govt-jobs.js` serves feed | verify counters computed from DB only, deadline states, "N civil posts of M" | complete to spec (P9) | L |
| C2 server-rendered landing `/government-jobs/central`, `/state/<s>`, `/department/<d>`, `/role/<r>` | no | absent (Hobby single-segment rule → aliases + rewrites) | n/a | build with single-segment aliases (P9) | L |
| C3 detail `/government-jobs/<slug>` full spec | partial | detail rendering exists via `/api/jobs?render=html` pattern; govt detail page to spec? | verify all spec sections | complete (P9) | L |
| C4 role guides `/careers/<role>` | partial | `career-guides.html`, `career-paths.html` exist | spec wants per-role pages with CPC-labelled pay | build/extend (P9) | M |
| C5 `/exams` hub + per-exam pages + Results/Admit/Answer Keys | partial | `exams.html`, `_api/exams.js`, `_api/exam-tracker.js` exist | spec wants civil-only hub fed from admin queue | extend (P9) | M |
| D1 per-URL unique title/meta/canonical + unified OG/Twitter | partial | `vercel.json` rewrites to static shells with canonicals (`phase13` test checks some); og-image via `scripts/generate-og-image.js` | `<title>` vs `og:title` mismatch reported by owner | audit + fix every listing/exam/resource page (P10) | M |
| D2 `JobPosting` JSON-LD on ACTIVE jobs only + Organization/BreadcrumbList | partial | verify presence/removal-on-close | invalid JSON-LD if left on closed jobs | implement + remove on close (P10) | M |
| D3 dynamic `sitemap.xml` from DB, updated on publish | yes | `_api/sitemap.js`; `vercel.json` `/sitemap.xml`→`/api/sitemap` | verify it updates on publish and covers new pages | verify/extend (P10) | S |
| D4 performance: code-split, lazy-load, defer, image dims; Lighthouse 85+ | partial | PWA `service-worker.js` present; no route code-splitting (single-page bundles) | baseline mobile Lighthouse 56 | measure baseline, optimize, report before/after (P10) | L |
| E1 `reviewed_at`/reviewer + "Reviewed on" badges + stale sweep | partial | `reviewed_at` exists on some tables; govt feed exposes verification status | not shown on cards/detail; no 30-day sweep | add badges + admin sweep (P11) | M |
| E2 About "How we review" + fix "India and globally" | partial | About section exists in `index.html` | wording says "globally" (site is India-only) | fix wording + add review section (P11) | S |
| E3 standalone Privacy Policy + Terms + Disclaimer (DPDP) | partial | combined `/legal` → `legal.html` only | must split into standalone pages; DPDP alignment | split + add Disclaimer (P11) | M |
| E4 content policy: source link + own-words excerpt, never full copy | partial | classifier + feeds use excerpts | enforce at render | verify/enforce (P11) | S |
| G1 scheduled backups (GH Actions export) + restore runbook | no | no backup workflow | data loss on free-tier pause/accident | create export workflow + runbook (P12) | M |
| G2 monitoring: uptime check + `/api/health` + failure alerts | partial | `_api/health.js` exists; no uptime monitor/alerts | silent failures | add uptime check + alerting (P12) | S |
| G3 daily review routine doc + stale sweep | no | absent | operational drift | write routine doc (P12) | S |
| G4 analytics: UTM + monthly per-platform summary | partial | `_api/analytics.js`, UTM from engine (P2+) | no monthly platform summary view | add summary view (P12) | M |
| G5 credential expiry reminders + revoke/rotate runbook | no | absent | expired LinkedIn/Meta tokens silently break publishing | add expiry tracking + runbook (P12) | S |
| G6 hosting terms: flag Vercel Hobby non-commercial if ads/revenue planned | no | not documented | terms violation if monetized | document + propose free alternative (P12) | S |
| H1 README real architecture/domain; consolidate deploy docs | partial | `README.md`, `DEPLOY.md`, many `docs/*.md` | outdated/duplicated | update + consolidate (P13) | M |
| H2 `.env.example` complete | partial | see F8 | undocumented vars | complete (P13) | S |
| H3 `SOCIAL-ENGINE-README.md`, `SOCIAL-ENGINE-RUNBOOK.md`, `docs/govt-pipeline-runbook.md` | partial | `docs/07-govt-pipeline-runbook.md` exists; social docs absent | operator gaps | write (P13) | M |
| H4 handle open PR + list dead code (no delete without approval) | partial | open PR not inspected this session | unknown | list dead code (P13) | S |

## 7. Conflicts between the prompt and the codebase

1. **`social-engine` branch name collision** — resolved in §3 (fast-forward reuse).
2. **`lib/supabase.js` is dead ESM** — `import { createClient } from '@supabase/supabase-js'`
   in a CommonJS project; referenced by nothing. It would crash if ever loaded.
   Listed for removal in P13 (not deleted without owner approval).
3. **Stray `api/govt-discovery.js` shadows the dispatcher** — on Vercel the
   more-specific file wins, so `/api/govt-discovery` is served by this standalone
   function (1480 lines, `@supabase/supabase-js` + service_role) which does **not**
   enforce the dispatcher's `CRON_SECRET`/`isCron` gate. `_api/govt-discovery.js`
   (the dispatcher target) correctly checks `req.isCron`. PROGRESS.md:231 claims the
   stray was removed — it was not. **P1 removes the stray** (security: unauthenticated
   crawl trigger writing to staging via service_role). This also fixes phase13 test
   assertion #1.
4. **Optional free-tier AI extraction vs "no AI API" hard rule** — the codebase has
   `lib/ai-models.js` + `_api/extract.js` that call Groq/Gemini/OpenRouter/etc.
   This is **key-gated and default-OFF** (no provider works until a key is set) and
   uses free tiers only. The mission's Block B explicitly permits "optional free-tier
   LLM behind an adapter, default OFF" for the classifier. So this existing feature is
   consistent with the mission's carve-out, not a violation. `connect-src` allows
   `https://api.groq.com` for that optional path. Documented, not removed (do not
   rebuild working features).
5. **CSP `script-src 'unsafe-inline'`** — needed by existing inline scripts in the
   HTML pages; removing it would break pages. Flagged; tightened only where safe.
6. **Vercel Hobby cron limit** — Vercel Hobby crons run at most once per day, but the
   mission wants social-cron every 30–60 min. Resolution: social-cron runs on a
   **GitHub Actions** schedule (free), not a Vercel cron (P3). This matches the
   existing pattern (`job-scraper.yml` etc.).
7. **Turnstile on authenticated endpoints** — the mission lists "profile" among forms
   needing Turnstile. Profile/account writes are authenticated by the user's own
   bearer token (not anonymous), so the anonymous-form threat model differs. Decision:
   enforce Turnstile+rate-limit on anonymous writes (subscribe, contact, report,
   resource, employer); enforce per-IP rate-limit (not Turnstile) on authenticated
   account/profile writes. Documented as a deliberate, honest reading.
8. **`LINKEDIN_ORGANIZATION_ID` in `.env.example`** — company-page posting is
   BLOCKED BY PLATFORM REQUIREMENT (needs `w_organization_social` partner approval).
   Keep the var for documentation but the publisher uses the personal-member route;
   `.env.example` also needs `LINKEDIN_API_VERSION` (P5).

## 8. Free-tier limits that matter (with doc pages)

- **Vercel Hobby:** max 100 cron jobs but each runs **at most once per day**;
  non-commercial terms; `maxDuration` up to 300 s with Fluid Compute but this repo
  pins 15 s; a small number of serverless functions. → use GitHub Actions for
  sub-daily schedules; keep the single dispatcher.
  Pages: https://vercel.com/docs/vercel-for-github (plans),
  https://vercel.com/docs/crons (once-per-day Hobby limit),
  https://vercel.com/legal/terms (non-commercial).
- **Supabase Free:** 500 MB DB, 1 GB Storage, 5 GB + 5 GB egress, 50k MAU,
  2 projects/org; project pauses after inactivity (verify current rule).
  → backups via GitHub Actions export (P12). Pages:
  https://supabase.com/docs/guides/resources/usage-limits,
  https://supabase.com/docs/guides/resources/paused-projects.
- **GitHub Free:** 2000 Actions min/month; **scheduled workflows in public repos can
  be auto-disabled after ~60 days of inactivity** (documented in P3). Pages:
  https://docs.github.com/en/actions/learn-github-actions/usage-limits-billing-and-administration,
  https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule.
- **Telegram Bot API:** 4096-char message limit; Markdown parse errors are definite
  (not timeouts). Page: https://core.telegram.org/bots/api#sendmessage.
- **LinkedIn:** versioned Posts API `POST /rest/posts`; member route needs
  `w_member_social`; organization route needs `w_organization_social` (partner
  approval → BLOCKED). Access tokens ~60 days. Pages:
  https://learn.microsoft.com/en-us/linkedin/shared/api-reference/concepts/versioning,
  https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/posts-api.
- **Instagram:** "Instagram API with Instagram Login" (`graph.instagram.com`),
  scopes `instagram_business_basic` + `instagram_business_content_publish`, no
  Facebook Page; JPEG only; 100 posts/24 h moving window; two-step container flow.
  Page: https://developers.facebook.com/docs/instagram-api/guides/content-publishing.
- **Meta/Instagram rate & container timing:** poll container ≤1/min for ≤5 min;
  container expires after 24 h. Same doc page as above.

## 9. Owner-only checklist (never blocks code; code fails safe)

- [ ] Confirm the two FINAL v27 SQL files are the applied versions (already matched
      byte-for-byte this session; no action needed unless Supabase differs).
- [ ] Run `docs/rls-audit.sql` (created in P1) in Supabase; confirm every public
      table has RLS on and no anon/authenticated privilege.
- [ ] Set `ADMIN_EMAIL` (comma list, dot-insensitive) and/or `ADMIN_USER_ID`,
      `CRON_SECRET`, `SOCIAL_CRON_SECRET` (P3), `TURNSTILE_SITE_KEY` +
      `TURNSTILE_SECRET_KEY` (already configured per PROGRESS.md:82 — confirm),
      `OWNER_KEY`, `SITE_URL` in Vercel Production.
- [ ] Preview env: same Supabase/admin vars, `SITE_URL` = preview URL,
      `TELEGRAM_BOT_TOKEN` + `TELEGRAM_TEST_CHANNEL_ID` only (no
      `TELEGRAM_CHANNEL_ID`), `LEGACY_TELEGRAM_AUTOPOST=false`.
- [ ] Create Telegram test channel; set `TELEGRAM_TEST_CHANNEL_ID`.
- [ ] LinkedIn developer app + personal-member token → `LINKEDIN_ACCESS_TOKEN`,
      `LINKEDIN_AUTHOR_URN`, `LINKEDIN_API_VERSION` (P5).
- [ ] Instagram Creator/Business conversion + Meta app → `INSTAGRAM_ACCESS_TOKEN`,
      `INSTAGRAM_BUSINESS_ACCOUNT_ID` (P6).
- [ ] Run SQL migrations v28+ as each phase introduces them (each with its verify
      query using `pg_tables.rowsecurity`).
- [ ] First real test posts (Telegram, then LinkedIn, then Instagram) — one each,
      owner-controlled; only then mark those publishers TESTED.
- [ ] Merge branches into `main` in order after testing previews.

## 10. Dead code / cleanup list (do NOT delete without owner approval)

- `lib/supabase.js` — dead ESM module (see §7.2).
- `api/govt-discovery.js` — stray shadowing function; **will be removed in P1**
  (security), flagged here for the record.
- `docs/govt-discovery-source-integrated-final.js` — a 700-line JS file stored under
  `docs/` (a copy of the `_api` handler); documentation artifact.
- `discovery-v9.js`, `next-phase.js` (already removed per phase13), `CC-intelligence.js`,
  `aceternity-effects.js`, `hero-3d.js`, `visual-backends.js` — verify none are
  referenced before any removal.

---

*Status words used above follow the mission's honest vocabulary. Nothing here is
claimed TESTED unless a test was actually run. Baseline `npm test`: 32/35 pass,
3 pre-existing failures documented in §2.*
