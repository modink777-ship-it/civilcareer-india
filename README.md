# civilcareer.jobs — India

A deploy-ready India-only civil engineering jobs board. As the owner, paste an original public vacancy URL and the server extracts available structured details (role, company, location, description, employment type, salary and dates) and publishes the listing.

## Free public setup

You need free accounts on **GitHub**, **Vercel**, and **Supabase**. Free plans have usage limits, but are suitable for an early MVP with modest traffic.

### 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase.sql`.
3. In Supabase project settings, copy:
   - Project URL
   - `service_role` key (keep this secret; never add it to browser code)

### 2. Put the project on GitHub

Create a repository and upload all files from this folder, preserving the `api` folder.

### 3. Deploy on Vercel

1. Import the GitHub repository in Vercel.
2. Add these Environment Variables:
   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service-role key
   - `OWNER_KEY` = a long private password only you know
3. Deploy. Vercel gives you a public HTTPS address.
4. Optional: connect a custom domain later. The Vercel address works without buying a domain.

## Owner workflow

1. Open the public website.
2. Select **Add vacancy**.
3. Paste the original public vacancy URL and enter your owner key (saved locally on your device).
4. Select **Detect & publish vacancy**.

## What works automatically

**Automatic discovery, every 4 hours.** A scheduled run searches civil-engineering vacancies
for India across job platforms, India job feeds and vacancy news, and reads the career pages of
35 top Indian construction, infrastructure and real-estate companies (see `lib/company-careers.js`).
Every lead passes a **civil-only** gate, an **India-only** gate and a **freshness** gate, then a
deduplication pass against what is already on the site. Survivors are saved as **unpublished
drafts** in **Admin → Discovery**, where you review, edit and publish them. Automatic discovery
has no path to publishing on its own.

A slice of the company list is checked per run (the list rotates, so every company is visited
regularly) to keep each run inside the serverless execution limit. Source Status in the admin
tab reports per source and per company what was found, what was rejected and why.

**Manual import.** The importer reads JobPosting JSON-LD and public page metadata. It works best
with an original public job-detail URL from a company career page or job board.

### Free AI extraction chain

Extraction and enrichment run through a failover chain of eleven free tiers, so the site keeps
working when one free limit runs out: Groq → Gemini (Google AI Studio) → Cerebras → OpenRouter →
Mistral → GitHub Models → Together → Hugging Face → DeepSeek → Cloudflare Workers AI → Cohere.
Only the providers you hold keys for are used, and several keys can be listed in one variable
(comma separated) to continue on the same provider after the first key is exhausted. A provider
whose quota is gone is put on a cooldown and skipped until it recovers. Check which tiers are
live at `GET /api/extract?status=1&key=<OWNER_KEY>` or via **Admin → Health → AI providers**.
AI never decides whether a vacancy is admitted, and never invents a salary, city or company.

## Important limitations

- LinkedIn and some other sites may block automated reading or require sign-in. No free parser can guarantee every LinkedIn link will work reliably.
- A WhatsApp group/invite link does not contain vacancy details. Paste the original job URL shared inside WhatsApp.
- If a shared message contains only text or an image and no public job URL, link-only extraction is impossible; a later version can add a text/image paste fallback.
- Source sites can change their HTML at any time. The parser uses structured job data first and metadata as a fallback.
- Review copyright and source-site terms before republishing full descriptions. Linking to the original vacancy and showing a concise excerpt is the safer default.

## Agent Reach Integration

**Agent Reach** is an external tool (it runs on your own machine — never on this server) that
uses an AI agent to collect civil-engineering jobs, notes/resources and videos from the web.
When it finds something worth listing, it POSTs structured JSON to CivilCareer's ingestion
endpoint, where it waits for your review.

The rule that matters:

> **Agent Reach NEVER publishes directly.** All Agent Reach content enters
> **Pending Review**. An admin must verify and explicitly publish it from
> **Admin → Agent Reach**.

**Setup**

1. Run `supabase-agent-reach.sql` in the Supabase SQL Editor (after `supabase.sql` …
   `supabase-v10.sql`, and after the Phase 1–10 migrations `supabase-v11-account-layer.sql`,
   `supabase-v12-alerts-retention.sql`, `supabase-v13-employer-trust.sql`,
   `supabase-v14-data-quality.sql`). Each file only adds columns/indexes/tables — none
   destroys data, and each is safe to run more than once.
2. Add the environment variable `AGENT_REACH_INGEST_KEY` on Vercel (a long random string,
   shared only with the Agent Reach machine).

**Sending items** — `scripts/agent-reach-sync.ps1` shows the full flow:

```bash
POST /api/agent-reach-ingest
Authorization: Bearer <AGENT_REACH_INGEST_KEY>
Content-Type: application/json

{
  "items": [
    {
      "type": "job",
      "source": { "url": "https://example.com/job/123",
                  "name": "Example Engineering Careers", "external_id": "abc123" },
      "title": "Civil Site Engineer",
      "company": "Example Infra Pvt Ltd",
      "location": "Bengaluru, Karnataka",
      "description": "…",
      "apply_url": "https://example.com/apply",
      "employment_type": "Full-time",
      "experience": "2-5 years",
      "skills": ["AutoCAD", "Civil 3D"],
      "published_date": "2026-09-25"
    },
    {
      "type": "resource",
      "source": { "url": "https://example.com/video", "name": "Example Source" },
      "title": "Highway Engineering Lecture",
      "description": "…",
      "url": "https://example.com/video",
      "category": "Transportation Engineering",
      "content_type": "video"
    }
  ]
}
```

A single item object (without the `items` wrapper) is accepted too. A `GET
/api/agent-reach-ingest?status=1` with the same bearer token is a cheap connectivity/key probe.

The response reports exactly what happened to each item:

