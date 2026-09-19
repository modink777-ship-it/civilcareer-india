# CivilCareer Phase 7 Discovery Fix 2

## What this fixes

The previous Discovery build could hide the real backend error: the error CSS did not make the error banner visible, so the page could show an empty Discovery result without showing why the request failed.

This build also improves the keyless Job Opportunities API integration. Its current public contract supports `country`, `city`, `q`, `title`, and `posted_after`; the adapter now runs several small India/city query variants so `engineering` vs `engineer` and multi-city searches do not accidentally return an empty result.

## Preserved

- Existing Admin authentication
- Existing Supabase database
- Existing job table and publish workflow
- Existing `/jobs/:slug` pages
- Existing SEO/sitemap
- Existing Phase 6 UI
- Optional provider keys remain optional

## Diagnostics

After Search Now, Source Status is shown whenever the backend reaches the source manager. If the request itself fails, the red Discovery error banner now becomes visible and includes the HTTP status/details. Backend discovery errors also return source diagnostics when available.

## Testing

- JavaScript syntax checks passed.
- Existing source fallback test passed.
- End-to-end handler test with mocked Supabase and public source passed: a fresh Civil Engineer result became a draft and source status reported success.
- No live Vercel/Supabase production claim is made.
