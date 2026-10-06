/**
 * CivilCareer — Course Discovery API (course aggregator, v32)
 *
 * ADMIN-ONLY on every method: the dispatcher's ADMIN_RULES route
 * ('/api/course-discovery': () => true) runs verifyAdminToken on the
 * dashboard's Supabase session before this handler sees the request.
 *
 * Provider policy (master prompt §15 — VERIFY BEFORE RELYING):
 *   Udemy's Affiliate API v2.0 was DISCONTINUED on 2025-01-01
 *   (udemy.com/developers/affiliate: "Access to the Affiliate API on
 *   Udemy has been discontinued since 1/1/2025"). This endpoint does
 *   NOT call it, even when UDEMY_CLIENT_ID / UDEMY_CLIENT_SECRET are
 *   configured, and it never fabricates provider responses. The
 *   registry below reports each provider's real status so the admin
 *   UI can say so plainly.
 *
 * What still works, always:
 *   POST ?action=import — manual / bulk admin import. Idempotent
 *   (provider+external_id unique index; URL fallback matching),
 *   preserves admin-owned fields (affiliate_url, is_featured,
 *   admin_notes) on update, and FORCES is_published = false: nothing
 *   discovered or imported ever becomes public without review.
 *
 * Secrets: UDEMY_CLIENT_ID / UDEMY_CLIENT_SECRET are read only as
 * booleans (configured: true/false) and never echoed anywhere.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

/* The specification's standing search terms — kept configurable, used
   by any provider that becomes genuinely available. */
const DEFAULT_SEARCH_TERMS = [
  'AutoCAD civil engineering',
  'STAAD Pro structural',
  'Primavera P6',
  'GATE civil engineering',
  'RCC design IS 456',
  'BIM Revit civil',
  'quantity surveying',
  'construction management',
  'civil engineering interview',
  'SSC JE civil preparation',
];

/* Provider registry — status is a fact about the provider's public API,
   not about this project. Adding a provider later means adding an entry
   here plus an implementation that respects the provider's terms. */
function providers() {
  const udemyConfigured = Boolean(
    process.env.UDEMY_CLIENT_ID && process.env.UDEMY_CLIENT_SECRET
  );
  return [
    {
      id: 'udemy',
      label: 'Udemy',
      status: 'discontinued',
      configured: udemyConfigured,
      note: 'Udemy discontinued public Affiliate API access on 2025-01-01. '
        + 'Automated discovery is unavailable; add Udemy courses manually '
        + '(affiliate deep links must come from your affiliate dashboard).',
    },
    {
      id: 'coursera',
      label: 'Coursera',
      status: 'no-public-api',
      configured: false,
      note: 'Coursera offers no public course-catalog API for affiliates. Manual import only.',
    },
    {
      id: 'nptel',
      label: 'NPTEL / YouTube',
      status: 'manual',
      configured: false,
      note: 'NPTEL courses are free and curated manually — paste the course page URL into the import box.',
    },
  ];
}

function j(res, code, obj) {
  return res.status(code).json(obj);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanUrl(value, max) {
  const raw = cleanText(value, max);
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
}

/* Strip campaign noise so the same course pasted twice matches. */
function normalizeUrl(value) {
  try {
    const u = new URL(String(value));
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'mc_cid', 'mc_eid']) {
      u.searchParams.delete(k);
    }
    return u.toString().replace(/\/$/, '');
  } catch (_) {
    return null;
  }
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

async function readJson(res) {
  const t = await res.text();
  if (!res.ok) throw new Error(t || `Supabase ${res.status}`);
  return t ? JSON.parse(t) : [];
}

function isSetupError(detail) {
  return /PGRST205|relation .* does not exist|Could not find the table/i.test(String(detail || ''));
}

function requireAdmin(req, res) {
  if (!req.adminUser) {
    j(res, 401, { ok: false, error: 'Administrator authentication required.' });
    return false;
  }
  return true;
}

/* Validate one import item. Mirrors /api/courses validation but keeps
   the import-specific rules (never publish, keep source). */
