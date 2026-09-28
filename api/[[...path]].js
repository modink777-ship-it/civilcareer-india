/* ═══════════════════════════════════════════════════════════════════
   CivilCareer — SINGLE API FUNCTION (Hobby-plan friendly)
   ═══════════════════════════════════════════════════════════════════ */

const handlers = {
  '/api/jobs':                    () => require('../_api/jobs'),
  '/api/account':                 () => require('../_api/account'),
  '/api/alerts':                  () => require('../_api/alerts'),
  '/api/agent':                   () => require('../_api/agent'),
  '/api/agent-reach-ingest':      () => require('../_api/agent-reach-ingest'),
  '/api/analytics':               () => require('../_api/analytics'),
  '/api/auth-config':             () => require('../_api/auth-config'),
  '/api/employer-submissions':    () => require('../_api/employer-submissions'),
  '/api/employers':               () => require('../_api/employers'),
  '/api/exams':                   () => require('../_api/exams'),
  '/api/extract':                 () => require('../_api/extract'),
  '/api/health':                  () => require('../_api/health'),
  '/api/materials':               () => require('../_api/materials'),
  '/api/reports':                 () => require('../_api/reports'),
  '/api/resource-submissions':    () => require('../_api/resource-submissions'),
  '/api/sitemap':                 () => require('../_api/sitemap'),
  '/api/subscribe':               () => require('../_api/subscribe'),
  '/api/exam-alerts':             () => require('../_api/exam-alerts'),
  '/api/youtube-materials':       () => require('../_api/youtube-materials'),
  '/api/govt-discovery':          () => require('../_api/govt-discovery'),
  '/api/telegram':                () => require('../_api/telegram'),
  '/api/telegram/status':         () => require('../_api/telegram'),
  '/api/telegram/bulk':           () => require('../_api/telegram'),
  '/api/telegram/broadcast-all':  () => require('../_api/telegram'),
  '/api/civil-scraper':           () => require('../_api/civil-scraper'),
  '/api/admin-jobs':              () => require('../_api/admin-jobs'),
  '/api/govt-jobs':               () => require('../_api/govt-jobs'),
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

/* ── Pretty URLs that Vercel rewrites onto this function ──────────────────
   A rewrite keeps the ORIGINAL path in req.url while putting the
   destination's query params in req.query. Dispatching on the pathname
   alone therefore missed every rewritten request and 404'd it — which is
   why /jobs/<slug> (the server-rendered job page) and /sitemap.xml never
   reached their handlers. These rules map the pretty path back to a
   handler and rebuild the params the handler expects. */

function resolveRoute(pathName) {
  if (handlers[pathName]) return { match: handlers[pathName], query: null };

  if (pathName === '/sitemap.xml') {
    return { match: handlers['/api/sitemap'], query: null };
  }

  // /jobs/<slug> → the indexable job page rendered by _api/jobs.js
  const job = /^\/jobs\/([^/]+)$/.exec(pathName);
  if (job) {
    return {
      match: handlers['/api/jobs'],
      query: { slug: decodeURIComponent(job[1]), render: 'html' },
    };
  }

  return null;
}

/** Merge rebuilt params over whatever Vercel parsed, without ever throwing. */
function withQuery(req, extra) {
  if (!extra) return;
  const merged = Object.assign({}, req.query || {}, extra);
  try {
    req.query = merged;
  } catch (_) {
    try { Object.defineProperty(req, 'query', { value: merged, writable: true, configurable: true }); } catch (_) { /* ignore */ }
  }
}

module.exports = async function handler(req, res) {
  try {
    let pathName = '/';
    try {
      pathName = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    } catch (_) { /* keep default */ }

    const route = resolveRoute(pathName);
    if (!route) {
      return sendJson(res, 404, { error: 'Not found', path: pathName });
    }

    withQuery(req, route.query);
    const fn = route.match();
    return fn(req, res);
  } catch (err) {
    try { console.error('api dispatch error:', err && err.message); } catch (_) {}
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  }
};
