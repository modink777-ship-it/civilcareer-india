const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OWNER_KEY = process.env.OWNER_KEY;
const SITE_URL = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');

function isAdmin(req) {
  const provided = String(req.headers['x-owner-key'] || '').trim();
  return provided && OWNER_KEY && provided === OWNER_KEY;
}

function supa(path, opts = {}) {
  if (!SUPA || !KEY) {
    throw new Error('Supabase configuration is missing');
  }
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

function normalizeJob(row = {}) {
  const job = { ...row };
  if (!job.role && job.title) job.role = job.title;
  if (!job.role) job.role = 'Civil Engineering Opportunity';
  if (!job.company && job.employer) job.company = job.employer;
  if (!job.location && job.city) job.location = job.city;
  if (!job.location && job.state) job.location = job.state;
  if (!job.location) job.location = 'India';
  if (!job.status) job.status = job.published === false ? 'Draft' : 'Active';
  if (!job.created_at && job.posted_date) job.created_at = job.posted_date;
  if (job.valid_through && !job.expires_at) job.expires_at = job.valid_through;
  return job;
}

function isPubliclyVisible(job) {
  if (!job) return false;
  if (job.published === false) return false;
  const status = String(job.status || '').trim().toLowerCase();
  if (['draft', 'pending review', 'archived', 'deleted'].includes(status)) return false;
  const expiresAt = job.valid_through || job.expires_at || job.deadline;
  if (expiresAt) {
    const expires = new Date(expiresAt).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) return false;
  }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderJobHtml(job) {
  const j = normalizeJob(job);
  const title = `${j.role} at ${j.company || 'CivilCareer'} | CivilCareer`;
  const description = String(j.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Civil engineering opportunity listed on CivilCareer.';
  const canonical = `${SITE_URL}/jobs/${encodeURIComponent(String(j.slug || j.id || 'job'))}`;
  const applyUrl = j.application_url || j.source_url || '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description.slice(0, 160))}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <style>
    body { font-family: Arial, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1rem; color: #0b1f3a; }
    .meta { color: #4f5b76; margin-bottom: 1rem; }
    .box { background: #f8fafc; border: 1px solid #dfe7f5; border-radius: 12px; padding: 1.25rem; }
    a { color: #0b5bd3; }
  </style>
</head>
<body>
  <main>
    <p class="meta">CivilCareer • ${escapeHtml(j.location || 'India')}</p>
    <h1>${escapeHtml(j.role)}</h1>
    <p><strong>${escapeHtml(j.company || 'Employer')}</strong></p>
    <div class="meta">${escapeHtml(j.employment_type || 'Full-time')} • ${escapeHtml(j.location || 'India')}</div>
    <div class="box">
      <p>${escapeHtml(description)}</p>
      ${j.salary ? `<p><strong>Salary:</strong> ${escapeHtml(j.salary)}</p>` : ''}
      ${j.deadline ? `<p><strong>Deadline:</strong> ${escapeHtml(j.deadline)}</p>` : ''}
      ${applyUrl ? `<p><a href="${escapeHtml(applyUrl)}" target="_blank" rel="noreferrer">Apply now</a></p>` : ''}
    </div>
  </main>
</body>
</html>`;
}

async function handlePublicGet(req, res) {
  if (String(req.query.health || '') === '1') {
    return res.status(200).json({ ok: true, status: 'ok' });
  }

  const slug = String(req.query.slug || '').trim();
  const id = String(req.query.id || '').trim();

  if (String(req.query.render || '') === 'html') {
    try {
      let query = `jobs?select=*&published=eq.true&limit=1`;
      if (slug) query = `jobs?select=*&slug=eq.${encodeURIComponent(slug)}&published=eq.true&limit=1`;
      else if (id) query = `jobs?select=*&id=eq.${encodeURIComponent(id)}&published=eq.true&limit=1`;
      const r = await supa(query);
      if (!r.ok) {
        return res.status(500).send('Unable to load this job right now.');
      }
      const rows = await r.json();
      const job = Array.isArray(rows) ? rows[0] : null;
      if (!job || !isPubliclyVisible(job)) {
        return res.status(404).send('Job not found');
      }
      return res.status(200).send(renderJobHtml(job));
    } catch (e) {
      return res.status(500).send('Unable to load this job right now.');
    }
  }

  try {
    let query = 'jobs?select=*&published=eq.true&order=created_at.desc';
    if (slug) query = `jobs?select=*&slug=eq.${encodeURIComponent(slug)}&published=eq.true&limit=1`;
    else if (id) query = `jobs?select=*&id=eq.${encodeURIComponent(id)}&published=eq.true&limit=1`;

    const r = await supa(query);
    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: 'Failed to load jobs', details: detail });
    }
    let jobs = (await r.json()) || [];
    jobs = Array.isArray(jobs) ? jobs.map(normalizeJob).filter(isPubliclyVisible) : [];

    if (slug || id) return res.status(200).json({ job: jobs[0] || null });
    return res.status(200).json({ jobs });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load jobs', details: e.message });
  }
}

async function handleAdminGet(req, res) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Invalid owner key' });
  }

  const slug = String(req.query.slug || '').trim();
  const id = String(req.query.id || '').trim();

  try {
    let query = 'jobs?select=*&order=created_at.desc';
    if (slug) query = `jobs?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`;
    else if (id) query = `jobs?select=*&id=eq.${encodeURIComponent(id)}&limit=1`;

    const r = await supa(query);
    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: 'Failed to load admin jobs', details: detail });
    }
    let jobs = (await r.json()) || [];
    jobs = Array.isArray(jobs) ? jobs.map(normalizeJob) : [];
    if (slug || id) return res.status(200).json({ job: jobs[0] || null });
    return res.status(200).json({ jobs });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load admin jobs', details: e.message });
  }
}

async function handleAdminAuth(req, res) {
  if (!OWNER_KEY) {
    return res.status(503).json({ ok: false, error: 'Admin authentication is not configured on this deployment' });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid owner key' });
  }
  return res.status(200).json({ ok: true, authenticated: true });
}

async function handleCreate(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Invalid owner key' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const record = normalizeJob(body);
  record.published = typeof record.published === 'boolean' ? record.published : true;
  record.status = record.status || (record.published ? 'Active' : 'Draft');
  record.created_at = record.created_at || new Date().toISOString();
  record.updated_at = new Date().toISOString();

  if (record.source_url) {
    try {
      const dup = await supa(`jobs?select=id&source_url=eq.${encodeURIComponent(record.source_url)}&limit=1`);
      if (dup.ok) {
        const rows = await dup.json();
        if (Array.isArray(rows) && rows.length) {
          return res.status(409).json({ error: 'A job with this source URL already exists.' });
        }
      }
    } catch (_) {
      // continue safely if duplicate check fails
    }
  }

  try {
    const r = await supa('jobs', { method: 'POST', body: JSON.stringify(record) });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: 'Job could not be saved', details: detail });
    }
    const data = await r.json();
    return res.status(201).json({ success: true, job: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    return res.status(500).json({ error: 'Job could not be saved', details: e.message });
  }
}

async function handlePatch(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Invalid owner key' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const { id, ...rest } = body;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const record = normalizeJob(rest);
  record.updated_at = new Date().toISOString();

  try {
    const r = await supa(`jobs?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(record) });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: 'Job could not be updated', details: detail });
    }
    const data = await r.json();
    return res.status(200).json({ success: true, job: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    return res.status(500).json({ error: 'Job could not be updated', details: e.message });
  }
}

async function handleDelete(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Invalid owner key' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); } }
  const { id } = body;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const r = await supa(`jobs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: 'Job could not be deleted', details: detail });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Job could not be deleted', details: e.message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET' && String(req.query?.auth || '') === '1') {
    return handleAdminAuth(req, res);
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Supabase server configuration is missing' });
  }

  if (req.method === 'GET') {
    if (isAdmin(req)) return handleAdminGet(req, res);
    return handlePublicGet(req, res);
  }

  if (req.method === 'POST') {
    if (String(req.query?.auth || '') === '1') return handleAdminAuth(req, res);
    return handleCreate(req, res);
  }

  if (req.method === 'PATCH') return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
};
