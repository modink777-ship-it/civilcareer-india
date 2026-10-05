/* ═══════════════════════════════════════════════════════════════════
   CivilCareer — SINGLE API FUNCTION (Hobby-plan friendly)
   Vercel's Hobby plan allows max 12 serverless functions per
   deployment. Instead of one function per endpoint, this single
   catch-all ([...path].js) receives every /api/* request and
   dispatches it to the matching handler in /_api. One function,
   all endpoints, identical behavior.
   ═══════════════════════════════════════════════════════════════════ */

const { verifyAdminToken } = require('../lib/security');

const handlers = {
  '/api/jobs': () => require('../_api/jobs'),
  '/api/account': () => require('../_api/account'),
  '/api/contact': () => require('../_api/contact'),
  '/api/alerts': () => require('../_api/alerts'),
  '/api/agent': () => require('../_api/agent'),
  '/api/agent-reach-ingest': () => require('../_api/agent-reach-ingest'),
  '/api/analytics': () => require('../_api/analytics'),
  '/api/admin-auth': () => require('../_api/admin-auth'),
  /* A3: the /admin rewrite lands here. The handler runs the same
     allowlist check as requireAdmin before serving the admin bundle. */
  '/api/admin-page': () => require('../_api/admin-page'),
  '/api/auth-config': () => require('../_api/auth-config'),
  '/api/employer-submissions': () => require('../_api/employer-submissions'),
  '/api/employers': () => require('../_api/employers'),
  '/api/exams': () => require('../_api/exams'),
  '/api/extract': () => require('../_api/extract'),
  '/api/health': () => require('../_api/health'),
  '/api/materials': () => require('../_api/materials'),
  '/api/reports': () => require('../_api/reports'),
  '/api/resource-submissions': () => require('../_api/resource-submissions'),
  '/api/sitemap': () => require('../_api/sitemap'),
  '/api/subscribe': () => require('../_api/subscribe'),
  '/api/telegram':          () => require('../_api/telegram'),
  '/api/exam-alerts':       () => require('../_api/exam-alerts'),
  '/api/govt-discovery':    () => require('../_api/govt-discovery'),
  '/api/govt-review':       () => require('../_api/govt-review'),
  '/api/govt-jobs':         () => require('../_api/govt-jobs'),
  '/api/job-collector':     () => require('../_api/job-collector'),
  '/api/youtube-materials': () => require('../_api/youtube-materials'),
  '/api/exam-tracker':         () => require('../_api/exam-tracker'),
  '/api/exam-alert-subscribe': () => require('../_api/exam-alert-subscribe'),
  '/api/salary':               () => require('../_api/salary'),
  '/api/walkin':               () => require('../_api/walkin'),
  '/api/whatsapp-subscribe':   () => require('../_api/whatsapp-subscribe'),
  '/api/morning-brief':        () => require('../_api/morning-brief'),
  '/api/civil-scraper':        () => require('../_api/civil-scraper'),
  '/api/admin-jobs':           () => require('../_api/admin-jobs'),
  '/api/profiles':             () => require('../_api/profiles'),
  '/api/companies':            () => require('../_api/companies'),
  '/api/companies/review':     () => require('../_api/companies'),
  '/api/seo-page':             () => require('../_api/seo-page'),  '/api/blog':                 () => require('../_api/blog'),
  '/api/interview':            () => require('../_api/interview'),
  '/api/mock-tests':           () => require('../_api/mock-tests'),
  '/api/companies-review':     () => require('../_api/companies'),
  '/api/telegram-webhook':     () => require('../_api/telegram-webhook'),
  /* Social Content Engine (v27): suggestions, ledger,
     connections and settings. Admin-only on every method. */
  '/api/social':               () => require('../_api/social'),
  /* Sieve scrape API (v31): start/poll/resume runs, follow-up turns and
     file download. Admin-only; inert when SIEVE_API_KEY is unset. */
  '/api/sieve':                () => require('../_api/sieve'),
};



const CRON_ROUTES = new Set([
  '/api/exam-alerts',
  '/api/govt-discovery',
]);

