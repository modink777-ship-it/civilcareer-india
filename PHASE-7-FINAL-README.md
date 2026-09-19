# CivilCareer Phase 7 — Final Automatic Job Discovery

## What this version does
- Admin → Discovery → Search Now performs an immediate server-side discovery run.
- New matches are inserted into Supabase as unpublished Draft jobs.
- Daily Vercel Cron continues to run the same discovery engine automatically.
- Sources include public indexed Google/Bing news/search feeds plus free public Jobicy and Arbeitnow APIs where their published terms permit reuse.
- Naukri/LinkedIn/Indeed and other restricted platforms are discovered only through public indexed results; the system does not log in, bypass access controls, or scrape restricted pages.
- Search results include source-by-source diagnostics so failures are visible.

## Deployment
Upload this complete project over the current CivilCareer project. No new environment variable is required. Existing SUPABASE_URL, service-role key and OWNER_KEY remain unchanged.

## Important
No free system can guarantee every vacancy from every private job board. This build maximizes legitimate public discovery while keeping the workflow at ₹0.
