/**
 * CivilCareer — admin session control (hardening)
 *
 * ADMIN-ONLY on every method: the dispatcher's ADMIN_RULES elevates the
 * dashboard session through verifyAdminToken before this handler runs.
 *
 *   GET                       → the session policy this deployment enforces
 *   POST {action:'revoke-sessions'}
 *                             → global Supabase sign-out for the caller:
 *                               every refresh token for the account is
 *                               destroyed, so a stolen session cannot be
 *                               kept alive. Already-issued ACCESS tokens
 *                               stay valid until they expire, which is
 *                               why lib/security.js also caps session age
 *                               at ADMIN_SESSION_TTL_SECONDS.
 *
 * No token, secret or email is ever returned by this endpoint, and both
 * branches are written to admin_audit (v33).
 */

const {
  ADMIN_SESSION_TTL_SECONDS,
  recordAdminEvent,
  revokeAdminSessions,
} = require('../lib/security');

function bearerToken(req) {
  const m = String(req.headers?.authorization || '').match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!req.adminUser) {
    return res.status(401).json({ error: 'Administrator authentication required.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      session_ttl_seconds: ADMIN_SESSION_TTL_SECONDS,
      cookie: 'cc_admin_session; path=/; same-site=strict',
      audit_table: 'admin_audit',
      note: 'Sessions older than session_ttl_seconds are refused server-side even if the access token has not expired yet.',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  if (String(body.action || '') !== 'revoke-sessions') {
    return res.status(400).json({ error: "Unknown action. Use {action:'revoke-sessions'}." });
  }

  const token = bearerToken(req);
  const result = await revokeAdminSessions(token);
  await recordAdminEvent(result.ok ? 'sessions_revoked' : 'sessions_revoke_failed', req, {
    user: req.adminUser,
    detail: result.ok ? { scope: 'global' } : { status: result.status, error: String(result.error || '').slice(0, 120) },
  });

  if (!result.ok) {
    return res.status(502).json({
      ok: false,
      error: result.error || 'Session revoke failed.',
      hint: 'Rotate the account password in the Supabase dashboard to invalidate existing sessions.',
    });
  }

  return res.status(200).json({
    ok: true,
    scope: 'global',
    message: 'Every refresh token for this account is revoked. Access tokens already issued stop working when this session reaches its TTL.',
    next: 'Sign in again on this device.',
  });
};
