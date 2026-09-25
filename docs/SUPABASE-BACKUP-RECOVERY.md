# Supabase backup and recovery runbook

## Cost

₹0 using the existing Supabase dashboard, PostgreSQL tooling where available, and local storage. Free-tier availability can change; no paid backup service is required for the current MVP.

## Before any migration

- Confirm the target project and environment.
- Record the current Git commit and deployment URL.
- Export the database from Supabase Dashboard or use the project-supported PostgreSQL export method.
- Keep the export outside GitHub because it contains production data.
- Record:
  - UTC timestamp
  - project reference
  - jobs row count
  - important related-table row counts
  - file size
  - SHA-256 checksum

Example checksum command:

```bash
sha256sum civilcareer-backup-YYYYMMDD.sql
```

## Minimum verification

After export, inspect the backup for:

- `jobs` table definition
- primary key and unique source URL constraint
- job rows
- related tables used by the application
- no truncated output or failed export messages

A backup is not considered verified merely because an export command returned exit code 0.

## Restore test

Do not restore over production for a test. Restore into a separate local/staging PostgreSQL database if available:

```bash
createdb civilcareer_restore_test
psql civilcareer_restore_test < civilcareer-backup-YYYYMMDD.sql
psql civilcareer_restore_test -c "select count(*) from public.jobs;"
```

Compare the restored count with the recorded production count. Sample several jobs by ID and source URL.

## Recovery procedure

1. Stop deployment/migration activity.
2. Identify the last known-good backup.
3. Confirm the intended restore target and time window.
4. Restore only after confirming the backup checksum and contents.
5. Verify jobs, indexes, constraints and application queries.
6. Redeploy the last known-good Git commit if application code also changed.
7. Test public jobs, job detail pages, admin access and sitemap.
8. Record the incident and the recovery result.

## Safety rules

- Never paste Supabase service keys into GitHub or chat.
- Never commit a production SQL dump to this repository.
- Never drop tables or columns as part of the P1 scale work.
- Never run unknown migration files in bulk.
- Keep at least one pre-migration backup until production verification is complete.
