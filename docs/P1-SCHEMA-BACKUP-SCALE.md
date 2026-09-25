# P1 schema, backup and scale plan

## Scope

This branch documents the production-safe path toward pagination, indexed queries and schema consistency. It does **not** execute SQL, alter Supabase, delete jobs or change production secrets.

## Evidence available in the repository

The initial schema in `supabase.sql` defines `jobs` with:

- `id uuid primary key`
- `source_url text not null unique`
- `role text not null`
- `company text`
- `location text`
- `description text`
- `employment_type text`
- `salary text`
- `date_posted date`
- `valid_through timestamptz`
- `source text`
- `published boolean not null default true`
- `created_at timestamptz not null default now()`

Later repository migrations and application code reference additional fields including `slug`, `status`, `sector`, `deadline`, `expires_at`, `application_url`, `apply_url`, `company_url`, `state`, `city`, `country`, `location_display`, `qualifications`, `skills`, `employment_types`, `review_state`, `verification_status`, `updated_at`, `posted_at` and government-specific fields.

The live Supabase schema cannot be verified from GitHub alone. Treat the following as **unknown until checked in Supabase**:

- Which migration files were executed
- Current table columns and data types
- Current indexes and constraints
- Current row count and database size
- Whether optional fields used by discovery exist
- Whether related tables such as `user_profiles`, `job_preferences` and `job_interactions` exist

## Required production procedure

1. In Supabase, create/export a backup before any schema change.
2. Download the export outside the repository; never commit service keys or production data to GitHub.
3. Record the export timestamp, project reference, row counts and checksum.
4. Test restoring the backup into a separate free/local PostgreSQL environment where practical.
5. Only then apply an additive migration.
6. Verify row count, sample records, indexes and public API behavior.
7. Keep the backup and rollback instructions until the deployment has been verified.

## Do not do yet

- Do not run every `supabase-v*.sql` file blindly.
- Do not add `companies` or replace `jobs` until the live schema is recorded.
- Do not drop or rename columns.
- Do not make `deadline`, `expires_at` or `valid_through` mutually exclusive until existing data has been profiled.

## Proposed pagination contract

The future public endpoint should preserve the existing `{ jobs: [...] }` response shape while adding metadata:

```json
{
  "jobs": [],
  "page": 1,
  "page_size": 24,
  "has_more": false,
  "total": null
}
```

`total` should remain optional or cached because counting every filtered row on every request can be unnecessarily expensive. Existing clients must continue to work when they only read `jobs`.

Recommended query parameters:

- `page` — positive integer, default `1`
- `limit` — bounded, default `24`, maximum `60`
- `q` — optional search phrase
- `sector` — `private` or `government`
- `state`, `city`, `role`, `employment_type`
- `posted_days`
- `sort` — allowlisted values only

The first implementation should use Supabase/PostgREST range queries and allowlisted filters. Do not interpolate arbitrary column names or raw SQL into requests.

## Candidate indexes after live-schema verification

Create only indexes supported by actual columns and observed queries:

- published/status plus created_at for public listings
- slug for job detail pages
- deadline/expires_at/valid_through for expiry work
- sector and location fields used by filters
- source_url, already unique in the baseline schema

Use additive `create index if not exists` statements only after confirming names and types.

## Duplicate-check direction

The current application has full-table duplicate checks. At scale, replace them with targeted lookups:

1. Exact source URL
2. Normalized source URL if a stored normalized field is available
3. Normalized role + company + location
4. Human review for fuzzy description similarity

Do not introduce a normalized column until its backfill and rollback plan are documented.
