# Government Pipeline Runbook

## Purpose

Agent Reach discovers candidate civil-engineering government notifications, extracts facts from official sources, classifies civil relevance, and places records into the private government review queue. It never publishes directly.

## Schedule

- GitHub Actions workflow: `.github/workflows/govt-pipeline.yml`
- Scheduled every 6 hours.
- `workflow_dispatch` is available for a manual run.
- Private-job discovery remains separate and is not changed by this schedule.

## Required GitHub Secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`

Never print or commit secret values. The service-role key is server-side only.

## Add an official source

1. Add the source to `config/govt-sources.json`.
2. Use `type: official` for authoritative government/PSU sources.
3. Verify the source URL and its `robots.txt` before enabling it.
4. Keep aggregators as `aggregator_lead`; they are lead-only and must not supply publishable facts.
5. Run the workflow manually and inspect the GitHub summary plus Supabase `govt_sources` health fields.

## Crawl behavior

- At least 2 seconds between requests to the same host.
- `ETag` and `Last-Modified` values are persisted in `govt_sources` and sent on later runs.
- HTTP 403/429 stop the affected source run; no bypass is attempted.
- Network and 5xx failures use bounded exponential backoff.
- `robots.txt` is checked before the source page is fetched; failures fail closed.
- Full PDFs are never stored in Supabase; PDF text is temporary and the file is deleted after extraction.
- Scraped content is treated as untrusted data.

## Review flow

1. Pending: candidate requires human review.
2. Needs info: discipline/date/source information is unresolved.
3. Approved: reviewer has verified the official notification and can publish.
4. Rejected: reviewer records the reason.
5. Duplicate: merge/reconcile with the existing notification.

Nothing is public until the reviewer approves it.

## Rerun a failed crawl

1. Open GitHub Actions → Government civil notification pipeline.
2. Select **Run workflow**.
3. Inspect the run summary and the failed source in `govt_sources.last_status/last_error`.
4. If the source is blocked by robots, do not override it manually. Fix the source configuration only after verifying the official policy.

## Tune classifier keywords

Edit `lib/civil-classifier.js`, then run:

```bash
npm test
```

Negative fixtures must remain excluded and unknown fixtures must continue to land in `needs_info`.

## Rotate keys

1. Create the new Supabase/GitHub/Vercel secret value.
2. Update the corresponding GitHub Secret or Vercel environment variable.
3. Deploy/test the pipeline.
4. Revoke the old value.
5. Never place either value in source files, logs, issues, or chat.
