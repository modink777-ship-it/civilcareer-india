# CivilCareer Phase 1 — Backup & Recovery Procedure

## Scope
This document protects the existing CivilCareer Supabase data before schema-changing work. The repository does **not** contain proof of the live Supabase production state or a verified production backup, so those facts must not be assumed.

## Required pre-migration procedure
1. In the Supabase project dashboard, create a database backup/export using the project's supported backup/export facility.
2. Confirm the export completed successfully and record the timestamp.
3. Store the export outside the application repository; never commit database dumps, service-role keys, or personal candidate data to GitHub.
4. Before a destructive migration, test the migration against a disposable/local copy where practical.
5. After migration, verify row counts and key job fields before and after the change.

## Minimum verification for jobs
- Total job rows
- Published job rows
- Active job rows
- Expired job rows
- Government/private counts
- Sample records by `id` and `slug`
- `source_url` uniqueness

## Recovery
If a migration causes incorrect data:
1. Stop further writes that depend on the changed schema.
2. Preserve the failing migration/error output.
3. Restore the affected database from the verified backup using Supabase's supported recovery process.
4. Verify job counts and representative records.
5. Re-run only the corrected migration after testing.

## Important
No production backup has been claimed as complete by this repository change. Production backup verification requires access to the live Supabase project.
