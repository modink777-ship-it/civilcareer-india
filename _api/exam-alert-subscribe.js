/**
 * CivilCareer — Exam Alert Subscribe API (Feature 2)
 *
 * POST { name, whatsapp, email?, exam_id? | exam_ids? }
 *   → saves a row in exam_alert_subscribers (service-role write)
 *   → table is created automatically on first use if missing
 *     (uses SECURITY DEFINER DDL — no dashboard visit needed)
 *
 * Public endpoint: rate-limited per IP, strict input validation,
 * never leaks database errors to the client.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors } = require('../lib/security');

const UuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Naive fixed-window limiter (per lambda instance) — enough to blunt abuse. */
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 8;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.at > WINDOW_MS) {
    hits.set(ip, { at: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_PER_HOUR;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

/* Normalize to E.164 (+91XXXXXXXXXX). Returns null when invalid. */
function normalizeWhatsApp(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

const EmailRe = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

function cleanText(value, max) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
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

/* One-time table creation, so the endpoint works even before the SQL file
   is run. Requires the Supabase role to allow DDL; failures are surfaced
   to the ADMIN tab only — the subscriber gets a clear "run the SQL" error. */
let ddlAttempted = false;
async function ensureTable() {
  if (ddlAttempted) return true;
  ddlAttempted = true;
  try {
    const ddl = `
      CREATE TABLE IF NOT EXISTS exam_alert_subscribers (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        whatsapp text,
        email text,
        name text,
        exam_ids uuid[],
        city text,
        created_at timestamptz DEFAULT now()
      );
      ALTER TABLE exam_alert_subscribers ENABLE ROW LEVEL SECURITY;
      CREATE INDEX IF NOT EXISTS exam_subs_created_idx ON exam_alert_subscribers (created_at DESC);`;
    const r = await fetch(`${SUPA}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: ddl }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Server configuration is missing' });
  }

  /* Same-origin enforcement for public writes (CSRF guard). */
  const origin = String(req.headers.origin || '');
  const siteOrigin = String(process.env.SITE_URL || '').replace(/\/+$/, '');
  if (origin && siteOrigin && origin !== siteOrigin) {
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             String(req.socket?.remoteAddress || 'unknown');
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const body = parseBody(req);
  const name = cleanText(body.name, 80);
  const whatsapp = normalizeWhatsApp(body.whatsapp);
  const emailRaw = cleanText(body.email, 120);
  const email = emailRaw ? (EmailRe.test(emailRaw) ? emailRaw : null) : null;
  if (emailRaw && !email) {
    return res.status(400).json({ error: 'Please enter a valid email address or leave it blank.' });
  }

  if (!whatsapp) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
  }

  /* exam_ids: uuid array, deduped, capped at 50. exam_id (singular) is the
     common case from the Alert Me modal and is accepted too. */
  let examIds = [];
  if (Array.isArray(body.exam_ids)) examIds = body.exam_ids;
  else if (body.exam_id) examIds = [body.exam_id];
  examIds = [...new Set(examIds.map(x => String(x || '').trim()).filter(x => UuidRe.test(x)))].slice(0, 50);
  if (examIds.length > 50) examIds = examIds.slice(0, 50);

  const row = {
    name: name || null,
    whatsapp,
    email,
    exam_ids: examIds,
    city: cleanText(body.city, 80) || null,
  };

  try {
    let r = await supa('exam_alert_subscribers', { method: 'POST', body: JSON.stringify(row) });
    if (!r.ok) {
      const detail = await r.text();
      if (/PGRST205|relation .* does not exist|Could not find the table/i.test(detail)) {
        const made = await ensureTable();
        if (made) {
          r = await supa('exam_alert_subscribers', { method: 'POST', body: JSON.stringify(row) });
        } else {
          return res.status(503).json({
            error: 'Alert storage is not set up yet. Run supabase-v20-exam-tracker.sql in the Supabase SQL Editor.',
          });
        }
      } else {
        return res.status(500).json({ error: 'Could not save your alert right now. Please try again.' });
      }
    }
    if (!r.ok) {
      return res.status(500).json({ error: 'Could not save your alert right now. Please try again.' });
    }
    return res.status(201).json({ success: true, message: "You're subscribed! We'll alert you on WhatsApp when this exam updates." });
  } catch (_) {
    return res.status(500).json({ error: 'Could not save your alert right now. Please try again.' });
  }
};
