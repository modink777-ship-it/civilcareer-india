/**
 * CivilCareer — AI Job Collector + Admin Job Inbox
 *
 * The owner INTENTIONALLY submits material (pasted text, screenshots/posters,
 * PDFs, job URLs). This endpoint stores the original, extracts individual jobs,
 * scores civil relevance and confidence, flags duplicates and parks everything
 * in an admin-only inbox. Only an explicit "Approve & Publish" writes to the
 * public `jobs` table.
 *
 *   GET  ?action=metrics                         → inbox + batch counters
 *   GET  ?action=inbox&status=pending            → inbox rows
 *   GET  ?action=item&id=…                       → row + source item + signed original URL + events
 *   GET  ?action=batch&id=…                      → batch progress
 *   POST ?action=create_batch  {items:[…]}       → store originals, queue items
 *   POST ?action=process       {batch_id}        → extract jobs (bounded, resumable)
 *   POST ?action=update        {id,payload}      → admin edit (overrides AI)
 *   POST ?action=approve       {id}              → publish into the existing jobs table
 *   POST ?action=reject        {id,reason,notes} → reject with a reason
 *   POST ?action=retry         {item_id}         → re-run a failed/needs_text item
 *
 * Server-side only: Supabase service key, AI keys and storage never reach the browser.
 */
'use strict';

const {
  clean, oneLine, stripHtml, extractFromText, structureWithAI, visionExtract, duplicateScore,
} = require('../lib/job-collector-core');

const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
const BUCKET = 'job-sources';
const SITE = String(process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');
const PROCESS_BUDGET_MS = 45000;   // stay inside the 60s function limit
const MAX_ITEMS_PER_CALL = 20;

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

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
function send(res, status, obj) { return res.status(status).json(obj); }
function actorEmail(user) {
  return String((user && (user.email || (user.user_metadata && user.user_metadata.email))) || '').toLowerCase() || null;
}
function slugify(...parts) {
  const base = parts.filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return `${base || 'job'}-${Date.now().toString(36)}`;
}
function nowIso() { return new Date().toISOString(); }

async function recordEvent(inboxId, event, req, notes, meta, batchId, itemId) {
  try {
    await db('job_inbox_events', {
      method: 'POST',
      body: JSON.stringify({
        inbox_id: inboxId || null,
        batch_id: batchId || null,
        item_id: itemId || null,
        actor: actorEmail(req && req.adminUser),
        event,
        notes: notes || null,
        meta: meta || {},
      }),
    });
  } catch (_) { /* audit must never break the request */ }
}

/* ── storage ─────────────────────────────────────────────────────────── */

async function uploadOriginal(path, base64, mime) {
  const bytes = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!bytes.length) return { ok: false, error: 'empty_file' };
  const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': mime || 'application/octet-stream' },
    body: bytes,
  });
  if (!r.ok) return { ok: false, error: `storage_${r.status}` };
  return { ok: true, path, byte_size: bytes.length };
}

