/**
 * CivilCareer — WhatsApp Alert Subscription API (Feature 9)
 *
 * PUBLIC
 *   POST { name, whatsapp, city, preferred_roles[], preferred_sectors[], language }
 *        → upserts on the UNIQUE whatsapp number (re-subscribe updates prefs)
 *        → { ok: true, message: "Subscribed successfully" }
 *
 * ADMIN (x-owner-key)
 *   GET → { subscribers: [...], total }
 *
 * Table: whatsapp_subscribers (see supabase-v23-whatsapp-subscribers.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');

const SECTORS = ['Government', 'Private', 'PSU', 'MNC'];
const LANGUAGES = ['en', 'hi', 'te', 'kn', 'ta', 'mr'];
const MAX_ROLES = 10;

/* Naive fixed-window limiter (per lambda instance). */
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 6;

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

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* E.164 (+91XXXXXXXXXX). Returns null when invalid. */
function normalizeWhatsApp(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

const EmailRe = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

function cleanList(value, maxItems) {
  const arr = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(
    arr.map(x => cleanText(x, 80)).filter(Boolean)
  )].slice(0, maxItems);
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

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Supabase server configuration is missing' });
  }

  /* ── ADMIN GET — subscriber list ── */
  if (req.method === 'GET' && Boolean(req.headers['x-owner-key'])) {
    if (!requireOwner(req, res)) return;
    try {
      const r = await supa('whatsapp_subscribers?select=*&order=created_at.desc&limit=10000');
      if (!r.ok) {
        const detail = await r.text();
        if (/PGRST205|relation .* does not exist/i.test(detail)) {
          return res.status(503).json({ error: 'WhatsApp subscribers table missing. Run supabase-v23-whatsapp-subscribers.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Failed to load subscribers' });
      }
      const subscribers = await r.json();
      return res.status(200).json({ subscribers, total: subscribers.length });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load subscribers', details: err.message });
    }
  }

  /* ── PUBLIC POST — subscribe / re-subscribe ── */
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
  const city = cleanText(body.city, 60);
  const emailRaw = cleanText(body.email, 120);
  const email = emailRaw ? (EmailRe.test(emailRaw) ? emailRaw : null) : null;
  if (emailRaw && !email) {
    return res.status(400).json({ error: 'Please enter a valid email address or leave it blank.' });
  }
  const language = LANGUAGES.includes(body.language) ? body.language : 'en';
  const roles = cleanList(body.preferred_roles, MAX_ROLES);
  const sectors = cleanList(body.preferred_sectors, MAX_ROLES)
    .filter(s => SECTORS.includes(s));

  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!whatsapp) return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });

  const row = {
    name,
    whatsapp, /* UNIQUE — upsert key */
    city: city || null,
    preferred_roles: roles,
    preferred_sectors: sectors,
    language,
    is_active: true,
  };

  try {
    /* Upsert on the whatsapp unique constraint — one row per number;
       re-subscribing refreshes preferences and reactivates. */
    const r = await supa('whatsapp_subscribers', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const detail = await r.text();
      if (/PGRST205|relation .* does not exist/i.test(detail)) {
        return res.status(503).json({ error: 'Subscriber storage is not set up yet. Run supabase-v23-whatsapp-subscribers.sql in Supabase.' });
      }
      return res.status(500).json({ error: 'Could not subscribe right now. Please try again.' });
    }
    return res.status(201).json({ ok: true, message: 'Subscribed successfully' });
  } catch (_) {
    return res.status(500).json({ error: 'Could not subscribe right now. Please try again.' });
  }
};
