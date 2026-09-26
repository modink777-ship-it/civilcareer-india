# CivilCareer India — Master Project Prompt
# Copy and paste this entire file at the start of any session.
# Any AI coder can execute tasks immediately without reading the codebase.

---

## WHO YOU ARE WORKING FOR

Modin — Project Controls / Financial Coordinator at Jacobs, Bengaluru.
Building CivilCareer India as a side project.
Live site: https://civilcareer-india-two.vercel.app
GitHub: push to `main` → Vercel auto-deploys (no manual step needed).

---

## WHAT THE PRODUCT IS

CivilCareer is India's dedicated career platform for Civil Engineers.
It aggregates: private-sector civil jobs, government recruitment, competitive
exams (GATE, SSC JE, RRB JE, ESE, State PSC), and free study materials.
Audience: Civil Engineers in India, fresher to senior level.
Tone: Professional, trustworthy. Safety tagline: "We never charge for jobs."

---

## HARD RULES — NEVER BREAK THESE

1. NO React, Vue, Angular, Next.js or any JS framework — ever
2. NO TypeScript — plain .js files only
3. NO build step — no Vite, Webpack, Parcel, Rollup
4. NO new npm packages on client-side JS
5. NO `app/` folder or `next.config.ts` — these break Vercel static serving
6. NEVER expose SUPABASE_SERVICE_ROLE_KEY in client-side code
7. NEVER publish a job or material automatically — everything goes through admin review first
8. All new API handlers go in `/_api/` NOT in `/api/` directly
9. Every new handler MUST be registered in `api/[[...path]].js` dispatch table
10. Admin auth uses `x-owner-key` header checked against `process.env.OWNER_KEY`

---

## TECH STACK

| Layer       | Technology                                      |
|-------------|------------------------------------------------|
| Frontend    | Vanilla HTML + CSS + Vanilla JavaScript        |
| Hosting     | Vercel (Hobby plan — max 12 serverless funcs)  |
| Database    | Supabase (PostgreSQL) via REST API             |
| Build step  | NONE — files served as-is                      |
| Package mgr | npm (only inside `/_api/` folder)              |

---

## COMPLETE FILE STRUCTURE

```
/
├── index.html                  ← Main SPA — all page sections live here
├── admin.html                  ← Admin panel (owner-key protected)
├── career-guides.html          ← Standalone page
├── exam-guides.html            ← Standalone page
├── career-tools.html           ← Standalone page
├── job-alerts.html             ← Standalone page
├── legal.html                  ← Privacy / terms
│
├── styles.css                  ← ONLY stylesheet — all CSS lives here
│
├── app.js                      ← Main SPA logic, routing, data loading
├── v8.js                       ← Core feature layer
├── discovery-v9.js             ← Job discovery engine (client)
├── cc-intelligence.js          ← Personalisation / "For You" logic
├── account.js                  ← User account UI layer
├── hero-3d.js                  ← Hero section 3D visual
├── next-phase.js               ← Future phase features
├── service-worker.js           ← PWA service worker
├── visual-backgrounds.js       ← Animated backgrounds
│
├── api/
│   └── [[...path]].js          ← SINGLE catch-all Vercel function (dispatches to /_api/)
│
├── _api/                       ← All handler implementations live here
│   ├── jobs.js                 ← Job listings CRUD + discovery cron
│   ├── exams.js                ← Exam data CRUD
│   ├── materials.js            ← Study materials CRUD
│   ├── account.js              ← User account + auth
│   ├── alerts.js               ← Job alert subscriptions
│   ├── agent.js                ← AI agent for job recommendations
│   ├── agent-reach-ingest.js   ← Agent-Reach ingestion endpoint (FULLY BUILT)
│   ├── analytics.js            ← Usage analytics
│   ├── auth-config.js          ← Supabase auth config endpoint
│   ├── employer-submissions.js ← Employer job submission form
│   ├── employers.js            ← Employer profiles
│   ├── extract.js              ← Content extraction / scraping
│   ├── health.js               ← Health check endpoint
│   ├── reports.js              ← Report suspicious content
│   ├── resource-submissions.js ← User study resource submissions
│   ├── sitemap.js              ← Dynamic XML sitemap
│   ├── subscribe.js            ← Email / alert subscriptions
│   ├── telegram.js             ← Telegram bot notifications
│   └── package.json            ← API deps (@supabase/supabase-js only)
│
├── lib/
│   ├── supabase.js             ← Supabase client (server-side, uses SERVICE key)
│   ├── security.js             ← Auth + rate limiting middleware
│   ├── discovery-sources.js    ← Job discovery source config
│   ├── discovery-core.js       ← Discovery pipeline core logic
│   ├── company-careers.js      ← Company career page scrapers
│   └── ai-models.js            ← AI model failover chain
│
├── scripts/
│   ├── scrape-jobs.js          ← Local trigger for discovery cron
│   ├── launch-check.js         ← Pre-deploy sanity check
│   └── agent-reach-sync.ps1    ← PowerShell: push Agent-Reach results to /api/agent-reach-ingest
│
├── tests/                      ← Phase test files (phase1 through phase10)
├── docs/                       ← Phase docs (PHASE1-BASELINE.md … PHASE10-LAUNCH-CHECKLIST.md)
│
├── vercel.json                 ← Routing (165 rewrites), 1 cron, function config
├── package.json                ← Root: only @supabase/supabase-js
├── manifest.json               ← PWA manifest
├── robots.txt                  ← SEO robots
└── .github/workflows/
    └── job-scraper.yml         ← GitHub Actions: triggers discovery every 4 hours
```

