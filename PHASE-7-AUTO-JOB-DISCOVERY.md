# CivilCareer Phase 7 — Automatic Job Discovery

## What this does
Every 6 hours GitHub Actions searches the public Google News RSS index for fresh civil-engineering vacancies and creates **unpublished Draft jobs** in the existing Supabase `jobs` table.

The Admin > Jobs screen automatically shows **Fresh jobs found in the last 24 hours** at the top. You review each lead and publish only the vacancies you approve.

## Sources / coverage
The discovery queries cover general public indexing plus searches targeting LinkedIn Jobs, Naukri, Indeed, Foundit, TimesJobs, Shine, Apna, WorkIndia, Freshersworld and Indian government domains. This is discovery through public indexed results, not direct scraping or login automation.

It is not technically possible to guarantee every vacancy from every job board at zero cost. LinkedIn explicitly prohibits unauthorized scraping and automated copying, so CivilCareer does not bypass those controls. https://www.linkedin.com/legal/user-agreement

## Cost
No paid search API and no AI API is required. The workflow uses GitHub Actions plus public Google News RSS and the existing Supabase service-role secret.

## Admin experience

Open Admin > Jobs to see a **Fresh jobs found in the last 24 hours** block. The Discovery tab also reflects the same automatically collected draft leads. Review and publish explicitly.

## Secrets required
The existing GitHub repository secrets must contain:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

No new secret is required.

## Safety
- New discoveries are always `published=false`.
- Status is `Pending Review`.
- Duplicate `source_url` values are skipped.
- Results older than roughly 26 hours are skipped to provide a small scheduling tolerance around the 24-hour window.
- No existing published jobs are changed.
- No Supabase schema migration is required.
