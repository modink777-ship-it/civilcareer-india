/**
 * CivilCareer — Supabase admin-session helper (owner allowlist)
 * GET ?op=whoami    → { email, user_id } for the current session
 * POST { op:'refresh_token', refresh_token } → rotated access token
 *
 * The access token check mirrors api/[[...path]].js requireAdmin: the
 * Supabase user must match ADMIN_EMAIL or ADMIN_USER_ID. Refresh uses the
 * anon key with the caller's refresh_token ( Supabase rotates tokens);
 * the result is re-checked against the allowlist before being returned,
 * so a demoted or removed admin cannot mint fresh access.
 */

const SUPA_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_USER_ID = String(process.env.ADMIN_USER_ID || '').trim();

async function fetchUser(accessToken) {
  const r = await fetch(`${SUPA_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return r.json();
}

function allowed(user) {
  if (!user) return false;
  const emailOk = ADMIN_EMAIL && String(user.email || '').toLowerCase() === ADMIN_EMAIL;
  const idOk = ADMIN_USER_ID && String(user.id || '') === ADMIN_USER_ID;
  return Boolean(emailOk || idOk);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPA_URL || !ANON || (!ADMIN_EMAIL && !ADMIN_USER_ID)) {
    return res.status(503).json({ error: 'Admin authentication is not configured.' });
  }

  try {
    if (req.method === 'GET') {
      const auth = String(req.headers.authorization || '');
      const token = auth.replace(/^Bearer\s+/i, '').trim();
      if (!token) return res.status(401).json({ error: 'Missing session token.' });
      const user = await fetchUser(token);
      if (!allowed(user)) return res.status(403).json({ error: 'Administrator access denied.' });
      return res.status(200).json({ email: user.email, user_id: user.id });
    }

    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      if (String(body.op || '') !== 'refresh_token' || !body.refresh_token) {
        return res.status(400).json({ error: 'refresh_token required.' });
      }
      const r = await fetch(`${SUPA_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: body.refresh_token }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok || !x.access_token) {
        return res.status(401).json({ error: x.error_description || 'Session refresh failed — sign in again.' });
      }
      const user = await fetchUser(x.access_token);
      if (!allowed(user)) return res.status(403).json({ error: 'Administrator access denied.' });
      return res.status(200).json({
        access_token: x.access_token,
        refresh_token: x.refresh_token,
        expires_in: x.expires_in || 3600,
      });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(503).json({ error: err.message || 'Auth service unavailable.' });
  }
};
