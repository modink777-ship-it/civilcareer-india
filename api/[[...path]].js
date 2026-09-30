/* ═══════════════════════════════════════════════════════════════════
   CivilCareer — SINGLE API FUNCTION (Hobby-plan friendly)
   Vercel's Hobby plan allows max 12 serverless functions per
   deployment. Instead of one function per endpoint, this single
   catch-all ([...path].js) receives every /api/* request and
   dispatches it to the matching handler in /_api. One function,
   all endpoints, identical behavior.
   ═══════════════════════════════════════════════════════════════════ */

const handlers = {
  '/api/jobs': () => require('../_api/jobs'),
  '/api/account': () => require('../_api/account'),
  '/api/contact': () => require('../_api/contact'),
  '/api/alerts': () => require('../_api/alerts'),
  '/api/agent': () => require('../_api/agent'),
  '/api/agent-reach-ingest': () => require('../_api/agent-reach-ingest'),
  '/api/analytics': () => require('../_api/analytics'),
  '/api/admin-auth': () => require('../_api/admin-auth'),
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
  '/api/youtube-materials': () => require('../_api/youtube-materials'),
};



const ADMIN_RULES = {
  '/api/jobs': req => req.method !== 'GET' || new URL(req.url, 'http://localhost').searchParams.get('auth') === '1',
  '/api/analytics': req => req.method === 'GET',
  '/api/contact': req => req.method !== 'POST',
  '/api/employer-submissions': req => req.method !== 'POST',
  '/api/employers': req => req.method !== 'GET',
  '/api/exam-alerts': req => !isValidCronRequest(req),
  '/api/govt-discovery': req => !isValidCronRequest(req),
  '/api/exams': req => req.method !== 'GET' || new URL(req.url, 'http://localhost').searchParams.get('auth') === '1',
  '/api/extract': () => true,
  '/api/materials': req => req.method !== 'GET' || new URL(req.url, 'http://localhost').searchParams.get('auth') === '1',
  '/api/reports': req => req.method !== 'POST',
  '/api/resource-submissions': req => req.method !== 'POST',
  '/api/telegram': () => true,
  '/api/youtube-materials': () => true,
};

function isValidCronRequest(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = String(req.headers.authorization || '');
  return auth === `Bearer ${secret}`;
}

async function requireAdmin(req) {
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/i.test(auth)) return { ok: false, status: 401, error: 'Admin authentication required.' };
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const adminEmail = String(process.env.ADMIN_EMAIL || '');
  const adminUserId = String(process.env.ADMIN_USER_ID || '').trim();
  if (!supabaseUrl || !anonKey || (!adminEmail.trim() && !adminUserId)) {
    return { ok: false, status: 503, error: 'Admin authentication is not configured.' };
  }
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, status: 401, error: 'Invalid admin session.' };
    const user = await r.json();
    /* Multiple addresses allowed, comma separated, so modin7174@ and
       modink777@ can both be the owner. Dot-insensitive for GMail. */
    const gotEmail = String(user.email || '').toLowerCase().replace(/\.$/, '');
    const emailOk = adminEmail.split(',').some(e => {
      const want = e.trim().toLowerCase().replace(/\.$/, '');
      if (!want) return false;
      return gotEmail === want || gotEmail.replace(/\./g, '') === want.replace(/\./g, '');
    });
    const idOk = adminUserId && String(user.id || '') === adminUserId;
    if (!emailOk && !idOk) return { ok: false, status: 403, error: 'Administrator access denied.' };
    return { ok: true, user };
  } catch (_) {
    return { ok: false, status: 503, error: 'Could not verify administrator session.' };
  }
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

    const match = handlers[pathName];
    if (!match) {
      return sendJson(res, 404, { error: 'Not found', path: pathName });
    }

    const cronAuthorized = isValidCronRequest(req);
    const rule = ADMIN_RULES[pathName];
    if (rule && rule(req)) {
      if (!cronAuthorized) {
        const auth = await requireAdmin(req);
        if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
        req.adminUser = auth.user;
      } else {
        req.isCron = true;
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
