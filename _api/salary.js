/**
 * CivilCareer — Salary Transparency API (Feature 3)
 *
 * PUBLIC
 *   GET  ?role=&city=&experience=&company_type=
 *        → aggregated salary groups { role, city, company_type,
 *          min_sal, max_sal, median_sal (true median), data_points }
 *   POST { role, company_type, city, state, experience_years, salary_annual }
 *        → anonymous submission into salary_data (rate-limited, validated)
 *
 * ADMIN (x-owner-key)
 *   GET  ?unverified=1 → submissions awaiting verification
 *   PATCH { id, is_verified } → verify / un-verify a submission
 *   DELETE { id } → remove a bad submission
 *
 * Table: salary_data (see supabase-v21-salary.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');

const ROLES = [
  'Site Engineer', 'Planning Engineer', 'Quantity Surveyor', 'Structural Engineer',
  'Junior Engineer', 'Assistant Engineer', 'Project Engineer', 'BIM Engineer',
  'QA/QC Engineer', 'Estimation Engineer', 'Highway Engineer', 'Geotechnical Engineer',
  'Survey Engineer', 'Billing Engineer', 'Contracts Engineer', 'Other',
];
const COMPANY_TYPES = ['Private', 'Government', 'PSU', 'MNC'];

const MAX_FETCH = 5000;

/* Naive fixed-window limiter (per lambda instance) — blunts automated spam. */
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 6;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.at > WINDOW_MS) {
    hits.set(ip, { at: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_PER_HOUR;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Escape LIKE wildcards in user input before ilike matching. */
function likeSafe(value) {
  return value.replace(/[%_\\]/g, m => '\\' + m);
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

/* ── aggregation (PostgREST has no GROUP BY; aggregate here) ── */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function aggregate(rows, groupByExperience) {
  const groups = new Map();
  for (const row of rows) {
    const salary = Number(row.salary_annual);
    if (!Number.isFinite(salary) || salary <= 0) continue;
    const exp = Number(row.experience_years);
    const key = [
      String(row.role || '').toLowerCase(),
      String(row.city || '').toLowerCase(),
      String(row.company_type || '').toLowerCase(),
      groupByExperience ? (Number.isFinite(exp) ? exp : '') : '',
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const out = [];
  for (const [, group] of groups) {
    const salaries = group.map(r => Number(r.salary_annual)).filter(v => Number.isFinite(v) && v > 0);
    if (!salaries.length) continue;
    const first = group[0];
    const verified = group.filter(r => r.is_verified === true).length;
    const exps = group.map(r => Number(r.experience_years)).filter(Number.isFinite);
    out.push({
      role: first.role,
      city: first.city,
      company_type: first.company_type,
      experience_years: groupByExperience && exps.length
        ? Math.round(exps.reduce((s, x) => s + x, 0) / exps.length)
        : null,
      min_sal: Math.min(...salaries),
      max_sal: Math.max(...salaries),
      median_sal: median(salaries),
      data_points: salaries.length,
      verified_points: verified,
    });
  }
  out.sort((a, b) => b.data_points - a.data_points);
  return out.slice(0, 36);
}

function buildFilters(query) {
  const filters = [];
  const role = cleanText(query.role, 80);
  const city = cleanText(query.city, 80);
  const type = cleanText(query.company_type, 40);
  if (role) filters.push(`role=ilike.${encodeURIComponent('%' + likeSafe(role) + '%')}`);
  if (city) filters.push(`city=ilike.${encodeURIComponent('%' + likeSafe(city) + '%')}`);
  if (type && COMPANY_TYPES.includes(type)) filters.push(`company_type=eq.${encodeURIComponent(type)}`);

  const expRaw = String(query.experience ?? '').trim();
  if (expRaw !== '' && /^\d{1,2}$/.test(expRaw)) {
    const n = Number.parseInt(expRaw, 10);
    const lo = Math.max(0, n - 2);
    const hi = n >= 10 ? 45 : n + 2; /* "10+" keeps everything senior */
    filters.push(`experience_years=gte.${lo}`);
    filters.push(`experience_years=lte.${hi}`);
  }
  return filters;
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Supabase server configuration is missing' });
  }

  const hasOwnerHeader = Boolean(req.headers['x-owner-key']);

  /* ── PUBLIC GET — aggregated explorer ── */
  if (req.method === 'GET' && !hasOwnerHeader) {
    allowPublicCors(req, res);
    try {
      const filters = buildFilters(req.query || {});
      const path = `salary_data?select=role,city,state,company_type,experience_years,salary_annual,is_verified&${filters.join('&')}&limit=${MAX_FETCH}`;
      const r = await supa(path);
      if (!r.ok) {
        const detail = await r.text();
        if (/PGRST205|relation .* does not exist/i.test(detail)) {
          return res.status(503).json({ error: 'Salary table missing. Run supabase-v21-salary.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Failed to load salary data' });
      }
      const rows = await r.json();
      const groups = aggregate(rows, Boolean(req.query?.experience));
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ groups, total_rows: rows.length });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load salary data', details: err.message });
    }
  }

  /* ── PUBLIC POST — anonymous submission ── */
  if (req.method === 'POST') {
    /* Same-origin enforcement for public writes (CSRF guard). */
    const origin = String(req.headers.origin || '');
    const siteOrigin = String(process.env.SITE_URL || '').replace(/\/+$/, '');
    if (origin && siteOrigin && origin !== siteOrigin) {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
               String(req.socket?.remoteAddress || 'unknown');
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }

    const body = parseBody(req);

    /* Honeypot: bots filling the hidden "website" field get a fake success. */
    if (cleanText(body.website, 40)) {
      return res.status(201).json({ success: true });
    }

    const role = cleanText(body.role, 80);
    const companyType = cleanText(body.company_type, 40);
    const city = cleanText(body.city, 60);
    const state = cleanText(body.state, 60);
    const experience = Number.parseInt(body.experience_years, 10);
    const salary = Number.parseInt(body.salary_annual, 10);

    if (!role) return res.status(400).json({ error: 'Please select your role.' });
    if (!COMPANY_TYPES.includes(companyType)) return res.status(400).json({ error: 'Please select a valid company type.' });
    if (!city) return res.status(400).json({ error: 'Please enter your city.' });
    if (!Number.isFinite(experience) || experience < 0 || experience > 45) {
      return res.status(400).json({ error: 'Experience must be between 0 and 45 years.' });
    }
    if (!Number.isFinite(salary) || salary < 50000 || salary > 20000000) {
      return res.status(400).json({ error: 'Annual CTC must be between ₹50,000 and ₹2 crore.' });
    }

    try {
      const row = {
        role: ROLES.includes(role) ? role : role.slice(0, 80),
        company_type: companyType,
        city,
        state: state || null,
        experience_years: experience,
        salary_annual: salary,
        is_verified: false,
      };
      const r = await supa('salary_data', { method: 'POST', body: JSON.stringify(row) });
      if (!r.ok) {
        const detail = await r.text();
        if (/PGRST205|relation .* does not exist/i.test(detail)) {
          return res.status(503).json({ error: 'Salary storage is not set up yet. Run supabase-v21-salary.sql in Supabase.' });
        }
        return res.status(500).json({ error: 'Could not save your submission right now. Please try again.' });
      }
      return res.status(201).json({
        success: true,
        message: 'Thank you. Your anonymous data helps 40 lakh civil engineers.',
      });
    } catch (_) {
      return res.status(500).json({ error: 'Could not save your submission right now. Please try again.' });
    }
  }

  /* ── ADMIN ROUTES ── */
  if (!requireOwner(req, res)) return;

  if (req.method === 'GET') {
    try {
      const r = await supa('salary_data?select=*&order=created_at.desc&limit=200');
      if (!r.ok) return res.status(500).json({ error: 'Failed to load submissions' });
      const rows = await r.json();
      const unverified = rows.filter(x => x.is_verified !== true);
      /* Aggregated table for the admin dashboard (role × city medians). */
      const seen = new Map();
      for (const row of rows) {
        const k = `${row.role}|${row.city}`;
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push(Number(row.salary_annual));
      }
      const aggregateTable = [...seen.entries()]
        .map(([key, salaries]) => ({
          role: key.split('|')[0],
          city: key.split('|')[1],
          data_points: salaries.length,
          min_sal: Math.min(...salaries),
          median_sal: median(salaries),
          max_sal: Math.max(...salaries),
        }))
        .sort((a, b) => b.data_points - a.data_points)
        .slice(0, 40);
      return res.status(200).json({ unverified, aggregateTable, total: rows.length });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load submissions', details: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const body = parseBody(req);
    const { id, is_verified } = body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const r = await supa(`salary_data?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_verified: Boolean(is_verified) }),
      });
      if (!r.ok) return res.status(500).json({ error: 'Update failed' });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Update failed', details: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const body = parseBody(req);
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const r = await supa(`salary_data?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) return res.status(500).json({ error: 'Delete failed' });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Delete failed', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
