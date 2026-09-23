# CivilCareer Phase 7 — Discovery Fix

## What this fixes
- Adds a no-key Job Opportunities API source using its public `/public/jobs` endpoint for India.
- Keeps SerpApi, Jobvetta, Adzuna and The Muse optional and server-side.
- Preserves OnJob, Arbeitnow, Jobicy, Google News and Bing News fallbacks.
- A provider error/429 does not stop the other sources.
- Corrects the draft date bug so an unknown date is never silently changed to “now”.
- Applies the Admin discovery type filter.
- Adds Job Opportunities API to Source Status.
- Keeps the 24-hour freshness rule for the review queue.

## Important
This package was tested locally with mocked provider responses, including a Jobvetta 429 and a successful no-key Job Opportunities API response.

It was NOT live-tested against your private Vercel/Supabase deployment. Do not treat the package as production-verified until it is deployed and the actual Admin > Discovery flow is checked.

## Optional environment variables
- `SERPAPI_API_KEY`
- `JOBVETTA_API_KEY`
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `MUSE_API_KEY`

The Job Opportunities API source does not require a key.

## Deployment
Upload/replace the project from this ZIP in the existing GitHub/Vercel project. Do not delete existing environment variables. No Supabase migration is required by this fix.
