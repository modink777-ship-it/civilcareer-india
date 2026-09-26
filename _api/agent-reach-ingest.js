/**
 * CivilCareer — Agent Reach ingestion endpoint
 * ============================================
 * POST /api/agent-reach-ingest
 *   Authorization: Bearer <AGENT_REACH_INGEST_KEY>
 *   Body: one item, or { "items": [ ... ] }
 *
 * Agent Reach runs EXTERNALLY (its own machine/CLI). This endpoint only
 * receives the structured results it produces. Nothing here ever publishes:
 *
 *   jobs      → published=false, review_state='Pending Review'
 *   resources → published=false, review_state='Pending Review'
 *
 * Any "published": true in the payload is ignored on purpose. Only an
 * authenticated admin action (admin.html → Publish button) can publish.
 *
 * Duplicate handling: an item is matched against an existing record by
 * (external_id) when provided, otherwise by its source URL. A pending record
 * is updated in place; a published record is left untouched (reported as a
 * duplicate); a rejected record stays rejected. Re-running the sync script
 * is therefore always safe.
 */

const crypto = require('crypto');

const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const INGEST_KEY = String(process.env.AGENT_REACH_INGEST_KEY || '');

const MAX_BODY_BYTES  = 2_000_000; // 2 MB — Agent Reach payloads are small; anything bigger is abuse or a bug
const MAX_ITEMS       = 200;
const JOB_TYPES       = new Set(['job', 'jobs']);
const RESOURCE_TYPES  = new Set(['resource', 'resources', 'material', 'materials', 'video', 'note']);

/* ── small helpers ─────────────────────────────────────────── */

function nowIso() { return new Date().toISOString(); }

function bearerToken(req) {
  const header = String(req.headers['authorization'] || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/** Constant-shape secret comparison (never leaks key length or prefix). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Only http(s) URLs are accepted — no javascript:, data:, file: etc. */
function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function hostOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

/** Canonical form used for duplicate detection (strip tracking noise). */
function normalizeUrl(value) {
  try {
    const u = new URL(String(value).trim());
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)$/i.test(p)) u.searchParams.delete(p);
    }
    let out = `${u.origin}${u.pathname}`.replace(/\/+$/, '');
    const q = u.searchParams.toString();
    return q ? `${out}?${q}` : out;
  } catch (_) {
    return '';
  }
}

