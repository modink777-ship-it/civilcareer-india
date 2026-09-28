'use strict';

/**
 * CivilCareer — Job Discovery (read-only candidate discovery)
 * GET /api/civil-discovery?key=...
 *
 * Fetches configured discovery sources and returns only candidates that do
 * not already exist in jobs. This endpoint NEVER inserts into jobs.
 * An admin explicitly moves a candidate into Review via /api/admin-jobs action=add.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OWNER_KEY = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;

function db(path, opts = {}) {
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

function getQuery(req) {
  if (req.query) return req.query;
  try { return Object.fromEntries(new URL(req.url || '', 'https://x.local').searchParams.entries()); }
  catch { return {}; }
}

function isAdmin(req) {
  const q = getQuery(req);
  return !!OWNER_KEY && (req.headers?.['x-owner-key'] === OWNER_KEY || q.key === OWNER_KEY);
}

function norm(v) { return String(v || '').toLowerCase().trim().replace(/\s+/g, ' '); }
function urlKey(v) { return norm(v).replace(/\/$/, ''); }
function fingerprint(j) { return [norm(j.company), norm(j.role || j.title), norm(j.location)].join('|'); }

async function getExistingJobs() {
  const res = await db('jobs?select=source_url,company,role,location&limit=10000');
  if (!res.ok) throw new Error('Could not read existing jobs for deduplication.');
  return await res.json();
}

async function fetchDiscoveryJobs() {
  const { runConfiguredSources } = require('../lib/discovery-sources');
  const jobs = await runConfiguredSources({ q:'civil engineer india', location:'India' });
  return Array.isArray(jobs) ? jobs : [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'GET only.'});
  if (!isAdmin(req)) return res.status(401).json({ok:false,error:'Admin key required.'});
  if (!SUPA || !KEY) return res.status(500).json({ok:false,error:'Supabase configuration missing.'});

  try {
    const existing = await getExistingJobs();
    const existingUrls = new Set(existing.map(j=>urlKey(j.source_url)).filter(Boolean));
    const existingFps = new Set(existing.map(fingerprint).filter(x=>x !== '||'));

    const allJobs = await fetchDiscoveryJobs();
    const seenUrls = new Set();
    const seenFps = new Set();
    const newJobs = [];
    let duplicates = 0;

    for (const raw of allJobs) {
      const job = {
        ...raw,
        role: raw.role || raw.title || '',
        source_url: raw.source_url || raw.url || raw.link || '',
        application_url: raw.application_url || raw.apply_url || raw.url || raw.link || '',
      };
      const u = urlKey(job.source_url);
      const fp = fingerprint(job);
      if (!job.role || (!u && fp === '||')) continue;
      if ((u && (existingUrls.has(u) || seenUrls.has(u))) || (fp !== '||' && (existingFps.has(fp) || seenFps.has(fp)))) {
        duplicates++;
        continue;
      }
      if (u) seenUrls.add(u);
      if (fp !== '||') seenFps.add(fp);
      newJobs.push(job);
    }

    return res.status(200).json({
      ok:true,
      summary:{ totalFetched:allJobs.length, alreadyExisting:duplicates, newJobs:newJobs.length, inserted:0 },
      jobs:newJobs,
    });
  } catch (err) {
    console.error('Discovery error:',err);
    return res.status(500).json({ok:false,error:err.message || 'Discovery failed'});
  }
};