const ADMIN_RULES = {
  '/api/jobs': req => req.method !== 'GET' || new URL(req.url, 'http://localhost').searchParams.get('auth') === '1',
  '/api/analytics': req => req.method === 'GET',
  '/api/contact': req => req.method !== 'POST',
  '/api/employer-submissions': req => req.method !== 'POST',
  '/api/employers': req => req.method !== 'GET',
  '/api/exam-alerts': req => !isValidCronRequest(req),
  '/api/govt-discovery': req => !isValidCronRequest(req),
  '/api/govt-review': req => true,
  '/api/job-collector': () => true,
  '/api/exams': req => req.method !== 'GET' || new URL(req.url, 'http://localhost').searchParams.get('auth') === '1',
  '/api/extract': () => true,
  '/api/materials': req => req.method !== 'GET' || new URL(req.url, 'http://localhost').searchParams.get('auth') === '1',
  '/api/reports': req => req.method !== 'POST',
  '/api/resource-submissions': req => req.method !== 'POST',
  '/api/telegram': () => true,
  '/api/youtube-materials': () => true,
  /* These handlers check the owner key themselves (lib/security.js), but the
     dashboard signs in with a Supabase session and cannot hold the raw key.
     Elevate non-public requests through the allowlist unless the caller is
     already authenticated with the real owner key (scripts, cron curls). */
  '/api/exam-tracker':       req => req.method !== 'GET' && !hasValidOwnerKey(req),
  '/api/salary':             req => (req.method !== 'GET'
                               || new URL(req.url, 'http://localhost').searchParams.has('admin')
                               || new URL(req.url, 'http://localhost').searchParams.has('unverified'))
                               && !hasValidOwnerKey(req),
  '/api/walkin':             req => (req.method !== 'GET'
                               || new URL(req.url, 'http://localhost').searchParams.has('admin'))
                               && !hasValidOwnerKey(req),
  '/api/whatsapp-subscribe': req => req.method === 'GET' && !hasValidOwnerKey(req),
  '/api/companies':          req => ((req.method !== 'GET' && req.method !== 'POST')
                               || new URL(req.url, 'http://localhost').searchParams.get('status') === 'pending')
                               && !hasValidOwnerKey(req),
  '/api/blog':               req => (req.method !== 'GET' || Boolean(req.headers['x-owner-key']))
                               && !hasValidOwnerKey(req),
  '/api/interview':          req => ((req.method !== 'GET' && req.method !== 'POST')
                               || new URL(req.url, 'http://localhost').searchParams.get('status') === 'pending'
                               || Boolean(req.headers['x-owner-key']))
                               && !hasValidOwnerKey(req),
  /* Social Content Engine: every method is admin-only (the queue
     list, settings, connections and all mutations). Elevate
     dashboard sessions through the allowlist unless the caller
     already holds the real owner key. */
  '/api/social': req => !hasValidOwnerKey(req),
  /* Sieve is server-to-server only and spends credits: every method is
     admin-only, and the handler itself refuses when the key is unset. */
  '/api/sieve': req => !hasValidOwnerKey(req),
  /* GET = admin webhook info; POST with {action:'set-webhook'} = admin setup.
     Real Telegram updates are POSTs without those markers → public. */
  '/api/telegram-webhook':   req => {
                               if (req.method !== 'POST') return !hasValidOwnerKey(req);
                               const b = req.body;
                               const isMgmt = b && typeof b === 'object' && (b.action || b.key);
                               return Boolean(isMgmt) && !hasValidOwnerKey(req);
                             },
};

function isValidCronRequest(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = String(req.headers.authorization || '');
  return auth === `Bearer ${secret}`;
}

/* Scheduled Social engine drain: the SOCIAL_CRON_SECRET
   (with a CRON_SECRET fallback) authorizes ONLY op=drain
   on /api/social — never the queue list, settings, ledger,
   connections or any other route. The op is read from the
   query string (Vercel Cron sends GETs) or the JSON body.
   Deliberately separate from CRON_ROUTES: scheduler access
   to the drain can never imply exam-alert or
   discovery-crawler access. */
