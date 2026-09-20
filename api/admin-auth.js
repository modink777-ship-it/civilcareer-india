/**
 * CivilCareer India - Admin authentication
 *
 * Supports GET and POST.
 * The owner key is read only from Vercel's OWNER_KEY environment variable.
 * The secret itself is never returned to the browser.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,x-owner-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const configured = String(process.env.OWNER_KEY || '');
  const supplied = String(req.headers['x-owner-key'] || '');

  if (!configured) {
    return res.status(503).json({
      ok: false,
      error: 'Admin authentication is not configured on this deployment'
    });
  }

  if (!supplied || supplied !== configured) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid owner key'
    });
  }

  return res.status(200).json({
    ok: true,
    authenticated: true
  });
};
