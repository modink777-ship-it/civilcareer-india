# CivilCareer — All Phases One-Shot Foundation

This build consolidates the roadmap into one deployable foundation: discovery/drafts, job intelligence, government tracking, professional career hub, alerts, trust/verification, system health, expiry automation, SEO/PWA continuity and the existing visual system.

## Database migration
Run `supabase-v9.sql` once in the Supabase SQL editor after the existing V8 migration. The public site remains usable if optional tables are not yet present; alert/admin panels will report configuration errors until the migration is applied.

## ₹0 rule
No paid API or automatic billing is enabled. Gemini currently offers a free tier, while Google also documents paid tiers and limits; do not enable billing if CivilCareer must remain ₹0. citeturn0search13

Jobicy currently documents a public no-key REST API for remote jobs and requires retaining its canonical source URL. citeturn0search8

## Image licensing
Unsplash states that its standard images are free for most commercial uses without mandatory attribution, but people, trademarks, logos and other depicted rights can require separate permission. The license also prohibits compiling images to replicate a competing image service. citeturn0search0turn0search1turn0search4

## Scheduled maintenance
`api/automation.js` expires published jobs whose deadline/expiry has passed. The included GitHub Actions workflow calls it hourly using `CIVILCAREER_SITE_URL` and `CRON_SECRET` repository secrets.

## New public route
`/career-hub` is the new Civil Engineer Career Command Center.


## Career Hub status
Temporarily hidden from public navigation and routing. Feature code remains preserved for future relaunch.
