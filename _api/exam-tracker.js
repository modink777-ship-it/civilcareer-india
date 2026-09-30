/**
 * CivilCareer — Exam Tracker API (Feature 2)
 *
 * GET            → public: all ACTIVE exams (newest activity first)
 * POST (admin)   → create a new exam
 * PATCH/PUT(admin) → update an exam; a status change to `application_open`
 *                    fires a Telegram channel announcement (once per change)
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

/* ── Telegram announcement on application_open ────────────────────────
   Plain text (no Markdown parse mode) so unusual exam names can never
   break delivery. Best-effort: a Telegram failure never fails the save. */
function tgApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const https = require('https');
  return new Promise(resolve => {
    if (!token) return resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
    const body = JSON.stringify(payload);
    const rq = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, rs => {
      let data = '';
      rs.on('data', d => { data += d; });
      rs.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve({ ok: false }); } });
    });
    rq.on('error', () => resolve({ ok: false }));
    rq.on('timeout', () => { rq.destroy(); resolve({ ok: false }); });
    rq.write(body);
    rq.end();
  });
}

function fmtDay(value) {
  if (!value) return 'TBA';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function examTelegramText(exam) {
  const lines = [
    '🟢 APPLICATIONS OPEN',
    `📋 ${exam.name || 'Civil Engineering Exam'}${exam.short_name ? ` (${exam.short_name})` : ''}`,
    exam.authority ? `🏛️ ${exam.authority}` : '',
    `📝 Apply by: ${fmtDay(exam.application_end)}`,
    exam.vacancy_count ? `👥 Vacancies: ~${Number(exam.vacancy_count).toLocaleString('en-IN')}` : '',
    exam.eligibility_summary ? `🎓 Eligibility: ${exam.eligibility_summary}` : '',
    exam.official_url ? `🔗 Official site: ${exam.official_url}` : '',
    '',
    'Track all exams: https://civilcareer-india-two.vercel.app/exam-tracker',
    '📢 @CivilCareerIndiaJobs',
  ];
  return lines.filter(Boolean).join('\n');
}

async function announceOpening(exam) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL_ID) {
    return { sent: false, reason: 'Telegram not configured' };
  }
  const result = await tgApi('sendMessage', {
    chat_id: process.env.TELEGRAM_CHANNEL_ID,
    text: examTelegramText(exam),
    disable_web_page_preview: true,
  });
  return { sent: Boolean(result.ok), error: result.ok ? undefined : (result.description || 'Telegram error') };
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

      // Status transition to application_open → announce on Telegram.
      let telegram = { sent: false };
      if (
        payload.status === 'application_open' &&
        String(previous.status || '') !== 'application_open' &&
        previous.is_active !== false
      ) {
        telegram = await announceOpening({ ...previous, ...payload });
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
