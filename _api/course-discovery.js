/**
 * CivilCareer — Course Discovery API (course aggregator, v32)
 *
 * ADMIN-ONLY on every method: the dispatcher's ADMIN_RULES route
 * ('/api/course-discovery': () => true) runs verifyAdminToken on the
 * dashboard's Supabase session before this handler sees the request.
 *
 * SCOPE (directory spec): Udemy + Coursera, CIVIL ENGINEERING only.
 * Every import and every discovery run passes through directoryScope()
 * in lib/course-civil.js, which enforces the two rules — the provider
 * must be one the directory covers, and the text must classify as Civil
 * Engineering. Out-of-scope rows are rejected with the reason, never
 * quietly stored.
 *
 * Provider access — VERIFIED against the providers' own pages on
 * 2026-10-08, not assumed:
 *   Udemy    — "Access to the Affiliate API on Udemy has been
 *              discontinued since 1/1/2025" (udemy.com/developers/
 *              affiliate, still displayed today). No public catalogue
 *              API for a site like ours; scraping Udemy violates its
 *              terms. Status: discontinued.
 *   Coursera — api.coursera.org/api/courses.v1 does answer without a
 *              key, BUT api.coursera.org/robots.txt carries
 *              "Disallow: /api/" (re-checked today) and Coursera's
 *              terms do not grant automated reuse of its catalogue.
 *              CivCareer therefore does NOT call it. Authorized access
 *              needs a Coursera partner agreement. Status:
 *              no-authorized-api.
 *   Neither provider is available, so nothing above is crawled,
 *   guessed, or fabricated — POST ?action=run answers with the exact
 *   PROVIDER_ACCESS_NOTICE from lib/course-civil.js.
 *
 * What still works, always:
 *   POST ?action=import — manual / bulk admin import. Idempotent
 *   (provider+external_id unique index; URL fallback matching),
 *   preserves admin-owned fields (affiliate_url, is_featured,
 *   admin_notes, civil_verified) on update, and FORCES
 *   is_published = false: nothing imported or discovered ever becomes
 *   public without review.
 *   stageDiscovery() — the pipeline a provider adapter will call once
 *   real authorized access exists: normalize → civil filter → dedupe →
 *   pending review. Exercised by tests today, wired to no provider.
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
const {
  SUPPORTED_PROVIDERS,
  COURSE_SPECIALIZATIONS,
  PROVIDER_ACCESS_NOTICE,
  canonicalProvider,
  normalizeSpecialization,
  classifyCourse,
} = require('../lib/course-civil');

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
   not about this project, and `available` is the single switch the run
   path reads. Nothing is 'available' today, so no discovery run can
   silently claim to have fetched anything. Adding a provider later
   means: an entry here with available:true (only once authorized access
   is actually configured and tested) plus an adapter that respects the
   provider's terms and calls stageDiscovery(). */
function providers() {
  const udemyConfigured = Boolean(
    process.env.UDEMY_CLIENT_ID && process.env.UDEMY_CLIENT_SECRET
  );
  return [
    {
      id: 'udemy',
      label: 'Udemy',
      status: 'discontinued',
      available: false,
      configured: udemyConfigured,
      note: 'Udemy discontinued its Affiliate API on 2025-01-01 (still stated on '
        + 'udemy.com/developers/affiliate). There is no public catalogue API for this '
        + 'site and scraping is against Udemy\'s terms, so Udemy courses are added '
        + 'manually. Credentials alone do not enable discovery — the API is gone.',
    },
    {
      id: 'coursera',
      label: 'Coursera',
      status: 'no-authorized-api',
      available: false,
      configured: false,
      note: 'Coursera\'s legacy catalogue endpoint answers without a key, but '
        + 'api.coursera.org/robots.txt carries "Disallow: /api/" and Coursera\'s terms '
        + 'do not grant automated reuse, so CivilCareer does not call it. Authorized '
        + 'catalogue access needs a Coursera partner agreement.',
    },
  ];
}