function importItem(item) {
  if (!item || typeof item !== 'object') return { error: 'not an object' };
  const title = cleanText(item.title, 160);
  if (!title) return { error: 'title is required' };
  const provider = cleanText(item.provider, 60);
  if (!provider) return { error: 'provider is required' };
  const course_url = cleanUrl(item.course_url, 500);
  if (!course_url) return { error: 'course_url must be a valid http(s) URL' };
  let affiliate_url = null;
  if (item.affiliate_url != null && String(item.affiliate_url).trim() !== '') {
    affiliate_url = cleanUrl(item.affiliate_url, 500);
    if (!affiliate_url) return { error: 'affiliate_url must be a valid http(s) URL' };
  }
  const price_inr = Math.max(0, Math.round(Number(item.price_inr) || 0));
  const roles = Array.isArray(item.target_roles) ? item.target_roles : String(item.target_roles || '').split(',');
  const ratingRaw = item.rating;
  let rating = null;
  if (ratingRaw != null && String(ratingRaw).trim() !== '') {
    const n = Number(ratingRaw);
    if (!Number.isFinite(n) || n < 0 || n > 5) return { error: 'rating must be between 0 and 5' };
    rating = n;
  }
  return {
    payload: {
      title,
      provider,
      instructor: cleanText(item.instructor, 80) || null,
      category: cleanText(item.category, 60) || null,
      target_roles: [...new Set(roles.map((r) => cleanText(r, 40)).filter(Boolean))].slice(0, 8),
      career_stage: cleanText(item.career_stage, 40) || null,
      price_inr,
      original_price_inr: Number.isFinite(Number(item.original_price_inr)) && item.original_price_inr != null && String(item.original_price_inr) !== ''
        ? Math.max(0, Math.round(Number(item.original_price_inr)))
        : null,
      rating,
      enrollment_count: Number.isFinite(Number(item.enrollment_count)) && item.enrollment_count != null && String(item.enrollment_count) !== ''
        ? Math.max(0, Math.round(Number(item.enrollment_count)))
        : null,
      duration_hours: Number.isFinite(Number(item.duration_hours)) && item.duration_hours != null && String(item.duration_hours) !== ''
        ? Math.max(0, Number(item.duration_hours))
        : null,
      language: cleanText(item.language, 40) || null,
      thumbnail_url: item.thumbnail_url ? (cleanUrl(item.thumbnail_url, 500) || null) : null,
      course_url,
      affiliate_url,
      external_id: cleanText(item.external_id, 120) || null,
      source: cleanText(item.source, 40) || 'import',
      is_free: item.is_free === true || (!('is_free' in item) && price_inr === 0),
      /* §16: discovered/imported rows are drafts, always. */
      is_published: false,
      is_featured: item.is_featured === true,
      admin_notes: cleanText(item.admin_notes, 2000) || null,
      updated_at: new Date().toISOString(),
    },
  };
}

/* Fields the import may WRITE on an existing row. affiliate_url /
   is_featured / admin_notes are admin-owned (§34): they are only
   touched when the incoming item explicitly carries them. */
const IMPORT_WRITABLE = [
  'title', 'provider', 'instructor', 'category', 'target_roles', 'career_stage',
  'price_inr', 'original_price_inr', 'rating', 'enrollment_count', 'duration_hours',
  'language', 'thumbnail_url', 'course_url', 'external_id', 'source', 'is_free',
];

async function findExisting(payload) {
  if (payload.external_id) {
    const byExt = await readJson(await supa(
      `courses?select=id&provider=eq.${encodeURIComponent(payload.provider)}`
      + `&external_id=eq.${encodeURIComponent(payload.external_id)}&limit=1`
    ));
    if (byExt.length) return byExt[0].id;
  }
  const raw = payload.course_url;
  const norm = normalizeUrl(raw);
  for (const candidate of [raw, norm].filter(Boolean)) {
    const byUrl = await readJson(await supa(
      `courses?select=id&course_url=eq.${encodeURIComponent(candidate)}&limit=1`
    ));
    if (byUrl.length) return byUrl[0].id;
  }
  return null;
}

