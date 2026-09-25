# CivilCareer Phase 1 — Repository Schema Inventory

## Production-state limitation
The repository contains multiple SQL versions. They document intended/evolving schema, but they do **not** prove which migrations have actually been applied to the live Supabase database.

## Jobs table — fields observed across repository migrations/code
Core: `id`, `source_url`, `role`, `company`, `location`, `description`, `employment_type`, `salary`, `date_posted`, `valid_through`, `source`, `published`, `created_at`.

Structured/lifecycle: `responsibilities`, `skills`, `country`, `state`, `district`, `city`, `location_display`, `locations`, `qualifications`, `qualification_notes`, `experience_min`, `experience_max`, `experience_ranges`, `employment_types`, `salary_min`, `salary_max`, `salary_currency`, `application_email`, `application_emails`, `application_email_private`, `application_url`, `company_url`, `role_normalized`, `posted_at`, `published_at`, `expires_at`, `verification_status`, `last_verified_at`, `updated_at`, `slug`, `qualification`, `posted_date`, `application_method`, `contact_info`, `featured`, `last_verified`, `status`, `vacancy_count`, `age_limit`, `application_fee`, `application_start`, `recruitment_authority`.

## Other repository tables observed
- `exams`
- `materials`
- `career_profiles`
- `saved_jobs`
- `job_events`
- `job_alerts`
- `source_snapshots`
- `employer_verifications`
- `employer_submissions`
- `resource_submissions`
- `content_reports`
- `analytics_events`
- `job_role_master`
- `qualification_master`

## Phase 1 lifecycle decision
`expires_at` is treated as the preferred canonical lifecycle field because the V8 migration explicitly backfills it. Legacy `valid_through` and `deadline` remain fallback fields in application logic so existing records are not silently invalidated.

## Required production verification
Before a destructive schema migration, compare this inventory with the actual Supabase schema and record differences. Do not execute all repository SQL files blindly.
