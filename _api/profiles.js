/**
 * CivilCareer — Civil Engineer Portfolio API (Feature 4)
 *
 * PUBLIC (no auth)
 *   GET ?slug=xxx                → one public profile + its projects
 *                                  (increments profile_views)
 *   GET (no slug/token, ?role=&city=&state=&skills=&min_exp=&sector=)
 *                                → public profile cards for /talent
 *
 * TOKEN-GATED (edit_token acts as the credential — no login needed)
 *   GET  ?token=xxx              → owner view: full profile + projects
 *   PUT  { edit_token, ... }     → update profile fields
 *   POST ?action=project { edit_token, ... } → add a project
 *
 * POST (create, rate-limited 5/15min)
 *   { name, current_role, years_experience, city, state, email, whatsapp,
 *     bio, skills[], target_roles[], work_type, sector_preference[],
 *     linkedin_url, projects?: [ {project_name, ...}, up to 5 ] }
 *   → returns { id, slug, edit_token, profile_url, edit_url }
 *
 * Tables: engineer_profiles + profile_projects
 *         (see supabase-v25-portfolio-reviews.sql)
 */

const crypto = require('crypto');

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

const TEXT_FIELDS = [
  'name', 'current_role', 'city', 'state', 'bio', 'linkedin_url',
  'work_type', 'email', 'whatsapp',
];
const ARRAY_FIELDS = ['skills', 'target_roles', 'sector_preference'];

const PROFILE_MAX = {
  name: 80, current_role: 60, city: 60, state: 60, bio: 1200,
  linkedin_url: 300, work_type: 10, email: 120, whatsapp: 20,
};

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

function cleanArray(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function isHttpUrl(v) {
  try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; }
}

function cleanProfilePayload(raw, { forCreate = false } = {}) {
  const out = {};
  for (const f of TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, f)) continue;
    out[f] = cleanText(raw[f], PROFILE_MAX[f] || 300);
  }
  for (const f of ARRAY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, f)) continue;
    out[f] = cleanArray(raw[f], 25, 60);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'years_experience')) {
    const n = parseInt(raw.years_experience, 10);
    out.years_experience = Number.isFinite(n) && n >= 0 && n <= 50 ? n : null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'is_public')) {
    out.is_public = Boolean(raw.is_public);
  }
  if (out.linkedin_url && !isHttpUrl(out.linkedin_url)) delete out.linkedin_url;
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) delete out.email;
  if (out.whatsapp && !/^\+?[0-9]{8,15}$/.test(String(out.whatsapp).replace(/[\s-]/g, ''))) {
    delete out.whatsapp;
  }
  if (forCreate && !out.name) return null;
  return out;
}

function cleanProjectPayload(raw) {
  const out = {};
  out.project_name = cleanText(raw.project_name, 120);
  if (!out.project_name) return null;
  out.project_type = cleanText(raw.project_type, 40);
  out.role_played = cleanText(raw.role_played, 60);
  out.location = cleanText(raw.location, 100);
  out.client = cleanText(raw.client, 100);
  out.contractor = cleanText(raw.contractor, 100);
  out.project_value = cleanText(raw.project_value, 60);
  out.description = cleanText(raw.description, 1500);
  out.software_used = cleanArray(raw.software_used, 15, 40);
  const dm = parseInt(raw.duration_months, 10);
  out.duration_months = Number.isFinite(dm) && dm >= 0 && dm <= 600 ? dm : null;
  const cy = parseInt(raw.completion_year, 10);
  out.completion_year = Number.isFinite(cy) && cy >= 1970 && cy <= 2100 ? cy : null;
  if (raw.photo_url && isHttpUrl(raw.photo_url)) {
    out.photo_url = cleanText(raw.photo_url, 500);
  }
  return out;
}

function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'engineer';
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
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

