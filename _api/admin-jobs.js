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

const { autoPostToTelegram } = require('../lib/telegram-auto');

/* F7 / private-job transition: legacy direct Telegram auto-post gate.
   'true'/'1' = ON — the pre-engine behaviour. Phase 3 flips
   the DEFAULT OFF: job publishes now create source_type 'job'
   suggestions in the Social Content Engine (approval queue +
   Truth Lock + per-platform daily caps) unless the owner
   explicitly re-enables the legacy direct post. */
const LEGACY_AUTOPOST_ON = ['true', '1'].includes(
  String(process.env.LEGACY_TELEGRAM_AUTOPOST || 'false').trim().toLowerCase()
);

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
  /* NOTE: auth headers must be merged AFTER spreading opts. The previous
     order (auth headers first, then ...opts) let opts.headers REPLACE them,
     so authed calls came back 401 and the row count silently fell back to 0
     — which hid the Jobs-tab pager and made it look like only some jobs
     existed. */
  return fetch(url, {
    ...opts,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      ...(opts && opts.headers ? opts.headers : {}),
    },
  });
}

function readOwnerKey(req) {
  if (req && req.headers && req.headers['x-owner-key']) {
    return String(req.headers['x-owner-key']).trim();
  }
  if (req && req.body && typeof req.body === 'object' && req.body.key) {
    return String(req.body.key).trim();
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

/* PHASE 3: job publishes flow through the Social Content
   Engine instead of the legacy direct Telegram post. The
   in-process call (same runtime — no network self-call,
   identical contract to _api/exam-tracker.js) creates a
   source_type 'job' suggestion; the engine's unique index
   on (source_type, source_id, template_key) makes it
   once-per-job, and with require_approval OFF the engine
   publishes immediately, still enforcing Truth Lock, the
   one-send-per-platform ledger and the daily caps.
   Best-effort: an engine hiccup never fails the publish. */
function callSocial(op, body) {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      url: `/api/social?op=${encodeURIComponent(op)}`,
      headers: { 'x-owner-key': String(process.env.OWNER_KEY || '') },
      body,
    };
    /* The handler may answer through status()/json() (auth
       failures) or end() (sendJson) — support both so the
       verdict always round-trips, never a TypeError. */
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { res.statusCode = code; return res; },
      json(b) { res.end(JSON.stringify(b)); return res; },
      end(data) {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (_) { json = null; }
        resolve({ status: res.statusCode, body: json });
      },
    };
    Promise.resolve(require('./social')(req, res)).catch(() =>
      resolve({ status: 500, body: { error: 'Social engine unavailable' } }));
  });
}

/* Queue (and, when auto-approval is ON, publish) one job
   through the engine. Returns a verdict for the logs. */