---

## API ARCHITECTURE — CRITICAL TO UNDERSTAND

Vercel Hobby plan allows max 12 serverless functions. We use ONE catch-all:

```
Browser → /api/anything → api/[[...path]].js → dispatches to → _api/anything.js
```

### How the dispatch table works (`api/[[...path]].js`)

```js
const handlers = {
  '/api/jobs':                   () => require('../_api/jobs'),
  '/api/account':                () => require('../_api/account'),
  '/api/alerts':                 () => require('../_api/alerts'),
  '/api/agent':                  () => require('../_api/agent'),
  '/api/agent-reach-ingest':     () => require('../_api/agent-reach-ingest'),
  '/api/analytics':              () => require('../_api/analytics'),
  '/api/auth-config':            () => require('../_api/auth-config'),
  '/api/employer-submissions':   () => require('../_api/employer-submissions'),
  '/api/employers':              () => require('../_api/employers'),
  '/api/exams':                  () => require('../_api/exams'),
  '/api/extract':                () => require('../_api/extract'),
  '/api/health':                 () => require('../_api/health'),
  '/api/materials':              () => require('../_api/materials'),
  '/api/reports':                () => require('../_api/reports'),
  '/api/resource-submissions':   () => require('../_api/resource-submissions'),
  '/api/sitemap':                () => require('../_api/sitemap'),
  '/api/subscribe':              () => require('../_api/subscribe'),
  '/api/telegram':               () => require('../_api/telegram'),
};
```

### Adding a new API endpoint — exact 2-step process

**Step 1**: Create `_api/your-endpoint.js` following the handler pattern below.

**Step 2**: Add ONE line to the dispatch table in `api/[[...path]].js`:
```js
'/api/your-endpoint': () => require('../_api/your-endpoint'),
```

That's it. No other config needed.

### Handler template — copy this exactly for every new `_api/*.js` file

```js
'use strict';

const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function db(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function isAdmin(req) {
  return req.headers['x-owner-key'] === process.env.OWNER_KEY;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // your logic here
    return res.status(200).json({ ok: true, data: [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
```

---

## DATABASE — SUPABASE

### Environment variables

