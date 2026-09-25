# CivilCareer Phase 2 — Job Platform Stabilization

## Scope

This phase adds server-side pagination/filtering and reduces browser-side dependence on the full jobs table without changing the application stack or deleting production data.

## Changes

- `/api/jobs` now defaults to a bounded page (40 public jobs, 50 admin jobs when requested) and returns pagination metadata.
- Public job search/filter parameters are processed server-side.
- Admin job search/status/published/date filters are processed server-side.
- Public job summary endpoint reports active private/government counts without loading all jobs into the browser.
- Duplicate detection no longer loads 1,000 published jobs into memory; it performs targeted URL/title/company queries.
- Public universal search queries the jobs API instead of searching only the browser's initial page.
- Private and government explorer lists use server-side pagination and show Previous/Next controls.
- Sitemap job retrieval is batched at 1,000 rows and excludes expired jobs server-side; the implementation remains below the 50,000-URL single-sitemap ceiling.
- JobPosting salary schema is emitted only when a salary unit is supported by explicit source data; LPA values are represented as annual salary.
- Lightweight pagination/admin-filter CSS was added.

## Database

No production migration was executed. Existing repository indexes were reviewed and preserved. A future migration can add only evidence-backed indexes after the live production schema is verified.

## Deliberately deferred

- A normalized monthly/annual salary column, because the current data model contains mixed salary conventions and changing the schema requires a verified migration plan.
- Full PostgreSQL full-text search, pending measurement of query volume and production schema.
- Sitemap index, because the current operating target is 10,000+ jobs and a single sitemap remains below the 50,000-URL limit. Revisit before 50,000 indexable URLs.

## Verification

- Node syntax check: all JavaScript files passed.
- Node test suite: 9 tests passed, 0 failed.
- `vercel.json` and `package.json` parsed successfully.
