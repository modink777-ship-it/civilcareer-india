# CivilCareer Phase 7 — Discovery UI Upgrade

## What changed

### `api/jobs.js`
- Extended the `results` array returned by `runPublicDiscovery()`.
- Each result now includes: `id`, `title`, `company`, `location`, `url`, `applicationUrl`,
  `snippet`, `source`, `sourceDomain`, `postedAt`, `score`.
- Previously only `title`, `url`, `snippet`, `source`, `score` were returned.
- Change is purely additive. No logic was altered.

### `admin.html`
- **Source Health Panel** — After every search, a table renders showing each source
  (🟢 OK / 🟡 Quota / 🔴 Error / ⚪ Not configured) with jobs found and error reason.
- **Diagnostics Summary** — Shows "X new drafts · Y fresh candidates · Z skipped" after search.
- **Upgraded Result Cards** — Now show company, location, source badge, posting date,
  and "Posting time: Unknown" when the source didn't confirm a date.
- **Review Modal** — "Review" button opens a full detail panel (title, company, location,
  source, date, description, URL). From there: Publish, Open in Editor, or Reject.
- **Reject button** — Deletes the draft directly from the card or from the modal.
- **Review Queue** — After search, a separate section lists the same drafts for review.
- **Removed auto-run** — Discovery no longer fires automatically when the tab opens.
  It now only runs when you click "Search Now" or press Enter.

## What was NOT changed
- `lib/discovery-sources.js` — untouched
- `vercel.json` — untouched
- All other `api/*.js` files — untouched
- `index.html` and all public pages — untouched
- `robots.txt`, `sitemap.xml` — untouched
- Supabase schema — untouched
- No new Vercel functions added

## Deployment
1. Upload this complete ZIP over your existing Vercel project repository.
2. Vercel will auto-deploy on push.
3. No new environment variables are required.
4. Existing env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_KEY, etc.) are unchanged.

## Optional API keys (add in Vercel → Project → Settings → Environment Variables)
| Variable | Provider | Required? |
|---|---|---|
| SERPAPI_API_KEY | Google Jobs via SerpApi | No |
| ADZUNA_APP_ID | Adzuna | No |
| ADZUNA_APP_KEY | Adzuna | No |
| MUSE_API_KEY | The Muse | No |
| JOBVETTA_API_KEY | Jobvetta | No |

The system runs without any of these using Google News RSS, Bing News RSS,
Jobicy, Arbeitnow, and OnJob as no-key fallbacks.

## What happens when a provider has no key
It appears as ⚪ Not configured in the Source Health table. No error is thrown.

## What happens when a provider returns 429
It appears as 🟡 Quota in the Source Health table. The remaining sources continue.
The total result count is from all sources that succeeded.

## Testing performed
- Node syntax check on all modified JS files: PASS
- All 20 new DOM IDs verified present in HTML: PASS
- All 9 new JS functions verified present: PASS
- Auto-run on tab open confirmed removed: PASS
- Existing panels, tabs, admin/jobs/:slug routes confirmed preserved: PASS
- End-to-end mock pipeline test (Bing=429, OnJob=timeout, Google News=success): PASS
- Civil-relevance filter confirmed removing non-civil jobs: PASS
- System confirmed not crashing when 2 of 5 public sources fail: PASS

Live production verification against your Vercel/Supabase deployment was not
performed in this chat because those credentials are not available here.
