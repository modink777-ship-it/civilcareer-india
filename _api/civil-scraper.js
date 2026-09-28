/**
 * CivilCareer — Admin civil scraper trigger endpoint
 * Matches this project's existing admin-auth convention:
 *   - owner key from header x-owner-key, or ?key= query param
 *   - compared to process.env.OWNER_KEY
 *
 * POST /api/civil-scraper   body { key }
 * Triggers a scrape of the configured civil-job portals and saves results
 * as pending-review drafts. Returns the number of new jobs added.
 */

const OWNER_KEY = String(process.env.OWNER_KEY || '').trim();
const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

function supa(path, opts) {
  const url = SUPA_URL + '/rest/v1/' + path;
  return fetch(url, {
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      ...(opts && opts.headers ? opts.headers : {}),
    },
    ...opts,
  });
}

function readOwnerKey(req) {
  if (req && req.headers && req.headers['x-owner-key']) {
    return String(req.headers['x-owner-key']).trim();
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('key');
    if (q) return q.trim();
  } catch (_) { /* ignore */ }
  return '';
}

function isOwner(req) {
  if (!OWNER_KEY) return false;
  const supplied = readOwnerKey(req);
  if (!supplied) return false;
  return supplied === OWNER_KEY;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function safeSourceUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (!host) return false;
    if (/^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/.test(host)) return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

async function saveDraft(item) {
  if (!SUPA_URL || !SUPA_KEY) return { ok: false, error: 'Supabase not configured' };

  const payload = {
    role:             String(item.title || item.role || '').trim() || 'Untitled',
    company:          String(item.company || '').trim(),
    location:         String(item.location || '').trim(),
    location_display: String(item.location || item.location_display || '').trim(),
    sector:           String(item.sector || '').trim(),
    source_name:      String(item.source || item.source_name || '').trim(),
    source_url:       String(item.url || item.link || item.source_url || '').trim(),
    application_url:  String(item.application_url || item.apply_url || '').trim(),
    deadline:         String(item.deadline || '').trim(),
    vacancy_count:    (item.vacancy_count != null) ? Number(item.vacancy_count) : null,
    description:      String(item.description || item.snippet || '').trim(),
    status:           'Active',
    published:        false,
    telegram_posted:  false,
    review_state:     'pending',
    created_at:       new Date().toISOString(),
  };

  const applicationUrl = payload.application_url || payload.source_url;
  if (applicationUrl && !safeSourceUrl(applicationUrl)) {
    payload.application_url = '';
  }
  if (payload.source_url && !safeSourceUrl(payload.source_url)) {
    payload.source_url = '';
  }

  try {
    const r = await supa('jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: 'create failed ' + r.status + ': ' + text.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'unknown' };
  }
}

function loadScraper() {
  const candidates = [
    ['../lib/discovery-sources', ['runConfiguredSources', 'run', 'scrape', 'discover']],
    ['../lib/govt-discovery',    ['run', 'scrape', 'discover']],
    ['../lib/discovery',         ['run', 'scrape', 'discover']],
    ['../lib/civil-scraper',     ['run', 'scrape']],
    ['../lib/scraper',           ['run', 'scrape']],
  ];

  for (const [mod, names] of candidates) {
    try {
      const m = require(mod);
      for (const name of names) {
        if (typeof m[name] === 'function') return m[name].bind(m);
      }
    } catch (_) { /* try next */ }
  }

  return null;
}

module.exports = async function civilScraperHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isOwner(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase not configured on the server.' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const scraperFn = loadScraper();

  if (!scraperFn) {
    return res.status(501).json({
      ok: false,
      error: 'No civil scraper module is wired up yet. Add a scraper to lib/ (runConfiguredSources or similar) or wire saveDraft in this file.',
      saved: 0,
      added: 0,
    });
  }

  const query     = String(body.query || process.env.SCRAPER_QUERY || 'civil engineering jobs India').trim();
  const location  = String(body.location || process.env.SCRAPER_LOCATION || '').trim();

  let result;
  try {
    result = await scraperFn({ query, location });
  } catch (e) {
    console.error('civil-scraper run error:', e && e.message);
    return res.status(500).json({
      ok: false,
      error: 'Scraper crashed: ' + (e && e.message || 'unknown'),
      saved: 0,
      added: 0,
    });
  }

  const items = Array.isArray(result && result.jobs) ? result.jobs
    : Array.isArray(result && result.results) ? result.results
    : Array.isArray(result && result.items) ? result.items
    : Array.isArray(result) ? result
    : [];

  if (!items.length) {
    return res.status(200).json({
      ok: true,
      saved: 0,
      added: 0,
      total: 0,
      note: 'Scraper finished but returned no jobs.',
    });
  }

  let saved = 0;
  let errors = 0;

  for (const item of items) {
    const r = await saveDraft(item);
    if (r.ok) saved += 1;
    else errors += 1;
  }

  return res.status(200).json({
    ok: true,
    saved,
    added: saved,
    total: items.length,
    errors,
    note: errors ? errors + ' item(s) could not be saved.' : 'Scrape complete.',
  });
};
