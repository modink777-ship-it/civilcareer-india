# Phase 5 — Candidate Accounts

CivilCareer now has an optional account layer. Guests remain fully usable and retain localStorage behavior. A candidate can sign in with a Supabase magic link to sync:

- Civil engineering profile
- Saved jobs
- Viewed-job events
- Tracked applications

## Safety model

- No CivilCareer password is collected or stored.
- The browser uses Supabase Auth only after the candidate chooses Sign in.
- `/api/account` verifies the bearer token against Supabase Auth before using the service-role key for database operations.
- The service-role key never reaches the browser.
- Account API responses are private/no-store.
- Existing guest localStorage remains the fallback when the candidate is not signed in.

## Database migration

`supabase-v11-account-layer.sql` is additive and must be reviewed/applied deliberately in Supabase. This package does **not** execute a production migration.

## Configuration

The existing server environment must provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Supabase Auth email/magic-link sign-in must be enabled and the deployed site origin must be allowed in the Auth URL configuration.

## Rollout

1. Review and apply the SQL migration.
2. Enable/configure Supabase email authentication and redirect URLs.
3. Deploy this package.
4. Test sign-in, sign-out, profile sync, save/unsave, view tracking and application tracking on desktop and mobile.
5. If Auth is not configured, the rest of CivilCareer continues to work as a guest site; the account button reports that authentication is unavailable.
