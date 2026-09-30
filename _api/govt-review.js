'use strict';

const { allowSameOrigin } = require('../lib/security');
const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

function db(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
}
function slugify(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'government-job'; }
function bodyOf(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(req.body || '{}'); } catch { return {}; } }
function requireAdmin(req, res) {
  if (!req.adminUser) { res.status(401).json({ ok: false, error: 'Administrator authentication required.' }); return false; }
  return true;
}

async function approve(id, user, payloadOverride = null) {
  const r = await db(`govt_job_staging?id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!r.ok) throw new Error('Could not load staging item.');
  const rows = await r.json(); const item = rows[0]; if (!item) throw new Error('Staging item not found.');
  const p = payloadOverride || item.payload || {};
  const title = String(p.title || 'Government Civil Recruitment').trim();
  const organization = String(p.organization || p.organization_hint || 'Government organization').trim();
  let slug = slugify(`${organization}-${title}`);
  const existing = await db(`govt_jobs?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
  if (existing.ok && (await existing.json()).length) slug = `${slug}-${String(id).slice(0, 8)}`;
  const deadline = p.deadline || {};
  const job = {
    staging_id: item.id,
    title,
    slug,
    organization,
    org_type: String(p.org_type || 'central'),
    scope: String(p.scope || 'central') === 'state' ? 'state' : 'central',
    state: String(p.state || 'All India'),
    department_category: String(p.department_category || 'Other'),
    job_type: String(p.job_type || 'regular'),
    notification_no: p.notification_no || null,
    total_posts_in_notification: Array.isArray(p.post_candidates) ? p.post_candidates.length : null,
    civil_posts_count: Array.isArray(p.post_candidates) ? p.post_candidates.filter(x => x.outcome === 'civil').length : null,
    civil_status: item.civil_status,
    tier: item.tier,
    dates: p.dates || {},
    deadline_kind: deadline.kind || 'fixed',
    deadline_text: deadline.text || null,
    apply_end: deadline.date || null,
    previous_apply_end: p.previous_apply_end || null,
    age_limit_by_category: p.age_limit_by_category || null,
    age_as_on: p.age_as_on || null,
    fee_by_category: p.fee_by_category || null,
    payment_mode: p.payment_mode || null,
    required_documents: Array.isArray(p.required_documents) ? p.required_documents : [],
    how_to_apply: p.how_to_apply || null,
    language_required: p.language_required || null,
    local_cadre_or_domicile: p.local_cadre_or_domicile || null,
    reservation_notes: p.reservation_notes || null,
    official_notice_url: String(p.official_notice_url || p.source_url || '').trim(),
    official_apply_url: p.official_apply_url || null,
    official_site_url: p.official_site_url || null,
    summary: p.summary || p.excerpt || null,
    status: deadline.date && deadline.date < new Date().toISOString().slice(0, 10) ? 'closed' : 'active',
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    published_at: new Date().toISOString(),
    closes_at: deadline.date ? new Date(`${deadline.date}T23:59:59Z`).toISOString() : null,
    change_log: [{ at: new Date().toISOString(), action: 'approved', reviewer: user.id }]
  };
  if (!job.official_notice_url) throw new Error('Official notice URL is required before publishing.');
  const jr = await db('govt_jobs', { method: 'POST', body: JSON.stringify(job) });
  if (!jr.ok) throw new Error(`Could not publish government job: ${(await jr.text()).slice(0, 400)}`);
  const saved = (await jr.json())[0];
  const posts = Array.isArray(p.post_candidates) ? p.post_candidates.filter(x => x.outcome === 'civil' || x.outcome === 'discipline_unknown') : [];
  if (saved && posts.length) {
    const pr = await db('govt_job_posts', {
      method: 'POST',
      body: JSON.stringify(posts.map(x => ({
        govt_job_id: saved.id,
        post_name: String(x.post_name || title),
        discipline: x.discipline || null,
        is_civil: x.outcome === 'civil',
        vacancies: Number.isFinite(Number(x.vacancies)) ? Number(x.vacancies) : null,
        pay: x.pay || null,
        qualification: x.qualification || null,
        qualification_levels: Array.isArray(x.qualification_levels) ? x.qualification_levels : [],
        selection_process: x.selection_process || null,
      })))
    });
    if (!pr.ok) throw new Error(`Government post rows failed: ${(await pr.text()).slice(0, 400)}`);
  }
  await db(`govt_job_staging?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() }) });
  return saved;
}

module.exports = async function handler(req, res) {
  allowSameOrigin(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!SUPA || !KEY) return res.status(503).json({ ok: false, error: 'Supabase is not configured.' });
  if (!requireAdmin(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'queue';

  try {
    if (req.method === 'GET' && action === 'health') {
      const [sources, pending, needs] = await Promise.all([
        db('govt_sources?select=id,name,enabled,last_run_at,last_status,robots_ok,last_error,items_found,items_staged&order=name'),
        db('govt_job_staging?status=eq.pending&select=id&limit=1'),
        db('govt_job_staging?status=eq.needs_info&select=id&limit=1')
      ]);
      return res.status(200).json({ ok: true, sources: sources.ok ? await sources.json() : [], pending: pending.ok ? (await pending.json()).length : 0, needs_info: needs.ok ? (await needs.json()).length : 0 });
    }
    if (req.method === 'GET') {
      const status = String(url.searchParams.get('status') || 'pending');
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      const qs = `govt_job_staging?status=eq.${encodeURIComponent(status)}&select=*&order=created_at.desc&limit=${limit}`;
      const r = await db(qs); if (!r.ok) throw new Error((await r.text()).slice(0, 400));
      return res.status(200).json({ ok: true, items: await r.json() });
    }
    if (req.method === 'POST') {
      const b = bodyOf(req); const id = String(b.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'id is required.' });
      if (action === 'approve') return res.status(200).json({ ok: true, job: await approve(id, req.adminUser, b.payload || null) });
      if (action === 'reject' || action === 'needs_info' || action === 'duplicate') {
        const status = action === 'reject' ? 'rejected' : action;
        const patch = { status, reviewed_by: req.adminUser.id, reviewed_at: new Date().toISOString(), reject_reason: action === 'reject' ? String(b.reason || 'Rejected by administrator').slice(0, 500) : null, review_notes: String(b.notes || '').slice(0, 2000) };
        const r = await db(`govt_job_staging?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (!r.ok) throw new Error((await r.text()).slice(0, 400));
        return res.status(200).json({ ok: true });
      }
    }
    return res.status(400).json({ ok: false, error: 'Unsupported action.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Government review failed.' });
  }
};
