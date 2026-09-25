# civilcareer.jobs — India

A deploy-ready India-only civil engineering jobs board. As the owner, paste an original public vacancy URL and the server extracts available structured details (role, company, location, description, employment type, salary and dates) and publishes the listing.

## Free public setup

You need free accounts on **GitHub**, **Vercel**, and **Supabase**. Free plans have usage limits, but are suitable for an early MVP with modest traffic.

### 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase.sql`.
3. In Supabase project settings, copy:
   - Project URL
   - `service_role` key (keep this secret; never add it to browser code)

### 2. Put the project on GitHub

Create a repository and upload all files from this folder, preserving the `api` folder.

### 3. Deploy on Vercel

1. Import the GitHub repository in Vercel.
2. Add these Environment Variables:
   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service-role key
   - `OWNER_KEY` = a long private password only you know
3. Deploy. Vercel gives you a public HTTPS address.
4. Optional: connect a custom domain later. The Vercel address works without buying a domain.

## Owner workflow

1. Open the public website.
2. Select **Add vacancy**.
3. Paste the original public vacancy URL and enter your owner key (saved locally on your device).
4. Select **Detect & publish vacancy**.

## What works automatically

The importer reads JobPosting JSON-LD and public page metadata. It works best with an original public job-detail URL from a company career page or job board.

## Important limitations

- LinkedIn and some other sites may block automated reading or require sign-in. No free parser can guarantee every LinkedIn link will work reliably.
- A WhatsApp group/invite link does not contain vacancy details. Paste the original job URL shared inside WhatsApp.
- If a shared message contains only text or an image and no public job URL, link-only extraction is impossible; a later version can add a text/image paste fallback.
- Source sites can change their HTML at any time. The parser uses structured job data first and metadata as a fallback.
- Review copyright and source-site terms before republishing full descriptions. Linking to the original vacancy and showing a concise excerpt is the safer default.

## Local preview

Opening `index.html` directly shows sample listings. The import and shared database features work after deployment because they require the serverless `/api` routes and environment variables.

## Project files

**Front end (no build step — plain scripts, loaded in this order by `index.html`)**

- `index.html` — app shell, all SPA routes, SEO metadata
- `app.js` — data loading, normalisation helpers, home/government/exams/materials/For You,
  global search overlay, viewed + saved jobs, admin shell
- `v8.js` — **the canonical Civil Job Explorer** (private-jobs renderer), government renderer,
  dedicated job/exam/material pages, admin job editor
- `discovery-v9.js` — compact live job card, relevance search, profile save
- `cc-intelligence.js` — natural-language search, career radar, qualitative fit badge
- `visual-backgrounds.js` — decorative photo rotator
- `hero-3d.js`, `next-phase.js` — hero visual, career hub
- `styles.css` — the single stylesheet (design tokens, layout, components, responsive)
- `service-worker.js` — the only registered service worker
- `mobile.css` is gone; all responsive rules live in `styles.css`.

**Server (Vercel serverless, Node)**

- `api/jobs.js` — public listing API + owner-protected publishing + HTML job page
- `api/exams.js`, `api/materials.js` — content APIs
- `api/extract.js`, `api/agent.js` — free-first AI extraction chain
- `api/analytics.js`, `api/subscribe.js`, `api/telegram.js`, `api/reports.js`,
  `api/employer-submissions.js`, `api/resource-submissions.js`, `api/sitemap.js`
- `lib/discovery-core.js`, `lib/discovery-sources.js`, `lib/supabase.js` — server-only helpers
- `supabase.sql` + `supabase-v7…v10.sql` — database schema and migrations
- `scripts/scrape-jobs.js` + `.github/workflows/job-scraper.yml` — daily discovery cron
- `vercel.json` — routes, rewrites, security headers, cron

## Documentation

- `README.md` — this file (setup, environment variables, owner workflow)
- `DEPLOY.md` — deployment steps
- `CHANGELOG.md` — what changed in each build
- `CLEANUP-NOTES.md` — what was removed, consolidated and fixed in the 2026-09-25 cleanup

## Notes for this build

The site is **English-only** and **India-wide**. Match percentages are not displayed anywhere;
For You explains fit qualitatively (`✓` / `△` facet list plus skill gaps). The Career Map
presentation and the "How to Choose" section have been removed, but every civil role remains
available for For You, matching, filters and search.
