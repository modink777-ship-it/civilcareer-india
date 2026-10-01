/**
 * CivilCareer — Company Reviews API (Feature 5)
 *
 * PUBLIC (no auth)
 *   GET                 → per-company aggregate stats computed from
 *                         approved reviews (avg ratings, recommend %,
 *                         paid-on-time %, review count)
 *   GET ?slug=xxx       → one company's approved reviews + stats
 *
 * PUBLIC POST (rate-limited 3/15min)
 *   { company_name, reviewer_role, reviewer_experience, reviewer_city,
 *     rating_overall[1-5], rating_salary, rating_growth,
 *     rating_worklife, rating_management, salary_paid_on_time,
 *     pros, cons, advice, would_recommend }
 *   → lands with is_approved=false; admin approves
 *
 * ADMIN (x-owner-key or body.key)
 *   GET ?status=pending → ALL reviews incl. unapproved
 *   PATCH { id, is_approved } → approve / reject (reject = delete)
 *   DELETE { id }
 *
 * Table: company_reviews (see supabase-v25-portfolio-reviews.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

const RATING_FIELDS = [
  'rating_overall', 'rating_salary', 'rating_growth',
  'rating_worklife', 'rating_management',
];

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
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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

function avg(list, field) {
  const vals = list.map((r) => r[field]).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function pct(list, field) {
  const vals = list.map((r) => r[field]).filter((v) => typeof v === 'boolean');
  if (!vals.length) return null;
  return Math.round((vals.filter(Boolean).length / vals.length) * 100);
}

function statsFor(list) {
  return {
    review_count: list.length,
    avg_overall: avg(list, 'rating_overall'),
    avg_salary: avg(list, 'rating_salary'),
    avg_growth: avg(list, 'rating_growth'),
    avg_worklife: avg(list, 'rating_worklife'),
    avg_management: avg(list, 'rating_management'),
    pct_recommend: pct(list, 'would_recommend'),
    pct_paid_on_time: pct(list, 'salary_paid_on_time'),
  };
}

function publicReview(r) {
  return {
    id: r.id,
    company_name: r.company_name,
    company_slug: r.company_slug,
    reviewer_role: r.reviewer_role,
    reviewer_experience: r.reviewer_experience,
    reviewer_city: r.reviewer_city,
    rating_overall: r.rating_overall,
    rating_salary: r.rating_salary,
    rating_growth: r.rating_growth,
    rating_worklife: r.rating_worklife,
    rating_management: r.rating_management,
    salary_paid_on_time: r.salary_paid_on_time,
    pros: r.pros,
    cons: r.cons,
    advice: r.advice,
    would_recommend: r.would_recommend,
    created_at: r.created_at,
  };
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }
  if (!SUPA || !KEY) {
    return j(res, 500, { error: 'Supabase server configuration is missing' });
  }

  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const body = parseBody(req);
  const isAdmin = Boolean(
    req.headers['x-owner-key'] ||
    (req.method !== 'GET' && body.key)
  );

  try {
    /* ── ADMIN GET: list all / pending (?status=pending) ───── */
    if (req.method === 'GET' && isAdmin) {
      if (!requireOwner(req, res)) return;
      const status = q.get('status');
      const path = status === 'pending'
        ? 'company_reviews?is_approved=eq.false&order=created_at.desc&limit=300'
        : 'company_reviews?order=created_at.desc&limit=300';
      const rows = await readJson(await supa(path));
      return j(res, 200, { reviews: rows });
    }

    /* ── PUBLIC GET: aggregates / one company's reviews ────── */
    if (req.method === 'GET') {
      allowPublicCors(req, res);
      const slug = cleanText(q.get('slug'), 60);
      if (slug) {
        const rows = await readJson(await supa(
          `company_reviews?company_slug=eq.${encodeURIComponent(slug)}` +
          `&is_approved=eq.true&order=created_at.desc&limit=50`
        ));
        return j(res, 200, { company: { slug }, stats: statsFor(rows), reviews: rows.map(publicReview) });
      }
      const rows = await readJson(await supa(
        'company_reviews?is_approved=eq.true&order=created_at.desc&limit=2000'
      ));
      const byCompany = new Map();
      for (const r of rows) {
        const key = r.company_slug || slugify(r.company_name);
        if (!byCompany.has(key)) byCompany.set(key, []);
        byCompany.get(key).push(r);
      }
      const companies = [...byCompany.entries()].map(([k, list]) => ({
        company_slug: k,
        company_name: list[0].company_name,
        ...statsFor(list),
      })).sort((a, b) => b.review_count - a.review_count);
      return j(res, 200, { companies, total_reviews: rows.length });
    }

    /* ── PUBLIC POST: submit a review (moderated) ──────────── */
    if (req.method === 'POST') {
      if (!rateLimit(req, { key: 'company-review', max: 3 })) {
        return j(res, 429, { error: 'Too many reviews submitted. Please try again later.' });
      }
      const company_name = cleanText(body.company_name, 80);
      if (company_name.length < 2) {
        return j(res, 400, { error: 'Company name is required.' });
      }
      const row = {
        company_name,
        company_slug: slugify(company_name),
        reviewer_role: cleanText(body.reviewer_role, 60) || null,
        reviewer_experience: cleanText(body.reviewer_experience, 30) || null,
        reviewer_city: cleanText(body.reviewer_city, 60) || null,
        salary_paid_on_time: typeof body.salary_paid_on_time === 'boolean' ? body.salary_paid_on_time : null,
        pros: cleanText(body.pros, 1000) || null,
        cons: cleanText(body.cons, 1000) || null,
        advice: cleanText(body.advice, 1000) || null,
        would_recommend: typeof body.would_recommend === 'boolean' ? body.would_recommend : null,
        is_approved: false,
      };
      let anyRating = false;
      for (const f of RATING_FIELDS) {
        const n = parseInt(body[f], 10);
        if (Number.isFinite(n) && n >= 1 && n <= 5) { row[f] = n; if (f === 'rating_overall') anyRating = true; }
        else row[f] = null;
      }
      if (!anyRating) {
        return j(res, 400, { error: 'Please give an overall rating (1-5 stars).' });
      }
      if (body.honeypot) return j(res, 200, { submitted: true }); // silent spam drop
      const saved = await readJson(await supa('company_reviews', {
        method: 'POST', body: JSON.stringify(row),
      }));
      return j(res, 201, {
        submitted: true,
        message: 'Thank you — your review is awaiting moderation and will appear after verification.',
        review: { id: saved[0]?.id },
      });
    }

    /* ── ADMIN: approve / reject (reject = delete) ─────────── */
    if (req.method === 'PATCH') {
      if (!requireOwner(req, res)) return;
      const id = String(body.id || '');
      const approve = Boolean(body.is_approved);
      if (!id) return j(res, 400, { error: 'id is required.' });
      if (approve) {
        const updated = await readJson(await supa(
          `company_reviews?id=eq.${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify({ is_approved: true }) }
        ));
        return j(res, 200, { review: updated[0] });
      }
      /* Rejected → removed entirely (nothing to "unapprove" to) */
      await supa(`company_reviews?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return j(res, 200, { deleted: true });
    }

    /* ── ADMIN: delete ─────────────────────────────────────── */
    if (req.method === 'DELETE') {
      if (!requireOwner(req, res)) return;
      const id = String(body.id || '');
      if (!id) return j(res, 400, { error: 'id is required.' });
      await supa(`company_reviews?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return j(res, 200, { deleted: true });
    }

    return j(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error('companies error:', e.message);
    return j(res, 500, { error: 'Failed to process company reviews request' });
  }
};
