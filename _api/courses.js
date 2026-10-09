/**
 * CivilCareer — Courses API (course aggregator, v32)
 *
 * PUBLIC (no auth)
 *   GET  /api/courses
 *        Filters: category, role (target_roles), stage (career_stage),
 *                 provider, free=true, search, featured=true, page, limit
 *        Only is_published = true rows are ever returned — the query
 *        forces the filter server-side, so a client cannot ask for drafts.
 *        Response: { ok, courses, total, page, pages, limit, filters }
 *   POST /api/courses?action=click   { id, source?, referrer? }
 *        Aggregate click tracking, recorded server-side in course_clicks.
 *        Rate-limited per IP. Stores NO personal data.
 *   POST /api/courses?action=save     { id }  (Bearer token required)
 *   POST /api/courses?action=unsave   { id }  (Bearer token required)
 *        Bookmarks into candidate_saved_courses (v35). The token is
 *        verified against Supabase Auth; writes are always scoped to
 *        the VERIFIED user id, never a client-sent id.
 *   GET  /api/courses?saved=1         (Bearer token required)
 *        The signed-in visitor's saved, still-published courses.
 *   GET  /api/courses?id=<id>          → { ok, course } (single published)
 *
 * ADMIN (req.adminUser — the dispatcher's ADMIN_RULES elevates the
 *        dashboard's Supabase session through verifyAdminToken before
 *        this handler ever sees the request; the checks here are the
 *        second lock on the same door)
 *   GET    ?admin=1  → every course (incl. drafts) + stats
 *   POST             → create (never auto-publishes: is_published
 *                      defaults false) or update when { id } is present
 *   PATCH / PUT      → update only; { id } is mandatory (spec §13)
 *   DELETE ?id=      → delete (course_clicks cascade)
 *
 * Table: courses + course_clicks (v32-courses.sql, v34-courses-civil.sql)
 *        + candidate_saved_courses (v35-courses-saved.sql)
 * Affiliate discipline: affiliate_url lives ONLY in the database, is
 * written only by admin mutations, and is read publicly only so the
 * CTA can use it. admin_notes never leaves this endpoint's admin path.
 * Monitisation is NOT required for this surface: affiliate_url may stay
 * NULL on every row, and a row with no affiliate_url is served (and
 * labelled) as an ordinary provider link.
 *
 * Scope: the directory is Civil Engineering only, from Udemy and
 * Coursera. Two consequences live here:
 *   * filters expose the Civil Engineering specializations, and the
 *     provider facet always offers Udemy and Coursera;
 *   * a course cannot be PUBLISHED until it classifies as Civil
 *     Engineering (lib/course-civil.js) or an admin explicitly verified
 *     it (`civil_verified`). Drafts are unaffected — only going public
 *     is gated, so an unclassified row can sit in the review queue.
 *
 * If v34 has not been applied yet the public list falls back to the v32
 * columns and reports which migration is missing, so a deploy that
 * lands before the migration cannot take /courses down.
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
  classifyCourse,
  normalizeSpecialization,
} = require('../lib/course-civil');

/* ── Saved courses (bookmarks) — v35 ───────────────────────────────
   Signed-in visitors only. The bearer token is verified against
   Supabase Auth (the account.js pattern); every subsequent read/write
   is forced through the verified user_id — never a client-supplied id.
   Table: candidate_saved_courses (v35-courses-saved.sql). */
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