async function signedOriginal(path) {
  if (!path) return null;
  try {
    const r = await fetch(`${SUPA}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const signed = data && (data.signedURL || data.signedUrl);
    if (!signed) return null;
    return signed.startsWith('http') ? signed : `${SUPA}/storage/v1${signed}`;
  } catch (_) { return null; }
}

/* ── duplicate detection against the live jobs table ─────────────────── */

function likeValue(value) {
  return encodeURIComponent(String(value || '').replace(/[*%]/g, ' ').trim()).replace(/%2A/gi, '*');
}

async function findDuplicate(candidate) {
  const filters = ['select=id,role,company,city,location,description,application_email,source_url,created_at', 'limit=25'];
  const or = [];
  if (candidate.company) or.push(`company.ilike.${likeValue(`*${candidate.company}*`)}`);
  if (candidate.title) or.push(`role.ilike.${likeValue(`*${candidate.title}*`)}`);
  if (candidate.application_email) or.push(`application_email.ilike.${likeValue(`*${candidate.application_email}*`)}`);
  if (candidate.application_url) or.push(`source_url.eq.${likeValue(candidate.application_url)}`);
  if (!or.length) return null;
  filters.push(`or=(${or.join(',')})`);
  try {
    const r = await db(`jobs?${filters.join('&')}`);
    if (!r.ok) return null;
    const rows = await r.json();
    let best = null;
    for (const row of rows || []) {
      const verdict = duplicateScore(candidate, row);
      if (verdict.score >= 0.5 && (!best || verdict.score > best.score)) {
        best = { score: verdict.score, reasons: verdict.reasons, id: row.id, role: row.role, company: row.company };
      }
    }
    return best;
  } catch (_) { return null; }
}

/* ── text acquisition per item kind ──────────────────────────────────── */

async function fetchUrlText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'CivilCareer job collector/1.0 (owner-submitted link)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!r.ok) return { ok: false, error: `http_${r.status}` };
    const html = await r.text();
    const text = stripHtml(html).slice(0, 12000);
    return text.length > 40 ? { ok: true, text } : { ok: false, error: 'page_too_short' };
  } catch (err) {
    return { ok: false, error: `fetch_failed: ${String(err && err.message || '').slice(0, 80)}` };
  }
}

async function base64FromStorage(path) {
  try {
    const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString('base64');
  } catch (_) { return null; }
}

/** Resolve the text of one item; keeps the original untouched on failure. */
async function itemText(item) {
  if (item.kind === 'text') {
    return item.raw_text ? { ok: true, text: item.raw_text, method: 'rules' } : { ok: false, error: 'empty_text' };
  }
  if (item.kind === 'url') {
    const fetched = await fetchUrlText(item.source_url);
    if (!fetched.ok) return fetched;
    return { ok: true, text: fetched.text, method: 'url_fetch' };
  }
  if (item.raw_text && item.raw_text.length > 40) {
    return { ok: true, text: item.raw_text, method: 'rules' };
  }
  const base64 = item.storage_path ? await base64FromStorage(item.storage_path) : null;
  if (!base64) return { ok: false, error: 'original_unreadable' };
  const vision = await visionExtract({ base64, mime: item.mime, filename: item.filename });
  if (!vision.ok) {
    return {
      ok: false,
      error: vision.reason === 'no_vision_provider' ? 'no_ocr_provider' : vision.reason,
      needsText: true,
    };
  }
  return { ok: true, text: vision.text, method: 'vision', provider: vision.provider, model: vision.model };
}

/* ── extraction for one item → inbox rows ────────────────────────────── */

async function processItem(item, batch, req) {
  const source = { type: item.kind === 'url' ? 'url' : 'manual', url: item.source_url || null, file: item.filename || null };
  const acquired = await itemText(item);
  if (!acquired.ok) {
    await db(`job_import_items?id=eq.${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: acquired.needsText ? 'needs_text' : 'failed',
        error: String(acquired.error || 'extraction_failed').slice(0, 300),
        processed_at: nowIso(),
      }),
    });
    await recordEvent(null, 'processing_completed', req, acquired.error, { item_id: item.id }, batch.id, item.id);
    return { jobs: 0, status: acquired.needsText ? 'needs_text' : 'failed' };
  }

  let text = clean(acquired.text);
  if (text.length < 30) {
    await db(`job_import_items?id=eq.${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'needs_text', error: 'too_short', processed_at: nowIso() }),
    });
    return { jobs: 0, status: 'needs_text' };
  }

  let candidates = extractFromText(text, source);
  let method = acquired.method || 'rules';
  let provider = acquired.provider || null;
  let model = acquired.model || null;

  /* Thin deterministic result → one bounded AI pass (cached, free tier). */
  const thin = !candidates.length || candidates.every((c) => (c.confidence_score || 0) < 0.5);
  if (thin) {
    const ai = await structureWithAI(text, source);
    if (ai.length) {
      candidates = ai;
      method = 'ai';
      provider = ai[0].ai_provider || provider;
      model = ai[0].ai_model || model;
    }
  }

  /* Keep the extracted text on the item so the original is never lost and
     "paste the text instead" is always available for a failed OCR. */
  await db(`job_import_items?id=eq.${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      raw_text: text.slice(0, 12000),
      status: 'processed',
      error: null,
      extraction_method: method,
      jobs_found: candidates.length,
      processed_at: nowIso(),
    }),
  });

  const withText = candidates.map((c) => ({ ...c, raw_text: text.slice(0, 12000), extraction_method: method, ai_provider: provider, ai_model: model }));
  if (!withText.length) {
    /* Unreadable/unsplittable: still surface it so a human can act. */
    withText.push({
      title: null,
      company: null,
      description: text.slice(0, 4000),
      raw_text: text.slice(0, 12000),
      skills: [],
      relevance_category: 'uncertain',
      relevance_score: 0.3,
      relevance_reason: 'nothing identifiable was extracted',
      confidence_score: 0.2,
      confidence_reason: 'no job fields found',
      extraction_method: method,
      source_type: source.type,
      source_url: source.url,
      source_file: source.file,
      needs_attention: 'extraction_failed',
    });
  }

  const rows = [];
  for (const candidate of withText) {
    const dup = await findDuplicate(candidate);
    const relevance = String(candidate.relevance_category || 'uncertain');
    const status = candidate.needs_attention
      ? 'needs_attention'
      : (relevance === 'non_relevant' ? 'needs_attention' : (dup && dup.score >= 0.85 ? 'needs_attention' : 'pending'));
    rows.push({
      batch_id: batch.id,
      item_id: item.id,
      status,
      title: candidate.title || null,
      company: candidate.company || null,
      company_url: candidate.company_url || null,
      city: candidate.city || null,
      state: candidate.state || null,
      country: candidate.country || 'India',
      location: candidate.location || null,
      job_type: candidate.job_type || null,
      work_mode: candidate.work_mode || null,
      department: candidate.department || null,
      industry: candidate.industry || null,
      experience_min: candidate.experience_min ?? null,
      experience_max: candidate.experience_max ?? null,
      fresher_allowed: candidate.fresher_allowed ?? null,
      experience_text: candidate.experience_text || null,
      degree: candidate.degree || null,
      branch: candidate.branch || null,
      qualification: candidate.qualification || null,
      skills: Array.isArray(candidate.skills) ? candidate.skills : [],
      salary: candidate.salary || null,
      salary_min: candidate.salary_min ?? null,
      salary_max: candidate.salary_max ?? null,
      salary_currency: candidate.salary_currency || null,
      salary_period: candidate.salary_period || null,
      application_url: candidate.application_url || null,
      application_email: candidate.application_email || null,
      application_phone: candidate.application_phone || null,
      application_instructions: candidate.application_instructions || null,
      description: candidate.description || null,
      expiry: candidate.expiry || null,
      source_type: candidate.source_type || source.type,
      source_url: candidate.source_url || source.url || null,
      source_file: candidate.source_file || source.file || null,
      raw_text: candidate.raw_text || text.slice(0, 12000),
      relevance_category: relevance,
      relevance_score: candidate.relevance_score ?? null,
      confidence_score: candidate.confidence_score ?? null,
      confidence_reason: candidate.confidence_reason || null,
      duplicate_of: dup ? dup.id : null,
      duplicate_score: dup ? dup.score : null,
      duplicate_reasons: dup ? dup.reasons : [],
      ai_provider: candidate.ai_provider || provider,
      ai_model: candidate.ai_model || model,
      extraction_method: method,
      review_notes: candidate.needs_attention === 'extraction_failed' ? 'Nothing identifiable was extracted — edit or reject.' : null,
    });
  }

  let created = [];
  const ins = await db('job_inbox', { method: 'POST', body: JSON.stringify(rows) });
  if (ins.ok) created = await ins.json();
  for (const row of created) {
    await recordEvent(row.id, 'source_received', req, null, { kind: item.kind, method }, batch.id, item.id);
    if (row.duplicate_of) {
      await recordEvent(row.id, 'duplicate_detected', req, `score ${row.duplicate_score}`, row.duplicate_reasons, batch.id, item.id);
    }
  }
  return { jobs: created.length, status: 'processed', duplicates: created.filter((r) => r.duplicate_of).length };
}