```json
{
  "ok": true,
  "received": 5, "created": 4, "updated": 1, "duplicates": 0, "rejected": 0,
  "results": [ { "index": 0, "ok": true, "action": "created", "id": "…", "type": "job", "title": "Civil Site Engineer" } ]
}
```

`created` = new pending record, `updated` = an existing pending record was refreshed,
`duplicates` = already ingested (published or rejected records are never overwritten).
Re-running the sync is always safe — the endpoint matches items by external id and source
URL, so running the same batch twice never creates copies. Malformed items are rejected with
per-item errors (HTTP 400 when nothing valid remains); unauthorized requests get HTTP 401.

**Admin review** — every ingested item appears in **Admin → Agent Reach** with its type,
source, ingestion date and state. *Review* shows every extracted field; *Edit* opens the
familiar job/material editor (an inbox edit saves without publishing); *Publish* makes the
item live; *Reject* marks it `review_state = 'Rejected'` (hidden from the public site and
the inbox by default) or deletes it permanently. Nothing is published by editing — only by
the explicit Publish action.

Unauthenticated, unkeyed or third-party traffic cannot read pending content: the public
jobs/materials APIs return `published=true` rows only (unchanged), and the ingestion endpoint
accepts writes only.

## Local preview

Opening `index.html` directly shows sample listings. The import and shared database features work after deployment because they require the serverless `/api` routes and environment variables.

## Project files

**Front end (no build step — plain scripts, loaded in this order by `index.html`)**

- `index.html` — app shell, all SPA routes, SEO metadata
- `app.js` — data loading, normalisation helpers, home/government/exams/materials/For You,
  global search overlay, viewed + saved jobs, admin shell
- `v8.js` — **the canonical Civil Job Explorer** (private-jobs renderer), government renderer,
  dedicated job/exam/material pages, admin job editor
- `discovery-v9.js` — compact live job card, relevance search, profile save
- `cc-intelligence.js` — natural-language search, career radar, qualitative fit badge
- `visual-backgrounds.js` — decorative photo rotator
- `hero-3d.js`, `next-phase.js` — hero visual, career hub
- `styles.css` — the single stylesheet (design tokens, layout, components, responsive)
- `service-worker.js` — the only registered service worker
- `mobile.css` is gone; all responsive rules live in `styles.css`.

**Server (Vercel serverless, Node)**

- `api/jobs.js` — public listing API + owner-protected publishing + HTML job page
- `api/exams.js`, `api/materials.js` — content APIs
- `api/extract.js`, `api/agent.js` — free-first AI extraction chain
- `api/agent-reach-ingest.js` — authenticated ingestion endpoint for the external Agent Reach
  tool (writes pending-review records only)
- `api/analytics.js`, `api/subscribe.js`, `api/telegram.js`, `api/reports.js`,
  `api/employer-submissions.js`, `api/resource-submissions.js`, `api/sitemap.js`
- `lib/discovery-core.js` — the shared gates: civil-role classifier, India-eligibility rules,
  freshness buckets, dedup keys, RSS parser (pure functions, no network, no database)
- `lib/discovery-sources.js` — optional keyed providers (SerpApi Google Jobs, Adzuna, The Muse)
- `lib/company-careers.js` — the 35-company careers list plus its reader (discovered careers URL,
  schema.org JobPosting JSON-LD, job-detail links) — edit `COMPANIES` here to change the list
- `lib/ai-models.js` — the free-tier AI failover chain
- `lib/supabase.js` — server-only helper
- `supabase.sql` + `supabase-v7…v10.sql` — database schema and migrations
- `scripts/scrape-jobs.js` + `.github/workflows/job-scraper.yml` — the every-4-hours trigger
  (the script itself only calls the deployed endpoint, so the pipeline lives in exactly one place)
- `vercel.json` — routes, rewrites, security headers, cron

## Environment variables

Required to run at all: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_KEY`.

| Purpose | Variables |
| --- | --- |
| Free AI failover chain | `GROQ_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `GITHUB_TOKEN` or `GITHUB_MODELS_TOKEN`, `TOGETHER_API_KEY`, `HUGGINGFACE_API_KEY`, `DEEPSEEK_API_KEY`, `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`), `COHERE_API_KEY` — add any subset |
| Extra job sources (optional) | `SERPAPI_KEY`/`SERP_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `THEMUSE_API_KEY`/`MUSE_API_KEY` |
| Scheduled discovery | `CRON_SECRET` (Vercel Cron sends it automatically) and `SITE_URL` for the GitHub Action |
| External Agent Reach tool | `AGENT_REACH_INGEST_KEY` — shared bearer token used by `scripts/agent-reach-sync.ps1` |
| Owner alerts (optional) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` |

GitHub repository secrets needed by the 4-hourly workflow: `SITE_URL`, `CRON_SECRET`
(or `OWNER_KEY`), and optionally the two Telegram values.

> Vercel limits sub-daily cron schedules to paid plans, so the reliable free 4-hourly schedule
> lives in GitHub Actions. The Vercel cron is kept as a once-a-day safety net. GitHub disables
> scheduled workflows after 60 days of repository inactivity — re-enable it from the Actions tab
> if the drafts ever stop arriving.

## Documentation

- `README.md` — this file (setup, environment variables, owner workflow)
- `DEPLOY.md` — deployment steps
- `CHANGELOG.md` — what changed in each build
- `CLEANUP-NOTES.md` — what was removed, consolidated and fixed in the 2026-09-25 cleanup

## Notes for this build

The site is **English-only** and **India-wide**. Match percentages are not displayed anywhere;
For You explains fit qualitatively (`✓` / `△` facet list plus skill gaps). The Career Map
presentation and the "How to Choose" section have been removed, but every civil role remains
available for For You, matching, filters and search.
