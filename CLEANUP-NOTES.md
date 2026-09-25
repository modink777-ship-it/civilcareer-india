# CivilCareer India — Cleanup, Consolidation & Fix Notes

**Date:** 2026-09-25
**Scope:** safe audit → remove dead files → consolidate duplicate implementations → fix the
private-jobs pipeline, filters, stats, admin form and search → one clean production codebase.
**Site:** https://civilcareer-india-two.vercel.app/
**Build version:** `?v=20260925-100` · service worker `civilcareer-v17-explorer-20260925`

No feature was rebuilt from scratch. Nothing was deleted until every reference to it was
checked across HTML, JS, CSS, JSON, the service worker and `vercel.json`.

---

## 1. Files removed

### Unused stylesheets (verified: no `<link>`, no JS injection, no SW precache)
| File | Why it was removed |
|---|---|
| `premium-theme.css` | Superseded by the single premium layer inside `styles.css`. Referenced by nothing. |
| `premium-experience.css` | Superseded; its only remaining mentions were in the now-deleted `premium-experience.js`. |
| `premium-cleanup.css` | One-off patch file, never linked. |
| `portal-v16.css` | Belonged to the abandoned `portal-v16.js` generation. |
| `styles-patch.css` | Patch layer; only reference was a stale service-worker precache entry. |
| `styles-next-phase.css` | Its useful rules were already merged into `styles.css` (Career Hub block). |
| `styles-accenture-enterprise.css` | Unused brand experiment, never linked. |
| `ui-ux-phase4.css` | Unused phase-4 experiment, never linked. |
| `mobile.css` | Only reference was the obsolete `sw.js`; responsive rules already live in `styles.css`. |
| `css-fixes.css` | Only reference was a stale `<link>` in the server-rendered job page in `api/jobs.js`. |

### Unused / obsolete JavaScript
| File | Why it was removed |
|---|---|
| `sw.js` | A second, competing service worker. `app.js` registers **`/service-worker.js`** only, so `sw.js` was dead — and its cache name was stale. |
| `premium-experience.js` | Never loaded by any page. Also the only file still referencing `mobile.css` / `manifest.webmanifest`. |
| `portal-v16.js` | Abandoned generation, never loaded. |
| `pwa-install.js` | Never loaded; install prompts are handled elsewhere. |

### Duplicate assets, stray artefacts and obsolete documentation
| File(s) | Why they were removed |
|---|---|
| `icon-72/96/128/144/192/512.png` (repo root) | Duplicates — `manifest.json` and every page use `/icons/icon-*.png`. |
| `manifest.webmanifest` | Duplicate manifest; `index.html` links `/manifest.json`. |
| `civilcareer-india-main-FINAL-2026-09-24.zip` | An old ZIP committed inside the project. |
| `workflows` (extension-less root file) | Duplicate copy of the scraper workflow; the real one lives in `.github/workflows/`. |
| `.github/workflows/jekyll-docker.yml` | Dead Jekyll CI config (this is not a Jekyll site). |
| ~40 `PHASE-*.md`, `*-FIX*.md`, `SOFT404-*.md`, `SEO-*.md`, `DISCOVERY-*.md`, `DEPLOY-V8.txt`, `CLAUDE.md`, `ALL-PHASES.md`, `PREMIUM-*.md`, `MOBILE-APP-SETUP.md`, `WEB-DISCOVERY.md`, `SUPABASE-V10-SETUP.md`, `NATIONAL-PORTAL-UPDATE.md`, `PHOTO-SOURCES.md`, `AI-EXTRACTION-FALLBACKS.md`, `RESTORE-DEPLOYMENT-INSTRUCTIONS.txt` … | Historical phase notes. Summarised into `CHANGELOG.md` so the production package stays lean. |

### Dead code removed inside surviving files
| Location | Removed |
|---|---|
| `app.js` | The **old category-tile private renderer** (`ROLE_HEADS`-driven tiles → per-category list), `activePrivateCategory`. Replaced by a documented no-op stub so the first paint before `v8.js` boots cannot throw. The Civil Job Explorer in `v8.js` is now the **single** private-jobs renderer. |
| `app.js` | The **entire Kannada dictionary**, the `cc_lang` preference, the `kn-IN` locale switch and every `lang === 'kn'` branch. `translate()` is kept as a documented English-only no-op. |
| `app.js` / `v8.js` | The admin "Kannada title" and "Kannada eligibility" inputs. |
| `cc-intelligence.js` | The unused `MAPS` / `MAP_SKILLS` Career Map data structures. |
| `visual-backgrounds.js` | The `titleSets` caption data and the injected `.cc-bg-label` hero caption. |
| `styles.css` | `.role-tile*`, `.role-heads-grid`, `.category-back`, `.career-map-grid`, `.cm-*`, `.cm-help-grid`, `.cc-bg-label`, `.cc-match-pct*`, `.match-pct` — all rules for markup that no longer exists. |
| `api/jobs.js` | The stale `<link rel="stylesheet" href="/css-fixes.css">` (the file is gone). |
| `service-worker.js` | The `/styles-patch.css` precache entry. |

