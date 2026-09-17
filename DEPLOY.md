# CivilCareer Premium V7 — Phase 1 MVP

This build implements the final master specification as a focused Phase 1 MVP. It intentionally does not add user accounts, payments, advertising, social networking, premium subscriptions or fake analytics/revenue.

## Included

- Premium mobile-first redesign and clean routes
- Civil-engineering-only private jobs
- Karnataka government jobs across departments
- Exams and free study materials
- Universal search and focused filters
- Source verification dates and automatic closed status after deadlines
- Moderated employer and resource submissions
- Private content reports
- Protected single-owner dashboard
- Real privacy-conscious first-party analytics (no fake numbers)
- SEO metadata, sitemap, robots.txt and security headers
- English/Kannada interface foundation

## Deploy

1. In Supabase SQL Editor, run all of `supabase-v7.sql` once.
2. Replace the GitHub repository contents with this package while preserving the existing environment variables.
3. Verify Vercel has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `OWNER_KEY` for Production.
4. Optional AI exam extraction: add `GEMINI_API_KEY`. Never expose it in GitHub or screenshots.
5. Vercel deploys automatically after the commit.

## Admin

The admin dashboard is intentionally not linked publicly. Open:

`https://civilcareer-india.vercel.app/admin`

Enter the existing owner key. The key is checked by server APIs and kept only in the browser tab session.

For stronger multi-user administration later, migrate to Supabase Auth with MFA and role-based permissions.

## Analytics

After the SQL migration, page views are stored in `analytics_events` without raw IP addresses or full referrer URLs. The admin dashboard shows real totals, visitors, devices, countries, top pages and referring domains. When analytics cannot connect, the dashboard shows an error instead of invented values.

## Important launch checks

- Verify every government source URL and last-verified date.
- Do not mark an item verified unless you personally checked the official source.
- Test employer, resource and report forms.
- Test desktop and mobile navigation.
- Confirm expired deadlines display Application Closed.
- Obtain legal review before monetization, ads or payments.