| Variable                   | Used in          | Safe on client? |
|----------------------------|------------------|-----------------|
| `SUPABASE_URL`             | _api/*.js        | Yes             |
| `SUPABASE_ANON_KEY`        | _api/*.js        | Yes             |
| `SUPABASE_SERVICE_ROLE_KEY`| _api/*.js        | NO — never      |
| `OWNER_KEY`                | admin auth       | NO — never      |
| `AGENT_REACH_INGEST_KEY`   | agent-reach-ingest| NO — never     |
| `TELEGRAM_BOT_TOKEN`       | _api/telegram.js | NO — never      |
| `TELEGRAM_ADMIN_CHAT_ID`   | _api/telegram.js | NO — never      |

### Main tables

| Table                    | Purpose                                           |
|--------------------------|---------------------------------------------------|
| `jobs`                   | All job listings (private + government)           |
| `exams`                  | Civil engineering exam notifications              |
| `materials`              | Free study resources                              |
| `employer_profiles`      | Verified employer accounts                        |
| `employer_submissions`   | Employer job submission requests                  |
| `resource_submissions`   | User-submitted study resources                    |
| `candidate_profiles`     | Registered candidate accounts                     |
| `candidate_saved_jobs`   | Saved/bookmarked jobs per candidate               |
| `candidate_job_events`   | Click/view/apply tracking                         |
| `job_alerts`             | Email alert subscriptions                         |
| `job_alert_deliveries`   | Alert send history                                |
| `reports`                | Suspicious content reports                        |

### Key fields on `jobs` table (most important)

```
id, role, company, location, country, sector ('Private'|'Government'),
description, employment_type, experience_level, salary, qualification,
posted_date, deadline, source_url, application_url, status ('Active'|'Expired'),
published (boolean), review_state ('Pending Review'|'Published'|'Rejected'),
ingestion_source ('agent_reach'|'discovery'|'admin'),
auto_discovered (boolean), quality_flags (jsonb), featured (boolean),
slug (text), created_at, updated_at
```

### CRITICAL: Nothing auto-publishes
Every job, exam, and material arrives as `published: false, review_state: 'Pending Review'`.
Only the admin panel can publish. Never set `published: true` in ingestion code.

---

## ROUTING SYSTEM

### Server-side (vercel.json) — 165 rewrites
All URL routes map to an HTML file. Pattern examples:
```json
{ "source": "/civil-engineer-jobs-in-bengaluru", "destination": "/index.html" }
{ "source": "/career-tools",                      "destination": "/career-tools.html" }
{ "source": "/admin",                             "destination": "/admin.html" }
{ "source": "/jobs/:slug*",                       "destination": "/index.html" }
{ "source": "/sitemap.xml",                       "destination": "/api/sitemap" }
```

To add a new URL: add a rewrite entry in `vercel.json`.

### Client-side SPA (inside index.html)
Every page is `<section class="page" data-page="name">`. Current pages:
```
home | foryou | private | careerpaths | government | exams |
jobDetail | examDetail | materialDetail | materials |
post | resource | report | about | search | admin
```

Navigation uses `data-route` attributes on links, handled by `app.js`.
Job cards use `jobs-explorer` layout with `job-detail-panel` sidebar (already built).

To add a new SPA page:
1. Add `<section class="page" data-page="newpage">` in index.html
2. Add nav link `<a class="route" href="/new-url" data-route="newpage">`
3. Add rewrite in vercel.json
4. Handle data loading in app.js if needed

---

## CSS SYSTEM

Single file: `styles.css` — do not create separate CSS files.

### CSS variables (always use these, never hardcode hex)

```css
--cc-navy         /* #0b1f3a — primary brand dark navy */
--cc-navy-mid     /* mid-tone navy */
--cc-navy-light   /* light navy */
--cc-gold         /* #c9973c — primary accent / CTA */
--cc-gold-soft    /* soft gold for backgrounds */
--cc-border       /* border color */
--cc-surface      /* card surface */
--cc-ink          /* primary text */
--cc-text-dim     /* secondary/muted text */
--cc-shadow-sm    /* small shadow */
--cc-shadow-md    /* medium shadow */
--cc-white        /* white */
--cc-slate        /* slate gray */
```

### Existing layout components (already in styles.css — use them)

```css
.jobs-explorer          /* two-column split: left job list, right detail panel */
.jobs-column            /* left scrollable job cards column */
.job-detail-panel       /* right sticky detail panel (mobile: slides from bottom) */
.cc-filterbar           /* horizontal filter chip bar above job list */
.cc-compact-card        /* job card in list */
.dash-card              /* admin dashboard card */
.btn-gold               /* primary gold button */
.btn-ghost              /* secondary ghost button */
.btn-reject             /* red reject button */
```

### CSS rules
- Mobile-first. Use existing breakpoints.
- Class naming: lowercase-hyphenated (`job-card`, `filter-title`)
- No Tailwind, no CSS-in-JS, no CSS modules
- Add to `styles.css` only. Never inline styles in HTML except for one-off overrides.

---

## JAVASCRIPT CONVENTIONS

- ES6+ OK (modern browsers + Vercel Node.js support it)
- No import/export on client-side — use plain `<script>` tags
- API calls: `fetch()` only — no axios, no jQuery
- DOM: `document.querySelector` / `getElementById`
- Async: `async/await` preferred over `.then()`
- Always wrap `fetch` in try/catch with user-visible error messages
- Remove all `console.log` before pushing to GitHub

### Client-side API call pattern

```js
async function loadJobs() {
  try {
    const res = await fetch('/api/jobs?published=true&limit=9');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    renderJobs(data.jobs || []);
  } catch (err) {
    showError(err.message);
  }
}
```

### Admin panel API call pattern (uses `adminKey` variable)

```js
// adminKey is a global set after login in admin.html
async function api(url, opt = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(opt.key ? { 'x-owner-key': opt.key } : {}),
    ...(opt.headers || {}),
  };
  const r = await fetch(url, { ...opt, headers });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) {
    const err = Error(data.error || data.details || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Usage (adminKey is always in scope in admin.html):
const jobs = await api('/api/jobs', { key: adminKey });
const result = await api('/api/jobs', { method: 'POST', key: adminKey, body: JSON.stringify(payload) });
```

---

## ADMIN PANEL (`admin.html`)

### Tabs (panels)

| Panel ID              | Purpose                                      |
|-----------------------|----------------------------------------------|
| `panel-analytics`     | Page views, devices, traffic (default)       |
| `panel-jobs`          | Job listings management                      |
| `panel-discovery`     | Job discovery from web (SerpAPI / free feeds)|
| `panel-agent-reach`   | Agent-Reach inbox — pending review items     |
| `panel-exams`         | Exam notifications management                |
| `panel-materials`     | Study materials management                   |
| `panel-submissions`   | Employer + resource submission inbox         |
| `panel-reports`       | Suspicious content reports                   |

### Agent-Reach tab (`panel-agent-reach`) — what's already there
- Inbox showing all `ingestion_source = 'agent_reach'` items with `review_state = 'Pending Review'`
- Buttons: Publish / Open in Editor / Reject per item
- YouTube section (UI exists, no backend handler yet)
- RSS discovery section (UI exists, no backend handler yet)
- Missing: "Run Now" trigger buttons for exam-alerts and youtube-materials

### Adding UI to admin.html — conventions

```js
// Status feedback pattern (reuse this):
function setStatus(elId, type, msg) {
  // type: 'running' | 'ok' | 'err'
  const el = document.getElementById(elId);
  el.className = 'ar-status ' + type;
  el.textContent = msg;
}

// Button pattern:
async function myAdminAction() {
  const btn = document.getElementById('myBtn');
  btn.disabled = true; btn.textContent = 'Running…';
  try {
    const d = await api('/api/my-endpoint', { method: 'POST', key: adminKey });
    setStatus('myStatus', 'ok', `✅ Done — ${d.total} items processed`);
  } catch (err) {
    setStatus('myStatus', 'err', '❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '▶ Run Now';
  }
}
```

---

## VERCEL CONFIGURATION

### Current crons

```json
"crons": [
  { "path": "/api/jobs?discovery=cron", "schedule": "30 0 * * *" }
]
```

### Function config

```json
"functions": {
  "api/[[...path]].js": { "maxDuration": 15 }
}
```

To add a new cron, add to the `crons` array. To increase a function timeout:
```json
"functions": {
  "api/[[...path]].js": { "maxDuration": 60 }
}
```

(Max 60s on Hobby plan.)

---

## WHAT IS ALREADY BUILT (do not rebuild)

| Feature                          | Location                              | Status      |
|----------------------------------|---------------------------------------|-------------|
| LinkedIn-style split job layout  | styles.css `.jobs-explorer`           | ✅ Complete |
| Mobile job detail drawer         | styles.css `.job-detail-panel`        | ✅ Complete |
| Agent-Reach ingestion endpoint   | `_api/agent-reach-ingest.js`          | ✅ Complete |
| Agent-Reach admin inbox tab      | `admin.html #panel-agent-reach`       | ✅ Complete |
| Supabase schema for Agent-Reach  | `supabase-agent-reach.sql`            | ✅ Complete |
| PowerShell sync script           | `scripts/agent-reach-sync.ps1`        | ✅ Complete |
| Job discovery pipeline           | `_api/jobs.js` + `lib/discovery-*.js`| ✅ Complete |
| Company career scrapers          | `lib/company-careers.js`              | ✅ Complete |
| Account / auth system            | `_api/account.js` + `account.js`     | ✅ Complete |
| Job alerts system                | `_api/alerts.js`                      | ✅ Complete |
| Employer trust / verification    | `_api/employers.js`                   | ✅ Complete |
| GitHub Actions discovery (4h)    | `.github/workflows/job-scraper.yml`   | ✅ Complete |
| 165 SEO rewrites (city pages)    | `vercel.json`                         | ✅ Complete |
| Phase 1–10 documentation         | `docs/`                               | ✅ Complete |
| Test suite (phase1–10)           | `tests/`                              | ✅ Complete |
| Security middleware              | `lib/security.js`                     | ✅ Complete |
| Telegram notifications           | `_api/telegram.js`                    | ✅ Complete |

---

## WHAT STILL NEEDS TO BE BUILT

### 1. Fix HTTP 403 on live site (HIGHEST PRIORITY)
The live site https://civilcareer-india-two.vercel.app returns 403 on all URLs.

Check in Vercel → Project → Settings → Environment Variables:
- `SUPABASE_URL` — must be set
- `SUPABASE_ANON_KEY` — must be set
- `SUPABASE_SERVICE_ROLE_KEY` — must be set
- `OWNER_KEY` — must be set (admin password)
- `AGENT_REACH_INGEST_KEY` — must be set for Agent-Reach

If all vars are set, check `lib/security.js` for a middleware that may be blocking all requests.

### 2. Exam Alerts Scraper (`_api/exam-alerts.js`)
Scrapes UPSC, SSC, RRB, Employment News for civil engineering exam notifications.
Saves to `exams` table as `review_state: 'Pending Review'`.

Steps:
1. Create `_api/exam-alerts.js` using the handler template above
2. Scrape these free sources (no API key needed):
   - `https://www.employmentnews.gov.in/rss/feed.aspx`
   - `https://upsc.gov.in/examinations/active-examinations`
   - `https://ssc.nic.in/`
   - `https://www.sarkariresult.com/feed/`
3. Filter by civil engineering keywords
4. Save to `exams` table, `published: false, review_state: 'Pending Review'`
5. Add to dispatch table in `api/[[...path]].js`
6. Add cron in `vercel.json`: `{ "path": "/api/exam-alerts", "schedule": "30 0 * * 1" }`
7. Add "Run Now" button in `admin.html` inside `#panel-exams`

### 3. YouTube Study Materials (`_api/youtube-materials.js`)
Admin pastes YouTube URL → transcript extracted → saved to `materials` table for review.
No API key needed — uses YouTube's public caption endpoint.

Steps:
1. Create `_api/youtube-materials.js` using handler template
2. Extract video ID from URL
3. Fetch YouTube page → parse `ytInitialPlayerResponse` JSON → get caption track URL
4. Fetch caption XML → clean to plain text transcript
5. Save to `materials` table: `published: false, review_state: 'Pending Review'`
6. Add to dispatch table in `api/[[...path]].js`
7. Add input + "Transcribe" button to `admin.html` inside `#panel-materials`

### 4. "Run Now" Trigger Buttons in Admin Panel
The `#panel-agent-reach` tab needs manual trigger buttons for:
- Exam scan → calls `POST /api/exam-alerts`
- YouTube transcribe → calls `POST /api/youtube-materials` with a URL input

Use the admin button pattern from the JS conventions section above.

### 5. CLAUDE.md — Project Knowledge File for Claude Code
File at project root: `CLAUDE.md`
Should reference this master prompt and document the v13 architecture.
Used by Claude Code (VS Code extension) to auto-load project context.

### 6. `.mcp.json` — Claude Code MCP Config
```json
{
  "mcpServers": {
    "agent-reach": {
      "command": "agent-reach",
      "args": ["serve", "--mcp"],
      "description": "Lets Claude Code browse job sites, government portals and YouTube live."
    }
  }
}
```

---

## HOW TO ADD A NEW FEATURE — MASTER CHECKLIST

### New API endpoint
- [ ] Create `_api/your-endpoint.js` using the exact handler template above
- [ ] Add `OWNER_KEY` auth if admin-only
- [ ] Add one line to dispatch table in `api/[[...path]].js`
- [ ] Add new dep (if any) to `_api/package.json` only
- [ ] Test: `curl -X GET http://localhost:3000/api/your-endpoint`
- [ ] Push to GitHub → Vercel auto-deploys

### New cron job
- [ ] Handler already exists at `_api/your-endpoint.js`
- [ ] Add to `vercel.json` crons array
- [ ] Increase `maxDuration` if needed (max 60 for Hobby)
- [ ] Test manually via admin panel before relying on cron

### New SPA page in index.html
- [ ] Add `<section class="page" data-page="newpage">` inside index.html
- [ ] Add nav link with `data-route="newpage"`
- [ ] Add rewrite in vercel.json: `{ "source": "/new-url", "destination": "/index.html" }`
- [ ] Handle in `app.js` (data loading, rendering)
- [ ] Add CSS to `styles.css`

### New standalone page (not SPA)
- [ ] Create `newpage.html` at root
- [ ] Add rewrite: `{ "source": "/newpage", "destination": "/newpage.html" }`
- [ ] Include same `<head>` boilerplate as other HTML files (meta, canonical, CSS)

### New SEO city/role page
- [ ] Add rewrite to vercel.json: `{ "source": "/[role]-jobs-in-[city]", "destination": "/index.html" }`
- [ ] The page content is served by the SPA using the URL slug
- [ ] Verify `/api/sitemap` picks up new URLs

---

## DEPLOYMENT

```
git push origin main
```

Vercel auto-deploys on every push to `main`. No build command. No manual step.
Check deployment status at: vercel.com → civilcareer → Deployments

---

## SEO RULES — DO NOT BREAK

- Every public HTML page must have `<title>`, `<meta name="description">`, `<link rel="canonical">`
- City page pattern: `/civil-engineer-jobs-in-{city}` → rewrite to `/index.html`
- Sitemap is dynamic at `/api/sitemap` (via `_api/sitemap.js`)
- Google verification meta tag is in `index.html <head>` — never remove it
- `robots.txt` at root — never block any public pages
- Do not add `noindex` to any public page

---

## WHAT NOT TO DO

- ❌ Do not add React, Vue, Next.js or any framework
- ❌ Do not add a build step
- ❌ Do not create files inside `/api/` directly — use `/_api/` then register
- ❌ Do not forget to register new handlers in `api/[[...path]].js`
- ❌ Do not expose `SUPABASE_SERVICE_ROLE_KEY` anywhere client-side
- ❌ Do not set `published: true` in any ingestion/discovery code
- ❌ Do not create new CSS files — extend `styles.css`
- ❌ Do not add new npm packages to the root `package.json` — only `_api/package.json`
- ❌ Do not recreate `app/` folder or `next.config.ts` — these break the site
- ❌ Do not add TypeScript (`.ts`) files anywhere

---

## NOW — WHAT I NEED YOU TO DO

Execute all of the following tasks in order. Each one is self-contained.
Do not skip any. Do not ask for clarification — everything you need is above.

---

### TASK 1 — Fix HTTP 403 on live site (do this first)

The live site https://civilcareer-india-two.vercel.app returns HTTP 403
on every URL including the homepage, /private-jobs, and /api/health.

Do the following:
1. Open `lib/security.js` and read it fully
2. Identify what condition is causing ALL requests to be blocked (missing
   env var check, IP block, misconfigured middleware, etc.)
3. Fix the condition so that public pages and public API endpoints
   (GET /api/jobs, GET /api/exams, GET /api/materials, GET /api/health)
   are accessible without any auth
4. Make sure the fix does NOT remove protection from admin-only endpoints
   (anything that calls isAdmin(req) must still require x-owner-key)
5. Show the exact lines changed

---

### TASK 2 — Build `_api/exam-alerts.js`

Create a new file `_api/exam-alerts.js` that scrapes government portals
for civil engineering exam notifications and saves them to the `exams` table.

Requirements:
- Auth: `isAdmin(req)` OR Vercel cron user-agent (`/vercel-cron/i`)
- Scrape these 4 free sources (no API key needed, use fetch only):
    1. Employment News RSS: https://www.employmentnews.gov.in/rss/feed.aspx
    2. UPSC active exams page: https://upsc.gov.in/examinations/active-examinations
    3. SSC homepage: https://ssc.nic.in/
    4. Sarkari Result RSS: https://www.sarkariresult.com/feed/
- Parse RSS with regex (no cheerio — not in _api/package.json)
- Filter items that contain civil engineering keywords:
  civil, je, junior engineer, assistant engineer, gate, ese, ies,
  ssc je, rrb je, cpwd, pwd, nhai, irrigation, structural, highway,
  upsc, kpsc, mpsc, tnpsc, appsc, state psc
- For each matching item save to `exams` table:
    title, description (plain text, max 600 chars), source_url,
    category (detect: UPSC/SSC/RRB/GATE/State PSC/Government),
    status: 'Active', published: false, review_state: 'Pending Review',
    notification_date (today if not parseable), auto_discovered: true
- Skip duplicates: load existing exam titles first, compare case-insensitively
- Return JSON: { ok, totalNew, durationMs, sources: [{name, found, saved, error}] }
- Use the exact handler template and db() helper from this prompt
- AbortSignal.timeout(12000) on every fetch

After creating the file:
- Add to dispatch table in `api/[[...path]].js`:
  '/api/exam-alerts': () => require('../_api/exam-alerts'),
- Add cron to vercel.json:
  { "path": "/api/exam-alerts", "schedule": "30 0 * * 1" }
  (runs every Monday at 00:30 UTC)

---

### TASK 3 — Build `_api/youtube-materials.js`

Create `_api/youtube-materials.js` that transcribes any YouTube video
and saves the transcript to the `materials` table for admin review.

Requirements:
- Method: POST only
- Auth: isAdmin(req) — admin-only, no cron
- Request body: { url: string, title?: string, category?: string }
- No API key needed — use YouTube's public caption system:
    Step 1: fetch https://www.youtube.com/watch?v=VIDEO_ID
    Step 2: extract ytInitialPlayerResponse JSON from the page HTML
            (regex: /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/)
    Step 3: navigate to
            playerData.captions.playerCaptionsTracklistRenderer.captionTracks
    Step 4: prefer English (languageCode === 'en'), fallback to first track
    Step 5: fetch captionTrack.baseUrl + '&fmt=json3'
    Step 6: parse events array → clean to plain paragraphs (~300 words each)
- Extract video metadata: title, channel (videoDetails.author),
  duration (videoDetails.lengthSeconds)
- Auto-detect category from title keywords:
    gate/ese → 'GATE / ESE Prep'
    ssc je/rrb je → 'SSC JE / RRB JE'
    structural/rcc → 'Structural Engineering'
    highway/transport → 'Transportation'
    geotechnical/soil → 'Geotechnical'
    fluid/hydraulic → 'Fluid Mechanics'
    survey → 'Surveying'
    quantity/qs → 'Quantity Surveying'
    default → 'Civil Engineering'
- Save to `materials` table:
    title (body.title || ytTitle),
    description (channel + duration + word count),
    content (full transcript text),
    source_url (https://www.youtube.com/watch?v=VIDEO_ID),
    category (auto-detected or body.category),
    type: 'Video Transcript',
    published: false,
    review_state: 'Pending Review',
    auto_discovered: true
- Return: { ok, stats: { videoId, title, channel, duration, transcriptWords }, material }
- On error (no captions, video not found): return 500 with clear error message

After creating the file:
- Add to dispatch table in `api/[[...path]].js`:
  '/api/youtube-materials': () => require('../_api/youtube-materials'),

---

### TASK 4 — Add "Run Now" buttons to admin.html

Open `admin.html`. Find the `#panel-agent-reach` section.
Add the following two UI blocks inside that panel.

Block A — Exam Alerts Scanner (add near the top of panel-agent-reach,
before the inbox list):

```
Card title: "🔔 Exam Alerts Scanner"
Subtitle: "Scrapes UPSC, SSC, RRB and Employment News for new civil exam notifications"
Small note: "Runs automatically every Monday · results go to Exams tab for review"
Button: id="arExamScanBtn" text="▶ Scan Now" onclick="arRunExamScan()"
Status div: id="arExamScanStatus" (hidden by default)
Results div: id="arExamScanResults" (hidden by default)
```

Block B — YouTube Transcriber (add after Block A):

```
Card title: "🎬 YouTube Study Materials"
Subtitle: "Paste a YouTube URL — transcript is extracted and saved as a draft"
Input: id="arYtUrl" type="url" placeholder="https://youtube.com/watch?v=..."
Input: id="arYtTitle" type="text" placeholder="Custom title (optional)"
Select: id="arYtCategory" with options matching the category list in Task 3
Button: id="arYtBtn" text="▶ Transcribe" onclick="arRunYtTranscribe()"
Status div: id="arYtStatus" (hidden by default)
Preview div: id="arYtPreview" (hidden by default) — shows title + channel + word count
```

Style both cards to match the existing `.dash-card` / `.source-health-panel` pattern
already in admin.html. Use the existing color scheme (--cc-navy, --cc-gold).

Add these JavaScript functions at the bottom of admin.html (before </script>):

```js
async function arRunExamScan() {
  // disable button, show running status
  // call GET /api/exam-alerts with { key: adminKey }
  // on success: show totalNew and per-source breakdown
  // on error: show error message
  // re-enable button
  // if totalNew > 0: call loadExams() to refresh the exams tab
}

async function arRunYtTranscribe() {
  // validate arYtUrl is not empty
  // disable button, show running status
  // call POST /api/youtube-materials with { key: adminKey }
  // body: { url, title (optional), category (optional) }
  // on success: show video title, channel, duration, word count in preview div
  // clear the url and title inputs
  // on error: show error message
  // re-enable button
  // if success: call loadMaterials() to refresh materials tab
}
```

Use the existing `api(url, opt)` helper already in admin.html — do not write a new fetch wrapper.

---

### TASK 5 — Add CLAUDE.md to project root

Create a file `CLAUDE.md` at the project root with this exact content:

```
@MASTER_PROMPT.md
```

This tells Claude Code to read the master prompt file.
Also create `MASTER_PROMPT.md` at the project root containing the full
contents of this master prompt (the entire file you are reading right now).

---

### TASK 6 — Add .mcp.json to project root

Create `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "agent-reach": {
      "command": "agent-reach",
      "args": ["serve", "--mcp"],
      "description": "Gives Claude Code live web browsing: job sites, government portals, YouTube. Use during development to read real page data."
    }
  }
}
```

---

### DELIVERY CHECKLIST

When all 6 tasks are complete, confirm:
- [ ] lib/security.js fix — public endpoints return 200, admin endpoints still require key
- [ ] _api/exam-alerts.js created and registered in api/[[...path]].js
- [ ] vercel.json has exam-alerts cron added
- [ ] _api/youtube-materials.js created and registered in api/[[...path]].js
- [ ] admin.html has both new UI blocks with working JS functions
- [ ] CLAUDE.md created at project root
- [ ] MASTER_PROMPT.md created at project root  
- [ ] .mcp.json created at project root
- [ ] All files pushed to main branch on GitHub

Show a summary of every file changed and what changed in each one.
