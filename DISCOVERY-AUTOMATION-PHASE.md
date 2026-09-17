# CivilCareer — Discovery & Admin Automation Phase

This build adds a stronger admin review workflow without requiring a paid API.

## Web discovery
- Google, Bing and DuckDuckGo public search attempts.
- Google News RSS fallbacks using multiple civil-job query variants.
- Results are deduplicated and relevance-scored.
- Search failures are isolated with `Promise.allSettled`, so one source cannot cancel the others.

## Draft workflow
- Discovery leads are reviewable before publication.
- `Create draft & review` sends the original URL to `/api/extract`.
- Discovery-created records open as `Draft` + `published=false`.
- Saving a discovery draft does not send Telegram alerts.
- Publishing requires an explicit review action.
- Discovery shows likely duplicates and lets the admin review the existing record.
- Admin Discovery includes a live list of unpublished drafts from web discovery and the daily scraper.

## Expiry
The daily GitHub scraper now:
1. closes published jobs whose deadline has passed,
2. marks them `Expired`,
3. unpublishes them,
4. checks recent jobs for source/title/company/location duplicates,
5. stores newly discovered records as unpublished `Draft` jobs.

## Serverless safety
The extraction provider/source timeouts were reduced to keep the worst-case URL-fetch + free-AI fallback chain inside the project's 15-second Vercel function limit.

## Important
Web discovery is lead generation, not blind publishing. Original vacancy pages must be checked before publication.
No paid search or scraping API was added.
