# CivilCareer Soft 404 / 404 Fix V4

This version uses Vercel's documented named-rewrite parameter passthrough.

- `/jobs/:slug` rewrites to `/api/job-page`; Vercel supplies the named `slug` as a query parameter.
- Removed the overlapping `/jobs/:path*` rewrite.
- Server renderer accepts slug/id/path/jobSlug query forms and direct route paths.
- Existing published-job lookup and numeric-ID fallback retained.
- No database migration, paid service, or paid API.
