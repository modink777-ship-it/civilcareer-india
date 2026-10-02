# CivilCareer — India-only Civil Engineering Platform

CivilCareer is an India-only civil-engineering jobs and career platform using vanilla HTML/CSS/JS, Node.js CommonJS serverless functions, Supabase and Vercel.

## Current architecture
- Public pages are static HTML shells plus server-rendered API responses where crawlability matters.
- `api/[[...path]].js` is the single Vercel dispatcher for `_api/*` handlers.
- Supabase is the database and public browser code never reads tables directly.
- Government discovery uses Agent Reach plus the existing government pipeline and a shared civil classifier.
- Exam Tracker uses `exam_tracker`, local saves and server-side alerts.
- Social publishing flows through the Social Engine: verified source → Truth Lock → human approval → platform publisher → ledger.
- Telegram is supported; LinkedIn personal-profile and Instagram Login publishers are implemented but require owner-side credentials and controlled real-post verification.
- WhatsApp is manual-share only.

## Production URL
`https://civilcareer-india-two.vercel.app` is the current Vercel site URL used by the repository configuration.

## Free-first operations
Vercel Hobby, Supabase Free and GitHub Actions are the intended deployment/operations baseline. Sub-daily jobs use GitHub Actions rather than Vercel Hobby cron scheduling.

## Environment
Required server-side production values include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_KEY`, `ADMIN_EMAIL` and/or `ADMIN_USER_ID`, `SITE_URL`, `CRON_SECRET`, `SOCIAL_CRON_SECRET`, Turnstile keys and Telegram variables.
Optional social variables are `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_API_VERSION`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` and `INSTAGRAM_API_VERSION`.
`LEGACY_TELEGRAM_AUTOPOST=false` is the Social Engine transition setting.

## Government pipeline
Government records are not public until human review. Hard negatives are excluded from staging; `discipline_unknown` remains reviewable as `needs_info`. Expired fixed-deadline government rows are closed by the protected expiry sweep.

## Social Engine
See `SOCIAL-ENGINE-README.md` and `SOCIAL-ENGINE-RUNBOOK.md`.

## Exam Tracker
`/exam-tracker` provides category filters, saved exams, My Exams, save/star actions and Alert Me. The API is `_api/exam-tracker.js`.

## Legal
Standalone pages: `/privacy`, `/terms`, `/disclaimer`, plus the existing legal centre.

## Testing
Run:
```bash
npm install --no-audit --no-fund
npm run check:syntax
npm test
```

CI runs syntax checks and the full `node:test` suite on pushes and pull requests.

## Operations
See `docs/OPERATIONS-RUNBOOK.md` for backups, monitoring, incident handling, credential rotation and the daily owner routine.

## SQL
`supabase-v27-social-engine.sql` is the frozen, already-applied Social Engine schema and must not be edited. New migrations start at v28.

## Deployment
Use `DEPLOY.md` plus `docs/FINAL-REPORT.md`. Production secrets belong in Vercel/GitHub secret storage only; never commit or paste secret values.