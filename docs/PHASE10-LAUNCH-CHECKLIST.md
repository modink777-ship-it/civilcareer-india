# CivilCareer Phase 10 — Launch Checklist

## Before deployment
- [ ] Use the Phase 9/10 package, not the older live ZIP.
- [ ] Confirm production Vercel project and domain.
- [ ] Confirm all required environment variables.
- [ ] Confirm Supabase backup/recovery path.
- [ ] Review additive migrations v11, v12 and v13 before execution.

## Database
- [ ] Apply migrations in order: account layer, alerts/retention, employer trust.
- [ ] Confirm RLS policies.
- [ ] Confirm existing jobs, exams, resources and submissions remain intact.
- [ ] Confirm no destructive migration is included.

## API
- [ ] `/api/health` ready.
- [ ] `/api/jobs?summary=1` returns numeric active counts.
- [ ] Public job API excludes expired/private admin-only fields.
- [ ] Pagination and filters return expected results.
- [ ] Account endpoints reject unauthenticated access appropriately.
- [ ] Alert endpoints do not leak private data.

## Public UX
- [ ] English only.
- [ ] India-only private jobs.
- [ ] No International private-job scope.
- [ ] Private jobs: compact left cards + right detail pane.
- [ ] Government jobs: compact left cards + right detail pane.
- [ ] No match percentages.
- [ ] Viewed state is explicit.
- [ ] For You uses account personalization when signed in.
- [ ] Guest browsing still works.

## Trust
- [ ] Employer verification badges only appear for approved profiles.
- [ ] Source/application URLs remain original/validated.
- [ ] Scam/reporting workflow works.
- [ ] No job is published automatically from AI extraction.

## SEO/PWA
- [ ] robots.txt valid.
- [ ] sitemap.xml valid and current.
- [ ] Canonical job URLs resolve.
- [ ] JobPosting schema contains only supported salary units.
- [ ] Service worker activates the new cache version.
- [ ] Mobile layout and navigation pass manual checks.

## Launch decision

Do not announce production launch until all blocking items are checked and the live deployment is confirmed to match the Phase 9/10 package.