---

## 2. Files retained (and why)

`index.html` (app shell + all SPA routes) · `app.js`, `v8.js`, `discovery-v9.js`,
`cc-intelligence.js`, `visual-backgrounds.js`, `hero-3d.js`, `next-phase.js` — all seven are
loaded by `index.html` with `?v=20260925-100` · `styles.css` (the single stylesheet) ·
`service-worker.js` (the only registered worker) · `manifest.json` · `robots.txt` ·
`sitemap.xml` · `admin.html` · `career-guides.html`, `career-tools.html`, `exam-guides.html`,
`job-alerts.html`, `legal.html` (all routed by `vercel.json` and listed in `api/sitemap.js`) ·
`api/*.js` (11 serverless functions: jobs, exams, materials, extract, agent, analytics,
subscribe, telegram, reports, employer/resource submissions, sitemap) ·
`lib/discovery-core.js`, `lib/discovery-sources.js`, `lib/supabase.js` (server-side only) ·
`supabase*.sql` migrations · `scripts/scrape-jobs.js` + `.github/workflows/job-scraper.yml`
(the daily discovery cron) · `vercel.json` · `package.json`, `api/package.json` · `icons/` ·
`README.md`, `DEPLOY.md`, `CHANGELOG.md`, `CLEANUP-NOTES.md`.

---

## 3. Consolidations (one canonical implementation per feature)

| Feature | Canonical implementation | What was reconciled |
|---|---|---|
| Private jobs | `v8.js` `renderPrivate()` — Civil Job Explorer | Old `app.js` category renderer removed. |
| Job card | `discovery-v9.js` `enhancedJobCard` (compact) | `app.js` and `v8.js` card variants remain only as earlier layers that the final assignment overrides; the rendered card is one. |
| Government jobs | `v8.js` `renderGovernment()` | Single path, uses `isGovJob()` / `sectorOf()`. |
| Sector classification | `app.js` `sectorOf()` | `Private`, `private`, `PRIVATE`, `Private Sector`, `private-sector`, `MNC`, `MNC/private`, `company`, empty → **Private**. `gov`/`public sector`/`psu` → Government. |
| Salary comparison | `v8.js` `salaryMonthly()` | New normaliser so the filter tolerates monthly **and** annual figures. |
| Global search | Nav **Search** → `app.js` overlay + `ccSearchResults()` (jobs, exams, resources from every route) | The homepage smart-search form and `/search` page feed the same data. |
| Matching | `app.js` `civilMatch()` (facets) + `matchScore()` | **Not displayed** as a percentage anywhere. |
| Discovery duplicate detection | Server-side (`lib/discovery-core.js` / `api/jobs.js`) | The client no longer invents its own duplicate verdict. |
| Viewed jobs | `app.js` `markViewed` / `isViewed` / `viewedLabel` | New — single implementation. |
| Service worker | `service-worker.js` | `sw.js` deleted. |
| Styles | `styles.css` | All patch layers deleted. |

---

## 4. Bugs fixed

1. **Private jobs did not display reliably** — the compact card is rendered through the
   normalised sector classifier, so records with `PRIVATE`, `Private Sector`, `private-sector`,
   `MNC` or a missing sector field all appear. Records with a missing *optional* location field
   are no longer dropped by the State/City scope.
2. **`syncPrivateSalary()` threw a `ReferenceError`** — it read an undefined `$sel` variable, so
   the salary dropdown **and** the ₹30K+ chip crashed and the salary filter never applied. Now
   reads the correct element.
3. **Salary filter compared incompatible units** — the ₹30K+/month select was multiplied by 12
   and then compared against raw `salary_max`, so it hid **every** job with salary data. The
   filter now compares like-for-like through `salaryMonthly()`, and a job with **no** salary
   information is never removed by the salary filter.
4. **Quick chips could not be toggled off** — "Freshers" wrote into the experience dropdown and
   could never be cleared; several chips ignored their own re-click. Each chip is now an
   independent toggle and activating one clears the previous chip.