/* ── publish approved inbox row into the existing jobs table ─────────── */

function buildJobRow(row, inboxId) {
  const role = oneLine(row.title);
  const company = oneLine(row.company) || null;
  return {
    role,
    company,
    company_url: row.company_url || null,
    location: row.location || [row.city, row.state].filter(Boolean).join(', ') || null,
    location_display: row.location || null,
    city: row.city || null,
    state: row.state || null,
    country: row.country || 'India',
    description: clean(row.description) || null,
    employment_type: row.job_type || null,
    salary: row.salary || null,
    salary_min: row.salary_min ?? null,
    salary_max: row.salary_max ?? null,
    salary_currency: row.salary_currency || null,
    skills: Array.isArray(row.skills) ? row.skills : [],
    qualification: row.qualification || null,
    experience_min: row.experience_min ?? null,
    experience_max: row.experience_max ?? null,
    application_url: row.application_url || null,
    application_email: row.application_email || null,
    source: 'Job Collector',
    source_url: row.application_url || row.source_url || `${SITE}/inbox/${inboxId}`,
    sector: 'Private',
    published: true,
    status: 'Active',
    review_state: 'Published',
    verification_status: 'Unverified',
    slug: slugify(role, company),
    posted_at: nowIso(),
    published_at: nowIso(),
    created_at: nowIso(),
    expires_at: row.expiry ? `${row.expiry}T23:59:59.000Z` : null,
    application_email_private: true,
  };
}

