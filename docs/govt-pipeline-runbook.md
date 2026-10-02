# Government Pipeline Runbook

This is the operator entry point for government civil-job discovery and review. The historical detailed runbook remains in docs/07-govt-pipeline-runbook.md.

## Schedule
- GitHub Actions: .github/workflows/govt-pipeline.yml
- Every 6 hours
- Manual workflow_dispatch available

## Flow
Official/lead source → Agent Reach/discovery → civil classifier → government staging → Admin review → approved govt_jobs → public government pages

Hard-negative civil classifications are excluded from staging. discipline_unknown remains reviewable as needs_info.

## Source rules
Official government and PSU sources are authoritative for publishable facts. Aggregators provide leads only and do not become the source of publishable facts.
Respect robots.txt. Do not bypass 403/429. Keep the configured delay between requests to the same host.

## Review states
- Pending
- Needs info
- Approved
- Rejected
- Duplicate

Nothing becomes public until a reviewer approves it.

## Expiry
The cron-protected /api/govt-expiry sweep closes active government rows after their fixed apply_end date.

## Incident handling
1. Inspect govt_sources.last_status and last_error.
2. Verify the official source URL.
3. Do not bypass robots or platform limits.
4. Fix source configuration only after policy review.
5. Rerun the workflow manually.

## Classifier changes
Edit lib/civil-classifier.js only with fixture coverage. Run npm test. Negative fixtures must remain excluded; unknowns must remain reviewable.

## Secrets
Server-side GitHub/Vercel values: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, CRON_SECRET. Never print, log or commit secret values.