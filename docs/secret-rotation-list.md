# Secret scan & rotation list (P1 A6)

Date: 2026-10-02 · Branch: `security-hardening` (P1)

## What was scanned

Full git history of every local branch (`git log -p --all`),
grepped for:

- High-entropy provider tokens: OpenAI `sk-…`, AWS `AKIA…`,
  GitHub `ghp_…` / `github_pat_…`, Slack `xox[abp]-…`
- PEM private-key blocks (`-----BEGIN … PRIVATE KEY-----`)
- JWTs (`eyJ…` header.payload signatures)
- Provider-key assignments: `(supabase|groq|turnstile|vercel|
  resend|cloudflare)[…](key|secret|token) = <16+ chars>`
  excluding `process.env` reads, placeholders and empty strings

**Result: zero matches.** No committed secret values were found
in any commit on any branch. The Gitleaks workflow
(`.github/workflows/gitleaks.yml`) keeps this enforced on push.

## `.gitignore` — confirmed correct

`.env`, `.env.*`, `!.env.example`, `.freebuff/`, `*.zip`,
`live-jobs-tmp.json`, `node_modules/`, `dist/`, `.vercel/`,
`*.log`, `.DS_Store`. Local credentials can only enter the tree
by being explicitly force-added.

## Rotation list — key NAMES only (never values)

No exposed values were found, so no rotation is forced by this
scan. Rotate anyway after any future exposure scare, in this
order (all are Vercel environment variables, never database
columns — see `.env.example` for the canonical list):

| # | Variable | Why it matters | Rotate via |
|---|---|---|---|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` | bypasses RLS; full DB access | Supabase Dashboard → API keys → regenerate |
| 2 | `SUPABASE_ANON_KEY` | public API key | Supabase Dashboard → API keys → regenerate |
| 3 | `SUPABASE_SERVICE_KEY` | legacy alias of #1 | Supabase Dashboard (same screen) |
| 4 | `SUPABASE_PUBLIC_ANON_KEY` / `SUPABASE_PUBLIC_URL` | legacy aliases | Supabase Dashboard |
| 5 | `OWNER_KEY` / `CIVILCAREER_OWNER_KEY` / `ADMIN_OWNER_KEY` | server-side owner compatibility layer | Vercel env + any consumer config |
| 6 | `AGENT_REACH_INGEST_KEY` | ingest authentication | Vercel env + agent-reach side |
| 7 | `CRON_SECRET` | authorizes cron/discovery requests | Vercel env + workflow secrets |
| 8 | `TURNSTILE_SECRET_KEY` | bot-proofing verification | Cloudflare Turnstile dashboard |
| 9 | `TURNSTILE_SITE_KEY` | public widget key | Cloudflare Turnstile dashboard |
| 10 | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_ADMIN_CHAT_ID` | channel posting + webhook auth | BotFather / channel admin |
| 11 | `GROQ_API_KEY` (and `GROQ_MODEL`) | AI endpoint billing | Groq console |
| 12 | `SERPAPI_KEY` / `SERP_API_KEY` | search scraping quota | SerpApi dashboard |
| 13 | `MUSE_API_KEY` / `THEMUSE_API_KEY` | job aggregation | provider dashboards |
| 14 | `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | job aggregation | Adzuna dashboard |
| 15 | `LINKEDIN_ACCESS_TOKEN` / `LINKEDIN_ORGANIZATION_ID` | P2 social posting | LinkedIn developer portal |
| 16 | `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_BUSINESS_ACCOUNT_ID` | P2 social posting | Meta developer portal |
| 17 | `CLOUDFLARE_ACCOUNT_ID` | image/AI edge ops | Cloudflare dashboard |
| 18 | `ADMIN_EMAIL` / `ADMIN_USER_ID` | admin allowlist (not secrets, but credential-adjacent) | Vercel env |

Non-secret operational variables (`SITE_URL`,
`CIVILCAREER_SITE_URL`, `TELEGRAM_CHANNEL_ID`,
`TELEGRAM_TEST_CHANNEL_ID`,
`*_MODEL`, `*_TIMEOUT_MS`, `SCRAPER_*`, `GOVT_MAX_*`,
`AI_TIMEOUT_MS`) need no rotation.

## If a secret ever lands in a commit

1. Rotate the key FIRST (the value stays valid in history until
   rotated — rewriting history alone is not enough).
2. Then `git filter-repo` / BFG the branch, force-push, and
   redeploy so Vercel picks up the new value.
3. Note the key NAME (never the value) in this file.