function isSocialDrainRequest(req) {
  const secret = String(
    process.env.SOCIAL_CRON_SECRET ||
    process.env.CRON_SECRET || ''
  ).trim();
  if (!secret) return false;
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${secret}` &&
      String(req.headers['x-cron-secret'] || '') !== secret) return false;
  let op = '';
  try {
    op = String(new URL(req.url, 'http://localhost').searchParams.get('op') || '');
  } catch (_) { /* keep empty */ }
  if (op !== 'drain') {
    try {
      if (req.body && typeof req.body === 'object' &&
          String(req.body.op || '') === 'drain') op = 'drain';
    } catch (_) { /* body not parsed */ }
  }
  return op === 'drain';
}

/* True when the request already carries the real owner credential
   (header, Bearer or body key). Used by ADMIN_RULES so that direct
   owner-key scripts keep working while dashboard sessions (Supabase
   Bearer tokens) are elevated through the allowlist instead. */
function hasValidOwnerKey(req) {
  const expected = String(process.env.OWNER_KEY || '');
  if (!expected) return false;
  if (String(req.headers?.['x-owner-key'] || '') === expected) return true;
  if (String(req.headers?.authorization || '') === `Bearer ${expected}`) return true;
  try {
    if (req.body && typeof req.body === 'object' && String(req.body.key || '') === expected) return true;
  } catch (_) { /* body not parsed */ }
  return false;
}

/* The token check itself lives in lib/security.js (verifyAdminToken)
   so the gated admin page (/api/admin-page) enforces the identical
   allowlist rule as every admin JSON endpoint. */
async function requireAdmin(req) {
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/i.test(auth)) return { ok: false, status: 401, error: 'Admin authentication required.' };
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return verifyAdminToken(token);
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  try {
    let pathName = '/';
    try {
      pathName = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    } catch (_) { /* keep default */ }

    /* Platform query hygiene — the catch-all SEO rewrite in vercel.json
       (/:seoSlug → /api/seo-page?slug=:seoSlug) also prefix-matches every
       /api/* path and leaks slug=<first path segment> ("api") into the
       query string. Left in place, list endpoints take their detail branch
       and answer {"job":null} instead of the list. Strip exactly that
       leaked value; a slug the caller really sent is preserved. */
    if (pathName.startsWith('/api/')) {
      const injected = pathName.split('/')[1];
      let realSlug = null;
      try {
        const u = new URL(req.url, 'http://localhost');
        const seen = u.searchParams.getAll('slug');
        const kept = seen.filter(v => v !== injected);
        if (kept.length !== seen.length) {
          u.searchParams.delete('slug');
          for (const v of kept) u.searchParams.append('slug', v);
          req.url = u.pathname + u.search;
        }
        if (kept.length === 1) realSlug = kept[0];
      } catch (_) { /* keep req.url as-is */ }
      if (req.query && req.query.slug !== undefined) {
        let kept = Array.isArray(req.query.slug)
          ? req.query.slug.filter(v => String(v) !== injected)
          : (String(req.query.slug) === injected ? [] : [req.query.slug]);
        if (!kept.length && realSlug) kept = [realSlug];
        if (kept.length === 1) req.query.slug = kept[0];
        else if (kept.length) req.query.slug = kept;
        else delete req.query.slug;
      }
    }

    /* Server-rendered job detail pages: /jobs/<slug> maps to the jobs handler
       regardless of whether the vercel.json rewrite reached us intact — the
       catch-all receives the original path here, so resolve it ourselves. */
    const jobDetail = pathName.match(/^\/jobs\/([^/]+)$/);
    if (jobDetail) {
      let slug = jobDetail[1];
      try { slug = decodeURIComponent(slug); } catch (_) { /* keep raw */ }
      pathName = '/api/jobs';
      req.query = Object.assign({}, req.query, { slug, render: 'html' });
    }

    /* Dynamic SEO pages (Feature 12): /<role>-jobs[-in-<city>] URLs resolve
       here as well — Vercel rewrites can leave req.url as the original path,
       so the slug is derived from it directly instead of relying on the
       rewritten query string. */
    if (!handlers[pathName]) {
      const seoSlug = pathName.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*-jobs(?:-in-[a-z0-9-]+)?)$/i);
      if (seoSlug) {
        pathName = '/api/seo-page';
        req.query = Object.assign({}, req.query, { slug: seoSlug[1] });
      }
    }

    /* A3 gated admin page: the /admin and /admin.html rewrites can
       reach this catch-all with the ORIGINAL path intact — the same
       platform quirk as the job-detail and SEO-page rewrites above.
       Normalise both spellings so the dispatcher always finds the
       gated handler, no matter how Vercel's router passed the
       rewrite through. */
    if (pathName === '/admin' || pathName === '/admin.html') {
      pathName = '/api/admin-page';
    }

    /* Owner deep links into the collector / inbox: vercel.json rewrites the
       named routes here, and the platform keeps the original path (same quirk
       as /admin). The tab itself is selected client-side from the pathname. */
    const adminDeepLink = pathName.match(/^\/admin\/jobs\/(collector|inbox)$/);
    if (adminDeepLink) {
      req.query = Object.assign({}, req.query, { view: adminDeepLink[1] });
      pathName = '/api/admin-page';
    }

    /* Feature E: POST /api/interview/upvote is the same handler, flagged.
       req.url is rewritten too because the handler parses the URL itself. */
    if (pathName === '/api/interview/upvote') {
      pathName = '/api/interview';
      req.query = Object.assign({}, req.query, { action: 'upvote' });
      try { req.url = '/api/interview?action=upvote'; } catch (_) { /* keep */ }
    }

    /* Feature C/D: two-segment /api/* URLs (e.g. /api/companies/review,
       /api/telegram/webhook) cannot reach this function on Vercel's router
       — plain-Node optional catch-alls only match 0-1 segments. The action
       lives on a single-segment alias instead; the canonical spellings are
       kept working via the generic /api/:path* rewrite + these mappings. */
    if (pathName === '/api/companies-review') {
      pathName = '/api/companies';
      req.query = Object.assign({}, req.query, { action: 'review' });
      try { req.url = '/api/companies?action=review'; } catch (_) { /* keep */ }
    }
    /* Legacy F5 spelling: route to the review branch explicitly. */
    if (pathName === '/api/companies/review') {
      pathName = '/api/companies';
      try { req.url = '/api/companies?action=review'; } catch (_) { /* keep */ }
    }
    if (pathName === '/api/telegram/webhook') {
      pathName = '/api/telegram-webhook';
    }
    const match = handlers[pathName];
    if (!match) {
      return sendJson(res, 404, { error: 'Not found', path: pathName });
    }

    const cronAuthorized = isValidCronRequest(req);
    const socialDrain = pathName === '/api/social' && isSocialDrainRequest(req);
    const rule = ADMIN_RULES[pathName];
    /* A CRON_SECRET is valid only for the explicitly scheduled routes
       (CRON_ROUTES), and it must be honoured BEFORE the per-route allowlist.
       For those routes the rule is the negation of this same check
       ('/api/govt-discovery': req => !isValidCronRequest(req)), so gating on
       the rule first left req.isCron unset on every legitimate cron run and
       the handler answered 401 "Cron authorization required.". Never let the
       scheduler credential bypass an unrelated admin allowlist. */
    if (cronAuthorized && CRON_ROUTES.has(pathName)) {
      req.isCron = true;
    } else if (rule && rule(req)) {
      if (socialDrain) {
        /* SOCIAL_CRON_SECRET elevates op=drain only — the
           /api/social handler re-verifies the credential and
           refuses every other operation with it. */
        req.isSocialCron = true;
      } else {
        const auth = await requireAdmin(req);
        if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
        req.adminUser = auth.user;
      }
      // Legacy handlers still expect their owner key. Keep the secret server-side.
      if (!process.env.OWNER_KEY) process.env.OWNER_KEY = '__ADMIN_AUTH_OK__';
      req.headers['x-owner-key'] = process.env.OWNER_KEY;
    }

    const fn = match();
    return fn(req, res);
  } catch (err) {
    try { console.error('api dispatch error:', err && err.message); } catch (_) {}
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  }
};
