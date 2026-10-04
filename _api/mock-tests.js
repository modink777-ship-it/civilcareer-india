/**
 * CivilCareer — Mock Tests API
 *
 * PUBLIC (no auth)
 *   GET ?exam=X&subject=Y&limit=N  → { questions: [...] }
 *
 * Table: mock_questions (see v28-new-features.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

function j(res, code, obj) {
  return res.status(code).json(obj);
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
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
  return /PGRST205|relation .* does not exist|Could not find the table/i.test(
    String(detail || '')
  );
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (!SUPA || !KEY) {
    return j(res, 500, { error: 'Mock tests server configuration is missing' });
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const q = url.searchParams;
      const exam = cleanText(q.get('exam'), 80) || 'all';
      const subject = cleanText(q.get('subject'), 80) || 'all';
      const limit =
        Math.min(
          Math.max(parseInt(q.get('limit') || '100', 10) || 100, 1),
          500
        );

      let path =
        `mock_questions?select=id,exam,subject,question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,year,is_active,created_at&is_active=eq.true&limit=${limit}`;
      if (exam !== 'all') path += `&exam=eq.${encodeURIComponent(exam)}`;
      if (subject !== 'all') path += `&subject=eq.${encodeURIComponent(subject)}`;
      path += '&order=created_at.desc';

      const rows = await readJson(await supa(path));
      return j(res, 200, { questions: rows });
    } catch (err) {
      const detail = String(err && err.message ? err.message : err);
      if (isSetupError(detail)) {
        return j(res, 503, { error: 'Mock questions table missing. Run v28-new-features.sql.' });
      }
      return j(res, 500, { error: 'Mock tests request failed', details: detail.slice(0, 300) });
    }
  }

  return j(res, 405, { error: 'Method not allowed' });
}

module.exports = handler;
