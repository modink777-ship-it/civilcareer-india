# Phase 7 Manifest

Base: CivilCareer Phase 6 personalization package.

Changed:
- api/alerts.js — authenticated/admin alert API, matching evaluator, pending delivery queueing.
- account.js — signed-in candidate alert preferences UI and sync.
- styles.css — responsive alert controls.
- supabase-v12-alerts-retention.sql — additive alert/delivery schema migration.
- tests/phase7-alerts.test.js — Phase 7 regression checks.
- docs/PHASE7-ALERTS-RETENTION.md — rollout and architecture notes.

No production migration, data deletion, paid service, or email provider was introduced.
