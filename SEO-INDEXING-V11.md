# CivilCareer V11 — Free Google Indexing Readiness

This release adds a database-backed XML sitemap and indexability controls. It does not require a paid service or a database migration.

## Included

- `/sitemap.xml` is served dynamically from `/api/sitemap`.
- Active published jobs are included automatically.
- Published exams and study materials are included automatically.
- Expired jobs are excluded from the sitemap.
- Empty role/location landing pages are marked `noindex,follow`.
- Expired job detail pages are marked `noindex,follow` and no longer emit `JobPosting` structured data.
- Canonical URLs no longer include search/filter query strings.
- `/admin` and `/api/` are disallowed in `robots.txt`.
- Sitemap responses are cached briefly at the edge to keep the site fast and free.

## Google Search Console — free setup

1. Open Google Search Console and add the CivilCareer domain/property.
2. Verify ownership using one of Google's offered free verification methods.
3. Submit:
   `https://civilcareer-india-two.vercel.app/sitemap.xml`
4. Use URL Inspection on a few important active job URLs and request indexing when appropriate.

Search Console is a Google service and does not require a paid subscription.
