# CivilCareer India — Claude Code Project Guide

## What This Project Is

**CivilCareer** (`https://civilcareer-india-two.vercel.app`) is India's dedicated career platform for Civil Engineers. It lists private-sector civil engineering jobs, government civil recruitment, competitive exams, and free study materials — all in one place.

---

## Stack — Read This Before Touching Any File

| Layer | Technology |
|---|---|
| Frontend | **Vanilla HTML + CSS + JavaScript — NO framework** |
| Hosting | **Vercel** (static files + serverless functions) |
| Database | **Supabase** (PostgreSQL, accessed via REST API) |
| Build step | **None** — files are served as-is |
| Package manager | npm (only for API dependencies) |

### Hard Rules — Never Break These

1. **NO React, Vue, Angular, Next.js or any JS framework** — this project is intentionally framework-free
2. **NO TypeScript** — plain `.js` files only
3. **NO build step** — no bundler (Webpack, Vite, etc.), no transpilation
4. **NO new npm packages on the client** — browser JS uses CDN scripts only when absolutely needed
5. **NO `app/` folder or `next.config.ts`** — these were removed intentionally; do not recreate them
6. **NEVER expose `SUPABASE_SERVICE_KEY` to client-side code** — only `SUPABASE_ANON_KEY` is safe on the browser

---

## Project Structure

```
/
├── index.html              # Main SPA — contains ALL page sections
├── career-guides.html      # Standalone: career guides
├── exam-guides.html        # Standalone: exam guides
├── career-tools.html       # Standalone: career tools
├── job-alerts.html         # Standalone: job alerts
├── admin.html              # Admin panel (protected)
├── legal.html              # Legal / privacy
│
├── styles.css              # PRIMARY stylesheet — most styles live here
├── ui-ux-phase4.css        # UI/UX layer (loaded after styles.css)
├── css-fixes.css           # Patch fixes
├── portal-v16.css          # Portal-specific styles
├── premium-experience.css  # Premium feature styles
│
├── app.js                  # MAIN application logic — routing, data loading
├── v8.js                   # Core feature updates (loaded with app.js)
├── discovery-v9.js         # Auto job discovery engine
├── portal-v16.js           # Portal UI features
├── premium-experience.js   # Premium experience features
├── hero-3d.js              # Hero section 3D visual
├── next-phase.js           # Future phase features
├── pwa-install.js          # PWA install prompt
├── service-worker.js       # PWA service worker
├── visual-backgrounds.js   # Animated backgrounds
│
├── api/                    # Vercel Serverless Functions (Node.js)
│   ├── jobs.js             # Job listings — GET/POST/PUT/DELETE
│   ├── exams.js            # Exam data
│   ├── materials.js        # Study materials
│   ├── analytics.js        # Usage analytics
│   ├── employer-submissions.js  # Employer job submission form
│   ├── resource-submissions.js  # Study resource submission form
│   ├── reports.js          # Report suspicious content
│   ├── subscribe.js        # Email/alert subscriptions
│   ├── telegram.js         # Telegram bot notifications
│   ├── sitemap.js          # Dynamic XML sitemap
│   ├── extract.js          # Content extraction/scraping
│   ├── agent.js            # AI job discovery agent
│   └── package.json        # API-only dependencies
│
├── lib/
│   ├── supabase.js         # Supabase client (server-side only)
│   ├── discovery-core.js   # Job discovery core logic
│   └── discovery-sources.js # Discovery source definitions
│
├── vercel.json             # Routing rewrites + headers + cron jobs
├── package.json            # Root package (only @supabase/supabase-js)
├── manifest.json           # PWA manifest
├── service-worker.js       # PWA service worker
└── robots.txt              # SEO robots
```

---

## Routing System — How It Works

### Server-side (vercel.json)
All URL routes are mapped in `vercel.json` as rewrites:
```json
{ "source": "/submit-resource", "destination": "/index.html" }
{ "source": "/career-tools",    "destination": "/career-tools.html" }
{ "source": "/admin",           "destination": "/admin.html" }
```
**To add a new URL route**: add a rewrite entry in `vercel.json`.

### Client-side (inside index.html)
`index.html` is a single-page app. Every "page" is a `<section class="page" data-page="pagename">` inside the file. Navigation uses `data-route` attributes on links:
```html
<a class="route" href="/private-jobs" data-route="private">Private Jobs</a>
```
The router in `app.js` intercepts clicks, shows the matching section, and updates the URL via `history.pushState`.

**To add a new page inside index.html**: add a `<section class="page" data-page="newpage">` and add navigation links with `data-route="newpage"`.

---

## Database — Supabase

- **URL**: `process.env.SUPABASE_URL`  
- **Anon key** (client-safe, read-only): `process.env.SUPABASE_ANON_KEY`  
- **Service key** (server-only, never client): `process.env.SUPABASE_SERVICE_KEY`

### Main Tables

| Table | Purpose |
|---|---|
| `jobs` | All private and government job listings |
| `exams` | Civil engineering exam data |
| `materials` | Free study resources/materials |
| `employer_submissions` | Employer-submitted job requests |
| `resource_submissions` | User-submitted study resources |
| `reports` | Suspicious content reports |
| `subscribers` | Email/alert subscribers |

