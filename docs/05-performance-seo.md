# Performance and SEO status

## Completed in this run
- Public admin code removed from the public bundle.
- Candidate authentication no longer loads a browser Supabase SDK CDN just to sign in.
- CSS `@import` removed.
- Server-side job pagination/summary and expiry handling from earlier phases retained.
- Clean redirects/rewrites added for legal/career-guides/career-tools/job-alerts paths.

## Remaining production work
- A live Lighthouse mobile before/after run requires a reachable deployed URL; this environment could not resolve the public host during this run.
- SPA route-specific server-rendered metadata/canonicals still needs a production-safe prerender/edge strategy for maximum crawler reliability.
- Search Console verification remains owner-only.
