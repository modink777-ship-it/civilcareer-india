# Free-tier limits and production constraints

Checked 30 Sep 2026 against provider documentation. Re-check before any architecture or hosting change.

## Supabase Free

- 2 free projects per organization/account scope.
- 500 MB database size per project; Free projects become read-only after the database-size quota is exceeded.
- 1 GB file storage.
- 5 GB uncached egress + 5 GB cached egress.
- 50,000 monthly active users.
- 500,000 Edge Function invocations.
- Supabase Edge Functions on Free have a 150-second wall-clock limit and 2 seconds of CPU time per request.

Sources: Supabase billing, database-size and Edge Function limit documentation.

## GitHub Actions

- GitHub Free includes 2,000 standard-hosted runner minutes/month and 500 MB artifact storage.
- Standard runners are free for public repositories; private repositories consume the included minute quota.
- Scheduled workflows support intervals down to five minutes, subject to normal scheduling behavior.
- Public repository schedules may be automatically disabled after 60 days without repository activity.

The government pipeline is intentionally bounded and runs every four hours through GitHub Actions. No paid runner or larger runner is used.

## Vercel Hobby

- Hobby currently supports 100 cron jobs per project, but each Hobby cron may run only once per day.
- Hobby cron timing is approximate within the selected hour.
- Current Node.js Function maximum duration is up to 300 seconds with Fluid Compute; the repository intentionally keeps its catch-all function at a lower configured maximum for predictable API behavior.
- Hobby includes a monthly allowance for function invocations and compute resources; the project must remain within those limits to stay at ₹0.
- Vercel's current Hobby plan is intended for personal/non-commercial use. If CivilCareer becomes commercial, hosting terms must be reviewed before monetization.

The government crawler therefore does **not** depend on Vercel sub-daily cron.

## Zero-cost design response

- GitHub Actions: scheduled government crawl every four hours.
- Vercel: public application/API and daily-compatible cron tasks only.
- Supabase: structured queue and approved records; no stored PDFs.
- No paid scraping API.
- No paid LLM requirement.
- No paid browser automation.
- No paid UI library.
