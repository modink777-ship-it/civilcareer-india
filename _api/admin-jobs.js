/**
 * CivilCareer — Admin Jobs review endpoint
 * Matches this project's existing admin-auth convention:
 *   - owner key from header x-owner-key, or ?key= query param
 *   - compared to process.env.OWNER_KEY
 *
 * GET  /api/admin-jobs?tab=review|published|deleted&search=&page=&per_page=&key=OWNER_KEY
 *       → { jobs: [...], total: N }
 * POST /api/admin-jobs   body { key, action, ids[] }
 *       actions: publish | reject | delete | restore
 */

const OWNER_KEY = String(process.env.OWNER_KEY || '').trim();
const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

const LIST_FIELDS = [
  'id', 'role', 'company', 'sector', 'location', 'location_display',
  'source_name', 'source_url', 'deadline', 'vacancy_count',
  'published', 'telegram_posted', 'review_state', 'created_at',
  'status', 'application_url', 'apply_url', 'source',
];

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

function projection(row) {
  const out = {};
  for (const f of LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
  }
  return out;
}

/* Build PostgREST query-string fragments directly, e.g.
   review    → review_state=eq.pending
   published → published=eq.true
   deleted   → review_state=eq.deleted
   search    → or=(role.ilike.*term*,company.ilike.*term*) */
function buildWhere(tab, search) {
  const parts = [];

  if (tab === 'published') parts.push('published=eq.true');
  else if (tab === 'deleted') parts.push('review_state=eq.deleted');
  else parts.push('review_state=eq.pending');

  const term = String(search || '').trim();
  if (term) {
    const needle = '*' + term.replace(/[*%,()]/g, ' ').trim() + '*';
    parts.push('or=(' +
      'role.ilike.' + encodeURIComponent(needle) + ',' +
      'company.ilike.' + encodeURIComponent(needle) + ')');
  }

  return '&' + parts.join('&');
}

async function handleGet(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!isOwner(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const tab = String(url.searchParams.get('tab') || 'review').toLowerCase();
    const search = String(url.searchParams.get('search') || '').trim().slice(0, 200);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || '50', 10) || 50));

    const conds = buildWhere(tab, search);
    const select = LIST_FIELDS.join(',');
    const offset = (page - 1) * perPage;

    let total = 0;
    try {
      const cr = await supa(`jobs?select=id${conds}&limit=1`, {
        headers: { Prefer: 'count=exact' },
      });
      const range = cr.headers.get('content-range') || '';
      const m = range.match(/\/(\d+)$/);
      total = m ? parseInt(m[1], 10) : 0;
    } catch (e) {
      console.error('admin-jobs count error:', e && e.message);
      return res.status(500).json({ error: 'Failed to count jobs' });
    }

    let jobs = [];
    try {
      const rowsR = await supa(
        `jobs?select=${encodeURIComponent(select)}${conds}&order=created_at.desc&limit=${perPage}&offset=${offset}`
      );
      if (!rowsR.ok) {
        console.error('admin-jobs list status:', rowsR.status);
        return res.status(500).json({ error: 'Failed to list jobs' });
      }
      const rows = await rowsR.json();
      jobs = Array.isArray(rows) ? rows.map(projection) : [];
    } catch (e) {
      console.error('admin-jobs list error:', e && e.message);
      return res.status(500).json({ error: 'Failed to list jobs' });
    }

    return res.status(200).json({ jobs, total });
  } catch (e) {
    console.error('admin-jobs GET error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function handlePost(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!isOwner(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (!body || !Array.isArray(body.ids) || !body.ids.length) {
    return res.status(400).json({ error: 'Missing ids array' });
  }

  const action = String(body.action || '').toLowerCase();
  if (!['publish', 'reject', 'delete', 'restore'].includes(action)) {
    return res.status(400).json({ error: 'Unknown action: ' + action });
  }

  const ids = Array.from(new Set(
    body.ids.map(String).map((s) => s.trim()).filter(Boolean)
  )).slice(0, 500);

  if (!ids.length) {
    return res.status(400).json({ error: 'No valid ids' });
  }

  const updates = {};
  if (action === 'publish') { updates.published = true;  updates.review_state = 'approved'; }
  else if (action === 'reject') { updates.published = false; updates.review_state = 'rejected'; }
  else if (action === 'delete') { updates.published = false; updates.review_state = 'deleted'; }
  else if (action === 'restore') { updates.published = false; updates.review_state = 'pending'; }

  let updated = 0;
  const CHUNK = 100;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    // PostgREST: PATCH jobs?id=in.("a","b",...)
    const inClause = 'id=in.(' + chunk.map((id) => '"' + encodeURIComponent(id) + '"').join(',') + ')';
    try {
      const r = await supa(`jobs?${inClause}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      if (r.ok) {
        try {
          const j = await r.json();
          if (Array.isArray(j)) updated += j.length;
          else if (j && typeof j === 'object') updated += 1;
          else updated += chunk.length;
        } catch (_) {
          updated += chunk.length;
        }
      } else {
        console.error('admin-jobs patch status:', r.status, action, chunk.length);
      }
    } catch (e) {
      console.error('admin-jobs patch error:', e && e.message);
    }
  }

  return res.status(200).json({ ok: true, action, updated });
}

module.exports = async function adminJobsHandler(req, res) {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (e) {
    console.error('admin-jobs handler error:', e && e.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Server error.' }));
    }
  }
};
