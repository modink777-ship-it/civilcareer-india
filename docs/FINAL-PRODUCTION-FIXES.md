# CivilCareer — Final Production Fixes

This package contains the final source-level fixes applied after the production/log review on 26 September 2026.

## Fixed in source

1. **Candidate account sign-in**
   - Email/Gmail + password and Indian mobile + password remain the only sign-in methods.
   - No OTP or magic-link sign-in.
   - `/api/auth-config` now supports `SUPABASE_URL`/`SUPABASE_ANON_KEY` plus public-key aliases and returns an actionable configuration error.
   - Account loading retries once and provides a Retry button instead of leaving the user at a dead error state.

2. **For You View Details**
   - Generic card binding now resolves jobs from authenticated `window.__ccRecommendations` as well as the other explorer caches.
   - This fixes the case where a personalized recommendation could render but its View Details button had no matching job object.

3. **Exam Alerts 504 timeout**
   - Source fetches run concurrently.
   - Per-source timeout is bounded to 4.5 seconds.
   - Existing exam titles are read once.
   - New drafts are written with one bounded bulk insert instead of one request per draft.
   - Cron/admin authentication remains supported.
   - All discovered exams remain `published=false` and `review_state='Pending Review'`.

4. **YouTube transcript ingestion**
   - Accepts watch, Shorts, embed and youtu.be URLs.
   - Reads public caption tracks when exposed.
   - Adds a YouTube timed-text fallback for auto-caption tracks.
   - Returns HTTP 422 with a clear message when the video genuinely exposes no usable public captions/timed-text instead of an opaque 500.
   - Successful transcripts are still saved as unpublished `Pending Review` materials.

5. **Admin authentication hardening**
   - Exam alerts, YouTube materials, reports, employer submissions, analytics, resource submissions and employer admin operations now use the shared hardened owner-key check where applicable.
   - Public candidate/user paths in the alerts endpoint remain accessible without an owner key.

## Verified

- `npm test`: **20 passed, 0 failed**
- JavaScript syntax checks: **passed**
- Admin HTML inline script syntax checks: **passed**
- `npm run check:launch`: **0 errors, 1 warning**
- Remaining launch warning: local `SITE_URL` is not set; configure production `SITE_URL` in Vercel.

## Production configuration still required

Source code cannot set Vercel/Supabase account settings. Before declaring production complete:

- Vercel Production must contain `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_KEY`, `SITE_URL`, and `CRON_SECRET` as appropriate.
- Supabase Auth must enable email/password and phone/password providers.
- Disable phone confirmation if the intended signup experience must not require phone OTP.
- If email confirmation is enabled, new email accounts still need the normal confirmation link before password login is allowed.
- Apply/review the additive V15 production-hardening SQL against the actual production schema before execution; do not blindly run migrations.
- Deploy this package to the same Vercel project and run live smoke tests for `/api/health`, `/api/jobs`, account sign-in, Private Jobs, Government Jobs, exam scan and YouTube ingestion.

## Important limitation

A YouTube video that exposes neither public captions nor a YouTube timed-text track cannot be reliably transcribed by this server-side implementation. Such a video must provide captions/auto-captions or be supplied with a transcript through a separate approved ingestion workflow.
