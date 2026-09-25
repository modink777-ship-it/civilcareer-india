# Changelog

All notable changes to CivilCareer India. The project uses a single production package with no
build step; version tags in `index.html` (`?v=…`) and the service-worker cache name are bumped
on every change so returning visitors always receive the newest HTML/CSS/JS.

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
