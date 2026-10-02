# CivilCareer Operations Runbook

## Daily owner routine
1. Open the protected Admin review queue and clear `Pending` / `needs_info` government items.
2. Open Social and review Truth Lock failures, `uncertain`, `needs_second_step`, and daily-cap headroom.
3. Review the crawler health panel for source errors, 403/429 stops, robots changes, and stale sources.
4. Review the stale-listing sweep for government and private listings not re-checked within 30 days.
5. Confirm the public `/api/health` endpoint is healthy.

## Backups
The GitHub Actions workflow `Private Supabase Backup` exports key tables to a private workflow artifact. The artifact is retained for 7 days. It requires GitHub Actions secrets named `CIVILCAREER_SUPABASE_URL` and `CIVILCAREER_SUPABASE_SERVICE_KEY`.
Never commit the exported JSON or service key. If a restore is needed, use the verified backup plus the Supabase-supported recovery/export tools and validate representative row counts before reopening writes.

## Monitoring
`CivilCareer Site Health` runs hourly against the production home page and `/api/health`. A failed run should be treated as an operational incident. GitHub Actions email/notification settings are the owner-side alert channel.

## Social credentials
Telegram, LinkedIn, and Instagram credentials remain server-side Vercel environment variables. A LinkedIn or Meta token must be considered NOT CONFIGURED until the official connection/read call succeeds and one controlled real post is verified by the owner.

## Kill switch and recovery
Use the Social Admin kill switch before investigating an unsafe publish queue. Do not automatically retry `uncertain` rows. Verify on the platform first, then mark the same ledger row sent/failed/cancelled or retry it through the existing Admin action.

## Hosting and free-tier constraint
The implementation is designed for Vercel Hobby, GitHub Actions Free, and Supabase Free. Current Vercel Hobby terms should be re-checked before any commercial monetization; commercial use may require a different hosting plan or provider.

## Credential rotation
Rotate compromised credentials before rewriting history. The canonical variable-name list is in `docs/secret-rotation-list.md`.