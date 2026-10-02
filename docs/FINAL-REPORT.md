# CivilCareer — Final P13 Report

Date: 2026-10-02
Repository: modink777-ship-it/civilcareer-india
Target URL configured by the repository: https://civilcareer-india-two.vercel.app

## Phase status

| Phase | Branch | Verified head | CI/tests | Status |
|---|---|---|---|---|
| P0 | audit | e92dec0389bf4baf4735830f94a26afb8acab7cf | baseline/gap audit recorded | IMPLEMENTED |
| P1 | security-hardening | ad7d80bcffd1c8a9693e9e4cf2d3ad2bee4d06a9 | security suite + CI green | TESTED |
| P2 | social-engine | 6606ff51a09a98704d5b6513682f1294f2b0b74f | social phase tests green | TESTED |
| P3 | social-engine (name collision resolution) | 6606ff51a09a98704d5b6513682f1294f2b0b74f | radar, bundle, CI blockers fixed | TESTED |
| P4 | social-engine-3 | 2185f09ec71c944836150db0dd8c5ba52b624252 | graphics CI green | TESTED |
| P5 | social-engine-4 | ee05187b50b7a2885913e6e39aa4c63a42a88aab | LinkedIn member tests green | TESTED |
| P6 | social-engine-5 | 6e970062e4a20459ca77312fe541bcdee6ab2246 | Instagram Login tests green | TESTED |
| P7 | social-engine-6 | fbf76b832f2fa80452abdc84228d7556dc66238a | Daily Radar preview tests green | TESTED |
| P8 | govt-pipeline | 7ef108380ef25bf4cb5c4164da9ba33f94d10306 | government pipeline CI green | TESTED |
| P9 | govt-public-pages | 0ff3440b60c94cef3f68668dbf5b9869ba796d18 | public-page CI green | TESTED |
| P10 | seo-performance | fb0ab1810a1457bd3159803fd3eedbbaa00623b5 | SEO/schema/sitemap CI green | TESTED |
| P11 | trust-legal | 94464291e6bb6a37759db797d70a85b6aea4998e | legal/trust CI green | TESTED |
| P12 | operations | fef916adda938da6caf391033e8f9495cfd1bfcd | operations CI green | TESTED |
| P13 | docs-final | ffad8ab254348cf1086b2e5f6f4344f48982f734 | final CI pending after this report update | IN PROGRESS |

## What is now implemented

- Exam Tracker dashboard, saves, filters and alerts.
- Social Engine with verified-source gating, Truth Lock, approval, ledger, caps, kill switch and duplicate prevention.
- Telegram publishing through the official Bot API.
- LinkedIn personal-profile publishing path using member credentials.
- Instagram Login publishing path with JPEG media, two-step container flow, 60-second polling guard and 24-hour expiry.
- SVG templates plus JPEG export and public Supabase Storage upload.
- Daily Radar preview with zero database writes and zero sends.
- Government Agent Reach pipeline hard-negative exclusion, unknown-to-needs_info handling and automatic expiry sweep.
- Server-rendered government public pages and route aliases.
- Government `JobPosting` structured data on active detail pages and dynamic government sitemap URLs.
- Standalone Privacy, Terms and Disclaimer pages plus consent notices.
- Private backup workflow, hourly health checks and operator runbooks.

## Frozen SQL
`supabase-v27-social-engine.sql` and its rollback remain frozen and were not edited during the later phases. The owner-supplied v27 schema is already applied in Supabase.

New government work used the existing government tables; no v28 migration was required by the implementation in this pass.

## Owner checklist — Supabase

1. Confirm the already-applied v27 schema using the repository verify queries. Do not rerun or edit the frozen v27 SQL unless you intentionally need a rollback.
2. Run `docs/rls-audit.sql` in Supabase SQL Editor and confirm zero unexpected anon/authenticated table privileges plus RLS enabled on public tables.
3. Configure the `social-graphics` Storage bucket only if the first real graphics upload is needed; the P4 endpoint can create it with the service role.
4. Confirm the existing government tables contain the current approved/reviewed records before exposing new public government detail pages.

## Owner checklist — Vercel Production

Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_KEY`, `ADMIN_EMAIL` and/or `ADMIN_USER_ID`, `SITE_URL`, `CRON_SECRET`, `SOCIAL_CRON_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `LEGACY_TELEGRAM_AUTOPOST=false`.
Optional social: `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_API_VERSION=202609`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_API_VERSION=v26.0`.

Preview environment: use a preview `SITE_URL`, `LEGACY_TELEGRAM_AUTOPOST=false`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_TEST_CHANNEL_ID`. Do not provide `TELEGRAM_CHANNEL_ID` to Preview.

## Owner checklist — GitHub Actions

Repository secrets required by the government/social/backup workflows must be added separately from Vercel environment variables. Never commit their values.
Review scheduled workflows after repository inactivity because GitHub may disable scheduled workflows in public repositories.

## Owner checklist — first real platform tests

Telegram: publish one legitimate approved suggestion to the controlled destination and record the result.
LinkedIn: connect the member app, store the token/author URN in Vercel, publish one controlled approved suggestion, record token expiry.
Instagram: connect the Professional account via Instagram Login, publish one controlled approved JPEG suggestion, record token expiry.
Do not count mocked CI tests as real social publication tests.

## Token/account setup

- Telegram: bot administrator permission in the destination channel; create an isolated test channel for Preview.
- LinkedIn: developer app plus official member sharing permission for the personal profile.
- Instagram: eligible Professional account plus Meta/Instagram Login configuration.
- Cloudflare Turnstile: site key and secret key for public forms.

## Merge order

Merge the verified branches into `main` in this order so each phase contains its predecessors:
`audit` → `security-hardening` → `social-engine` → `social-engine-3` → `social-engine-4` → `social-engine-5` → `social-engine-6` → `govt-pipeline` → `govt-public-pages` → `seo-performance` → `trust-legal` → `operations` → `docs-final`.

The `social-engine-2` name collision is documented in the P0 gap report: the existing `social-engine` branch was reused for the P2/P3 sequence instead of deleting or replacing it.

## Preview tests

1. Open `/` and `/government-jobs` on mobile and desktop.
2. Open one active government detail URL and confirm Reviewed on, civil-post counts, source link and JobPosting JSON-LD.
3. Open `/exam-tracker` and test save/star, filtering, My Exams and Alert Me.
4. Open Admin → Social and test preview, Truth Lock, approval, ledger, kill switch and daily caps without publishing.
5. Run Daily Radar Preview and confirm writes=0 and sends=0.
6. Verify Preview does not have the production Telegram destination.
7. Confirm `/privacy`, `/terms`, `/disclaimer` resolve.

## Open/partial items

- Vercel production promotion from this environment is blocked by the connected Vercel scope returning HTTP 403 for the `modinsaheb` scope. I cannot honestly claim the production deployment completed until that Vercel authorization is corrected.
- Browser-level live smoke testing of the latest deployment is also blocked by the same Vercel scope/access issue.
- Real LinkedIn and Instagram posts remain owner-side tests because credentials and external platform confirmation are required.
- Mobile Lighthouse 85+ was not measured in this environment; the code changes and CI tests are verified, but no Lighthouse score is claimed.
- `lib/supabase.js` is a dead CommonJS/ESM compatibility candidate and should be removed only after owner review.

## Production deployment state

`main` has not been touched by this phase stack yet. The intended release action is a merge of the verified `docs-final` branch into `main`, followed by the connected Vercel Production deployment.

Because the Vercel connector currently returns `403 Not authorized` for the `modinsaheb` scope and the team listing is empty, this report does not falsely claim a successful production promotion.