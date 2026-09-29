const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function supa(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts.headers,
    },
  });
}

function isAdmin(req) {
  const k = req.headers['x-owner-key']
    || (req.body && (req.body.key || JSON.parse(typeof req.body==='string'?req.body:'{}').key||''));
  return k === process.env.OWNER_KEY;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const admin = isAdmin(req);
    const query = admin
      ? 'materials?order=created_at.desc'
      : 'materials?published=eq.true&order=created_at.desc';
    const r = await supa(query);
    if (!r.ok) return res.status(500).json({ error: 'Failed to load materials' });
    const materials = await r.json();
    return res.status(200).json({ materials });
  }

  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  if (req.method === 'POST') {
    // File upload to Supabase Storage
    if (body._upload && body.file_data) {
      try {
        const buffer = Buffer.from(body.file_data, 'base64');
        const fname = String(Date.now())+'-'+(body.file_name||'file.pdf').replace(/[^a-zA-Z0-9._-]/g,'-');
        const sr = await fetch(`${SUPA}/storage/v1/object/materials/${fname}`, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`,
            'Content-Type': body.file_type||'application/pdf', 'x-upsert': 'true' },
          body: buffer
        });
        if (!sr.ok) { const e=await sr.text(); return res.status(500).json({error:'Upload failed: '+e}); }
        return res.status(200).json({ url: `${SUPA}/storage/v1/object/public/materials/${fname}`, success: true });
      } catch(e) { return res.status(500).json({ error: e.message }); }
    }
    delete body.id; delete body.key; delete body._upload; delete body.file_data;
    delete body.file_name; delete body.file_type;
    // REVIEW-FIRST SAFETY: creating a material never auto-publishes it.
    // The admin publishes explicitly afterwards (Materials list → Publish,
    // or the Agent Reach inbox). Existing published materials are untouched.
    body.published = false;
    if (!body.review_state || body.review_state === 'Published') body.review_state = 'Pending Review';
    body.access_type = body.access_type || 'Free';
    body.created_at = new Date().toISOString();
    const r = await supa('materials', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
    const data = await r.json();
    return res.status(201).json({ material: Array.isArray(data) ? data[0] : data, success: true });
  }

  if (req.method === 'PATCH') {
    const { id, key, ...rest } = body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await supa(`materials?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(rest) });
    if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const id = body.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await supa(`materials?id=eq.${id}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
