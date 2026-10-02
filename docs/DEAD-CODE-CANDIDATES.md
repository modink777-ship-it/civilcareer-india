# Dead-code candidates — review before deletion

- `lib/supabase.js`: legacy ESM-style Supabase helper in an otherwise CommonJS backend; no active imports found during the phase audit. Do not delete until owner confirms no external deployment depends on it.
- Any legacy direct social publisher helpers retained for compatibility: remove only after the Social Engine has completed the owner's real Telegram/LinkedIn/Instagram tests and the legacy transition flags remain unused.
- Historical `supabase-vNN-*.sql` migrations: retain for audit/recovery; do not delete as part of application cleanup.

These are candidates only. No deletion is performed by P13.