function cleanText(value, max = 5000) {
  if (value == null) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function isoToDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoToTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function slugify(title, company, suffix) {
  const base = `${title || 'item'}-${company || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return `${base || 'agent-reach'}-${suffix}`;
}

/** PostgREST filter value for `in.(...)` — quoted, URL-encoded. */
function inVal(value) { return `"${encodeURIComponent(String(value))}"`; }

/* ── validation + mapping ──────────────────────────────────── */

/** Validate one submitted item. Returns { error } or { value }. */
function validateItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Each item must be a JSON object.' };
  }
  const type = String(raw.type || '').toLowerCase().trim();
  if (!type) {
    return { error: "Missing required field 'type' (\"job\" or \"resource\")." };
  }
  if (!JOB_TYPES.has(type) && !RESOURCE_TYPES.has(type)) {
    return { error: `Unknown type "${cleanText(type, 40)}" — expected "job" or "resource".` };
  }
  const title = cleanText(raw.title, 300);
  if (!title) return { error: "Missing required field 'title'." };

  const source = (raw.source && typeof raw.source === 'object') ? raw.source : {};
  const sourceUrl = cleanText(source.url || raw.source_url || raw.url, 2000);
  const applyUrl  = cleanText(raw.apply_url || raw.application_url || '', 2000);

  if (JOB_TYPES.has(type) && !sourceUrl && !applyUrl) {
    return { error: "A job needs 'source.url' or 'apply_url' so it can be deduplicated and verified." };
  }
  if (RESOURCE_TYPES.has(type) && !sourceUrl && !applyUrl) {
    return { error: "A resource needs a 'url' (or 'source.url') pointing at the video/document." };
  }
  if ((sourceUrl && !isValidUrl(sourceUrl)) || (applyUrl && !isValidUrl(applyUrl))) {
    return { error: 'URLs must be valid http(s) links.' };
  }

  const publishedDate = isoToDate(raw.published_date || raw.published_at || raw.date_posted);
  const deadline      = isoToDate(raw.deadline);
  if (raw.published_date && !publishedDate) return { error: `'published_date' is not a valid date ("${cleanText(raw.published_date, 40)}").` };
  if (raw.deadline && !deadline)            return { error: `'deadline' is not a valid date ("${cleanText(raw.deadline, 40)}").` };

  return { value: { raw, type: JOB_TYPES.has(type) ? 'job' : 'resource', title, sourceUrl, applyUrl, publishedDate, deadline } };
}

/** Map a validated job item onto the existing public.jobs schema. */
function jobRecord(item) {
  const { raw, title, sourceUrl, applyUrl, publishedDate, deadline } = item;
  const source   = (raw.source && typeof raw.source === 'object') ? raw.source : {};
  const skills   = toArray(raw.skills).slice(0, 40).map(s => cleanText(s, 80)).filter(Boolean);
  const company  = cleanText(raw.company, 200);
  const location = cleanText(raw.location, 300);
  const postedAt = isoToTimestamp(raw.published_date || raw.published_at || raw.date_posted);

  return {
    role:                title,
    role_normalized:     title,
    company:             company || null,
    location,
    location_display:    location,
    country:             'India',
    description:         cleanText(raw.description, 20000) || `Submitted by Agent Reach from ${source.name || hostOf(sourceUrl) || 'an external source'}. Verify the original posting before publishing.`,
    sector:              'Private',
    employment_type:     cleanText(raw.employment_type, 120),
    employment_types:    cleanText(raw.employment_type, 120) ? [cleanText(raw.employment_type, 120)] : [],
    experience_level:    cleanText(raw.experience, 120),
    skills:              skills.join(', '),
    salary:              cleanText(raw.salary, 200),
    date_posted:         publishedDate,
    posted_at:           postedAt,
    deadline,
    source_url:          sourceUrl || applyUrl,
    application_url:     applyUrl || sourceUrl,
    source:              `Agent Reach — ${cleanText(source.name, 200) || hostOf(sourceUrl) || 'external source'}`,
    source_name:         cleanText(source.name, 200),
    source_domain:       hostOf(sourceUrl || applyUrl),
    external_id:         cleanText(source.external_id || raw.external_id, 200) || null,
    ingestion_source:    'agent_reach',
    ingested_at:         nowIso(),
    agent_reach_meta:    {
      skills,
      content_type:    cleanText(raw.content_type, 60) || null,
      submitted_at:    nowIso(),
      source_raw:      { name: cleanText(source.name, 200), url: sourceUrl || null },
    },
    // ── SAFETY: never publishable from ingestion, payload cannot override ──
    published:           false,
    review_state:        'Pending Review',
    status:              'Pending Review',
    verification_status: 'Pending',
    created_at:          nowIso(),
    updated_at:          nowIso(),
    slug:                slugify(title, company, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  };
}

/** Map a validated resource/video item onto the existing public.materials schema. */
function materialRecord(item) {
  const { raw, title, sourceUrl, applyUrl } = item;
  const source = (raw.source && typeof raw.source === 'object') ? raw.source : {};
  const url    = applyUrl || sourceUrl;
  const description = cleanText(raw.description, 20000);

  return {
    title_en:          title,
    description_en:    description,
    category:          cleanText(raw.category, 200) || 'Civil Engineering',
    author:            cleanText(source.name, 200) || null,
    file_url:          url,
    source_url:        sourceUrl || url,
    source_name:       cleanText(source.name, 200),
    external_id:       cleanText(source.external_id || raw.external_id, 200) || null,
    access_type:       'Free',
    ingestion_source:  'agent_reach',
    ingested_at:       nowIso(),
    agent_reach_meta:  {
      content_type:  cleanText(raw.content_type, 60) || (RESOURCE_TYPES.has(String(raw.type).toLowerCase()) ? String(raw.type).toLowerCase() : null),
      description,
      submitted_at:  nowIso(),
      source_raw:    { name: cleanText(source.name, 200), url: sourceUrl || null },
    },
    // ── SAFETY: never publishable from ingestion ──
    published:         false,
    review_state:      'Pending Review',
    created_at:        nowIso(),
  };
}

/* ── Supabase ──────────────────────────────────────────────── */

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

/** Find an existing record for this item. Returns { table, query, row } or null. */
async function findExisting(item) {
  const { type, title, sourceUrl, applyUrl } = item;
  const externalId = cleanText(item.raw.external_id || (item.raw.source || {}).external_id, 200);

  if (type === 'job') {
    const tries = [];
    if (externalId) tries.push(`jobs?external_id=eq.${encodeURIComponent(externalId)}&ingestion_source=eq.agent_reach&limit=1`);
    const primary = sourceUrl || applyUrl;
    if (primary) {
      const normalized = normalizeUrl(primary);
      const variants = [...new Set([primary.replace(/\/$/, ''), normalized].filter(Boolean))];
      tries.push(`jobs?source_url=in.(${variants.map(inVal).join(',')})&limit=1`);
    }
    for (const query of tries) {
      try {
        const r = await supa(query);
        if (r.ok) {
          const rows = await r.json();
          if (Array.isArray(rows) && rows[0]) return { table: 'jobs', row: rows[0] };
        }
      } catch (_) { /* try the next key */ }
    }
    return null;
  }

  // Resource/material: match on external id, the resource URL, or the page URL.
  const tries = [];
  if (externalId) tries.push(`materials?external_id=eq.${encodeURIComponent(externalId)}&ingestion_source=eq.agent_reach&limit=1`);
  const url = applyUrl || sourceUrl;
  const normalized = normalizeUrl(url);
  const variants = [...new Set([url, normalized].filter(Boolean))];
  if (variants.length) tries.push(`materials?file_url=in.(${variants.map(inVal).join(',')})&limit=1`);
  if (sourceUrl) tries.push(`materials?source_url=in.(${inVal(sourceUrl)},${inVal(normalized || sourceUrl)})&limit=1`);
  for (const query of tries) {
    try {
      const r = await supa(query);
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) return { table: 'materials', row: rows[0] };
      }
    } catch (_) { /* try the next key */ }
  }
  return null;
}

/**
 * Upsert one validated item. States:
 *  - created     new pending record
 *  - updated     existing pending record refreshed (still unpublished)
 *  - duplicate   already ingested (and left untouched — published or rejected)
 */
async function upsertItem(item) {
  const record = item.type === 'job' ? jobRecord(item) : materialRecord(item);
  const table  = item.type === 'job' ? 'jobs' : 'materials';
  const existing = await findExisting(item);

  if (existing) {
    const row = existing.row;
    // An admin decision already recorded on this record is never undone here.
    if (row.published === true || row.review_state === 'Published') {
      return { action: 'duplicate', id: row.id };
    }
    if (row.review_state === 'Rejected') {
      return { action: 'duplicate', id: row.id };
    }
    // Refresh the pending record's content, but re-assert the safety fields.
    const patch = {
      ...record,
      created_at: row.created_at || record.created_at, // keep original ingestion time
      published:  false,
      review_state: 'Pending Review',
      status: item.type === 'job' ? 'Pending Review' : undefined,
      slug: row.slug || record.slug,
    };
    if (item.type !== 'job') delete patch.status;
    const r = await supa(`${table}?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const detail = await r.text();
      throw new Error(`Could not update the existing record (${r.status}): ${detail.slice(0, 300)}`);
    }
    return { action: 'updated', id: row.id };
  }

  const r = await supa(table, { method: 'POST', body: JSON.stringify(record) });
  if (!r.ok) {
    const detail = await r.text();
    // Lost a race with a duplicate insert? Look the record up once more.
    if (r.status === 409) {
      const second = await findExisting(item);
      if (second) return { action: 'duplicate', id: second.row.id };
    }
    throw new Error(`Database rejected the record (${r.status}): ${detail.slice(0, 300)}`);
  }
  const rows = await r.json();
  const saved = Array.isArray(rows) ? rows[0] : rows;
  return { action: 'created', id: saved ? saved.id : null };
}

