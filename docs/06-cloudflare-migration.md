# Cloudflare Pages migration — preparation only (P6.1)

**Nothing here changes production.** No DNS edits, no hosting switch without the
owner's explicit confirmation. Vercel Hobby's terms restrict use to personal,
non-commercial projects — this document is the ready-to-execute plan for the day
the owner decides to move.

## Why Cloudflare Pages (free tier)

| Need | CF Pages free | Notes |
|------|---------------|-------|
| Commercial use | Allowed | Unlike Vercel Hobby |
| Build minutes | 500/month (plenty: 1 build per push ≈ 60/mo) | |
| Static requests | Unlimited | |
| Functions (Pages Functions) | 100,000 req/day free | Our entire API is a single catch-all — well under |
| Cron triggers | Not on Pages free | Keep exam-alerts/scraper crons on GitHub Actions instead |

## Architecture mapping

| Vercel today | Cloudflare Pages equivalent |
|--------------|------------------------------|
| `api/[[...path]].js` (Node catch-all) | Pages Function `functions/api/[[path]].js` — same dispatcher code, Web-standard `Request/Response` adapter needed |
| `_api/*.js` handlers (Node `req/res`) | Imported unchanged behind a thin adapter (they only use `req.method/url/headers/body`, `res.status/setHeader/end`) |
| `vercel.json` rewrites | `_redirects` file (301s) + `_headers` file (CSP/security headers) + a catch-all Pages Function route for `/jobs/:slug` |
| Vercel crons (`vercel.json` crons) | GitHub Actions schedules already present (`job-scraper.yml`); add exam-alerts trigger with `CRON_SECRET` |
| Env vars | Pages project → Settings → Environment variables (same names) |

## Exact switch steps (owner-executes, ~1 hour)

1. **Create the project:** Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → pick `modink777-ship-it/civilcareer-india` → branch `main`. Build command: `none` (static site + functions). Output dir: `/`.
2. **Functions adapter (one commit on a branch first):** add `functions/api/[[path]].js` that wraps the existing dispatcher:
   ```js
   export async function onRequest(context) {
     const { request, env } = context;
     const url = new URL(request.url);
     const { createServerAdapter } = await import('../../_api/node-adapter.js'); // to be added
     return createServerAdapter(request, env);
   }
   ```
   The adapter converts `Request` → Node-style `req/res` objects (method, url, headers as lowercase object, JSON body), calls the existing `module.exports` handler, and captures `statusCode`/headers/body into a `Response`. **All existing handlers stay untouched.**
3. **Port configuration:** copy every env var from Vercel (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, CRON_SECRET, ADMIN_EMAIL/ADMIN_USER_ID, OWNER_KEY, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, AI keys). Add `_headers` replicating the vercel.json header set (CSP exactly as today) and `_redirects` replicating the 301 redirects.
4. **Deploy to `*.pages.dev`** and run the full live test battery against the preview URL: home, private-jobs, government-jobs (Cards+Table), a real `/jobs/<slug>` SSR page, a fake slug → 404, sitemap.xml, robots.txt, `/api/health`, subscribe (first + duplicate), contact with Turnstile token, admin sign-in + allowlist denial, theme toggle, Lighthouse mobile.
5. **Only after every test passes:** owner switches DNS (domain registrar → CF nameservers or CNAME) — this is the irreversible step and happens **only on the owner's say-so**.

## Rollback plan

- The Vercel project stays intact and deployed the whole time — it is the rollback.
- DNS TTL is lowered to 60s **before** the switch, so reverting is a DNS-only change effective in ≤5 minutes.
- Rollback = point DNS back at Vercel (`cname.vercel-dns.com`). No code or data moves; Supabase is untouched by the hosting switch in either direction.
- GitHub stays the single source of truth; both hosts deploy from `main`, so a rollback never needs a code revert.