### API Pattern
Client-side JS calls the Vercel API functions:
```js
const res = await fetch('/api/jobs?type=private&limit=9');
const data = await res.json();
```
API functions (`/api/*.js`) use the Supabase Node client to query the database.

---

## CSS Conventions

- **Primary color**: `#0b1f3a` (dark navy) — brand colour, used for header/hero
- **Accent**: defined in `styles.css` as CSS variables — check before hardcoding
- **Mobile-first**: all layouts are responsive; use existing breakpoints in `styles.css`
- **Add styles to**: `styles.css` for core changes, `ui-ux-phase4.css` for UI layer additions
- **Do not create new CSS files** unless it's a completely separate standalone feature
- **Class naming**: lowercase hyphen-separated (`job-card`, `filter-title`, `results-head`)
- **No CSS-in-JS, no Tailwind, no CSS modules**

---

## JavaScript Conventions

- **ES6+** is fine (Vercel/modern browsers support it)
- **No modules/import on client** — browser JS uses plain `<script>` tags
- **API calls**: use `fetch()` — no axios, no jQuery
- **DOM manipulation**: vanilla `document.querySelector` / `getElementById`
- **Events**: `addEventListener` — no jQuery `.on()`
- **Async**: `async/await` preferred over `.then()` chains
- **Error handling**: always wrap `fetch` calls in `try/catch` and show user-friendly messages
- **No `console.log` left in production** — use them during dev, remove before deploying

---

## Vercel Serverless Functions (api/*.js)

- Runtime: **Node.js**
- Pattern:
  ```js
  export default async function handler(req, res) {
    // CORS headers first
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
      // your logic
      return res.status(200).json({ data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  ```
- Import Supabase from `../lib/supabase.js`
- Max duration: **15 seconds** (set in vercel.json)
- Dependencies go in `api/package.json`, NOT the root `package.json`

---

## SEO Rules — Don't Break These

- Every public page must have: `<title>`, `<meta name="description">`, `<link rel="canonical">`
- Job routes follow the pattern: `/civil-engineer-jobs-in-{city}` → mapped in `vercel.json`
- `sitemap.xml` is generated dynamically by `/api/sitemap.js`
- Google verification tag is in the `<head>` of `index.html` — do not remove it
- `robots.txt` is at the root — do not block any public pages

---

## PWA

- `manifest.json` defines app name, icons, theme color
- `service-worker.js` handles offline caching
- Icons are in `/icons/` (72, 96, 128, 144, 192, 512px)
- Theme color: `#0b1f3a`

---

## Environment Variables (Vercel)

Set in Vercel dashboard → Project Settings → Environment Variables:

| Variable | Where Used |
|---|---|
| `SUPABASE_URL` | api/*.js and lib/supabase.js |
| `SUPABASE_ANON_KEY` | api/*.js (safe for client too) |
| `SUPABASE_SERVICE_KEY` | api/*.js only — NEVER client |
| `TELEGRAM_BOT_TOKEN` | api/telegram.js |
| `TELEGRAM_CHAT_ID` | api/telegram.js |

---

## How to Add a New Feature — Checklist

### New page/section inside the SPA (index.html):
1. Add `<section class="page" data-page="newpage">` in `index.html`
2. Add nav link `<a class="route" href="/new-page" data-route="newpage">` in the header
3. Add rewrite in `vercel.json`: `{ "source": "/new-page", "destination": "/index.html" }`
4. Add route handler in `app.js` if the page needs data fetching on load
5. Add styles in `styles.css` or `ui-ux-phase4.css`

### New API endpoint:
1. Create `/api/newfeature.js` following the handler pattern above
2. Add to `api/package.json` if new npm dependency is needed
3. Add max duration in `vercel.json` under `"functions"` if needed

### New standalone page (not SPA):
1. Create `newpage.html` at root
2. Add rewrite in `vercel.json`: `{ "source": "/newpage", "destination": "/newpage.html" }`
3. Link necessary CSS and JS at the bottom of the file

---

## Deployment

- **Auto-deploy**: pushing to the `main` branch on GitHub triggers a Vercel deployment
- **No manual build** needed — Vercel serves files directly
- **Cron job**: `/api/jobs?discovery=cron` runs daily at 00:30 UTC to auto-discover new jobs

---

## What NOT to Do

- ❌ Do not add React, Vue, or any JS framework
- ❌ Do not add a build step (Vite, Webpack, Parcel, etc.)
- ❌ Do not create an `app/` folder or `next.config.ts` — these break the static serving
- ❌ Do not import npm packages in client-side `.js` files (use CDN if needed)
- ❌ Do not expose `SUPABASE_SERVICE_KEY` in any file served to the browser
- ❌ Do not add TypeScript (`.ts`) files
- ❌ Do not create new CSS files for every small change — extend `styles.css`
- ❌ Do not hardcode API keys or secrets in any file

---

## Project Context

- **Audience**: Civil Engineers in India — fresher to senior level
- **Primary language**: English (Kannada/KN toggle available for regional users)
- **Tone of content**: Professional, trustworthy, safety-first ("Never pay for a job")
- **Hosted**: Vercel (free tier + serverless functions)
- **Database**: Supabase (free tier)
- **Domain**: civilcareer-india-two.vercel.app (custom domain TBD)
