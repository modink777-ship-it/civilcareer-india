/**
 * CivilCareer — Exams API
 * File: api/exams.js
 */
const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_KEY;

function supa(path, opts={}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...opts.headers
    }
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const r = await supa('exams?published=eq.true&order=created_at.desc');
    if (!r.ok) return res.status(500).json({ error: 'Failed to load exams' });
    const exams = await r.json();
    return res.status(200).json({ exams });
  }

  const key = req.headers['x-owner-key'] || req.body?.key;
  if (key !== process.env.OWNER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    delete body.id;
    body.published = true;
    const r = await supa('exams', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
    const data = await r.json();
    return res.status(201).json({ exam: data[0] });
  }

  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { id, ...rest } = body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await supa(`exams?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(rest) });
    if (!r.ok) return res.status(500).json({ error: 'Update failed' });
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await supa(`exams?id=eq.${id}`, { method: 'DELETE' });
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' });
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
