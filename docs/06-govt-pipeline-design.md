# CivilCareer Government Civil-Jobs Pipeline Design

Date: 2026-09-30

## 1. Study-first baseline

The current repository uses a single Vercel catch-all API function (`api/[[...path]].js`) that dispatches into `_api/*` handlers. The browser is intended to use API endpoints rather than direct Supabase table access. Government jobs currently share the general `public.jobs` table and the older `/api/govt-discovery` path creates unpublished `jobs` rows with `published=false` / `review_state='Pending Review'`.

The current public government feed (`_api/govt-jobs.js`) filters those general job rows using civil relevance plus official government/PSU source URL validation. It is therefore a publication filter, not a dedicated government-notification data model.

The current admin dashboard has Jobs, Discovery and Agent Reach tabs, but it does not yet have the dedicated government review queue described in the new execution plan.

## 2. Current storage/publish flow

Current flow:

external/provider discovery -> general `jobs` row -> `published=false` + review state -> admin review -> `published=true` -> public job APIs.

This is adequate for private jobs but is too coarse for government notifications because one notification may contain multiple posts/disciplines and because government data needs notification-level provenance, deadline semantics, verification state, and per-post civil classification.

The new pipeline therefore adds separate tables:

- `govt_sources`
- `govt_job_leads`
- `govt_job_staging`
- `govt_jobs`
- `govt_job_posts`

Private-job storage remains untouched.

## 3. Current platform constraints verified on 2026-09-30

### Vercel Hobby

Vercel currently documents 100 cron jobs per project, but Hobby cron jobs may execute only once per day. More frequent cron expressions fail deployment. Hobby cron timing is approximate within the selected hour. citehttps://vercel.com/docs/cron-jobs/usage-and-pricing

Current Node.js Function limits are up to 300 seconds on Hobby when using the current Fluid Compute limits; older/non-Fluid configuration has a lower 60-second maximum. The repository currently pins the catch-all function to 15 seconds, so long crawls must not depend on that function. citehttps://vercel.com/docs/functions/limitations

The current repository already has a GitHub Actions workflow scheduled every four hours. That is the correct place for sub-daily government discovery under a strict ₹0 requirement; Vercel can remain a once-daily safety/maintenance path.

### GitHub Actions

GitHub Free currently includes 2,000 standard-hosted runner minutes per month and 500 MB of artifact storage. Public repositories receive free standard-hosted runner usage; private repositories consume the included minute quota. Scheduled workflows can run as frequently as every five minutes, subject to normal scheduling behavior, and public-repository scheduled workflows can be disabled after 60 days without repository activity. citehttps://docs.github.com/en/billing/reference/product-usage-includedhttps://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows?via=aivyx

A bounded four-hour government crawler is therefore compatible with the ₹0 design if each run is kept short and artifacts are not generated unnecessarily.

### Supabase Free

Current Free limits include 500 MB database size per project, 1 GB storage, 5 GB uncached egress + 5 GB cached egress, 50,000 MAU, and 500,000 Edge Function invocations. Free database projects become read-only after the 500 MB database-size quota is exceeded. citehttps://supabase.com/docs/guides/platform/billing-on-supabasehttps://supabase.com/docs/guides/platform/database-size

The government pipeline will therefore store URLs, hashes, short excerpts and structured JSON rather than PDFs or full source documents.

## 4. Conflicts with the requested plan

### Conflict A — Vercel Hobby every 6 hours

The requested six-hour schedule cannot be implemented as a Vercel Hobby cron. Vercel Hobby requires daily-or-less cron frequency. The six-hour schedule will therefore run through GitHub Actions, which is compatible with the requested free architecture.

### Conflict B — existing government data model

The current `jobs` table is not sufficient for notification-level and per-post government data. The dedicated government tables will be additive and will not change the private-job flow.

### Conflict C — PDF extraction

The repository has no PDF parsing dependency. To preserve the ₹0 constraint and avoid adding a heavy runtime dependency, the crawler will use HTML/RSS/sitemap extraction first and an optional runner-local `pdftotext` capability for official PDFs. If PDF text cannot be extracted, the item becomes `needs_info` rather than being invented or silently dropped.

### Conflict D — admin UI exposure

The current repository still contains a static `admin.html` deployment asset. The existing protection is server-side API authentication, but the HTML shell itself is not yet a fully server-protected route. This remains a carry-over hardening item and must not be represented as complete until the static admin bundle is removed from direct public serving.

## 5. Source policy

Official sources are authoritative. Aggregators are lead-only sources. Aggregator text, images, FAQs and vacancy counts are not copied into CivilCareer. A staged government record must be backed by an official notification/source URL or remain `needs_info`.

Initial official source verification was performed against current official pages for CPWD, NHAI, UPSC, RRB/CDG, RITES, IRCON and Employment News. CPWD exposes recruitment information and civil/engineering recruitment rules; NHAI exposes direct recruitment notices; UPSC exposes recruitment advertisements; RRB/CDG exposes employment notices; RITES exposes its recruitment system; IRCON exposes regular/contract recruitment lists; Employment News publishes government recruitment listings. citeturn3search2turn3search3turn3search16turn3search15turn3search4turn3search5turn3search11turn4search1

## 6. Pipeline

```text
Official sources / aggregator leads
        |
        v
     discover
        |
        v
  govt_job_leads
        |
        v
 official notice resolution
        |
        v
 structured extraction
        |
        v
 civil classifier + deadline parser + dedupe
        |
        v
 govt_job_staging
        |
        +--> needs_info / rejected / duplicate
        |
        v
     Admin review
        |
        v
     govt_jobs
        |
        v
 Public govt-jobs API (approved + active only)
```

Nothing is public before approval.

## 7. Classification

Rules run first. Civil relevance is determined from post/discipline/qualification context, not the word `engineer` by itself. Hard negatives include Civil Judge/Civil Court/Civil Services, software/IT, electrical/mechanical-only roles, police, teaching, medical and clerical roles. Unknown engineering roles at civil-heavy organizations are retained as `discipline_unknown` / `needs_info` instead of being discarded.

Mixed notifications are split into child posts and only civil child posts are exposed publicly.

## 8. Deadline policy

The parser supports explicit Indian dates, ISO dates and relative notices such as `Within 21/30 Days`. Relative deadlines are stored as relative and flagged for confirmation. `Update Soon` / `Notified Soon` are preserved as non-date statuses. Last-date extensions update the existing record and retain the previous deadline.

Expired notifications are never staged as active public jobs.

## 9. Security

- RLS remains enabled on government tables.
- `anon` and `authenticated` receive no table privileges.
- Only server-side service-role access is used by the crawler/API.
- Scraped content is treated as untrusted input.
- Raw HTML is sanitized before display.
- LLM output, if enabled later, must conform to a strict JSON schema.
- No personal data is sent to an optional LLM.
- No login/CAPTCHA bypass is permitted.
- Crawler obeys robots.txt, uses a descriptive User-Agent, rate-limits per host, honors conditional requests where possible, and stops on 403/429.

## 10. Zero-cost operating model

- GitHub Actions: four-hour government crawl.
- Supabase Free: structured queue + approved government records.
- Vercel Hobby: public application/API and daily safety cron only.
- No paid scraper.
- No paid AI API.
- No browser automation service.
- No stored PDFs.

If any future step could create a charge, implementation must stop and require owner approval.
