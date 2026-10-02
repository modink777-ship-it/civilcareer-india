# CivilCareer Production Deployment

## Source of truth
Deploy the merged `main` branch after the full phase stack has green CI.

## Vercel Production variables
Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OWNER_KEY, ADMIN_EMAIL and/or ADMIN_USER_ID, SITE_URL, CRON_SECRET, SOCIAL_CRON_SECRET, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID.
Optional: LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, LINKEDIN_API_VERSION, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_API_VERSION.

## GitHub Actions secrets
Add the server-side values required by the government pipeline and private backup workflow. Do not duplicate real production social destinations into Preview.

## Supabase
The owner-supplied `supabase-v27-social-engine.sql` is frozen and already applied. Do not edit it. Run `docs/rls-audit.sql` as an owner verification step.

## Preview
Use Preview-only Telegram credentials: TELEGRAM_TEST_CHANNEL_ID without TELEGRAM_CHANNEL_ID. Social publishing is approval-gated in every environment.
Verify Admin authentication, Exam Tracker, government detail pages, Social preview, Truth Lock, kill switch, ledger, legal pages and no-secret responses before merging.

## Production smoke test
After Vercel promotion, verify `/`, `/government-jobs`, one active government detail URL, `/exam-tracker`, `/privacy`, `/terms`, `/disclaimer`, `/api/health`, Admin and the Social queue.
Then run one controlled real Telegram, LinkedIn member and Instagram post as documented in `docs/FINAL-REPORT.md` and `SOCIAL-ENGINE-RUNBOOK.md`.

## Current connector note
The connected Vercel integration currently returns HTTP 403 for the `modinsaheb` scope, so production promotion cannot be honestly confirmed from this session until that scope is re-authenticated.