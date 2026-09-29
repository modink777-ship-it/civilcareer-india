# Admin and write-security design

## Admin authentication
- `/admin` serves the standalone admin UI only.
- Admin login uses Supabase email/password authentication.
- The catch-all API dispatcher verifies the Supabase bearer token against `/auth/v1/user`.
- Access is allowlisted by `ADMIN_EMAIL` and/or `ADMIN_USER_ID` environment variables.
- Legacy owner-key handlers are retained as a server-side compatibility layer; the owner key is never embedded in public HTML or public JS.

## Public writes
- Employer submissions, resource submissions and reports remain public submission endpoints and create reviewable records only.
- Resource submissions accept public URLs, not file uploads.
- Contact uses honeypot, input length limits and bounded per-IP throttling.

## Candidate account data
Candidate profile/saved/viewed/application/alert endpoints use the candidate's Supabase bearer token and server-side service-role access.

## Secrets
No production secrets are committed. `ADMIN_EMAIL`, `ADMIN_USER_ID`, Supabase keys, cron secrets and optional provider credentials belong in deployment secret stores.
