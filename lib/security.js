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

/* ── Admin session hardening ─────────────────────────────────────
   The owner credential was exposed in chat, so three things now hold:
     1. A session is refused outright once it is older than
        ADMIN_SESSION_TTL_SECONDS, even though Supabase access tokens
        live ~1 hour. Enforced server-side from the token's own `iat`
        (which Supabase has already validated), so it cannot be
        bypassed by a client clock.
     2. Every gate decision is recorded in admin_audit (v33) — who,
        from where, allowed or refused. Tokens are never written.
     3. Sessions can be revoked globally, which kills the refresh
        tokens an attacker would need to keep a stolen session alive. */
const ADMIN_SESSION_TTL_SECONDS = 1800;

function adminSessionAgeSeconds(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const iat = Number(payload && payload.iat);
    if (!Number.isFinite(iat) || iat <= 0) return null;
    return Math.floor(Date.now() / 1000) - iat;
  } catch (_) {
    return null;
  }
}

/** true when the session is young enough to keep using. */
function adminSessionFresh(token, ttlSeconds = ADMIN_SESSION_TTL_SECONDS) {
  const age = adminSessionAgeSeconds(token);
  /* No readable iat: fall back to Supabase's own validity window rather
     than locking the owner out (opaque tokens are still verified). */
  if (age === null) return true;
  return age <= ttlSeconds;
}

async function supaService(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return fetch(`${String(url).replace(/\/$/, '')}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

/**
 * Append a gate decision to admin_audit. Best-effort by design: an
 * audit failure must never block a legitimate or blocked request, and
 * a token is never passed in.
 */
async function recordAdminEvent(event, req, detail = {}) {
  try {
    const user = detail.user || (req && req.adminUser) || null;
    const body = {
      event: String(event || 'unknown').slice(0, 60),
      email: user && user.email ? String(user.email).slice(0, 200) : null,
      user_id: user && user.id ? String(user.id).slice(0, 80) : null,
      ip: req ? clientIp(req).slice(0, 80) : null,
      user_agent: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 300) || null,
      detail: detail.detail && typeof detail.detail === 'object' ? detail.detail : {},
    };
    const r = await supaService('admin_audit', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    return Boolean(r && r.ok);
  } catch (_) {
    return false;
  }
}

/**
 * Revoke every refresh token for the caller (Supabase Auth global
 * sign-out). Access tokens already issued stay valid until they
 * expire — which is exactly why the TTL cap above exists. Returns
 * { ok, status, error } and never throws.
 */
async function revokeAdminSessions(userToken) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon || !userToken) {
    return { ok: false, status: 503, error: 'Authentication is not configured.' };
  }
  try {
    const r = await fetch(`${String(url).replace(/\/$/, '')}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) {
      return { ok: false, status: r.status, error: 'Supabase refused the revoke (' + r.status + ').' };
    }
    return { ok: true, status: r.status || 204 };
  } catch (e) {
    return { ok: false, status: 503, error: String((e && e.message) || e) };
  }
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
    /* Age cap: a verified session older than the TTL must sign in again
       (the access token itself would still be accepted by Supabase). */
    if (!adminSessionFresh(token)) {
      return { ok: false, status: 401, error: 'Administrator session expired — sign in again.' };
    }
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

module.exports = {
  SITE_URL, SITE_ORIGIN, allowPublicCors, allowSameOrigin, sameOrigin,
  ownerKeyMatches, requireOwner, verifyAdminToken,
  ADMIN_SESSION_TTL_SECONDS, adminSessionAgeSeconds, adminSessionFresh,
  recordAdminEvent, revokeAdminSessions,
};
