# CivilCareer Jobs API production fix

This version makes the configured discovery module optional at runtime.

The old top-level import could make the entire `/api/jobs` function crash with
`FUNCTION_INVOCATION_FAILED` when `lib/discovery-sources.js` was absent from a
deployment bundle. The normal jobs API and admin authentication must not depend
on that optional module.

## Behavior
- Public `/api/jobs` loads published jobs from Supabase.
- `GET /api/jobs?auth=1` checks `OWNER_KEY` without loading discovery.
- Admin create/update/delete operations do not depend on discovery.
- Discovery uses configured providers when `lib/discovery-sources.js` exists.
- If the optional module is absent, discovery reports it as unavailable instead
  of crashing the entire jobs function.

## Vercel variables expected by api/jobs.js
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or legacy `SUPABASE_SERVICE_KEY`)
- `OWNER_KEY`
