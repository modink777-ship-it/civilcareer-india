# CivilCareer — Final Phase 6/14/15/16 Fix

## Fixed
- For You action-button colour forced to the CivilCareer green action style.
- Profile save closes the actual profile overlay instead of the unrelated editor dialog.
- Fixed the V8 script override that was still reading `data.job` while `/api/extract` returned `data.extracted`.
- `/api/extract` now uses direct fetch, JSON-LD extraction, free Jina Reader fallback for HTTP 429/blocked pages, Groq/Gemini AI, then deterministic text fallback.
- Extraction endpoint is admin-protected.
- Added `/api/discover` for free public-source job discovery.
- Added visible `🛰 Discovery` admin tab to the main SPA admin and standalone admin page.
- Discovery creates `Pending Review` drafts only; it never auto-publishes.
- Duplicate filtering by source URL and normalized role/company/location.
- Publishing a job stamps `published_at` at the publication moment.
- PWA cache bumped to force the latest UI after deployment.

## Important
Jina Reader basic usage is currently free without an API key, with a published basic rate limit; no paid Jina key is required by this implementation. The app does not automatically add any paid service.

## Workflow
1. Admin → 🛰 Discovery → Fetch new jobs now.
2. Admin → Jobs → review/edit Pending Review drafts.
3. Publish only after checking the original source.
4. For a single URL: Admin → Jobs → paste URL → Extract & fill fields.
5. If a site blocks both direct fetch and the reader, paste the vacancy text; the extractor still organizes the fields.
