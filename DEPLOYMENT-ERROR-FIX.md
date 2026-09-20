# Deployment error fix

## What changed
- Added isolated `/api/admin-auth` so admin-key validation does not depend on Supabase or job discovery modules.
- Made the discovery provider module lazy-loaded by `/api/jobs`, so normal job listing/authentication cannot fail because an optional provider module fails to load.
- Added a Node 18+ runtime declaration for API functions.
- Made discovery request timeouts compatible with Node runtimes without `AbortSignal.timeout()`.

## Required Vercel variables
Set these in the Production environment:
- `OWNER_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or the legacy `SUPABASE_SERVICE_KEY` for `/api/jobs` only)

The public `/api/jobs` endpoint cannot show published database jobs without valid Supabase credentials and a `jobs` table containing `published = true` rows.
