const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = new Set([
    SITE_URL,
    'https://civilcareer-india-two.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ]);
  return allowed.has(origin) ? origin : SITE_URL;
}

function validateSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{12,128}$/.test(value.trim());
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

module.exports = async function handler(req, res) {
  const origin = getAllowedOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session-id,x-owner-key');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.headers['x-session-id'];
  if (!validateSessionId(sessionId)) {
    return res.status(400).json({ error: 'Missing or invalid session ID' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const type = url.searchParams.get('type') || 'profile';
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  if (type === 'profile') {
    if (req.method === 'GET') {
      const [pr, pf] = await Promise.all([
        supa(`user_profiles?session_id=eq.${encodeURIComponent(sessionId)}&limit=1`),
        supa(`job_preferences?session_id=eq.${encodeURIComponent(sessionId)}&limit=1`),
      ]);
      return res.status(200).json({
        profile: pr.ok ? (await pr.json())[0] || null : null,
        preferences: pf.ok ? (await pf.json())[0] || null : null,
      });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const { profile = {}, preferences = {} } = body;
      const now = new Date().toISOString();
      const pr = await supa('user_profiles', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ ...profile, session_id: sessionId, updated_at: now }),
      });
      const pf = await supa('job_preferences', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ ...preferences, session_id: sessionId, updated_at: now }),
      });
      if (!pr.ok || !pf.ok) {
        const e = !pr.ok ? await pr.text() : await pf.text();
        return res.status(500).json({ error: e });
      }
      const sp = await pr.json();
      const sf = await pf.json();
      return res.status(200).json({
        success: true,
        profile: Array.isArray(sp) ? sp[0] : sp,
        preferences: Array.isArray(sf) ? sf[0] : sf,
      });
    }
  }

  if (type === 'jobs') {
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      const q = action
        ? `job_interactions?session_id=eq.${encodeURIComponent(sessionId)}&action=eq.${action}&order=created_at.desc`
        : `job_interactions?session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.desc`;
      const r = await supa(q);
      return res.status(200).json({ interactions: r.ok ? await r.json() : [] });
    }
    if (req.method === 'POST') {
      const { job_id, action, notes } = body;
      if (!job_id || !action) return res.status(400).json({ error: 'Missing job_id or action' });
      const r = await supa('job_interactions', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          session_id: sessionId,
          job_id,
          action,
          notes: notes || null,
          created_at: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const e = await r.text();
        return res.status(500).json({ error: e });
      }
      const data = await r.json();
      return res.status(200).json({ success: true, interaction: Array.isArray(data) ? data[0] : data });
    }
    if (req.method === 'DELETE') {
      const { job_id } = body;
      if (!job_id) return res.status(400).json({ error: 'Missing job_id' });
      const r = await supa(
        `job_interactions?session_id=eq.${encodeURIComponent(sessionId)}&job_id=eq.${job_id}`,
        { method: 'DELETE' }
      );
      if (!r.ok) return res.status(500).json({ error: 'Delete failed' });
      return res.status(200).json({ success: true });
    }
  }

  return res.status(400).json({ error: 'Unknown type' });
};

