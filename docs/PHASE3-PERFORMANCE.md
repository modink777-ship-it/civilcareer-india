# CivilCareer — Phase 3 Performance

Date: 2026-09-25

## Objective

Improve measurable runtime performance without changing the stack or introducing paid monitoring/infrastructure.

## Completed

1. **Lazy-load PDF.js**
   - Removed the global PDF.js download from the main homepage bundle.
   - PDF.js is loaded only when the admin actually reads an exam PDF.
   - The admin page uses the same lazy-loading approach.

2. **Lazy-load Tesseract.js**
   - Removed the global Tesseract download from the main homepage.
   - OCR is loaded only when a PDF has insufficient extracted text and OCR is actually needed.
   - OCR failure now falls back gracefully to extracted text.

3. **Public API caching**
   - Public job list responses: `s-maxage=60`, stale-while-revalidate.
   - Public job detail responses: `s-maxage=300`, stale-while-revalidate.
   - Public job summary responses: `s-maxage=60`, stale-while-revalidate.
   - Admin responses remain `private, no-store`.

4. **Lightweight API performance instrumentation**
   - Public/server API responses expose a `Server-Timing` duration header.
   - The browser records the last 100 API request samples in `window.__ccPerfSamples`.
   - No paid monitoring service is required.

5. **CDN connection setup**
   - Added `preconnect` hints for the two external libraries used only by optional PDF/OCR workflows.

## What was deliberately not changed

- No framework migration.
- No database migration.
- No production data changes.
- No new paid service.
- No external search service.
- No aggressive CSS/JS splitting that could create regressions.
- No removal of existing application features.

## Verification

- Node test suite: 9 passed, 0 failed.
- JavaScript syntax: 31 files checked, 0 failures.
- `vercel.json`: valid JSON.
- The main homepage no longer eagerly loads PDF.js or Tesseract.js.

## Measurement limitation

This repository-level phase cannot claim real production Core Web Vitals, Supabase latency, Vercel execution time, bandwidth usage, or database query latency without live production telemetry. The new timing instrumentation is intended to provide those measurements after deployment.

## Next performance measurement

After deployment, inspect:

- API `Server-Timing` values
- `window.__ccPerfSamples`
- job-list response sizes
- search latency
- mobile rendering
- admin job-list latency
- real Supabase/Vercel usage before considering any paid upgrade