5. **Statistics lied about failures** — a failed `/api/jobs` fell through to `0 jobs` and after
   12 s the count degraded to `0`. Now: `Loading…` → real number → **`Unable to load`**. A
   genuinely empty database still shows a real `0`.
6. **Empty state could not distinguish failure from emptiness** — "No private jobs are
   currently available" was shown even when the API had failed. Now the three states are
   distinct, and the failure state offers a **Retry** button.
7. **Admin government-only fields were never actually hidden** — `syncV8SectorFields()` called
   `$('#jobEdit [name="deadline"]')`, and `$` is `getElementById`, so it always returned `null`.
   Rewritten with `querySelectorAll('[data-gov-only]')`; verified hiding/showing on sector
   change.
8. **Match percentages everywhere** — removed from private cards, government cards, the
   selected-job panel, For You cards, the Career Hub match list and the `.cc-match` card badge.
   Matching still ranks internally; the UI shows a qualitative "WHY THIS JOB FITS" facet list
   (`✓` / `△`) and a skill gap, never a number.
9. **Stray text at the bottom edge of the hero** — the actual source was `visual-backgrounds.js`
   appending a rotating `.cc-bg-label` caption ("INDUSTRIAL / EPC", …) inside the hero. The
   caption layer and its data were removed at origin, not hidden with CSS.
10. **Karnataka-only copy on an India-wide site** — government counters, empty states and the
    search meta description no longer say "Karnataka"; `manifest.json` shortcut names updated.

---

## 5. Requested removals

- **Career Map presentation** — removed from the homepage **and** the Career Paths page
  (`cm-col` / `cm-band` / `cm-help-grid` markup, plus the "Explore the full map →" link and
  all its CSS). The Career Paths page is now a short, honest article; **all 14 civil roles stay
  available** as live links and continue to power For You, matching, filters and search.
- **"HOW TO CHOOSE"** — the whole section (and its four explanatory articles) is gone. No empty
  containers or dead anchors remain (`cpEmptyContainers: 0`).
- **Kannada / language selector** — the `KN` button is gone from the header, the dictionary and
  every locale branch are deleted, and only English remains. Because the selector would have
  contained only English, it was removed entirely.
- **Old standalone Safety line** — the safety/verification message lives **once**, horizontally
  alongside Live Statistics in the stats strip (`🛡 Safety · Never pay for a job… · Report a
  scam ↗`).
- **Obsolete service worker** — `sw.js` deleted; `service-worker.js` is the only worker and its
  cache version was bumped so no returning visitor is served stale `app.js`/`styles.css`.
- **International** — never present in the private-job filter (verified), and the
  `INFL_CITIES` list is no longer injected into the city dropdown by any live renderer.

---

## 6. Two-pane Jobs workspace (verified in-browser at 1440×900)

- Left column 432 px of job cards, right column the large selected-job panel.
- **Every card in the list shares one size** (`grid-auto-rows:1fr`; measured 418×250 for all).
- Actions pinned to the card bottom (`margin-top:auto`); titles line-clamped to 2 lines.
- Filter bar **sticky** under the header (`top:74px`).
- Job list **and** detail panel each scroll independently; the detail panel stays sticky.
- Mobile/tablet collapse to a single column with a bottom-sheet detail panel; no horizontal
  overflow.
- Selecting a card updates the right panel in place (no navigation, no modal) and marks the job
  **viewed**.

## 7. Viewed status

- Recorded **only** on an explicit card click / detail open — never because a job merely
  appeared in a list, and never because it was the default selection.
- Persisted as `{ jobId: viewedAt }` in `localStorage` (`cc_viewed`) — only those two fields,
  never the job object. Guests need no login; the store is capped at 400 entries.
- Shown subtly on the card as `✓ Viewed · Today` / `· Yesterday` / `· N days ago`.
- Survives filters, search, All India / State-wise / City-wise and returning to the Jobs page.

## 8. Admin job form (`v8.js`)

- **Private job:** Recruitment Authority, Vacancies, Application Start Date, Application End
  Date, Age Limit, Application Fee, Last Verified and Online Apply URL are hidden.
- **Government / Public Sector:** all eight are shown, with a live explanatory note.
- Switching Private → Government restores them; Government → Private hides them again.
- Hidden fields are **omitted from the payload** rather than written as empty, so government
  data on an existing record is never wiped. No database column was changed.

---

## 9. Verification performed

- `node --check` passes on **all** JS: `app.js`, `v8.js`, `discovery-v9.js`,
  `cc-intelligence.js`, `next-phase.js`, `hero-3d.js`, `visual-backgrounds.js`,
  `service-worker.js`, `api/*.js`, `lib/*.js`, `scripts/*.js`.