async function userFromBearer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  if (!/^Bearer\s+\S+$/i.test(h)) return null;
  const token = h.replace(/^Bearer\s+/i, '').trim();
  try {
    const r = await fetch(`${SUPA}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? { id: String(u.id), email: u.email || '' } : null;
  } catch (_) { return null; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function savedCoursesEnabled() {
  return Boolean(ANON_KEY);
}

/* The public card needs exactly these fields — nothing else. admin_notes,
   url_status, external_id and civil_verified stay admin-side by
   construction. BASE is the v32 prefix; the v34 columns are appended and
   dropped again by the fallback below when the migration is missing. */
const PUBLIC_SELECT_BASE =
  'id,title,provider,instructor,category,target_roles,career_stage,'
  + 'price_inr,original_price_inr,rating,enrollment_count,duration_hours,'
  + 'language,thumbnail_url,course_url,affiliate_url,is_free,is_featured,created_at';
const PUBLIC_SELECT = PUBLIC_SELECT_BASE + ',description,specialization';

const DEFAULT_LIMIT = 24; /* section 31: 20–24 per request */
const MAX_LIMIT = 50;
const MAX_ROWS = 1000;     /* count/facet scan cap — start small (section 44) */
const MAX_CLICK_SCAN = 5000;

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
  return /PGRST205|relation .* does not exist|Could not find the table|column .* of relation .* does not exist/i.test(String(detail || ''));
}

/* PostgREST says PGRST204 when a named column is not in the schema cache
   — i.e. v34-courses-civil.sql has not been applied yet. */
function isMissingColumn(detail) {
  return /PGRST204|Could not find the '[^']+' column|column .* of relation .* does not exist/i.test(String(detail || ''));
}

const MISSING_COLUMN_MESSAGE = 'The courses table is missing the v34 columns (description, specialization, civil_verified). '
  + 'Run v34-courses-civil.sql in the Supabase SQL editor.';

function requireAdmin(req, res) {
  if (!req.adminUser) {
    j(res, 401, { ok: false, error: 'Administrator authentication required.' });
    return false;
  }
  return true;
}

/* Public projection — explicit field list even when a query path changes. */
function publicCourse(r) {
  return {
    id: r.id,
    title: r.title,
    provider: r.provider,
    instructor: r.instructor || null,
    category: r.category || null,
    target_roles: Array.isArray(r.target_roles) ? r.target_roles : [],
    career_stage: r.career_stage || null,
    price_inr: r.price_inr == null ? null : Number(r.price_inr),
    original_price_inr: r.original_price_inr == null ? null : Number(r.original_price_inr),
    rating: r.rating == null ? null : Number(r.rating),
    enrollment_count: r.enrollment_count == null ? null : Number(r.enrollment_count),
    duration_hours: r.duration_hours == null ? null : Number(r.duration_hours),
    language: r.language || null,
    thumbnail_url: r.thumbnail_url || null,
    course_url: r.course_url,
    affiliate_url: r.affiliate_url || null,
    description: r.description || null,
    specialization: r.specialization || null,
    is_free: Boolean(r.is_free),
    is_featured: Boolean(r.is_featured),
    created_at: r.created_at,
  };
}

function numOrNull(v, min, max) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Validate a course payload from the admin form or the discovery import.
 * Returns { error } on the first problem, else { payload }.
 * is_published is NEVER taken from discovery input — the caller decides.
 */
function coursePayload(body, { forImport = false } = {}) {
  const title = cleanText(body.title, 160);
  if (!title) return { error: 'Title is required.' };
  const provider = cleanText(body.provider, 60);
  if (!provider) return { error: 'Provider is required.' };
  const course_url = cleanUrl(body.course_url, 500);
  if (!course_url) return { error: 'course_url must be a valid http(s) URL.' };

  let affiliate_url = null;
  if (body.affiliate_url != null && String(body.affiliate_url).trim() !== '') {
    affiliate_url = cleanUrl(body.affiliate_url, 500);
    if (!affiliate_url) return { error: 'affiliate_url must be a valid http(s) URL.' };
  }
  let thumbnail_url = null;
  if (body.thumbnail_url != null && String(body.thumbnail_url).trim() !== '') {
    thumbnail_url = cleanUrl(body.thumbnail_url, 500);
    if (!thumbnail_url) return { error: 'thumbnail_url must be a valid http(s) URL.' };
  }

  /* Price: a supplied 0 means free; an OMITTED price stays NULL ("not
     provided") instead of being invented as 0/FREE. */
  const priceSupplied = body.price_inr != null && String(body.price_inr).trim() !== '';
  const price_inr = priceSupplied ? Math.max(0, Math.round(Number(body.price_inr) || 0)) : null;
  const roles = Array.isArray(body.target_roles) ? body.target_roles : String(body.target_roles || '').split(',');
  const target_roles = [...new Set(roles.map((r) => cleanText(r, 40)).filter(Boolean))].slice(0, 8);

  const rating = numOrNull(body.rating, 0, 5);
  if (body.rating != null && String(body.rating).trim() !== '' && rating === null) {
    return { error: 'rating must be a number between 0 and 5.' };
  }
  const enrollment_count = numOrNull(body.enrollment_count, 0, 100000000);
  if (body.enrollment_count != null && String(body.enrollment_count).trim() !== '' && enrollment_count === null) {
    return { error: 'enrollment_count must be a non-negative number.' };
  }
  const duration_hours = numOrNull(body.duration_hours, 0, 10000);
  if (body.duration_hours != null && String(body.duration_hours).trim() !== '' && duration_hours === null) {
    return { error: 'duration_hours must be a non-negative number.' };
  }
  const original_price_inr = numOrNull(body.original_price_inr, 0, 10000000);

  /* The Civil Engineering classification. An empty value is allowed
     (the classifier will decide on publish); a value that is not one of
     the directory's specializations is a client error, so the public
     filter can never contain a label nobody can select. */
  let specialization = null;
  if (body.specialization != null && String(body.specialization).trim() !== '') {
    specialization = normalizeSpecialization(body.specialization);
    if (!specialization) {
      return { error: 'specialization must be one of the known Civil Engineering specializations (GET /api/course-discovery lists them).' };
    }
  }

  return {
    payload: {
      title,
      provider,
      description: cleanText(body.description, 2000) || null,
      specialization,
      civil_verified: body.civil_verified === true,
      instructor: cleanText(body.instructor, 80) || null,
      category: cleanText(body.category, 60) || null,
      target_roles,
      career_stage: cleanText(body.career_stage, 40) || null,
      price_inr,
      original_price_inr,
      rating,
      enrollment_count,
      duration_hours,
      language: cleanText(body.language, 40) || null,
      thumbnail_url,
      course_url,
      affiliate_url,
      external_id: cleanText(body.external_id, 120) || null,
      source: cleanText(body.source, 40) || (forImport ? 'import' : 'manual'),
      is_free: body.is_free === true || body.is_free === 'true' || (priceSupplied && price_inr === 0),
      is_published: body.is_published === true,
      is_featured: body.is_featured === true,
      admin_notes: cleanText(body.admin_notes, 2000) || null,
      updated_at: new Date().toISOString(),
    },
  };
}

/* A course is publishable when it classifies as Civil Engineering, or
   when an admin explicitly verified it. Drafts are never judged — the
   gate only fires on is_published, so a newly imported or discovered
   row can always sit in the review queue until a human decides. */
function publishGate(payload) {
  if (payload.is_published !== true) return null;
  if (payload.civil_verified === true) return null;
  const c = classifyCourse({
    title: payload.title,
    description: payload.description,
    category: payload.category,
    specialization: payload.specialization,
  });
  if (c.civil) return null;
  return {
    error: 'Not publishable yet — this course does not classify as Civil Engineering ('
      + c.reasons.join(', ') + '). Set the Civil Engineering specialization, or tick '
      + '"Civil relevance verified" to publish it anyway.',
    classification: c,
  };
}

/* Filters the public list understands. The published-only constraint is
   added by the caller and is never part of user input.

   opts.extended=false drops the v34 columns — used only by the fallback
   when the migration has not been applied yet. */
function publicListPath(q, opts = {}) {
  const extended = opts.extended !== false;
  const limit = Math.min(Math.max(parseInt(q.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(parseInt(q.get('page') || '1', 10) || 1, 1);
  const offset = (page - 1) * limit;

  let path = `courses?select=${extended ? PUBLIC_SELECT : PUBLIC_SELECT_BASE}&is_published=eq.true`;
  const category = cleanText(q.get('category'), 60);
  if (category) path += `&category=eq.${encodeURIComponent(category)}`;
  const provider = cleanText(q.get('provider'), 60);
  if (provider) path += `&provider=eq.${encodeURIComponent(provider)}`;
  const stage = cleanText(q.get('stage'), 40);
  if (stage) path += `&career_stage=eq.${encodeURIComponent(stage)}`;
  /* The Civil Engineering specialization — the directory's headline
     filter. Ignored in the legacy fallback, where the column is absent. */
  const specialization = extended ? normalizeSpecialization(q.get('specialization')) : null;
  if (specialization) path += `&specialization=eq.${encodeURIComponent(specialization)}`;
  const role = cleanText(q.get('role'), 40);
  if (role) path += `&target_roles=cs.${encodeURIComponent('{"' + role.replace(/"/g, '') + '"}')}`;
  if (q.get('free') === 'true') path += '&is_free=eq.true';
  /* Free / Paid is a single choice on the page. */
  if (q.get('paid') === 'true') path += '&is_free=eq.false';
  if (q.get('featured') === 'true') path += '&is_featured=eq.true';
  const search = cleanText(q.get('search'), 60).replace(/[^a-zA-Z0-9 .\-]/g, ' ').trim();
  if (search) {
    const term = encodeURIComponent(`*${search}*`);
    path += `&or=(title.ilike.${term},provider.ilike.${term})`;
  }
  path += `&order=is_featured.desc,rating.desc.nullslast,created_at.desc`;
  path += `&limit=${limit}&offset=${offset}`;
  return { path, limit, page };
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

  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const body = parseBody(req);

  try {
    /* ── PUBLIC GET — published courses only ─────────────────── */
    if (req.method === 'GET' && !q.has('admin')) {
      let { path, limit, page } = publicListPath(q);
      /* One bounded scan gives the total AND the filter options —
         distinct values are derived from published rows only. */
      const facetPath = (extended) =>
        `courses?select=category,provider,career_stage${extended ? ',specialization' : ''}&is_published=eq.true&limit=${MAX_ROWS}`;
      let rows;
      let facets;
      let extended = true;
      try {
        [rows, facets] = await Promise.all([
          readJson(await supa(path)),
          readJson(await supa(facetPath(true))),
        ]);
      } catch (e) {
        /* v34 not applied yet: keep the directory serving the v32 columns
           and say so, instead of taking the public page down. */
        const detail = String((e && e.message) || e);
        if (!isMissingColumn(detail)) throw e;
        extended = false;
        ({ path, limit, page } = publicListPath(q, { extended: false }));
        [rows, facets] = await Promise.all([
          readJson(await supa(path)),
          readJson(await supa(facetPath(false))),
        ]);
      }
      const distinct = (key) => [...new Set(facets.map((r) => r[key]).filter(Boolean))].sort();
      const extraProviders = distinct('provider').filter((p) => !SUPPORTED_PROVIDERS.includes(p));
      return j(res, 200, {
        ok: true,
        courses: rows.map(publicCourse),
        total: facets.length,
        page,
        pages: Math.max(1, Math.ceil(facets.length / limit)),
        limit,
        filters: {
          /* Udemy and Coursera are always offered, even before the first
             course is published — they are the directory's scope. */
          providers: [...SUPPORTED_PROVIDERS, ...extraProviders],
          categories: distinct('category'),
          stages: distinct('career_stage'),
          /* The Civil Engineering specialization filter offers the whole
             directory vocabulary, not only what is published today, so
             the page is useful while the catalogue is still filling up.
             (Writes validate against this list, so a stored value is
             always selectable.) */
          specializations: COURSE_SPECIALIZATIONS,
        },
        ...(extended ? {} : {
          columnsMissing: true,
          notice: 'Run v34-courses-civil.sql to enable course descriptions and the Civil Engineering specialization filter.',
        }),
      });
    }

    /* ── PUBLIC GET with saves overlay — published courses + my ★ ── */
    if (req.method === 'GET' && q.has('saved') && savedCoursesEnabled()) {
      const u = await userFromBearer(req);
      if (!u) return j(res, 401, { ok: false, error: 'Sign in required.' });
      const ids = await readJson(await supa(
        `candidate_saved_courses?select=course_id,saved_at&user_id=eq.${encodeURIComponent(u.id)}&order=saved_at.desc&limit=200`
      ));
      const savedIds = Array.isArray(ids) ? ids.map((r) => String(r.course_id)) : [];
      if (!savedIds.length) return j(res, 200, { ok: true, courses: [], saved_ids: [] });
      /* Published rows only — an unpublished course can never be
         served because it was saved while public and later unpublishd. */
      const inList = savedIds.map((x) => `"${x.replace(/"/g, '')}"`).join(',');
      const rows = await readJson(await supa(
        `courses?select=${PUBLIC_SELECT}&id=in.(${encodeURIComponent(inList)})&is_published=eq.true&limit=${savedIds.length}`
      ));
      return j(res, 200, {
        ok: true,
        courses: Array.isArray(rows) ? rows.map(publicCourse) : [],
        saved_ids: savedIds,
      });
    }

    /* ── PUBLIC GET — single published course by id ────────────── */
    if (req.method === 'GET' && q.has('id') && !q.has('admin')) {
      const id = cleanText(q.get('id'), 120);
      if (!id) return j(res, 400, { ok: false, error: 'id required.' });
      const path = `courses?id=eq.${encodeURIComponent(id)}&select=${PUBLIC_SELECT}&is_published=eq.true&limit=1`;
      try {
        const rows = await readJson(await supa(path));
        if (!rows.length) return j(res, 404, { ok: false, error: 'Published course not found.' });
        return j(res, 200, { ok: true, course: publicCourse(rows[0]) });
      } catch (e) {
        const detail = String((e && e.message) || e);
        if (isMissingColumn(detail)) return j(res, 503, { ok: false, error: MISSING_COLUMN_MESSAGE });
        throw e;
      }
    }

    /* ── ADMIN GET — every course + stats ────────────────────── */
    if (req.method === 'GET' && q.has('admin')) {
      if (!requireAdmin(req, res)) return;
      const rows = await readJson(await supa(
        `courses?select=*&order=is_published.asc,updated_at.desc&limit=${MAX_ROWS}`
      ));

      /* Exact click total straight from PostgREST's content-range. */
      let clicks = 0;
      try {
        const cr = await supa('course_clicks?select=id&limit=1', { headers: { Prefer: 'count=exact' } });
        const m = String((cr.headers && cr.headers.get && cr.headers.get('content-range')) || '').match(/\/(\d+)\s*$/);
        if (m) clicks = Number(m[1]);
      } catch (_) { /* stats are best-effort */ }

      /* Per-course click counts for the table (bounded scan). */
      const clickMap = {};
      try {
        const cc = await readJson(await supa(`course_clicks?select=course_id&limit=${MAX_CLICK_SCAN}`));
        for (const row of cc) clickMap[row.course_id] = (clickMap[row.course_id] || 0) + 1;
      } catch (_) { /* leave the map empty */ }

      /* Each row carries its Civil Engineering classification, computed
         server-side, so the admin UI never re-implements the rule and the
         reviewer can see exactly why a row is (or is not) publishable. */
      const reviewed = rows.map((r) => ({ ...r, classification: classifyCourse(r) }));
      return j(res, 200, {
        ok: true,
        courses: reviewed,
        clicks_by_course: clickMap,
        stats: {
          total: reviewed.length,
          published: reviewed.filter((r) => r.is_published).length,
          pending: reviewed.filter((r) => !r.is_published).length,
          free: reviewed.filter((r) => r.is_free).length,
          paid: reviewed.filter((r) => !r.is_free).length,
          featured: reviewed.filter((r) => r.is_featured).length,
          /* Drafts a human still has to classify before publishing. */
          needsClassification: reviewed.filter((r) => !r.classification.civil && r.civil_verified !== true).length,
          clicks,
        },
      });
    }

    /* ── POST ?action=save / unsave — bookmark a published course ── */
    if (req.method === 'POST' && q.get('action') && ['save', 'unsave'].includes(q.get('action')) && savedCoursesEnabled()) {
      if (!rateLimit(req, { key: 'course-save', max: 30 })) {
        return j(res, 429, { ok: false, error: 'Too many requests. Please try again later.' });
      }
      const u = await userFromBearer(req);
      if (!u) return j(res, 401, { ok: false, error: 'Sign in required.' });
      const cid = cleanText(body.id, 64);
      if (!UUID_RE.test(cid)) return j(res, 400, { ok: false, error: 'A valid course id is required.' });
      /* scope to the VERIFIED owner id — the client-sent value is only
         which course, never whose. */
      if (q.get('action') === 'save') {
        try {
          await supa('candidate_saved_courses', {
            method: 'POST',
            headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
            body: JSON.stringify({ user_id: u.id, course_id: cid }),
          });
          return j(res, 200, { ok: true, saved: true });
        } catch (e) {
          const d = String((e && e.message) || e);
          if (isSetupError(d)) return j(res, 503, { ok: false, error: 'Saved courses not set up yet. Run v35-courses-saved.sql.' });
          throw e;
        }
      } else {
        try {
          await supa(
            `candidate_saved_courses?user_id=eq.${encodeURIComponent(u.id)}&course_id=eq.${encodeURIComponent(cid)}`,
            { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
          );
          return j(res, 200, { ok: true, saved: false });
        } catch (e) {
          const d = String((e && e.message) || e);
          if (isSetupError(d)) return j(res, 503, { ok: false, error: 'Saved courses not set up yet. Run v35-courses-saved.sql.' });
          throw e;
        }
      }
    }

    /* ── PUBLIC POST ?action=click — aggregate tracking ──────── */
    if (req.method === 'POST' && q.get('action') === 'click') {
      if (!rateLimit(req, { windowMs: 60 * 60 * 1000, max: 60, key: 'course-click' })) {
        return j(res, 429, { ok: false, error: 'Too many requests from this network. Try later.' });
      }
      const id = cleanText(body.id, 64);
      if (!id) return j(res, 400, { ok: false, error: 'id is required.' });

      const rows = await readJson(
        await supa(`courses?select=id&is_published=eq.true&id=eq.${encodeURIComponent(id)}&limit=1`)
      );
      if (!rows.length) return j(res, 404, { ok: false, error: 'Course not found.' });

      await supa('course_clicks', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          course_id: rows[0].id,
          referrer: cleanText(body.referrer, 200) || null,
          source: cleanText(body.source, 40) || null,
        }),
      });
      return j(res, 200, { ok: true });
    }

    /* ── ADMIN POST / PATCH / PUT — create or update ─────────── */
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      if (!requireAdmin(req, res)) return;
      const built = coursePayload(body);
      if (built.error) return j(res, 400, { ok: false, error: built.error });
      const payload = built.payload;

      /* Directory scope: nothing goes public as a non-civil course unless
         an admin explicitly verified it. */
      const blocked = publishGate(payload);
      if (blocked) return j(res, 409, { ok: false, error: blocked.error, classification: blocked.classification });

      /* PATCH/PUT are update-only: they may never create a row, so a
         missing id is a client error rather than a silent insert. */
      if (!body.id && req.method !== 'POST') {
        return j(res, 400, { ok: false, error: 'id is required for a ' + req.method + ' update.' });
      }

      if (body.id) {
        const id = cleanText(body.id, 64);
        if (!id) return j(res, 400, { ok: false, error: 'id is required for an update.' });
        const saved = await readJson(await supa(`courses?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }));
        if (!saved.length) return j(res, 404, { ok: false, error: 'Course not found.' });
        return j(res, 200, { ok: true, course: saved[0] });
      }

      /* New rows always start as drafts unless the admin explicitly
         published in the same action — never silently public. */
      const saved = await readJson(await supa('courses', {
        method: 'POST',
        body: JSON.stringify(payload),
      }));
      return j(res, 201, { ok: true, course: saved[0] || payload });
    }

    /* ── ADMIN DELETE ────────────────────────────────────────── */
    if (req.method === 'DELETE') {
      if (!requireAdmin(req, res)) return;
      const id = cleanText(q.get('id'), 64);
      if (!id) return j(res, 400, { ok: false, error: 'id query parameter is required.' });
      await supa(`courses?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      return j(res, 200, { ok: true });
    }

    return j(res, 405, { ok: false, error: 'Method not allowed' });
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
    return j(res, 500, { ok: false, error: 'Courses request failed', details: detail.slice(0, 300) });
  }
};

module.exports._internal = {
  coursePayload,
  publicCourse,
  publicListPath,
  publishGate,
  PUBLIC_SELECT,
  PUBLIC_SELECT_BASE,
};
