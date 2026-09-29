# Free-tier limits and production constraints

Checked 29 Sep 2026 against provider documentation. These limits can change; re-check before a hosting or architecture switch.

## Supabase Free
- 500 MB database size per project; Free projects enter read-only mode above the database-size quota.
- 5 GB uncached egress + 5 GB cached egress.
- 1 GB file storage.
- 50,000 monthly active users.
- 500,000 Edge Function invocations.
- Free projects can pause after 1 week of inactivity; two active projects are listed on the current pricing page.
Source: Supabase pricing and billing documentation.

## GitHub Actions
- GitHub Free currently includes 2,000 GitHub-hosted runner minutes/month for private repositories.
- Standard GitHub-hosted runners are free for public repositories.
- Artifact storage on GitHub Free is 500 MB.
Source: GitHub Actions billing/product-usage documentation.

## Cloudflare Pages
- Free Pages: 500 builds/month, 1 concurrent build, 20,000 files/site, 25 MiB max individual asset, and unlimited active preview deployments.
- Static asset requests are free; Pages Functions count against the Workers Free request quota. Current Cloudflare documentation describes the Free Workers quota as 100,000 requests/day.
Source: Cloudflare Pages limits/pricing documentation.

## Vercel Hobby
- Current Vercel Terms state that Hobby is for personal or non-commercial use. CivilCareer should therefore prepare for a move to Cloudflare Pages/another suitable host before treating the platform as a commercial service.
Source: Vercel Terms of Service, Hobby plan section.

## Design response
- Keep database reads bounded and paginated.
- Avoid storing PDFs uploaded by the public; use links instead.
- Cache public summaries and static assets.
- Run scheduled discovery in GitHub Actions with bounded work per run.
- Treat provider quotas as hard limits and fail gracefully rather than assuming paid overages.
