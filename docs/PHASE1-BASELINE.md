# CivilCareer Phase 1 — Baseline

## Repository
- Stack: Vanilla HTML/CSS/JavaScript, Node.js serverless functions, Vercel, Supabase PostgreSQL.
- API surface: jobs, agent, analytics, employer submissions, extraction, exams, materials, reports, resource submissions, sitemap, subscriptions, Telegram.
- Service worker: `/service-worker.js`.
- Production site configured through `SITE_URL`, defaulting to `https://civilcareer-india-two.vercel.app`.

## Phase 1 observations
1. Public jobs API previously returned all `published=true` rows without server-side expiry filtering.
2. Public single-job JSON previously returned the full database row, creating risk for private/admin fields.
3. `/api/extract` previously allowed unauthenticated callers to trigger external URL fetches and the configured AI API.
4. `/api/agent` used a browser-supplied session identifier as the sole selector for profile/interactions data; it is not authentication.
5. Service worker contained two `fetch` listeners; navigation requests could be handled by both listeners.
6. Server-rendered job pages reference `css-fixes.css`, and the stylesheet is actually present in the repository. Therefore the reference is not removed in this phase; cleanup notes are stale/inconsistent with the actual repository.
7. Owner-key authentication is still the existing shared-key model; Phase 1 hardening adds constant-time comparison and lightweight failure limiting without changing the authentication architecture.

## Not verified from repository alone
- Live Supabase migration state
- Live database row counts
- Successful production backup
- Live environment variable values
- Live traffic/latency measurements

These require access to the production Supabase/Vercel projects.
