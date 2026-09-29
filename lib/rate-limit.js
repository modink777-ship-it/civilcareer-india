/* lib/rate-limit.js — shared per-IP rate limiter + Turnstile verification.

   Zero-cost stack: the limiter is an in-memory sliding window (per serverless
   instance; Vercel warm instances make this effective in practice) and the
   captcha is Cloudflare Turnstile, whose keys are optional — when
   TURNSTILE_SECRET_KEY is not configured the check is skipped so forms keep
   working before the owner enables it. */
const buckets = new Map();

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

/**
 * Sliding-window limiter.
 * @returns {boolean} true when the request is allowed.
 */
function rateLimit(req, { windowMs = 60 * 60 * 1000, max = 5, key = 'default' } = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  const bucketKey = `${key}:${ip}`;
  const slot = buckets.get(bucketKey) || { started: now, count: 0 };
  if (now - slot.started > windowMs) { slot.started = now; slot.count = 0; }
  slot.count += 1;
  buckets.set(bucketKey, slot);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.started > windowMs) buckets.delete(k);
  }
  return slot.count <= max;
}

/**
 * Cloudflare Turnstile server-side verification.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function verifyTurnstile(req, token) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  /* Enforce only when the widget is actually wired to the frontend (site key
     set). A lone secret would block every real user, since no page could
     ever produce a token. */
  if (!secret || !siteKey) return { ok: true };
  if (!token) return { ok: false, error: 'Please complete the human verification.' };
  try {
    const body = new URLSearchParams({
      secret,
      response: String(token || ''),
      remoteip: clientIp(req),
    });
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(6000),
    });
    const data = await r.json().catch(() => ({}));
    if (data && data.success) return { ok: true };
    return { ok: false, error: 'Human verification failed. Please try again.' };
  } catch {
    /* Fail open on network errors so the free tier never blocks real users;
       rate limiting + honeypot still apply. */
    return { ok: true };
  }
}

module.exports = { rateLimit, verifyTurnstile, clientIp };