async function queueJobSuggestion(jobId) {
  const created = await callSocial('create', {
    op: 'create', source_type: 'job', source_id: String(jobId),
  });
  const suggestion = created.body && created.body.suggestion;
  if (!suggestion) {
    const err = created.body && (created.body.error || created.body.details);
    return { queued: false, error: err || 'Social engine did not create a suggestion' };
  }
  if (suggestion.status !== 'approved') {
    return { queued: true, suggestion_id: suggestion.id, status: suggestion.status };
  }
  /* Auto-approval is ON — publish through the engine
     (Truth Lock + caps + one-send-per-platform). */
  const published = await callSocial('publish', { op: 'publish', id: suggestion.id });
  const outcomes = (published.body && published.body.result && published.body.result.results) || [];
  const sent = outcomes.some((o) => o.ok && !o.skipped);
  return { queued: true, suggestion_id: suggestion.id, sent };
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

  /* The rest of the app writes review_state in Title Case ('Pending Review',
     'Deleted'…), so exact eq.<lowercase> filters matched nothing and the
     Review queue always looked empty. ilike.*value* matches any casing and
     any value that merely contains the word. */
  if (tab === 'published') parts.push('published=eq.true', 'review_state=neq.deleted', 'review_state=neq.Deleted');
  else if (tab === 'deleted') parts.push('or=(review_state=ilike.*deleted*,review_state=eq.deleted)');
  else if (tab === 'rejected') parts.push('published=eq.false', 'review_state=ilike.*rejected*');
  else parts.push('published=eq.false', 'or=(review_state=ilike.*pending*,review_state=is.null)');

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
    if (!['review', 'published', 'deleted', 'rejected'].includes(tab)) {
      return res.status(400).json({ error: 'Unknown jobs tab' });
    }
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

  /* action=add moves a Discovery candidate into the review queue without
     publishing it (payload arrives as body.job); action=unpublish sends
     published jobs back to Review — the Jobs-tab Unpublish button relies on
     it. Both mirror the routes the admin SPA already calls. */
  if (body.action === 'add') {
    const job = body.job && typeof body.job === 'object' ? body.job : null;
    if (!job) return res.status(400).json({ error: 'Missing job object' });
    const row = { ...job };
    delete row.id; delete row.created_at; delete row.updated_at;
    row.published = false;
    row.review_state = 'Pending Review';
    if (!row.status || row.status === 'Active') row.status = 'Pending Review';
    if (!row.created_at) row.created_at = new Date().toISOString();
    if (!row.slug) row.slug = (String(row.role || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job') + '-' + Date.now();
    try {
      const r = await supa('jobs', { method: 'POST', body: JSON.stringify(row) });
      if (!r.ok) {
        const detail = await r.text();
        console.error('admin-jobs add status:', r.status, String(detail).slice(0, 300));
        return res.status(500).json({ error: 'Job could not be added', details: String(detail).slice(0, 300) });
      }
      return res.status(201).json({ ok: true, action: 'add', added: 1 });
    } catch (e) {
      console.error('admin-jobs add error:', e && e.message);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  const action = String(body.action || '').toLowerCase();
  if (!['publish', 'reject', 'delete', 'restore', 'unpublish'].includes(action)) {
    return res.status(400).json({ error: 'Unknown action: ' + action });
  }

  const ids = Array.from(new Set(
    body.ids.map(String).map((s) => s.trim()).filter(Boolean)
  )).slice(0, 500);

  if (!ids.length) {
    return res.status(400).json({ error: 'No valid ids' });
  }

  const updates = {};
  if (action === 'publish') { updates.published = true; updates.review_state = 'Published'; updates.status = 'Active'; }
  else if (action === 'unpublish') { updates.published = false; updates.review_state = 'Pending Review'; }
  else if (action === 'reject') { updates.published = false; updates.review_state = 'Rejected'; }
  else if (action === 'delete') { updates.published = false; updates.review_state = 'Deleted'; }
  else if (action === 'restore') { updates.published = false; updates.review_state = 'Pending Review'; }

  let updated = 0;
  let updateErrors = 0;
  const CHUNK = 100;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    // PostgREST: PATCH jobs?id=in.("a","b",...)
    const inClause = 'id=in.(' + chunk.map((id) => '"' + encodeURIComponent(id) + '"').join(',') + ')';
    try {
      const r = await supa(`jobs?${inClause}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
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
        updateErrors += 1;
        console.error('admin-jobs patch status:', r.status, action, chunk.length);
      }
    } catch (e) {
      updateErrors += 1;
      console.error('admin-jobs patch error:', e && e.message);
    }
  }

  if (updateErrors) {
    return res.status(500).json({
      error: 'One or more job updates failed.',
      updated,
      requested: ids.length,
    });
  }

  /* Publish hook. Two mutually exclusive paths so a job can
     never be announced twice:
       * legacy gate OPEN (LEGACY_TELEGRAM_AUTOPOST=true/1) —
         the pre-engine direct Telegram post (F7). Duplicate
         safety lives entirely in lib/telegram-auto.js:
         autoPostToTelegram atomically claims telegram_posted
         false→true before sending, so only ONE caller ever
         posts a given job.
       * future Social Engine path — after the private-job migration is enabled:
         source_type 'job' suggestion in the Social Content
         Engine queue (approval + Truth Lock + caps). The
         engine's ledger dedupes sends per platform.
     Both paths are fire-and-forget and sequential: never
     blocks or fails the response. */
  if (action === 'publish' && updated > 0 && LEGACY_AUTOPOST_ON) {
    (async () => {
      for (const id of ids) {
        try {
          const fr = await supa(`jobs?select=*&id=eq.${encodeURIComponent(id)}&published=eq.true&limit=1`);
          if (!fr.ok) continue;
          const rows = await fr.json();
          if (Array.isArray(rows) && rows[0]) {
            await autoPostToTelegram(rows[0]);
            await new Promise((r) => setTimeout(r, 1200)); // Telegram rate limit
          }
        } catch (_) { /* keep going */ }
      }
    })();
  } else if (action === 'publish' && updated > 0) {
    /* Future default after the private-job migration: queue the
       published jobs in the Social engine (see queueJobSuggestion above). */
    (async () => {
      for (const id of ids) {
        try {
          const verdict = await queueJobSuggestion(id);
          if (verdict && verdict.queued === false) {
            console.error('admin-jobs social queue error:', id, verdict.error);
          }
          await new Promise((r) => setTimeout(r, 250));
        } catch (_) { /* keep going */ }
      }
    })();
  }

  return res.status(200).json({ ok: true, action, updated, requested: ids.length });
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
