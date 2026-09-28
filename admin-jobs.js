'use strict';

/**
 * CivilCareer — Admin Jobs Management
 * GET   /api/admin-jobs?tab=published|pending|rejected&key=...
 * PATCH /api/admin-jobs { id, ...updates }
 * POST  /api/admin-jobs { key, action, ids[] } for bulk actions
 * POST  /api/admin-jobs { key, action:'add', job } for Discovery -> Review
 */

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OWNER_KEY = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;

function db(path, opts = {}) {
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

function getQuery(req) {
  if (req.query) return req.query;
  try { return Object.fromEntries(new URL(req.url || '', 'https://x.local').searchParams.entries()); }
  catch { return {}; }
}

function isAdmin(req) {
  const q = getQuery(req);
  const headerKey = req.headers?.['x-owner-key'];
  const bodyKey = req.body && typeof req.body === 'object' ? req.body.key : null;
  return !!OWNER_KEY && (headerKey === OWNER_KEY || bodyKey === OWNER_KEY || q.key === OWNER_KEY);
}

function escQueryValue(value) {
  return encodeURIComponent(String(value ?? ''));
}

function normalize(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function jobFingerprint(j) {
  return [normalize(j.company), normalize(j.role || j.title), normalize(j.location)].join('|');
}

const ADD_FIELDS = [
  'role','title','company','location','description','qualification','experience_level',
  'experience_min','salary','salary_min','salary_max','sector','employment_type','country',
  'source_url','application_url','apply_url','source','source_name','ingestion_source',
  'gov_scope','deadline','posted_at','expires_at','status','review_state','published',
  'auto_discovered','verification_status','vacancy_count'
];

function pickJobFields(job) {
  const out = {};
  for (const key of ADD_FIELDS) if (job && job[key] !== undefined) out[key] = job[key];
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Admin key required.' });
  if (!SUPA || !KEY) return res.status(500).json({ ok: false, error: 'Supabase configuration missing.' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  if (req.method === 'GET') {
    const q = getQuery(req);
    const tab = q.tab || 'published';
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(q.per_page || '20', 10) || 20));
    const search = String(q.search || '').trim();

    const conditions = [];
    if (tab === 'published') {
      conditions.push('published=eq.true');
    } else if (tab === 'pending') {
      conditions.push('published=eq.false', 'review_state=eq.Pending%20Review');
    } else if (tab === 'rejected') {
      conditions.push('published=eq.false', 'review_state=eq.Rejected');
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown tab. Use published, pending, or rejected.' });
    }

    if (search) {
      const s = encodeURIComponent(`*${search}*`);
      conditions.push(`or=(company.ilike.${s},role.ilike.${s},location.ilike.${s})`);
    }

    const filter = conditions.join('&');
    const countRes = await db(`jobs?${filter}&select=id`, { headers: { Prefer: 'count=exact' } });
    if (!countRes.ok) return res.status(500).json({ ok: false, error: 'Count failed.' });
    const range = countRes.headers.get('content-range') || '*/0';
    const total = Number((range.split('/')[1] || '0')) || 0;

    const offset = (page - 1) * perPage;
    const listRes = await db(`jobs?${filter}&select=id,role,company,sector,location,source_name,source,source_url,deadline,vacancy_count,review_state,published,created_at,posted_at,telegram_posted,status,application_url,apply_url&order=created_at.desc&limit=${perPage}&offset=${offset}`);
    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(500).json({ ok: false, error: err || 'Fetch failed.' });
    }
    const jobs = await listRes.json();
    return res.status(200).json({ ok: true, tab, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)), jobs: Array.isArray(jobs) ? jobs : [] });
  }

  if (req.method === 'PATCH') {
    const { id, ...updates } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'Missing job id.' });
    delete updates.key;
    const updateRes = await db(`jobs?id=eq.${escQueryValue(id)}`, { method: 'PATCH', body: JSON.stringify(updates) });
    if (!updateRes.ok) return res.status(500).json({ ok: false, error: await updateRes.text() });
    const updated = await updateRes.json();
    return res.status(200).json({ ok: true, job: Array.isArray(updated) ? updated[0] : updated });
  }

  if (req.method === 'POST') {
    const { action, ids, job } = body;

    if (action === 'add') {
      if (!job || typeof job !== 'object') return res.status(400).json({ ok: false, error: 'job object required.' });
      const candidate = pickJobFields(job);
      if (!candidate.role && !candidate.title) return res.status(400).json({ ok: false, error: 'Job title is required.' });
      candidate.role = candidate.role || candidate.title;
      delete candidate.title;
      candidate.published = false;
      candidate.review_state = 'Pending Review';
      candidate.auto_discovered = true;
      candidate.status = candidate.status || 'Active';
      candidate.ingestion_source = candidate.ingestion_source || 'discovery';
      candidate.source_name = candidate.source_name || candidate.source || 'Auto-Discovery';

      // Final race-safe-ish duplicate check before insertion.
      const source = normalize(candidate.source_url);
      if (source) {
        const existing = await db(`jobs?source_url=eq.${escQueryValue(candidate.source_url)}&select=id&limit=1`);
        if (existing.ok && (await existing.json()).length) return res.status(409).json({ ok: false, error: 'This job is already in the database.' });
      }
      const fp = jobFingerprint(candidate);
      if (fp !== '||') {
        const existing = await db(`jobs?company=ilike.${encodeURIComponent(candidate.company || '')}&role=ilike.${encodeURIComponent(candidate.role || '')}&location=ilike.${encodeURIComponent(candidate.location || '')}&select=id&limit=1`);
        if (existing.ok && (await existing.json()).length) return res.status(409).json({ ok: false, error: 'A matching company/title/location job already exists.' });
      }
      const ins = await db('jobs', { method: 'POST', body: JSON.stringify(candidate) });
      if (!ins.ok) return res.status(500).json({ ok: false, error: await ins.text() });
      const inserted = await ins.json();
      return res.status(201).json({ ok: true, job: Array.isArray(inserted) ? inserted[0] : inserted });
    }

    if (!action || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ ok: false, error: 'action and ids[] required.' });
    const safeIds = ids.map(String).filter(Boolean);
    const idList = safeIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',');

    if (action === 'delete') {
      const delRes = await db(`jobs?id=in.(${idList})`, { method: 'DELETE' });
      if (!delRes.ok) return res.status(500).json({ ok: false, error: await delRes.text() });
      return res.status(200).json({ ok: true, action, deleted: safeIds.length });
    }

    let updates;
    if (action === 'publish') updates = { published: true, review_state: null, status: 'Active', published_at: new Date().toISOString() };
    else if (action === 'reject') updates = { published: false, review_state: 'Rejected' };
    else if (action === 'restore') updates = { published: false, review_state: 'Pending Review' };
    else if (action === 'unpublish') updates = { published: false, review_state: 'Pending Review' };
    else return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });

    const patchRes = await db(`jobs?id=in.(${idList})`, { method: 'PATCH', body: JSON.stringify(updates) });
    if (!patchRes.ok) return res.status(500).json({ ok: false, error: await patchRes.text() });
    const updated = await patchRes.json();

    // Preserve the existing Telegram publishing behavior.
    if (action === 'publish') {
      try {
        const jobs = Array.isArray(updated) ? updated : [];
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
        if (BOT_TOKEN && CHANNEL_ID) {
          const https = require('https');
          for (const jobRow of jobs) {
            const url = jobRow.apply_url || jobRow.application_url || jobRow.source_url || (jobRow.slug ? `https://civilcareer.in/jobs/${jobRow.slug}` : 'https://civilcareer.in');
            const lines = [`💼 *${jobRow.role || 'Job Opening'}*`];
            if (jobRow.company) lines.push(`🏗️ *Company:* ${jobRow.company}`);
            if (jobRow.location) lines.push(`📍 *Location:* ${jobRow.location}`);
            if (jobRow.deadline) lines.push(`⏰ *Last Date:* ${new Date(jobRow.deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}`);
            lines.push('', `🔗 [View & Apply](${url})`, '', '📢 @CivilCareerIndiaJobs');
            await new Promise(resolve => {
              const payload = JSON.stringify({ chat_id: CHANNEL_ID, text: lines.join('\n'), parse_mode:'Markdown', disable_web_page_preview:false });
              const r = https.request({ hostname:'api.telegram.org', path:`/bot${BOT_TOKEN}/sendMessage`, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)} }, r2 => { r2.resume(); resolve(); });
              r.on('error', resolve); r.write(payload); r.end();
            });
            await db(`jobs?id=eq.${escQueryValue(jobRow.id)}`, { method:'PATCH', body:JSON.stringify({ telegram_posted:true, telegram_posted_at:new Date().toISOString() }) });
            await new Promise(r=>setTimeout(r,500));
          }
        }
      } catch (e) { console.warn('Telegram publish warning:', e.message); }
    }

    return res.status(200).json({ ok:true, action, count:Array.isArray(updated)?updated.length:safeIds.length, updated:Array.isArray(updated)?updated:[updated] });
  }

  return res.status(405).json({ ok:false, error:'Method not allowed' });
};