/** Providers whose authorized API is configured right now (none today). */
function availableProviders() {
  return providers().filter((p) => p.available === true && p.configured === true);
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

/* PostgREST answers PGRST204 ("Could not find the 'specialization'
   column … in the schema cache") when v34-courses-civil.sql has not been
   run yet. That is a setup step, not a data problem, and it says so. */
function isMissingColumn(detail) {
  return /PGRST204|Could not find the '[^']+' column|column .* of relation .* does not exist/i.test(String(detail || ''));
}

const MISSING_COLUMN_MESSAGE = 'The courses table is missing the v34 columns (description, specialization, civil_verified). '
  + 'Run v34-courses-civil.sql in the Supabase SQL editor, then import again — nothing was written.';

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
  const providerRaw = cleanText(item.provider, 60);
  if (!providerRaw) return { error: 'provider is required' };
  /* 'udemy' from a feed or a paste becomes 'Udemy'; an unknown platform
     keeps its own spelling and is rejected later by directoryScope(). */
  const provider = canonicalProvider(providerRaw) || providerRaw;
  const course_url = cleanUrl(item.course_url, 500);
  if (!course_url) return { error: 'course_url must be a valid http(s) URL' };
  let affiliate_url = null;
  if (item.affiliate_url != null && String(item.affiliate_url).trim() !== '') {
    affiliate_url = cleanUrl(item.affiliate_url, 500);
    if (!affiliate_url) return { error: 'affiliate_url must be a valid http(s) URL' };
  }
  /* Price: 0 means free, omitted means "not provided" (NULL). Never
     invented — a provider that publishes no price yields no price. */
  const priceSupplied = item.price_inr != null && String(item.price_inr).trim() !== '';
  const price_inr = priceSupplied ? Math.max(0, Math.round(Number(item.price_inr) || 0)) : null;
  const roles = Array.isArray(item.target_roles) ? item.target_roles : String(item.target_roles || '').split(',');
  const ratingRaw = item.rating;
  let rating = null;
  if (ratingRaw != null && String(ratingRaw).trim() !== '') {
    const n = Number(ratingRaw);
    if (!Number.isFinite(n) || n < 0 || n > 5) return { error: 'rating must be between 0 and 5' };
    rating = n;
  }
  /* A specialization may be supplied by the feed or by the admin's bulk
     JSON; if it is supplied it must be one the directory knows, so the
     public filter can never contain a label nobody can select. */
  let specialization = null;
  if (item.specialization != null && String(item.specialization).trim() !== '') {
    specialization = normalizeSpecialization(item.specialization);
    if (!specialization) {
      return { error: 'specialization must be one of the known Civil Engineering specializations (GET /api/course-discovery lists them)' };
    }
  }

  return {
    payload: {
      title,
      provider,
      description: cleanText(item.description, 2000) || null,
      specialization,
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
      is_free: item.is_free === true || (priceSupplied && price_inr === 0),
      /* §16: discovered/imported rows are drafts, always — and an import
         never marks a course civil-verified: only the admin can do that. */
      is_published: false,
      civil_verified: false,
      is_featured: item.is_featured === true,
      admin_notes: cleanText(item.admin_notes, 2000) || null,
      updated_at: new Date().toISOString(),
    },
  };
}

/* Fields the import may WRITE on an existing row. affiliate_url /
   is_featured / admin_notes / civil_verified are admin-owned (§34): they
   are only touched when the incoming item explicitly carries them, and
   civil_verified never does. */
const IMPORT_WRITABLE = [
  'title', 'provider', 'description', 'specialization', 'instructor', 'category',
  'target_roles', 'career_stage', 'price_inr', 'original_price_inr', 'rating',
  'enrollment_count', 'duration_hours', 'language', 'thumbnail_url', 'course_url',
  'external_id', 'source', 'is_free',
];

/* ── The directory's scope gate ───────────────────────────────────
   One function, used by the bulk import AND by the provider pipeline,
   so a course cannot enter the table through one door that would be
   refused at the other:
     1. the provider must be one the directory covers (Udemy/Coursera)
     2. the text must classify as Civil Engineering
   Returns { error } when out of scope, else the canonical provider and
   the specialization the classifier assigned. */
