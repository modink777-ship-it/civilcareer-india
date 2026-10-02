# CivilCareer Social Engine Runbook

## 1. Production prerequisites
Set these in Vercel Production: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OWNER_KEY, ADMIN_EMAIL and/or ADMIN_USER_ID, SITE_URL, CRON_SECRET, SOCIAL_CRON_SECRET, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, LEGACY_TELEGRAM_AUTOPOST=false, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID.
For LinkedIn: LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, LINKEDIN_API_VERSION=202609.
For Instagram: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_API_VERSION=v26.0.

## 2. Telegram first real test
Use one legitimate verified CivilCareer suggestion. Admin → Social: Preview → inspect Truth Lock → Approve → Send Telegram.
Do not create a fake TEST announcement. A controlled real publication is the final proof.

## 3. LinkedIn first real test
Create/configure the official LinkedIn developer app, authorize the personal profile, obtain the member token and author URN, store both only in Vercel, register/verify the connection in Admin, preview one verified suggestion and publish exactly one controlled real post.
Record token expiry dates after issuance. Do not assume indefinite validity.

## 4. Instagram first real test
Use an eligible Instagram Professional account, complete the official Instagram Login connection, store the access token and account identifier in Vercel, confirm the generated media is a public JPEG, preview and approve, create the container, wait for processing, then use the Admin Publish Instagram container action after the ledger reaches needs_second_step and the container status is FINISHED.
Never use browser automation, cookies, passwords or unofficial wrappers.

## 5. Uncertain/duplicate safety
Never blindly retry an uncertain ledger row. Verify the platform first, then resolve the existing ledger row from Admin.

## 6. Instagram second step
The API enforces a public JPEG media URL, one readiness poll per 60 seconds, container expiry at 24 hours, final publish only after FINISHED, and explicit needs_second_step, expired and uncertain states.

## 7. Daily caps
Default caps are Telegram 5, LinkedIn 2, Instagram 2. Caps use Asia/Kolkata by default. Test rows do not count; uncertain real attempts do.

## 8. Daily Radar preview
Admin → Social → Daily CivilCareer Radar → Refresh Radar Preview. This performs no suggestion inserts and no sends.

## 9. Kill switch
Turn ON the Social Engine kill switch before investigating unsafe content or unexpected publishing. Inspect the ledger before changing credentials or retrying.

## 10. WhatsApp
Supported flow: preview, Copy for WhatsApp, paste manually. Unsupported: WhatsApp Web automation, stored session cookies, browser scripting, unofficial posting wrappers.

## 11. Credential rotation
Rotate at provider, update Vercel/GitHub secret, run the controlled test, revoke the old credential, confirm no secret values exist in logs or repository history.

## 12. Scheduler
The Social Engine drain uses GitHub Actions with SOCIAL_CRON_SECRET. Manual fallback is GitHub Actions → Social Engine Cron → Run workflow or Admin → Social → Run now.

## 13. Troubleshooting
503 Social engine tables missing → confirm v27 is applied in Supabase; do not modify the frozen v27 SQL.
409 source changed since lock → regenerate from the live source and re-approve.
409 content edited since approval → approve the current content again.
429 daily cap reached → wait for the next cap window.
Instagram needs_second_step → wait, then use the Admin second-step action after the 60-second guard.

## 14. Preview environment
Preview uses its own environment variables, preview SITE_URL, LEGACY_TELEGRAM_AUTOPOST=false, TELEGRAM_BOT_TOKEN and TELEGRAM_TEST_CHANNEL_ID. Do not put TELEGRAM_CHANNEL_ID in Preview.
No real production social destination should be present in Preview.

## 15. Shutdown
1. enable kill switch
2. disable scheduled workflow if necessary
3. inspect ledger
4. verify platform state for uncertain rows
5. rotate credentials if exposure occurred