# CivilCareer Jobs API production fix

## Root cause found
Vercel was returning `500` for `GET /api/jobs` before the handler could execute because
`api/jobs.js` imported `../lib/discovery-sources`, while that file was missing from the
uploaded deployment package.

## Fix included in this package
- Added `lib/discovery-sources.js` as a dependency-free optional provider module.
- Made the provider import defensive in `api/jobs.js`, so the normal Jobs API and Admin
  CRUD cannot crash merely because an optional discovery provider is unavailable.
- Configured providers run independently; a missing key, HTTP error, timeout, malformed
  response, or quota response is recorded in discovery `sourceStats` and does not stop
  other providers.
- Public jobs, Admin jobs, create, update, delete, authentication, and server-rendered
  job pages do not require any discovery API key.

## Required Vercel variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or legacy `SUPABASE_SERVICE_KEY`)
- `OWNER_KEY`

## Optional discovery variables
- `SERPAPI_API_KEY`
- `JOBVETTA_API_KEY`
- `JOBVETTA_API_URL` (optional endpoint override)
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `MUSE_API_KEY`

No secret values are stored in this package.
