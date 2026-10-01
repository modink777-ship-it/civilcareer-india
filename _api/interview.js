/**
 * CivilCareer — Interview Questions API (Feature E)
 *
 * PUBLIC (no auth)
 *   GET ?company=X&role=Y&round=Z&difficulty=D&q=search → approved questions
 *        (+ company list with counts when no company filter)
 *   POST { company, role, question, answer?, difficulty?, round?, year? }
 *        → community submission, lands unapproved (rate-limited, honeypot)
 *   POST /upvote { id } → +1 upvote (rate-limited)
 *
 * ADMIN (x-owner-key or body.key)
 *   GET ?status=pending → unapproved submissions (all fields)
 *   GET                 → everything
 *   PATCH { id, is_approved } → approve / reject (reject = delete)
 *   DELETE { id }
 *
 * Table: interview_questions (see supabase-v26-blog-interview.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const ROUNDS = ['Technical', 'HR', 'Manager'];

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

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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

function publicQuestion(r) {
  return {
    id: r.id,
    company: r.company,
    role: r.role,
    question: r.question,
    answer: r.answer,
    difficulty: r.difficulty,
    round: r.round,
    year: r.year,
    upvotes: r.upvotes || 0,
    created_at: r.created_at,
  };
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;

  /* /api/interview/upvote is routed here with ?action=upvote */
  const isUpvote = q.get('action') === 'upvote';

  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }
  if (!SUPA || !KEY) {
    return j(res, 500, { error: 'Supabase server configuration is missing' });
  }

  const body = parseBody(req);
  const wantsAdmin =
    Boolean(req.headers['x-owner-key']) || (req.method !== 'GET' && Boolean(body.key));

  try {
    /* ── ADMIN GET — full list or pending queue ─────────────── */
    if (req.method === 'GET' && wantsAdmin) {
      if (!requireOwner(req, res)) return;
      const pendingOnly = q.get('status') === 'pending';
      const rows = await readJson(await supa(
        `interview_questions?select=*&${pendingOnly ? 'is_approved=eq.false&' : ''}order=created_at.desc&limit=500`
      ));
      return j(res, 200, { questions: rows });
    }

    /* ── PUBLIC POST /upvote — +1 on a question ─────────────── */
    if (req.method === 'POST' && isUpvote) {
      if (!rateLimit(req, { windowMs: 60 * 60 * 1000, max: 30, key: 'interview-upvote' })) {
        return j(res, 429, { error: 'Too many upvotes from this network. Try later.' });
      }
      const id = cleanText(body.id, 40);
      if (!id) return j(res, 400, { error: 'Question id is required' });
      const rows = await readJson(await supa(
        `interview_questions?select=id,upvotes,is_approved&id=eq.${encodeURIComponent(id)}&limit=1`
      ));
      if (!rows.length) return j(res, 404, { error: 'Question not found' });
      await supa(`interview_questions?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ upvotes: (Number(rows[0].upvotes) || 0) + 1 }),
      });
      return j(res, 200, { ok: true, upvotes: (Number(rows[0].upvotes) || 0) + 1 });
    }

    /* ── PUBLIC POST — submit an interview experience ───────── */
    if (req.method === 'POST') {
      if (!rateLimit(req, { windowMs: 15 * 60 * 1000, max: 3, key: 'interview-submit' })) {
        return j(res, 429, { error: 'Too many submissions. Please try again later.' });
      }
      /* Honeypot: real users never fill the hidden "website" field. */
      if (cleanText(body.website, 200)) return j(res, 200, { ok: true });

      const company = cleanText(body.company, 120);
      const role = cleanText(body.role, 80);
      const question = cleanText(body.question, 600);
      if (!company || !role || !question) {
        return j(res, 400, { error: 'Company, role and question are required' });
      }
      const difficulty = DIFFICULTIES.includes(String(body.difficulty || '').toLowerCase())
        ? String(body.difficulty).toLowerCase() : 'medium';
      const round = ROUNDS.find((r) => r.toLowerCase() === String(body.round || '').toLowerCase()) || 'Technical';
      let year = parseInt(body.year, 10);
      if (!Number.isFinite(year) || year < 2000 || year > new Date().getFullYear() + 1) year = null;

      await supa('interview_questions', {
        method: 'POST',
        body: JSON.stringify({
          company,
          role,
          question,
          answer: cleanText(body.answer, 4000) || null,
          difficulty,
          round,
          year,
          upvotes: 0,
          is_approved: false,
        }),
      });
      return j(res, 200, {
        ok: true,
        message: 'Submitted for review. It appears publicly after moderation.',
      });
    }

    /* ── ADMIN PATCH — approve / reject(reject = delete) ────── */
    if (req.method === 'PATCH') {
      if (!requireOwner(req, res)) return;
      const id = cleanText(body.id, 40);
      if (!id) return j(res, 400, { error: 'Question id is required' });
      if (body.is_approved === false) {
        await supa(`interview_questions?id=eq.${id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
        return j(res, 200, { ok: true, deleted: true });
      }
      await supa(`interview_questions?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ is_approved: true }),
      });
      return j(res, 200, { ok: true });
    }

    /* ── ADMIN DELETE ────────────────────────────────────────── */
    if (req.method === 'DELETE') {
      if (!requireOwner(req, res)) return;
      const id = cleanText(body.id || q.get('id'), 40);
      if (!id) return j(res, 400, { error: 'Question id is required' });
      await supa(`interview_questions?id=eq.${id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      return j(res, 200, { ok: true });
    }

    /* ── PUBLIC GET — questions + company directory ─────────── */
    if (req.method !== 'GET') {
      return j(res, 405, { error: 'Method not allowed' });
    }

    const company = cleanText(q.get('company'), 120);
    const companySlug = cleanText(q.get('company_slug'), 80);
    const role = cleanText(q.get('role'), 80);
    const round = cleanText(q.get('round'), 20);
    const difficulty = cleanText(q.get('difficulty'), 10);
    const search = cleanText(q.get('q'), 60);
    const limit = Math.min(Math.max(parseInt(q.get('limit') || '200', 10) || 200, 1), 500);

    let path = `interview_questions?select=*&is_approved=eq.true&order=upvotes.desc.nullslast&limit=${limit}`;
    if (company) path += `&company=eq.${encodeURIComponent(company)}`;
    if (role) path += `&role=ilike.*${encodeURIComponent(role)}*`;
    if (round && ROUNDS.includes(round)) path += `&round=eq.${encodeURIComponent(round)}`;
    if (difficulty && DIFFICULTIES.includes(difficulty)) path += `&difficulty=eq.${difficulty}`;

    const rows = (await readJson(await supa(path))).filter((r) => {
      if (!search) return true;
      const hay = `${r.company} ${r.role} ${r.question}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });

    /* Company directory with counts (cheap: derived from the same fetch
       when unfiltered, separate lightweight query otherwise). */
    let companies = null;
    if (!company && !companySlug && !role) {
      const all = rows.length && !search && !round && !difficulty
        ? rows
        : await readJson(await supa('interview_questions?select=company&is_approved=eq.true&limit=2000'));
      const counts = {};
      for (const r of all) {
        const key = r.company;
        counts[key] = (counts[key] || 0) + 1;
      }
      companies = Object.entries(counts)
        .map(([name, count]) => ({ name, slug: slugify(name), count }))
        .sort((a, b) => b.count - a.count);
    }

    return j(res, 200, {
      questions: rows.map(publicQuestion),
      companies,
      total: rows.length,
    });
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    if (isSetupError(detail)) {
      return j(res, 503, { error: 'Interview questions table missing. Run supabase-v26-blog-interview.sql in Supabase.' });
    }
    return j(res, 500, { error: 'Interview request failed', details: detail.slice(0, 300) });
  }
};
