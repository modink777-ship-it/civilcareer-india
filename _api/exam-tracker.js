/**
 * CivilCareer — Exam Tracker API (Feature 2)
 *
 * GET            → public: all ACTIVE exams (newest activity first)
 * POST (admin)   → create a new exam
 * PATCH/PUT(admin) → update an exam; a status change to `application_open`
 *                    routes a suggestion through the Social Content Engine
 *                    (once per change — the engine dedupes on
 *                    (source_type, source_id, template_key))
 *
 * Table: exam_tracker (see supabase-v20-exam-tracker.sql)
 * Auth:  admin routes require the x-owner-key header (lib/security.js)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');

const VALID_STATUSES = [
  'upcoming', 'notification_out', 'application_open', 'application_closed',
  'admit_card', 'exam_scheduled', 'result_out',
];

/* Admin-writable columns. Everything else in a request body is ignored. */
const WRITABLE_FIELDS = [
  'name', 'short_name', 'authority', 'category', 'status',
  'notification_date', 'application_start', 'application_end',
  'exam_date', 'result_date', 'official_url', 'eligibility_summary',
  'vacancy_count', 'exam_fee', 'age_limit', 'qualification',
  'is_active', 'notes',
];

const DATE_FIELDS = ['notification_date', 'application_start', 'application_end', 'result_date'];

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

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

/* Strip empty strings on date columns — PostgREST rejects '' for date type. */
function cleanPayload(raw) {
  const out = {};
  for (const field of WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    let value = raw[field];
    if (DATE_FIELDS.includes(field) && (value === '' || value == null)) { out[field] = null; continue; }
    if (field === 'vacancy_count') {
      if (value === '' || value == null) { out[field] = null; continue; }
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 0 || n > 10000000) continue;
      out[field] = n;
      continue;
    }
    if (field === 'is_active') { out[field] = Boolean(value); continue; }
    if (field === 'status') {
      const s = String(value || '').trim().toLowerCase();
      if (!VALID_STATUSES.includes(s)) continue;
      out[field] = s;
      continue;
    }
    if (typeof value === 'string') {
      value = value.trim();
      if (value.length > 2000) value = value.slice(0, 2000);
      out[field] = value;
    } else if (value != null) {
      out[field] = value;
    }
  }
  return out;
}

/* ── Social Content Engine announcement on application_open ────────
   Status transitions create a pending suggestion through the /api/social
   handler. This source path never publishes; an administrator must approve
   the exact text in the Social tab before any platform send.
   The engine's unique index makes the announcement once-per-change:
   re-running the transition returns the existing suggestion, and a
   platform that already sent is skipped, never re-posted.
   Best-effort, as before: an engine hiccup never fails the exam save. */
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
      json(body) { res.end(JSON.stringify(body)); return res; },
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

async function announceOpening(examId) {
  const created = await callSocial('create', {
    op: 'create', source_type: 'exam_tracker', source_id: String(examId),
  });
  const suggestion = created.body && created.body.suggestion;
  if (!suggestion) {
    const err = created.body && (created.body.error || created.body.details);
    return { sent: false, error: err || 'Social engine did not create a suggestion' };
  }
  return {
    sent: false,
    queued: true,
    suggestion_id: suggestion.id,
    reason: 'Queued for explicit administrator approval in the Social tab',
  };
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

  /* ── PUBLIC GET ── */
  if (req.method === 'GET') {
    allowPublicCors(req, res);
    try {
      const r = await supa('exam_tracker?select=*&is_active=eq.true&order=status.asc,updated_at.desc');
      if (!r.ok) {
        const detail = await r.text();
        // Missing table → run supabase-v20-exam-tracker.sql
        if (/PGRST205|relation .* does not exist|Could not find the table/i.test(detail)) {
          return res.status(503).json({ error: 'Exam tracker table missing. Run supabase-v20-exam-tracker.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Failed to load exams', details: detail.slice(0, 300) });
      }
      const exams = await r.json();
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ exams });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load exams', details: err.message });
    }
  }

  /* ── ADMIN ROUTES ── */
  if (!requireOwner(req, res)) return;

  const body = parseBody(req);
  const { id, key: _key, ...rest } = body;

  /* CREATE */
  if (req.method === 'POST') {
    const payload = cleanPayload(rest);
    if (!payload.name) return res.status(400).json({ error: 'Exam name is required' });
    if (!payload.status) payload.status = 'upcoming';
    payload.updated_at = new Date().toISOString();
    try {
      const r = await supa('exam_tracker', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Exam could not be created', details: detail.slice(0, 300) });
      }
      const rows = await r.json();
      return res.status(201).json({ success: true, exam: Array.isArray(rows) ? rows[0] : rows });
    } catch (err) {
      return res.status(500).json({ error: 'Exam could not be created', details: err.message });
    }
  }

  /* UPDATE — PATCH and PUT are equivalent here (the admin tab uses PUT) */
  if (req.method === 'PATCH' || req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const payload = cleanPayload(rest);
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'No valid fields to update' });

    try {
      // Previous row: for status-transition detection + Telegram payload fallback.
      const prevR = await supa(`exam_tracker?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!prevR.ok) return res.status(500).json({ error: 'Could not load the exam before update' });
      const prevRows = await prevR.json();
      const previous = prevRows[0];
      if (!previous) return res.status(404).json({ error: 'Exam not found' });

      payload.updated_at = new Date().toISOString();
      const r = await supa(`exam_tracker?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Exam could not be updated', details: detail.slice(0, 300) });
      }
      const rows = await r.json();
      const updated = Array.isArray(rows) ? rows[0] : rows;

      // Status transition to application_open → announce via the
      // Social Content Engine (approval queue + Truth Lock + caps).
      let telegram = { sent: false };
      if (
        payload.status === 'application_open' &&
        String(previous.status || '') !== 'application_open' &&
        previous.is_active !== false
      ) {
        telegram = await announceOpening(updated.id);
      }

      return res.status(200).json({ success: true, exam: updated, telegram });
    } catch (err) {
      return res.status(500).json({ error: 'Exam could not be updated', details: err.message });
    }
  }

  /* DELETE */
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const r = await supa(`exam_tracker?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) return res.status(500).json({ error: 'Exam could not be deleted' });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Exam could not be deleted', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
