/**
 * CivilCareer — Social Engine Phase 2 scheduler endpoint.
 *
 * /api/social-cron?op=run
 * - scheduled call: SOCIAL_CRON_SECRET (constant-time)
 * - manual admin call: OWNER_KEY
 *
 * The endpoint only creates pending Deadline Radar suggestions and drains
 * suggestions that have already received human approval. It never publishes
 * newly generated radar suggestions without approval.
 */
const crypto = require('crypto');
const radarService = require('../lib/social-radar-service');
const social = require('./social');

function sameSecret(supplied, expected) {
  const a = Buffer.from(String(supplied || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function suppliedOwner(req) {
  if (req && req.headers && req.headers['x-owner-key']) return String(req.headers['x-owner-key']);
  return '';
}

function cronAuthorized(req) {
  const expected = String(process.env.SOCIAL_CRON_SECRET || '').trim();
  if (!expected) return false;
  const auth = String((req.headers && req.headers.authorization) || '');
  const bearer = auth.replace(/^Bearer\s+/i, '');
  const header = String((req.headers && req.headers['x-cron-secret']) || '');
  return sameSecret(bearer, expected) || sameSecret(header, expected);
}

function ownerAuthorized(req) {
  const expected = String(process.env.OWNER_KEY || '').trim();
  return sameSecret(suppliedOwner(req), expected);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function settings() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
  if (!url || !key) return { caps_timezone: 'Asia/Kolkata', site_url: process.env.SITE_URL || '' };
  try {
    const r = await fetch(url + '/rest/v1/social_settings?id=eq.1&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : { caps_timezone: 'Asia/Kolkata', site_url: process.env.SITE_URL || '' };
  } catch (_) {
    return { caps_timezone: 'Asia/Kolkata', site_url: process.env.SITE_URL || '' };
  }
}

module.exports = async function socialCronHandler(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let query = {};
  try { query = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams); } catch (_) {}
  const op = String(query.op || body.op || 'run');

  const isCron = cronAuthorized(req);
  const isOwner = ownerAuthorized(req);
  if (!isCron && !isOwner) return json(res, 401, { error: 'Social cron authorization required' });

  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });

  try {
    const cfg = await settings();

    if (op === 'radar') {
      const out = await radarService.generateRadarSuggestions({
        limit: query.limit || body.limit,
        sourceType: query.source_type || body.source_type,
        settings: cfg,
        createdBy: isCron ? 'social-cron' : 'admin',
      });
      return json(res, 200, { ok: true, mode: 'radar', ...out });
    }

    if (op === 'update') {
      if (isCron) return json(res, 403, { error: 'Scheduled social cron cannot create manual update posts' });
      const sourceType = String(query.source_type || body.source_type || '');
      const sourceId = String(query.source_id || body.source_id || body.id || '');
      const out = await radarService.generateUpdateSuggestion(sourceType, sourceId, cfg, 'admin');
      return json(res, out.ok ? 200 : (out.status || 400), out);
    }

    if (op === 'run') {
      const radar = await radarService.generateRadarSuggestions({
        limit: query.limit || body.limit,
        settings: cfg,
        createdBy: isCron ? 'social-cron' : 'admin',
      });
      const drained = await social._internal.drainQueue(Number(query.drain_limit || body.drain_limit) || 20);
      return json(res, drained.status === 200 ? 200 : drained.status, {
        ok: drained.status === 200,
        mode: 'run',
        radar,
        drain: drained.result || { error: drained.error },
      });
    }

    return json(res, 400, { error: 'Unknown op. Use run, radar or update.' });
  } catch (err) {
    return json(res, 500, { error: 'Social cron request failed' });
  }
};

module.exports._internal = { sameSecret, cronAuthorized, ownerAuthorized };
