# Phase 10 — Final Launch & Live Verification

Date: 2026-09-26

## Result

**Launch is BLOCKED pending deployment of the Phase 9/10 package.**

The currently reachable Vercel deployment was inspected before declaring launch readiness. It is not the Phase 9/10 build.

## Live observations

Current public deployment checked:

`https://civilcareer-india-two.vercel.app/`

Observed on the live homepage and job/government routes:

- Homepage still renders placeholder counters such as `…Active Civil Jobs` and `…Active Govt Civil Jobs`.
- Government route still exposes a `KN` language control.
- Government route still exposes `International` in the private-job scope.
- Live copy still describes the private job landscape as `INDIA + GLOBAL` / `India + Global`.
- Live page still contains `Global MNCs / International opportunities` messaging.
- The currently reachable government page uses the older listing/filter presentation rather than the final stabilized two-pane experience.
- The live About content also contains the older India-and-global wording.

These observations are direct live-page checks, not repository assumptions.

## API checks

The web inspection environment could not directly retrieve the deployed `/api/health` and `/api/jobs` endpoints, so their production response status was **not asserted**.

Do not treat local tests as proof that production environment variables, Supabase connectivity, migrations, or Vercel functions are configured.

## Required launch sequence

1. Deploy the Phase 9/10 package to the intended Vercel project.
2. Confirm production environment variables, especially `SITE_URL`, Supabase URL/key, and owner/admin configuration.
3. Apply additive Supabase migrations in the documented order only after backup/rollback readiness is confirmed.
4. Verify `/api/health` returns ready status.
5. Verify `/api/jobs?summary=1` returns real counts rather than placeholders.
6. Verify private jobs have India-only scope and no International option.
7. Verify government jobs use the final two-pane interaction.
8. Verify For You/account flows with a test candidate account.
9. Verify employer verification and candidate reporting flows.
10. Verify robots.txt, sitemap.xml, canonical URLs, and representative JobPosting pages.
11. Verify mobile navigation, service worker update, and PWA install behavior.
12. Run the production smoke-test checklist before announcing launch.

## Rollback

Keep the previous known-good Vercel deployment available until the full smoke test passes. If a critical regression appears, revert the deployment rather than modifying production data.
