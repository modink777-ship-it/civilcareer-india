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
 * Table: courses + course_clicks (v32-courses.sql)
 * Affiliate discipline: affiliate_url lives ONLY in the database, is
 * written only by admin mutations, and is read publicly only so the
 * CTA can use it. admin_notes never leaves this endpoint's admin path.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

/* The public card needs exactly these fields — nothing else. admin_notes,
   url_status and external_id stay admin-side by construction. */
const PUBLIC_SELECT =
  'id,title,provider,instructor,category,target_roles,career_stage,'
  + 'price_inr,original_price_inr,rating,enrollment_count,duration_hours,'
  + 'language,thumbnail_url,course_url,affiliate_url,is_free,is_featured,created_at';

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
    price_inr: Number(r.price_inr) || 0,
    original_price_inr: r.original_price_inr == null ? null : Number(r.original_price_inr),
    rating: r.rating == null ? null : Number(r.rating),
    enrollment_count: r.enrollment_count == null ? null : Number(r.enrollment_count),
    duration_hours: r.duration_hours == null ? null : Number(r.duration_hours),
    language: r.language || null,
    thumbnail_url: r.thumbnail_url || null,
    course_url: r.course_url,
    affiliate_url: r.affiliate_url || null,
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

  const price_inr = Math.max(0, Math.round(Number(body.price_inr) || 0));
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

  return {
    payload: {
      title,
      provider,
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
      is_free: body.is_free === true || body.is_free === 'true' || (!('is_free' in body) && price_inr === 0),
      is_published: body.is_published === true,
      is_featured: body.is_featured === true,
      admin_notes: cleanText(body.admin_notes, 2000) || null,
      updated_at: new Date().toISOString(),
    },
  };
}

/* Filters the public list understands. The published-only constraint is
   added by the caller and is never part of user input. */
function publicListPath(q) {
  const limit = Math.min(Math.max(parseInt(q.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(parseInt(q.get('page') || '1', 10) || 1, 1);
  const offset = (page - 1) * limit;

  let path = `courses?select=${PUBLIC_SELECT}&is_published=eq.true`;
  const category = cleanText(q.get('category'), 60);
  if (category) path += `&category=eq.${encodeURIComponent(category)}`;
  const provider = cleanText(q.get('provider'), 60);
  if (provider) path += `&provider=eq.${encodeURIComponent(provider)}`;
  const stage = cleanText(q.get('stage'), 40);
  if (stage) path += `&career_stage=eq.${encodeURIComponent(stage)}`;
  const role = cleanText(q.get('role'), 40);
  if (role) path += `&target_roles=cs.${encodeURIComponent('{"' + role.replace(/"/g, '') + '"}')}`;
  if (q.get('free') === 'true') path += '&is_free=eq.true';
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
      const { path, limit, page } = publicListPath(q);
      const [rows, facets] = await Promise.all([
        readJson(await supa(path)),
        /* One bounded scan gives the total AND the filter options —
           distinct values are derived from published rows only. */
        readJson(await supa(
          `courses?select=category,provider,career_stage&is_published=eq.true&limit=${MAX_ROWS}`
        )),
      ]);
      const distinct = (key) => [...new Set(facets.map((r) => r[key]).filter(Boolean))].sort();
      return j(res, 200, {
        ok: true,
        courses: rows.map(publicCourse),
        total: facets.length,
        page,
        pages: Math.max(1, Math.ceil(facets.length / limit)),
        limit,
        filters: { categories: distinct('category'), providers: distinct('provider'), stages: distinct('career_stage') },
      });
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

      return j(res, 200, {
        ok: true,
        courses: rows,
        clicks_by_course: clickMap,
        stats: {
          total: rows.length,
          published: rows.filter((r) => r.is_published).length,
          pending: rows.filter((r) => !r.is_published).length,
          free: rows.filter((r) => r.is_free).length,
          paid: rows.filter((r) => !r.is_free).length,
          featured: rows.filter((r) => r.is_featured).length,
          clicks,
        },
      });
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
    if (isSetupError(detail)) {
      return j(res, 503, {
        ok: false,
        error: 'Courses table missing. Run v32-courses.sql in the Supabase SQL editor.',
      });
    }
    return j(res, 500, { ok: false, error: 'Courses request failed', details: detail.slice(0, 300) });
  }
};

module.exports._internal = { coursePayload, publicCourse, publicListPath };
