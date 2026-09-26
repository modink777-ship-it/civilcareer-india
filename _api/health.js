/**
 * CivilCareer launch/readiness health endpoint.
 * Never returns secret values. This is configuration readiness, not a DB query.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const required = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_ANON_KEY: Boolean(process.env.SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
    OWNER_KEY: Boolean(process.env.OWNER_KEY),
    SITE_URL: Boolean(process.env.SITE_URL),
  };

  const missing = Object.keys(required).filter((key) => !required[key]);
  const ready = missing.length === 0;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.status(ready ? 200 : 503).json({
    ok: ready,
    service: 'civilcareer',
    checks: required,
    missing,
  });
};
