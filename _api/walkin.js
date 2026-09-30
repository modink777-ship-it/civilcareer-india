/**
 * CivilCareer — Walk-In Interview Board API (Feature 6)
 *
 * PUBLIC
 *   GET ?city=X            → published walk-ins with date >= today
 *                            (sorted by date; expires_at filtered out)
 *
 * ADMIN (x-owner-key header or body.key — OWNER_KEY required)
 *   POST   { company, roles, date, time_start, time_end, venue, city,
 *            state, experience_required, qualification, salary_offered,
 *            documents_required, contact, source_url, published }
 *          → create a walk-in
 *   PUT    { id, published } → publish / unpublish
 *   DELETE { id }            → remove
 *
 * Table: walkin_interviews (see supabase-v22-walkin.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');

const WRITABLE_FIELDS = [
  'company', 'roles', 'date', 'time_start', 'time_end', 'venue', 'city',
  'state', 'experience_required', 'qualification', 'salary_offered',
  'documents_required', 'contact', 'source_url', 'published', 'expires_at',
];
const REQUIRED_ON_CREATE = ['company', 'roles', 'date', 'venue'];

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function cleanText(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

const DateRe = /^\d{4}-\d{2}-\d{2}$/;
const TimeRe = /^\d{1,2}:\d{2}(:\d{2})?$/;

function cleanPayload(raw) {
  const out = {};
  for (const field of WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    let value = raw[field];

    if (field === 'published') { out[field] = Boolean(value); continue; }

    if (field === 'date' || field === 'expires_at') {
      const d = cleanText(value, 10);
      if (DateRe.test(d)) out[field] = d; else out[field] = null;
      continue;
    }
    if (field === 'time_start' || field === 'time_end') {
      const t = cleanText(value, 8);
      out[field] = TimeRe.test(t) ? t : null;
      continue;
    }
    if (field === 'source_url') {
      const u = cleanText(value, 500);
      if (u && /^https?:\/\//i.test(u)) out[field] = u;
      continue;
    }
    const max = field === 'documents_required' ? 500 : 300;
    const text = cleanText(value, max);
    if (text) out[field] = text;
  }
  return out;
}

function supa(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

/* Admin identification mirrors _api/exams.js: header OR body key. */
function adminKeyProvided(req) {
  return Boolean(req.headers['x-owner-key'] || parseBody(req).key);
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Supabase server configuration is missing' });
  }

  /* ── PUBLIC GET — upcoming published drives ── */
  if (req.method === 'GET' && !adminKeyProvided(req)) {
    allowPublicCors(req, res);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try {
      const city = cleanText(req.query?.city, 60);
      const filters = [
        'published=eq.true',
        `date=gte.${todayStr}`,
        `or=(expires_at.is.null,expires_at.gte.${todayStr})`,
      ];
      if (city) filters.push(`city=ilike.${encodeURIComponent('%' + city.replace(/[%_\\]/g, m => '\\' + m) + '%')}`);
      const r = await supa(`walkin_interviews?select=*&${filters.join('&')}&order=date.asc&limit=200`);
      if (!r.ok) {
        const detail = await r.text();
        if (/PGRST205|relation .* does not exist/i.test(detail)) {
          return res.status(503).json({ error: 'Walk-in table missing. Run supabase-v22-walkin.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Failed to load walk-ins' });
      }
      const walkins = await r.json();
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ walkins, today: todayStr });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load walk-ins', details: err.message });
    }
  }

  /* ── ADMIN ROUTES ── */
  if (!requireOwner(req, res)) return;

  const body = parseBody(req);
  const { id, key: _key, ...rest } = body;

  /* ADMIN GET — all walk-ins (published + pending, past included) */
  if (req.method === 'GET') {
    try {
      const r = await supa('walkin_interviews?select=*&order=date.desc&limit=500');
      if (!r.ok) {
        const detail = await r.text();
        if (/PGRST205|relation .* does not exist/i.test(detail)) {
          return res.status(503).json({ error: 'Walk-in table missing. Run supabase-v22-walkin.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Failed to load walk-ins' });
      }
      return res.status(200).json({ walkins: await r.json() });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load walk-ins', details: err.message });
    }
  }

  /* CREATE */
  if (req.method === 'POST') {
    const payload = cleanPayload(rest);
    const missing = REQUIRED_ON_CREATE.filter(f => !payload[f]);
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'published')) payload.published = false;
    payload.created_at = new Date().toISOString();
    try {
      const r = await supa('walkin_interviews', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok) {
        const detail = await r.text();
        if (/PGRST205|relation .* does not exist/i.test(detail)) {
          return res.status(503).json({ error: 'Walk-in table missing. Run supabase-v22-walkin.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Walk-in could not be created', details: detail.slice(0, 300) });
      }
      const rows = await r.json();
      return res.status(201).json({ success: true, walkin: Array.isArray(rows) ? rows[0] : rows });
    } catch (err) {
      return res.status(500).json({ error: 'Walk-in could not be created', details: err.message });
    }
  }

  /* PUBLISH / UNPUBLISH (and any other field update) */
  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const payload = cleanPayload(rest);
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'No valid fields to update' });
    try {
      const r = await supa(`walkin_interviews?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (!r.ok) return res.status(500).json({ error: 'Walk-in could not be updated' });
      const rows = await r.json();
      return res.status(200).json({ success: true, walkin: Array.isArray(rows) ? rows[0] : rows });
    } catch (err) {
      return res.status(500).json({ error: 'Walk-in could not be updated', details: err.message });
    }
  }

  /* DELETE */
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const r = await supa(`walkin_interviews?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) return res.status(500).json({ error: 'Walk-in could not be deleted' });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Walk-in could not be deleted', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