/* ── handler ─────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  try {
    if (!req.adminUser) return send(res, 401, { ok: false, error: 'Administrator authentication required.' });
    if (!SUPA || !KEY) return send(res, 503, { ok: false, error: 'Supabase server configuration is missing.' });

    const url = new URL(req.url, 'http://localhost');
    const action = String(url.searchParams.get('action') || '').trim();
    const body = bodyOf(req);

    if (req.method === 'GET') {
      if (action === 'metrics') {
        const [pending, needsAttention, dupes, approved, rejected, failed, batches] = await Promise.all([
          db('job_inbox?status=eq.pending&select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
          db('job_inbox?status=eq.needs_attention&select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
          db('job_inbox?duplicate_of=not.is.null&select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
          db('job_inbox?status=eq.approved&select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
          db('job_inbox?status=eq.rejected&select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
          db('job_inbox?status=eq.failed&select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
          db('job_import_batches?select=*&order=created_at.desc&limit=5'),
        ]);
        const count = (r) => {
          const range = r && r.headers && r.headers.get ? r.headers.get('content-range') : null;
          const m = range && range.match(/\/(\d+)$/);
          return m ? Number(m[1]) : 0;
        };
        return send(res, 200, {
          ok: true,
          metrics: {
            pending: count(pending),
            needs_attention: count(needsAttention),
            possible_duplicates: count(dupes),
            approved: count(approved),
            rejected: count(rejected),
            failed: count(failed),
          },
          batches: batches.ok ? await batches.json() : [],
        });
      }

      if (action === 'inbox') {
        const status = String(url.searchParams.get('status') || '').trim();
        const duplicatesOnly = String(url.searchParams.get('duplicates') || '') === '1';
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
        const filters = [`select=*`, `order=created_at.desc`, `limit=${limit}`];
        if (duplicatesOnly) filters.push('duplicate_of=not.is.null');
        else if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
        const r = await db(`job_inbox?${filters.join('&')}`);
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        return send(res, 200, { ok: true, items: await r.json() });
      }

      if (action === 'item') {
        const id = String(url.searchParams.get('id') || '');
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const r = await db(`job_inbox?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        const rows = await r.json();
        if (!rows.length) return send(res, 404, { ok: false, error: 'Inbox item not found.' });
        const row = rows[0];
        let item = null;
        if (row.item_id) {
          const ir = await db(`job_import_items?id=eq.${encodeURIComponent(row.item_id)}&select=*&limit=1`);
          if (ir.ok) item = (await ir.json())[0] || null;
        }
        const original_url = item && item.storage_path ? await signedOriginal(item.storage_path) : null;
        const ev = await db(`job_inbox_events?inbox_id=eq.${encodeURIComponent(id)}&select=*&order=at.desc&limit=50`);
        return send(res, 200, { ok: true, item: row, source: item, original_url, events: ev.ok ? await ev.json() : [] });
      }

      if (action === 'batch') {
        const id = String(url.searchParams.get('id') || '');
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const br = await db(`job_import_batches?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
        const ir = await db(`job_import_items?batch_id=eq.${encodeURIComponent(id)}&select=id,kind,filename,status,error,jobs_found,created_at&order=created_at&limit=200`);
        const rows = br.ok ? await br.json() : [];
        return send(res, 200, {
          ok: true,
          batch: rows[0] || null,
          items: ir.ok ? await ir.json() : [],
        });
      }

      return send(res, 400, { ok: false, error: 'Unsupported action.' });
    }

    if (req.method === 'POST') {
      if (action === 'create_batch') {
        const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
        if (!items.length) return send(res, 400, { ok: false, error: 'No files, text or URLs were supplied.' });
        const created = await db('job_import_batches', {
          method: 'POST',
          body: JSON.stringify({
            created_by: actorEmail(req.adminUser),
            label: body.label ? String(body.label).slice(0, 120) : null,
            status: 'open',
            source_count: items.length,
          }),
        });
        if (!created.ok) throw new Error((await created.text()).slice(0, 300));
        const batch = (await created.json())[0];

        const rows = [];
        for (let i = 0; i < items.length; i += 1) {
          const raw = items[i] || {};
          const kind = ['text', 'url', 'image', 'pdf'].includes(String(raw.kind)) ? String(raw.kind) : 'text';
          const base = {
            batch_id: batch.id,
            kind,
            filename: raw.filename ? String(raw.filename).slice(0, 200) : null,
            mime: raw.mime ? String(raw.mime).slice(0, 120) : null,
            source_url: raw.url ? String(raw.url).slice(0, 1000) : null,
            raw_text: raw.text ? clean(raw.text).slice(0, 12000) : null,
            status: 'pending',
          };
          if (raw.data_base64 && (kind === 'image' || kind === 'pdf')) {
            const path = `${batch.id}/${Date.now()}-${i}-${(base.filename || (kind === 'pdf' ? 'document.pdf' : 'image.jpg')).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`;
            const up = await uploadOriginal(path, raw.data_base64, base.mime);
            if (up.ok) {
              base.storage_path = up.path;
              base.byte_size = up.byte_size;
            } else {
              base.status = 'failed';
              base.error = up.error;
            }
          }
          rows.push(base);
        }
        const ins = await db('job_import_items', { method: 'POST', body: JSON.stringify(rows) });
        if (!ins.ok) throw new Error((await ins.text()).slice(0, 300));
        const savedItems = await ins.json();
        await recordEvent(null, 'source_received', req, `${savedItems.length} item(s)`, { batch_id: batch.id }, batch.id, null);
        return send(res, 201, {
          ok: true,
          batch,
          items: savedItems.map((i) => ({ id: i.id, kind: i.kind, filename: i.filename, status: i.status, error: i.error || null })),
        });
      }

      if (action === 'process') {
        const batchId = String(body.batch_id || '');
        if (!batchId) return send(res, 400, { ok: false, error: 'batch_id is required.' });
        const br = await db(`job_import_batches?id=eq.${encodeURIComponent(batchId)}&select=*&limit=1`);
        if (!br.ok) throw new Error((await br.text()).slice(0, 300));
        const batchRows = await br.json();
        const batch = batchRows[0];
        if (!batch) return send(res, 404, { ok: false, error: 'Batch not found.' });

        const q = await db(`job_import_items?batch_id=eq.${encodeURIComponent(batchId)}&status=in.(pending,needs_text)&select=*&order=created_at&limit=${MAX_ITEMS_PER_CALL}`);
        if (!q.ok) throw new Error((await q.text()).slice(0, 300));
        const queued = await q.json();

        await db(`job_import_batches?id=eq.${encodeURIComponent(batchId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'processing', updated_at: nowIso() }),
        });

        const startedAt = Date.now();
        let processed = 0;
        let jobsFound = 0;
        let duplicates = 0;
        let needsAttention = 0;
        let failed = 0;

        for (const item of queued) {
          if (Date.now() - startedAt > PROCESS_BUDGET_MS) break;
          await db(`job_import_items?id=eq.${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'processing' }),
          });
          try {
            const out = await processItem(item, batch, req);
            processed += 1;
            jobsFound += out.jobs || 0;
            duplicates += out.duplicates || 0;
            if (out.status === 'needs_text') needsAttention += 1;
            if (out.status === 'failed') failed += 1;
          } catch (err) {
            failed += 1;
            await db(`job_import_items?id=eq.${encodeURIComponent(item.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'failed', error: String(err && err.message || 'processing_failed').slice(0, 300), processed_at: nowIso() }),
            });
            await recordEvent(null, 'failed', req, String(err && err.message || ''), { item_id: item.id }, batchId, item.id);
          }
        }

        const restQ = await db(`job_import_items?batch_id=eq.${encodeURIComponent(batchId)}&status=in.(pending,needs_text)&select=id&limit=1`);
        const remaining = restQ.ok ? (await restQ.json()).length : 0;
        const totals = await db(`job_import_items?batch_id=eq.${encodeURIComponent(batchId)}&select=status`);
        const statuses = totals.ok ? await totals.json() : [];
        const pendingLeft = statuses.filter((s) => s.status === 'pending' || s.status === 'needs_text' || s.status === 'processing').length;
        const failedTotal = statuses.filter((s) => s.status === 'failed').length;
        const summaryStatus = pendingLeft ? 'processing' : (failedTotal ? 'partial' : 'done');

        await db(`job_import_batches?id=eq.${encodeURIComponent(batchId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: summaryStatus,
            processed_count: statuses.filter((s) => s.status === 'processed').length,
            jobs_detected: Math.max(0, jobsFound),
            duplicates,
            failed_count: failedTotal,
            updated_at: nowIso(),
          }),
        });

        const inboxCount = await db(`job_inbox?batch_id=eq.${encodeURIComponent(batchId)}&select=id`);
        const found = inboxCount.ok ? await inboxCount.json() : [];
        return send(res, 200, {
          ok: true,
          processed,
          remaining: remaining > 0 ? pendingLeft : 0,
          jobs_detected: found.length,
          duplicates,
          needs_attention: needsAttention,
          failed,
          batch_status: summaryStatus,
        });
      }

      if (action === 'update') {
        const id = String(body.id || '');
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const allowed = ['title', 'company', 'company_url', 'city', 'state', 'country', 'location', 'job_type', 'work_mode',
          'department', 'industry', 'experience_min', 'experience_max', 'fresher_allowed', 'experience_text', 'degree',
          'branch', 'qualification', 'skills', 'salary', 'salary_min', 'salary_max', 'salary_currency', 'salary_period',
          'application_url', 'application_email', 'application_phone', 'application_instructions', 'description', 'expiry',
          'source_type', 'source_url', 'relevance_category', 'review_notes'];
        const patch = {};
        for (const key of allowed) if (payload[key] !== undefined) patch[key] = payload[key];
        if (!Object.keys(patch).length) return send(res, 400, { ok: false, error: 'No editable fields supplied.' });
        if (Array.isArray(patch.skills)) patch.skills = patch.skills.map((s) => oneLine(s)).filter(Boolean).slice(0, 20);
        patch.admin_edited = true;
        patch.updated_at = nowIso();
        const r = await db(`job_inbox?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        await recordEvent(id, 'admin_edited', req, null, { fields: Object.keys(patch) });
        return send(res, 200, { ok: true, item: (await r.json())[0] });
      }

      if (action === 'approve') {
        const id = String(body.id || '');
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const r = await db(`job_inbox?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        const rows = await r.json();
        const row = rows[0];
        if (!row) return send(res, 404, { ok: false, error: 'Inbox item not found.' });
        if (row.status === 'approved') return send(res, 409, { ok: false, error: 'This job was already published.' });
        if (body.payload && typeof body.payload === 'object') {
          for (const [k, v] of Object.entries(body.payload)) if (v !== undefined) row[k] = v;
        }
        const role = oneLine(row.title);
        if (!role) return send(res, 422, { ok: false, error: 'A job title is required before publishing.' });
        if (!row.company && !row.application_email && !row.application_url) {
          return send(res, 422, { ok: false, error: 'Add a company or an application contact before publishing.' });
        }
        if (row.duplicate_of && Number(row.duplicate_score) >= 0.85 && body.confirm_duplicate !== true) {
          return send(res, 409, {
            ok: false,
            error: `Possible duplicate (${Math.round(Number(row.duplicate_score) * 100)}%): ${row.duplicate_reasons ? row.duplicate_reasons.join(', ') : 'similar job'}.`,
            duplicate_of: row.duplicate_of,
            needs_confirmation: true,
          });
        }

        const jobRow = buildJobRow(row, id);
        const jr = await db('jobs', { method: 'POST', body: JSON.stringify(jobRow) });
        if (!jr.ok) {
          const detail = await jr.text();
          await recordEvent(id, 'failed', req, detail.slice(0, 200));
          throw new Error(`Job could not be published: ${detail.slice(0, 300)}`);
        }
        const saved = (await jr.json())[0];

        await db(`job_inbox?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'approved',
            published_job_id: saved.id,
            approved_at: nowIso(),
            approved_by: actorEmail(req.adminUser),
            updated_at: nowIso(),
          }),
        });
        await recordEvent(id, 'approved', req, null, { job_id: saved.id });
        await recordEvent(id, 'published', req, `job ${saved.id}`, { slug: saved.slug });
        return send(res, 200, { ok: true, job: saved });
      }

      if (action === 'reject') {
        const id = String(body.id || '');
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const reason = String(body.reason || 'Other').slice(0, 120);
        const r = await db(`job_inbox?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'rejected',
            reject_reason: reason,
            review_notes: body.notes ? String(body.notes).slice(0, 1000) : null,
            updated_at: nowIso(),
          }),
        });
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        await recordEvent(id, 'rejected', req, reason, { notes: body.notes || null });
        return send(res, 200, { ok: true });
      }

      if (action === 'retry') {
        const itemId = String(body.item_id || '');
        if (!itemId) return send(res, 400, { ok: false, error: 'item_id is required.' });
        const patch = { status: 'pending', error: null };
        if (body.text !== undefined) patch.raw_text = clean(body.text).slice(0, 12000);
        const r = await db(`job_import_items?id=eq.${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        await recordEvent(null, 'processing_started', req, 'retry', { item_id: itemId });
        return send(res, 200, { ok: true });
      }

      return send(res, 400, { ok: false, error: 'Unsupported action.' });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (err) {
    return send(res, 500, { ok: false, error: String((err && err.message) || 'Job collector failed.').slice(0, 400) });
  }
};

module.exports._internal = { buildJobRow, processItem, findDuplicate, itemText };
