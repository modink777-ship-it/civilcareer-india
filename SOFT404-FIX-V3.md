# CivilCareer Soft 404 / 404 Fix V3

This version fixes the Vercel rewrite parameter handoff for individual job pages.

- `/jobs/:slug` explicitly rewrites to `/api/job-page?slug=:slug`
- `/api/job-page` accepts public and rewritten API path formats
- Numeric ID suffix fallback remains supported
- Genuine missing jobs still return HTTP 404
- No database migration
- No paid services
