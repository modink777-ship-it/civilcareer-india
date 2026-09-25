# CivilCareer Phase 7 — Alerts & Candidate Retention

## Scope
This phase adds account-linked job-alert preferences and a free notification queue foundation. It does not introduce a paid email/SMS provider.

## Candidate experience
- Signed-in candidates can create/update one alert preference set.
- Alert type: all, private, government.
- Filters: keywords, role, location, frequency.
- Preferences are synchronized server-side with the candidate account.
- Existing guest/local job-alert page remains functional.

## Delivery architecture
`job_alerts` stores preferences. `job_alert_deliveries` stores one pending delivery per alert/job pair. The admin evaluation endpoint (`POST /api/alerts?action=evaluate` with the owner key) evaluates recent published jobs and queues matching deliveries.

The evaluator deliberately does **not** send email. An actual delivery provider is a separate deployment decision. This keeps the current architecture ₹0-first and prevents silently claiming that notifications were delivered when no provider is configured.

## Migration
Run `supabase-v12-alerts-retention.sql` only after the account-layer migration is installed. It is additive and is not executed automatically.

## Safety
- Account endpoints verify the Supabase access token.
- Admin evaluation requires the owner key.
- Responses are private/no-store.
- Alert inputs are bounded and normalized.
- Candidate email is taken from the authenticated account for signed-in alerts.
- No sensitive identity or application documents are stored.

## Verification
The phase test covers alert input normalization, matching, authenticated API structure, queue schema presence, and regression syntax checks.
