# CivilCareer production overhaul progress

## 29 Sep 2026 — takeover baseline and Phase 2 hardening

- Source package inspected: `civilcareer-india-main (13)`.
- No Git repository metadata was present in the supplied package, so no commit hashes are available.
- Live production fetch was attempted from this environment but DNS/network access failed; no live deployment claim is made.
- Public `index.html` previously contained the full admin dashboard and owner-key UI. This was removed from the public bundle; `/admin` continues to rewrite to the standalone `admin.html`.
- Standalone admin now signs in through Supabase password auth. Server-side dispatcher verifies the Supabase bearer token and allowlists `ADMIN_EMAIL` and/or `ADMIN_USER_ID`; legacy owner key is kept only as a server-side compatibility layer for existing handlers.
- Candidate account login was replaced with password auth (email or Indian mobile), signup, password reset, session persistence and account sync. OTP/magic-link login is not used.
- Public resource submission no longer accepts PDF uploads; links only.
- Public footer no longer exposes the personal Gmail or the placeholder WhatsApp channel.
- Added a public Contact form endpoint with honeypot, input limits and in-memory per-IP throttling.
- Newsletter subscription now uses the server-side Supabase service role instead of the anon key, which is necessary after the database lockdown.
- Added explicit application-tracker `I applied` action and server account sync hook.
- Removed Gulf/overseas choices from the public candidate location/work-preference UI.
- Removed the stale public `next-phase.js` admin probing bundle.
- Removed CSS `@import`; fonts are loaded from HTML `<link>` tags.
- Added clean URL redirects/rewrites for legal, career guides/tools and alerts.
- Updated Exam Alerts sources to current official UPSC/SSC/RRB/Employment News locations, parallelized source fetches, reduced per-source timeout, bounded response size, and batched draft insertion. Results remain unpublished Pending Review.
- Added current free-tier limits documentation in `docs/01-free-tier-limits.md`.
- Added a GitHub Actions Gitleaks workflow.

## Verification

- `npm test`: 19 passed, 0 failed.
- `npm run check:launch`: 0 errors, 1 warning (`SITE_URL` not set locally).
- JavaScript syntax: 48 files checked, 0 failures.
- HTML forms: no duplicate IDs found within forms in the inspected static HTML.
- Public-bundle scan: no owner-key/admin-dashboard/OTP-login strings in the public HTML/app/v8/account scripts.

## Waiting on owner

1. Configure `ADMIN_EMAIL` or `ADMIN_USER_ID` in Vercel Production.
2. Confirm Supabase email/password and phone/password providers are enabled as desired. Disable phone confirmation if a no-OTP phone signup is required; email confirmation is a separate setting.
3. Configure `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `CRON_SECRET` and other production secrets in Vercel/GitHub.
4. Apply any required Supabase SQL only after schema review/backups; this run did not modify production data.
5. Perform the final hosting switch away from Vercel Hobby only with owner confirmation, because current Vercel Terms restrict Hobby to personal/non-commercial use.
