# CivilCareer Phase 9 — Production Readiness & Launch Hardening

## Scope

This phase hardens the existing CivilCareer stack for deployment. It does not claim that production is live or that a real Supabase migration has been executed.

## Changes

- Added `GET /api/health` as a non-secret configuration readiness check.
- Added `.env.example` documenting required and optional environment variables.
- Added `scripts/launch-check.js` for JSON, security-header, sitemap, required-file, browser-secret, robots and JavaScript syntax checks.
- Added npm scripts for launch checks and tests.
- Hardened `/api/subscribe` input validation and removed upstream database error leakage.
- Changed `/api/auth-config` to `no-store` and restricted it to GET.
- Added Phase 9 regression tests.

## Production migration status

No production database migration was executed. The SQL migrations from earlier phases remain separate and must be applied deliberately after a backup/recovery check.

## Required Vercel configuration

Set at minimum:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_KEY`
- `SITE_URL` using the final canonical CivilCareer HTTPS domain

Configure optional discovery/AI/Telegram variables only when the corresponding feature is enabled.

## Launch procedure

1. Deploy the Phase 9 package to a preview environment.
2. Confirm `/api/health` returns HTTP 200 and no missing required variables.
3. Apply required Supabase migrations only after backup/recovery validation.
4. Run public API smoke tests for jobs, summary, sitemap and authentication configuration.
5. Run admin authentication and mutation smoke tests.
6. Test private and government two-pane explorers on mobile and desktop.
7. Verify canonical URLs, robots and sitemap output.
8. Verify service worker cache version and hard-refresh behavior.
9. Promote to production only after preview checks pass.
10. Keep the immediately previous deployment available for rollback.

## Not claimed by this phase

- No live production uptime/SLO measurement.
- No live database backup verification.
- No production migration execution.
- No real email/SMS delivery guarantee.
- No external paid monitoring service.
