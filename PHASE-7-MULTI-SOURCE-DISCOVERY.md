# CivilCareer Phase 7 — Multi-Source Discovery

## What changed

The Admin → Discovery flow now uses a source pool instead of depending on one provider.

Configured providers are attempted independently:

1. Google Jobs via SerpApi (`SERPAPI_API_KEY`) — optional
2. Jobvetta (`JOBVETTA_API_KEY`) — optional
3. Adzuna (`ADZUNA_APP_ID` + `ADZUNA_APP_KEY`) — optional
4. The Muse (`MUSE_API_KEY`) — optional
5. Google News RSS — no key
6. Bing News RSS — no key
7. Jobicy public API — no key
8. Arbeitnow public API — no key
9. OnJob public feed — no key

A provider that is missing a key, returns an HTTP error, or reaches a rate limit is recorded as skipped; the other providers continue.

## Freshness and review

- Discovery accepts only listings with a known posting age.
- The Admin queue is restricted to the last 24 hours for this Phase 7 search.
- Results are normalized and deduplicated against existing CivilCareer jobs.
- New records are saved as `published: false`, `review_state: Draft`, and `verification_status: Pending`.
- Nothing is published automatically.
- The original source/application URL is retained.

## Optional environment variables

Add only the keys you actually have in Vercel → Project → Settings → Environment Variables. Do not paste secrets into chat or commit them to GitHub.

```text
SERPAPI_API_KEY=...
JOBVETTA_API_KEY=...
ADZUNA_APP_ID=...
ADZUNA_APP_KEY=...
MUSE_API_KEY=...
```

The system still runs without these optional keys using the public fallback pool, although coverage depends on what those public feeds currently expose.

## Google-like search

SerpApi's Google Jobs engine is the closest supported integration to the requested “search Google Jobs and bring the results into Admin” workflow. Its current free plan is documented as 250 searches/month. This is an optional source, not a requirement.

## Important boundaries

CivilCareer does not log in to, bypass access controls on, or scrape restricted/private areas of LinkedIn, Naukri, Indeed, or other protected job boards. The discovery engine uses APIs/feeds/publicly accessible sources instead.

## Testing completed for this package

- Node syntax checks for all API and library JavaScript files.
- Vercel routing validation, including `/admin` and `/jobs/:slug`.
- Mocked source-manager test: successful Google Jobs + Adzuna results continue when Jobvetta returns HTTP 429.
- Mocked full Admin discovery handler test: candidates are normalized and drafts are inserted while a rate-limited provider is skipped.

Live production verification of the user's private Vercel/Supabase deployment was not performed because this chat does not have access to the user's deployment secrets or connected GitHub/Vercel project.