/* ── handler ───────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPA || !KEY) {
    return res.status(500).json({ ok: false, error: 'Server is not connected to the database.' });
  }
  if (!INGEST_KEY) {
    return res.status(503).json({ ok: false, error: 'AGENT_REACH_INGEST_KEY is not configured on this deployment.' });
  }

  // Shared-secret auth — Agent Reach sends `Authorization: Bearer <key>`.
  const token = bearerToken(req);
  if (!token || !safeEqual(token, INGEST_KEY)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. Send "Authorization: Bearer <AGENT_REACH_INGEST_KEY>".' });
  }

  // Lightweight probe so the sync script can verify the endpoint + key.
  if (req.method === 'GET' && String(req.query?.status || '') === '1') {
    return res.status(200).json({ ok: true, service: 'agent-reach-ingest', ready: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST to submit items.' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: `Payload too large (max ${Math.round(MAX_BODY_BYTES / 1000000)} MB).` });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (_) { return res.status(400).json({ ok: false, error: 'Body is not valid JSON.' }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok: false, error: 'Send a JSON object: a single item, or { "items": [...] }.' });
  }

  const items = Array.isArray(body.items) ? body.items : [body];
  if (!items.length) {
    return res.status(400).json({ ok: false, error: 'Nothing to ingest: "items" is empty.' });
  }
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ ok: false, error: `Too many items in one request (max ${MAX_ITEMS}). Send the rest in another batch.` });
  }

  const summary = { received: items.length, created: 0, updated: 0, duplicates: 0, rejected: 0 };
  const results = [];
  const errors  = [];

  for (let index = 0; index < items.length; index++) {
    const raw = items[index];
    const check = validateItem(raw);
    if (check.error) {
      const titleHint = raw && typeof raw === 'object' ? cleanText(raw.title, 80) : '';
      errors.push({ index, title: titleHint || `(item ${index})`, error: check.error });
      summary.rejected += 1;
      results.push({ index, ok: false, error: check.error });
      continue;
    }
    try {
      const outcome = await upsertItem(check.value);
      summary[outcome.action === 'duplicate' ? 'duplicates' : outcome.action] += 1;
      results.push({ index, ok: true, action: outcome.action, id: outcome.id, type: check.value.type, title: check.value.title });
    } catch (err) {
      errors.push({ index, title: check.value.title, error: err.message });
      summary.rejected += 1;
      results.push({ index, ok: false, error: err.message });
    }
  }

  const allInvalid = summary.rejected === items.length;
  return res.status(allInvalid ? 400 : 200).json({
    ok: !allInvalid,
    ...summary,
    results,
    ...(errors.length ? { errors } : {}),
  });
};

// Internals exposed for unit-style testing only (mirrors api/jobs.js).
module.exports._internal = {
  validateItem,
  jobRecord,
  materialRecord,
  normalizeUrl,
  isValidUrl,
  safeEqual,
  bearerToken,
};