async function runImport(items) {
  const rejected = [];
  let imported = 0;
  let updated = 0;

  for (let i = 0; i < items.length; i += 1) {
    const built = importItem(items[i]);
    if (built.error) {
      rejected.push({ index: i, title: cleanText(items[i] && items[i].title, 80), reason: built.error });
      continue;
    }
    const payload = built.payload;
    const existingId = await findExisting(payload);

    if (existingId) {
      const patch = {};
      for (const k of IMPORT_WRITABLE) patch[k] = payload[k];
      /* Admin-owned fields: only when explicitly present in the item. */
      const item = items[i];
      if (Object.prototype.hasOwnProperty.call(item, 'affiliate_url')) patch.affiliate_url = payload.affiliate_url;
      if (Object.prototype.hasOwnProperty.call(item, 'is_featured')) patch.is_featured = payload.is_featured === true;
      if (Object.prototype.hasOwnProperty.call(item, 'admin_notes')) patch.admin_notes = payload.admin_notes;
      patch.updated_at = new Date().toISOString();
      await supa(`courses?id=eq.${encodeURIComponent(existingId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      updated += 1;
      continue;
    }

    try {
      await supa('courses', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
      imported += 1;
    } catch (e) {
      /* Unique (provider, external_id) raced or column lag — report, don't abort. */
      const detail = String((e && e.message) || e);
      if (/duplicate key|23505/i.test(detail)) {
        rejected.push({ index: i, title: payload.title, reason: 'duplicate provider+external_id' });
      } else {
        rejected.push({ index: i, title: payload.title, reason: detail.slice(0, 120) });
      }
    }
  }

  return { imported, updated, rejected };
}

/* ════════════════════════════ HANDLER ════════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }
  if (!SUPA || !KEY) {
    return j(res, 500, { ok: false, error: 'Supabase server configuration is missing' });
  }
  if (!requireAdmin(req, res)) return;

  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const body = parseBody(req);

  try {
    /* ── GET — provider status + search terms (no secrets) ───── */
    if (req.method === 'GET') {
      return j(res, 200, {
        ok: true,
        providers: providers(),
        searchTerms: DEFAULT_SEARCH_TERMS,
        manualImport: {
          endpoint: '/api/course-discovery?action=import',
          method: 'POST',
          bodyShape: {
            items: [{
              title: 'string (required)',
              provider: 'string (required)',
              course_url: 'https:// (required)',
              affiliate_url: 'https:// (optional)',
              category: 'string', career_stage: 'Fresher | 0-2 years | 3-5 years | 5+ years | Senior',
              target_roles: ['Site Engineer'],
              external_id: 'optional', price_inr: 0, rating: 0, is_free: true,
            }],
          },
          note: 'Every imported row is a draft (is_published=false) and appears under pending review in the Courses tab.',
        },
      });
    }

    if (req.method !== 'POST') {
      return j(res, 405, { ok: false, error: 'Method not allowed' });
    }

    /* ── POST ?action=run — run available providers ──────────── */
    if (q.get('action') === 'run') {
      if (!rateLimit(req, { windowMs: 60 * 1000, max: 5, key: 'course-discovery-run' })) {
        return j(res, 429, { ok: false, error: 'Too many discovery runs. Wait a minute.' });
      }
      /* A provider runs only when its status is 'available' AND its
         credentials exist. Today none is — Udemy's API is gone — and
         we say that instead of pretending or scraping. */
      const available = providers().filter((p) => p.status === 'available' && p.configured);
      if (!available.length) {
        return j(res, 200, {
          ok: true,
          providersRun: 0,
          staged: 0,
          code: 'no-provider-available',
          message: 'No provider API is currently available. Udemy discontinued its Affiliate API on 2025-01-01 and the other providers have no public catalog API.',
          hint: 'Add courses with the Add course form or POST ?action=import — everything lands as a draft for review.',
        });
      }
      /* Future providers hook in here, each honoring its own terms. */
      return j(res, 200, { ok: true, providersRun: 0, staged: 0, code: 'not-implemented' });
    }

    /* ── POST ?action=import — manual bulk import ────────────── */
    if (q.get('action') === 'import') {
      if (!rateLimit(req, { windowMs: 60 * 1000, max: 10, key: 'course-discovery-import' })) {
        return j(res, 429, { ok: false, error: 'Too many imports. Wait a minute.' });
      }
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : null;
      if (!items) return j(res, 400, { ok: false, error: 'items must be an array (max 200 per call).' });
      if (!items.length) return j(res, 400, { ok: false, error: 'items is empty.' });

      const result = await runImport(items);
      return j(res, 200, {
        ok: true,
        ...result,
        note: 'Imported as drafts — review and publish them in admin → Courses.',
      });
    }

    return j(res, 400, { ok: false, error: 'Unknown action. Use ?action=run or ?action=import.' });
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    if (isSetupError(detail)) {
      return j(res, 503, {
        ok: false,
        error: 'Courses table missing. Run v32-courses.sql in the Supabase SQL editor.',
      });
    }
    return j(res, 500, { ok: false, error: 'Discovery request failed', details: detail.slice(0, 300) });
  }
};

module.exports._internal = { importItem, normalizeUrl, providers };
