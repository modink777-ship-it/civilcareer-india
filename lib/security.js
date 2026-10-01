const crypto = require('crypto');

const SITE_URL = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');
const SITE_ORIGIN = (() => { try { return new URL(SITE_URL).origin; } catch { return ''; } })();
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 12;

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

function sameOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  return !origin || !SITE_ORIGIN || origin === SITE_ORIGIN;
}

/**
 * Strict same-origin CORS — used for admin-only endpoints.
 * Blocks requests from origins that don't match SITE_ORIGIN.
 */
function allowSameOrigin(req, res) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'Cross-origin request blocked.' });
    return false;
  }
  if (SITE_ORIGIN) res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN);
  res.setHeader('Vary', 'Origin');
  return true;
}

/**
 * Open CORS — used for PUBLIC API endpoints (GET /api/jobs, /api/exams,
 * /api/materials, /api/health, etc.).
 * Sets Access-Control-Allow-Origin: * so any origin can read public data.
 * Does NOT block any request — always returns true.
 */
function allowPublicCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key, Authorization');
  res.setHeader('Vary', 'Origin');
  return true;
}

function ownerKeyMatches(req) {
  const expected = String(process.env.OWNER_KEY || '');
  const supplied = String(req.headers?.['x-owner-key'] || '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ownerAttempt(req, success) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && now - current.started < WINDOW_MS) {
    if (!success) current.failures += 1;
    return current.failures <= MAX_FAILURES;
  }
  attempts.set(ip, { started: now, failures: success ? 0 : 1 });
  return true;
}

function clearOwnerFailures(req) {
  attempts.delete(clientIp(req));
}

/**
 * Verify a Supabase access token against the admin allowlist
 * (ADMIN_EMAIL comma-list, dot-insensitive for Gmail, and/or
 * ADMIN_USER_ID). Shared by the API dispatcher (requireAdmin)
 * and the gated admin page (/api/admin-page) so both enforce
 * exactly the same rule. Fails closed: any misconfiguration or
 * network error returns { ok:false }.
 */
async function verifyAdminToken(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const adminEmail = String(process.env.ADMIN_EMAIL || '');
  const adminUserId = String(process.env.ADMIN_USER_ID || '').trim();
  if (!supabaseUrl || !anonKey || (!adminEmail.trim() && !adminUserId)) {
    return { ok: false, status: 503, error: 'Admin authentication is not configured.' };
  }
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, status: 401, error: 'Invalid admin session.' };
    const user = await r.json();
    /* Multiple addresses allowed, comma separated, so modin7174@ and
       modink777@ can both be the owner. Dot-insensitive for GMail. */
    const gotEmail = String(user.email || '').toLowerCase().replace(/\.$/, '');
    const emailOk = adminEmail.split(',').some(e => {
      const want = e.trim().toLowerCase().replace(/\.$/, '');
      if (!want) return false;
      return gotEmail === want || gotEmail.replace(/\./g, '') === want.replace(/\./g, '');
    });
    const idOk = adminUserId && String(user.id || '') === adminUserId;
    if (!emailOk && !idOk) return { ok: false, status: 403, error: 'Administrator access denied.' };
    return { ok: true, user };
  } catch (_) {
    return { ok: false, status: 503, error: 'Could not verify administrator session.' };
  }
}

function requireOwner(req, res) {
  if (!process.env.OWNER_KEY) {
    res.status(503).json({ error: 'Admin authentication is not configured.' });
    return false;
  }
  const valid = ownerKeyMatches(req);
  const allowed = ownerAttempt(req, valid);
  if (!allowed || !valid) {
    if (!allowed) res.setHeader('Retry-After', '900');
    res.status(401).json({ error: 'Invalid owner key' });
    return false;
  }
  clearOwnerFailures(req);
  return true;
}

module.exports = { SITE_URL, SITE_ORIGIN, allowPublicCors, allowSameOrigin, sameOrigin, ownerKeyMatches, requireOwner, verifyAdminToken };
