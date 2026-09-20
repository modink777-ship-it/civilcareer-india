# CivilCareer Phase 7 — Multi-Source Automatic Job Discovery

## What this version does

- Admin → Discovery → Search Now runs a server-side multi-source discovery pool.
- Optional configured providers: Google Jobs via SerpApi, Jobvetta, Adzuna, and The Muse.
- No-key fallback sources: Google News RSS, Bing News RSS, Jobicy, Arbeitnow, and OnJob.
- If one provider is missing, unavailable, or rate-limited, the other sources continue automatically.
- Results are normalized, deduplicated against existing CivilCareer jobs, and restricted to listings with a known posting age within the 24-hour discovery window.
- New matches are saved as unpublished Draft jobs for manual review.
- Nothing is published automatically.
- The original source/application URL is retained.
- Daily Vercel Cron runs the same discovery engine automatically.
- LinkedIn/Naukri/Indeed and other protected platforms are not logged into or bypass-scraped.

## Existing project preservation

- Existing Supabase connection is preserved.
- Existing OWNER_KEY authentication is preserved.
- Existing `/admin` routing is preserved.
- Existing `/jobs/:slug` server-rendered job pages are preserved.
- No new Vercel API function was added; the discovery engine remains inside `api/jobs.js` and uses a library module.

## Optional environment variables

No new variable is mandatory for deployment. Add only the provider keys you actually have:

- `SERPAPI_API_KEY`
- `JOBVETTA_API_KEY`
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `MUSE_API_KEY`

Keep all keys server-side in Vercel Environment Variables. Never commit or paste them into chat.

## Deployment

Upload this complete package over the current CivilCareer repository and deploy normally through the existing Vercel project. Do not delete or replace existing Supabase environment variables.

## Testing statement

This package was tested locally with syntax checks, Vercel-route validation, a mocked provider-fallback test, and a mocked full Admin discovery-handler test. Live production verification against the user's private Vercel/Supabase deployment was not performed because those credentials/project controls are not available in this chat.
