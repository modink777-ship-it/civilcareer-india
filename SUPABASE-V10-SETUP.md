# CivilCareer database setup — v10

The v10 migration is required only for the Saved Jobs feature. Existing jobs, exams, materials and the admin API do not depend on the `saved_jobs` table.

## Run once

1. Open Supabase → SQL Editor for the **same project** used by CivilCareer.
2. Paste the contents of `supabase-v10.sql`.
3. Run it.
4. Confirm `public.saved_jobs` exists under Table Editor.
5. Redeploy the latest GitHub commit to Vercel.

The migration is idempotent and enables RLS. The website uses the server-side service-role key for this table; the browser does not receive the service-role key.

## Vercel environment variables

Production must have:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_KEY` (or `ADMIN_KEY`)

Do not put the service-role key or owner key in GitHub source files.

If `/admin` reports `503 Admin is not configured`, add the owner key to Vercel **Production** environment variables and redeploy.
