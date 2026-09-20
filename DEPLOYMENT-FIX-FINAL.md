# CivilCareer deployment fix

## What was fixed
- `/api/jobs` no longer loads an optional `lib/discovery-sources` module during serverless startup.
- Added the missing `/api/admin-auth` endpoint used by both the main app and the standalone admin page.
- Added a root `package.json` so Vercel has an unambiguous dependency manifest.

## Required Vercel environment variables
Keep the existing production values. At minimum:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or the existing `SUPABASE_SERVICE_KEY`)
- `OWNER_KEY`

Do not put these secrets in GitHub or this ZIP.

## Supabase
No table deletion or migration is required for this particular fix. Existing jobs are preserved.

## Automatic deployment
If Vercel is connected to GitHub, Vercel will deploy whatever is committed to the connected repository. Replacing/downloading this ZIP alone does not change production until its contents are committed to that repository (or otherwise used as the source for the deployment).

## First production checks
1. `GET /api/jobs` should return JSON instead of `FUNCTION_INVOCATION_FAILED`.
2. Admin login should call `/api/admin-auth` and return `{ "ok": true, "authenticated": true }` when the correct owner key is supplied.
3. Admin job loading then calls `/api/jobs` with `x-owner-key`.