function publicCard(r) {
  return {
    id: r.id, slug: r.slug, name: r.name, current_role: r.current_role,
    city: r.city, state: r.state, years_experience: r.years_experience,
    skills: r.skills || [], target_roles: r.target_roles || [],
    sector_preference: r.sector_preference || [],
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

  try {
    /* ── PUBLIC: talent browse ─────────────────────────────── */
    if (req.method === 'GET' && !q.get('slug') && !q.get('token')) {
      allowPublicCors(req, res);
      const filters = ['is_public=eq.true'];
      const role = cleanText(q.get('role'), 60);
      if (role) filters.push(`current_role=ilike.*${encodeURIComponent(role)}*`);
      const city = cleanText(q.get('city'), 60);
      if (city) filters.push(`city=ilike.*${encodeURIComponent(city)}*`);
      const state = cleanText(q.get('state'), 60);
      if (state) filters.push(`state=ilike.*${encodeURIComponent(state)}*`);
      const minExp = parseInt(q.get('min_exp'), 10);
      if (Number.isFinite(minExp)) filters.push(`years_experience=gte.${minExp}`);
      const sector = cleanText(q.get('sector'), 30);
      if (sector) filters.push(`sector_preference=cs.{${encodeURIComponent(sector)}}`);
      const skills = cleanText(q.get('skills'), 200); // comma-separated
      if (skills) {
        const list = skills.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
        for (const s of list) {
          filters.push(`skills=cs.{${encodeURIComponent(s)}}`);
        }
      }
      const rows = await readJson(await supa(
        `engineer_profiles?${filters.join('&')}&order=updated_at.desc&limit=60`
      ));
      return j(res, 200, { profiles: rows.map(publicCard) });
    }

    /* ── TOKEN VIEW (edit-profile page load) ───────────────── */
    if (req.method === 'GET' && q.get('token')) {
      allowPublicCors(req, res);
      const token = cleanText(q.get('token'), 80);
      const rows = await readJson(await supa(
        `engineer_profiles?edit_token=eq.${encodeURIComponent(token)}&limit=1`
      ));
      const p = rows[0];
      if (!p) return j(res, 404, { error: 'Profile not found for this edit link.' });
      let projects = [];
      try {
        projects = await readJson(await supa(
          `profile_projects?profile_id=eq.${p.id}&order=sort_order.asc,created_at.asc&limit=10`
        ));
      } catch (_) { projects = []; }
      return j(res, 200, { profile: p, projects });
    }

    /* ── PUBLIC: single profile by slug ────────────────────── */
    if (req.method === 'GET' && q.get('slug')) {
      allowPublicCors(req, res);
      const slug = cleanText(q.get('slug'), 80);
      const rows = await readJson(await supa(
        `engineer_profiles?slug=eq.${encodeURIComponent(slug)}&limit=1`
      ));
      const p = rows[0];
      if (!p || p.is_public === false) {
        return j(res, 404, { error: 'Profile not found.' });
      }
      let projects = [];
      try {
        projects = await readJson(await supa(
          `profile_projects?profile_id=eq.${p.id}&order=sort_order.asc,created_at.asc&limit=10`
        ));
      } catch (_) { projects = []; }
      supa(`engineer_profiles?id=eq.${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_views: (p.profile_views || 0) + 1 }),
      }).catch(() => {});
      return j(res, 200, {
        profile: {
          id: p.id, slug: p.slug, name: p.name, current_role: p.current_role,
          city: p.city, state: p.state, years_experience: p.years_experience,
          bio: p.bio, skills: p.skills || [], target_roles: p.target_roles || [],
          sector_preference: p.sector_preference || [], work_type: p.work_type,
          linkedin_url: p.linkedin_url, profile_views: p.profile_views || 0,
          created_at: p.created_at,
        },
        projects,
      });
    }

    /* ── CREATE (public, rate-limited) ─────────────────────── */
    if (req.method === 'POST' && q.get('action') !== 'project') {
      if (!rateLimit(req, { key: 'profiles-create', max: 5 })) {
        return j(res, 429, { error: 'Too many requests. Please try again later.' });
      }
      const payload = cleanProfilePayload(body, { forCreate: true });
      if (!payload) return j(res, 400, { error: 'Name is required.' });
      const edit_token = crypto.randomUUID();
      const slug = slugify(payload.name || body.name);
      const insert = { ...payload, slug, edit_token, is_public: true };
      const created = await readJson(await supa('engineer_profiles', {
        method: 'POST',
        body: JSON.stringify(insert),
      }));
      const p = created[0];
      /* Optional inline projects (step 3 of the wizard) */
      const rawProjects = Array.isArray(body.projects) ? body.projects.slice(0, 5) : [];
      const savedProjects = [];
      for (const raw of rawProjects) {
        const pr = cleanProjectPayload(raw);
        if (!pr) continue;
        try {
          const saved = await readJson(await supa('profile_projects', {
            method: 'POST',
            body: JSON.stringify({ ...pr, profile_id: p.id }),
          }));
          savedProjects.push(saved[0]);
        } catch (_) { /* keep going — projects are optional */ }
      }
      return j(res, 201, {
        id: p.id, slug: p.slug, edit_token: p.edit_token,
        profile_url: `/profile/${p.slug}`,
        edit_url: `/edit-profile?token=${p.edit_token}`,
        projects: savedProjects,
      });
    }

    /* ── ADD PROJECT (token-gated) ─────────────────────────── */
    if (req.method === 'POST' && q.get('action') === 'project') {
      if (!rateLimit(req, { key: 'profiles-project', max: 20 })) {
        return j(res, 429, { error: 'Too many requests.' });
      }
      const token = cleanText(body.edit_token, 80);
      if (!token) return j(res, 400, { error: 'edit_token is required.' });
      const rows = await readJson(await supa(
        `engineer_profiles?edit_token=eq.${encodeURIComponent(token)}&limit=1`
      ));
      const p = rows[0];
      if (!p) return j(res, 404, { error: 'Invalid edit link.' });
      const pr = cleanProjectPayload(body);
      if (!pr) return j(res, 400, { error: 'Project name is required.' });
      const cnt = await readJson(await supa(`profile_projects?profile_id=eq.${p.id}&select=id`));
      if (cnt.length >= 10) return j(res, 400, { error: 'Project limit (10) reached.' });
      const saved = await readJson(await supa('profile_projects', {
        method: 'POST',
        body: JSON.stringify({ ...pr, profile_id: p.id, sort_order: cnt.length }),
      }));
      return j(res, 201, { project: saved[0] });
    }

    /* ── UPDATE (token-gated) ──────────────────────────────── */
    if (req.method === 'PUT') {
      if (!rateLimit(req, { key: 'profiles-update', max: 20 })) {
        return j(res, 429, { error: 'Too many requests.' });
      }
      const token = cleanText(body.edit_token, 80);
      if (!token) return j(res, 400, { error: 'edit_token is required.' });
      const rows = await readJson(await supa(
        `engineer_profiles?edit_token=eq.${encodeURIComponent(token)}&limit=1`
      ));
      const p = rows[0];
      if (!p) return j(res, 404, { error: 'Invalid edit link.' });
      const payload = cleanProfilePayload(body);
      if (payload.email === '') payload.email = null;
      if (payload.whatsapp === '') payload.whatsapp = null;
      /* Name and slug stay immutable through the token flow. */
      delete payload.name;
      const patch = { ...payload, updated_at: new Date().toISOString() };
      const updated = await readJson(await supa(
        `engineer_profiles?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify(patch) }
      ));
      return j(res, 200, { profile: updated[0] });
    }

    return j(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error('profiles error:', e.message);
    if (/PGRST205|relation .* does not exist|Could not find the table/i.test(e.message || '')) {
      return j(res, 503, { error: 'Portfolio tables are not created yet. Run supabase-v25-portfolio-reviews.sql in the Supabase SQL editor.' });
    }
    return j(res, 500, { error: 'Failed to process profile request' });
  }
};