function directoryScope(payload) {
  const provider = canonicalProvider(payload.provider);
  if (!provider) {
    return { error: `provider must be ${SUPPORTED_PROVIDERS.join(' or ')} — the /courses directory covers those two platforms` };
  }
  const classification = classifyCourse({
    title: payload.title,
    description: payload.description,
    category: payload.category,
    specialization: payload.specialization,
  });
  if (!classification.civil) {
    return { error: 'not a Civil Engineering course (' + classification.reasons.join(', ') + ')' };
  }
  return { provider, specialization: classification.specialization, classification };
}

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

async function runImport(items, opts = {}) {
  const rejected = [];
  let imported = 0;
  let updated = 0;
  let setupError = null;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const built = importItem(item);
    if (built.error) {
      rejected.push({ index: i, title: cleanText(item && item.title, 80), reason: built.error });
      continue;
    }
    const payload = built.payload;

    /* Directory scope: Udemy/Coursera + Civil Engineering only. An
       out-of-scope row is reported with its reason so the admin can see
       exactly what was refused and why. */
    const scope = directoryScope(payload);
    if (scope.error) {
      rejected.push({ index: i, title: payload.title, reason: scope.error });
      continue;
    }
    payload.provider = scope.provider;
    payload.specialization = payload.specialization || scope.specialization;
    if (opts.source) payload.source = opts.source;

    const existingId = await findExisting(payload);

    if (existingId) {
      const patch = {};
      for (const k of IMPORT_WRITABLE) patch[k] = payload[k];
      /* Admin-owned fields: only when explicitly present in the item. */
      if (Object.prototype.hasOwnProperty.call(item, 'affiliate_url')) patch.affiliate_url = payload.affiliate_url;
      if (Object.prototype.hasOwnProperty.call(item, 'is_featured')) patch.is_featured = payload.is_featured === true;
      if (Object.prototype.hasOwnProperty.call(item, 'admin_notes')) patch.admin_notes = payload.admin_notes;
      patch.updated_at = new Date().toISOString();
      try {
        await supa(`courses?id=eq.${encodeURIComponent(existingId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        updated += 1;
      } catch (e) {
        const detail = String((e && e.message) || e);
        if (isMissingColumn(detail)) { setupError = MISSING_COLUMN_MESSAGE; break; }
        rejected.push({ index: i, title: payload.title, reason: detail.slice(0, 120) });
      }
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
      if (isMissingColumn(detail)) { setupError = MISSING_COLUMN_MESSAGE; break; }
      if (/duplicate key|23505/i.test(detail)) {
        rejected.push({ index: i, title: payload.title, reason: 'duplicate provider+external_id' });
      } else {
        rejected.push({ index: i, title: payload.title, reason: detail.slice(0, 120) });
      }
    }
  }

  return { imported, updated, rejected, setupError };
}

/* ── Provider pipeline (runs when a provider is genuinely available) ──
   provider feed → normalize → Civil Engineering filter → deduplicate →
   pending review. This is the exact chain the directory spec asks for,
   and it is the same code the admin's bulk import uses, so a discovered
   row gets the same guarantees: provider+external_id dedupe, forced
   is_published:false, admin-owned fields untouched.

   Nothing calls this today because no provider is `available`; the
   tests drive it directly with a sample feed to prove the chain works.
   When authorized access exists, its adapter fetches and calls this. */
async function stageDiscovery(providerId, items) {
  const provider = canonicalProvider(providerId);
  if (!provider) return { staged: 0, rejected: [{ index: -1, title: '', reason: `unknown provider ${providerId}` }] };
  const result = await runImport(
    (Array.isArray(items) ? items : []).map((it) => ({ ...it, provider })),
    { source: `discovery:${provider.toLowerCase()}` }
  );
  return { staged: result.imported, updated: result.updated, rejected: result.rejected, setupError: result.setupError };
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
      const available = availableProviders();
      return j(res, 200, {
        ok: true,
        providers: providers(),
        apiAccess: {
          configured: available.length > 0,
          providers: available.map((p) => p.id),
          /* The exact sentence to show whenever automatic discovery is
             unavailable. The admin UI prints it verbatim. */
          notice: PROVIDER_ACCESS_NOTICE,
        },
        scope: {
          providers: SUPPORTED_PROVIDERS,
          civilOnly: true,
          specializations: COURSE_SPECIALIZATIONS,
        },
        searchTerms: DEFAULT_SEARCH_TERMS,
        manualImport: {
          endpoint: '/api/course-discovery?action=import',
          method: 'POST',
          bodyShape: {
            items: [{
              title: 'string (required)',
              provider: 'Udemy | Coursera (required — the directory scope)',
              course_url: 'https:// (required)',
              description: 'string — short factual summary, shown on the card (optional)',
              specialization: 'string — one of scope.specializations; left empty the classifier assigns it (optional)',
              affiliate_url: 'https:// (optional, may stay empty)',
              category: 'string', career_stage: 'Fresher | 0-2 years | 3-5 years | 5+ years | Senior',
              target_roles: ['Site Engineer'],
              external_id: 'optional', price_inr: 0, rating: 0, is_free: true,
            }],
          },
          note: 'Every imported row is a draft (is_published=false) and appears under pending review in the Courses tab. '
            + 'Rows whose provider is not Udemy/Coursera, or whose text is not Civil Engineering, are rejected with the reason.',
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
      /* A provider runs only when its status is genuinely available AND
         its authorized credentials are configured. Today neither is, so
         the answer is the directory spec's exact sentence — no crawling,
         no scraping, no invented courses. */
      const available = availableProviders();
      if (!available.length) {
        return j(res, 200, {
          ok: true,
          providersRun: 0,
          staged: 0,
          code: 'no-provider-available',
          message: PROVIDER_ACCESS_NOTICE,
          details: 'Udemy discontinued its Affiliate API on 2025-01-01 (udemy.com/developers/affiliate), '
            + 'and Coursera has no catalogue API CivilCareer is authorized to call — api.coursera.org/robots.txt '
            + 'disallows /api/ and Coursera\'s terms do not permit automated reuse. Nothing was fetched, scraped or invented.',
          hint: 'Add courses with the Add course form or POST ?action=import — everything lands as a draft for review.',
          scope: { providers: SUPPORTED_PROVIDERS, civilOnly: true },
        });
      }
      /* A provider adapter lives here once one is authorized and tested:
         fetch → stageDiscovery(provider.id, items) → pending review.
         stageDiscovery() is already implemented and tested; only the
         provider fetch itself is missing. */
      return j(res, 200, {
        ok: true,
        providersRun: 0,
        staged: 0,
        code: 'adapter-not-implemented',
        message: 'A provider reports available credentials but no adapter is implemented for it yet — nothing was fetched.',
      });
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
      if (result.setupError) {
        return j(res, 503, { ok: false, error: result.setupError, ...result });
      }
      return j(res, 200, {
        ok: true,
        ...result,
        scope: { providers: SUPPORTED_PROVIDERS, civilOnly: true },
        note: 'Imported as drafts — review and publish them in admin → Courses. '
          + 'Out-of-scope rows (wrong platform, or not Civil Engineering) are listed under rejected.',
      });
    }

    return j(res, 400, { ok: false, error: 'Unknown action. Use ?action=run or ?action=import.' });
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    if (isMissingColumn(detail)) {
      return j(res, 503, { ok: false, error: MISSING_COLUMN_MESSAGE });
    }
    if (isSetupError(detail)) {
      return j(res, 503, {
        ok: false,
        error: 'Courses table missing. Run v32-courses.sql in the Supabase SQL editor.',
      });
    }
    return j(res, 500, { ok: false, error: 'Discovery request failed', details: detail.slice(0, 300) });
  }
};

module.exports._internal = {
  importItem,
  normalizeUrl,
  providers,
  availableProviders,
  directoryScope,
  stageDiscovery,
  runImport,
  PROVIDER_ACCESS_NOTICE,
};
