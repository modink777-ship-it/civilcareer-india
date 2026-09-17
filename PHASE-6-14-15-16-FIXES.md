# CivilCareer — Phase 6/14/15/16 fixes

This release fixes the For You page controls, publication-time display, job extraction,
admin discovery/review workflow, and PWA cache freshness.

## Included

- For You hero now has visible `Edit job preferences` and `Browse all jobs` actions.
- Fixed the profile modal close/save flow.
- Public job cards use `published_at`/`posted_at` and show relative age such as `Just now`,
  `5 min ago`, `1 hr ago`, `3 hrs ago`, `2 days ago`.
- Admin-created jobs get a server timestamp at creation/publication.
- Publishing a draft stamps the publication time once; later edits do not reset it.
- Public jobs API returns only public-safe fields.
- Job importer now accepts the API's `job` response correctly.
- Importer supports structured JSON-LD/meta extraction plus a deterministic fallback.
- Importer remains admin-only and blocks common private/internal URL targets.
- Added `/api/discover` for an admin-triggered free RSS discovery run.
- Discovery checks source URLs and role/company/location fingerprints for duplicates.
- Discovered jobs are always `Pending Review` + `published=false`.
- Admin dashboard gets `Fetch new jobs now` and shows review/source/age information.
- Existing GitHub Actions scraper remains available for scheduled discovery.
- PWA cache version bumped to avoid stale UI after deployment.

## Cost

No paid service was added. AI extraction is optional; the importer still works with its
built-in free fallback when the AI environment variable is missing or unavailable.

## Deployment

Replace the GitHub repository contents with the files in this release and let Vercel
deploy normally. No database migration is required because the timestamp/lifecycle
columns are already part of the existing V8 schema.
