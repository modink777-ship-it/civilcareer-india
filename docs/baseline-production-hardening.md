# CivilCareer production hardening baseline

Date: 2026-09-25
Repository: modink777-ship-it/civilcareer-india
Branch: security/p0-production-hardening

## Baseline snapshot

- Frontend: Vanilla HTML + JavaScript + CSS, single-page app shell in `index.html`, route-driven UI in `app.js`, canonical job explorer in `v8.js`.
- Backend: Vercel serverless functions in `api/*.js` using Supabase REST via service-role key.
- Database: Supabase PostgreSQL with repository SQL migrations (`supabase.sql`, `supabase-v7*`); production state not fully verifiable from repo alone.
- Hosting: Vercel with serverless functions and rewrites via `vercel.json`.
- Current app URL: https://civilcareer-india-two.vercel.app/
- Current deployment model: static site + server functions + Supabase.

## Initial repo findings

- Expiry is not enforced consistently in the public API and render path.
- Public endpoints still rely on `published=true` as the primary gate without a consistent expired/public visibility check.
- Server-rendered job pages still reference `/css-fixes.css` even though the stylesheet was removed.
- `service-worker.js` contains duplicate `fetch` listeners and can issue multiple `respondWith()` calls.
- `api/agent.js` uses wildcard CORS and accepts a raw `x-session-id` with no validation.
- `api/extract.js` fetches arbitrary URLs without SSRF safeguards.
- The repo contains multiple SQL versions and migration drift; production schema must be validated before deeper database work.
- No production backup/recovery workflow was documented in the codebase.

## Proven production priorities

1. Protect public job visibility and expiry.
2. Remove stale references and broken assets.
3. Consolidate service worker logic.
4. Harden CORS and session handling.
5. Add SSRF protections to external URL extraction.
6. Validate schema state before destructive database work.
7. Add a documented backup/recovery process.

## Constraints

- Keep the existing architecture.
- Do not rebuild the app in another framework.
- Do not pay for infrastructure unless a real free-tier limit is reached.
- Implement the smallest safe fix for each production issue.

## Current status

This baseline is recorded before the production-hardening patch set begins. It will be used as the comparison point for the next verification pass.