- Zero remaining references to any deleted asset across HTML/JS/CSS/JSON.
- Browser run (Chromium, 1440×900 and ~750 px): every static asset returns 200; the only
  network errors are `/api/*` 404s, expected because the static preview has no serverless
  backend. No JavaScript exceptions.
- Private-jobs pipeline exercised with records using `Private`, `PRIVATE`, `MNC`,
  `Private Sector`, `private-sector` and an empty sector — all six rendered; a Government
  record was correctly excluded.
- Filters exercised: Design, Freshers, ₹30K+, MNC, Bengaluru, Remote and the Role dropdown —
  each changes the list and each clears on re-click.
- Empty vs failed states exercised: `No private jobs are currently available` vs
  `Unable to load private jobs` (+ Retry).
- Statistics: `Unable to load` shown on API failure; real counts when data is present.
- Admin Editor: 8/8 government-only fields hidden for Private, 8/8 visible for Government,
  and hidden again when switching back.
- Career Paths: no map, no HOW TO CHOOSE, no empty containers, 14 working role links.
- Global search overlay opens from the nav and returns results.

## 10. Data safety

No jobs were deleted or replaced with mock data. No unpublished/draft record was made public.
No Supabase keys or owner credentials were moved into browser code (`lib/supabase.js` and
`api/*` stay server-side; `SUPABASE_SERVICE_ROLE_KEY` and `OWNER_KEY` are Vercel environment
variables only). Government records and For You profiles are untouched (the profile store is
read/written exactly as before, in the browser).

## 11. Automatic discovery model (added in this build)

Discovery already existed; this build gives it the shape the owner asked for and stops it from
living in two places.

**One implementation.** The pipeline is `runPublicDiscovery()` in `api/jobs.js`. The GitHub
Actions workflow no longer contains a second scraper — `scripts/scrape-jobs.js` was rewritten to
authenticate and call the deployed endpoint, so a gate fix takes effect immediately with no CI
change. The old Gulf (Dubai/Abu Dhabi/Qatar) and Karnataka-only Indeed feeds were deleted; the
server-side gates are India-only and civil-only by construction.

**Every 4 hours, reliably.** The workflow cron is `0 */4 * * *`. Vercel's cron is kept at one run
a day as a safety net, because Vercel restricts sub-daily schedules to paid plans — a `*/4`
Vercel cron can fail deployment on a free plan, and a broken deploy is worse than a slower
schedule. Note that GitHub disables scheduled workflows after 60 days of repository inactivity.

**Company career pages (`lib/company-careers.js`, new).** 35 top Indian construction, EPC,
infrastructure, real-estate and public-sector employers. Career URLs are **discovered** from each
company's homepage rather than guessed — an early version guessed `/careers` paths and the live
test showed most of them 404, while discovery correctly found `larsentoubro.com/careers` and
`careers.tataprojects.com`. Pages are read for schema.org `JobPosting` JSON-LD first and
job-detail links second. Nothing is invented: no fabricated URL, date or location.

**Honest limitation, documented not hidden.** A live test run reached most career pages and read
**zero** vacancies from them, because the majority render their vacancy lists in JavaScript — the
served HTML has no `JobPosting` block and no job links. The module header states this, the
per-company report says which pages were reached and carried nothing readable, and covering the
JavaScript-rendered majority needs a real browser in CI (the natural next step, not something
this build pretends to do).

**Free-AI failover (`lib/ai-models.js`, new) + enrichment.** Eleven free tiers with multi-key
support, cooldowns and rotation; used by `api/extract.js` and by capped draft enrichment that only
ever fills blanks. AI never admits a record to the queue and never fails a run.

**A security hole closed.** `?discovery=cron` was authorised only by the `vercel-cron/1.0`
user-agent, which is trivially spoofable — any stranger could have triggered runs and burned the
API quotas. It now requires `CRON_SECRET` (which Vercel Cron sends automatically) or the owner key.

**Deliberately NOT shipped.** A per-company web-search track was built and tested, then removed:
Bing's keyless RSS ignores the query and returned unrelated results (Outlook help threads, Google
Translate pages, Tata car prices) that the civil gate rejected 46/46. It added noise, not
vacancies, so it is not in this build.

## 12. Deploy note

The live site only updates after this build is pushed to GitHub (Vercel auto-deploys) — local
edits never reach the live URL on their own. After deploying, hard-refresh once
(**Ctrl+Shift+R**); the bumped service-worker cache handles normal visitors.
