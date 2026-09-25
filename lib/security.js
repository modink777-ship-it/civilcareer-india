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

function allowSameOrigin(req, res) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'Cross-origin request blocked.' });
    return false;
  }
  if (SITE_ORIGIN) res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN);
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

module.exports = { SITE_URL, SITE_ORIGIN, allowSameOrigin, sameOrigin, ownerKeyMatches, requireOwner };
