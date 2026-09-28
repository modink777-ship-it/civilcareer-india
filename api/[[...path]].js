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
};

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

    const match = handlers[pathName];
    if (!match) {
      return sendJson(res, 404, { error: 'Not found', path: pathName });
    }

    const fn = match();
    return fn(req, res);
  } catch (err) {
    try { console.error('api dispatch error:', err && err.message); } catch (_) {}
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  }
};
