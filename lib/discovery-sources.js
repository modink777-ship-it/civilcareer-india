/**
 * CivilCareer — configured discovery providers (optional, never fatal)
 *
 * Rules enforced here:
 *   • A missing API key NEVER fails the discovery run — the provider degrades
 *     to `configured:false` and the run continues with the remaining sources.
 *   • A provider network/HTTP failure degrades to `ok:false` + error stat;
 *     the run continues.
 *   • Records are normalized to the common item shape (title, link,
 *     description, pubDate, source, company, location, city, state, country,
 *     application_url) so the shared pipeline in api/jobs.js treats every
 *     source identically.
 *   • Jobvetta: no public API is documented, so it stays an honest no-op
 *     instead of inventing endpoints.
 */

'use strict';

const { cleanText, newSourceStat } = require('./discovery-core');

const FETCH_TIMEOUT_MS = 8000;

async function safeFetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'CivilCareer public vacancy discovery/1.0',
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  }
  return res.json();
}

function stat(name, extra = {}) {
  return { ...newSourceStat(name, false), ...extra };
}

/* ── SerpApi — Google Jobs ──────────────────────────────────────────── */
async function fetchSerpApiGoogleJobs(q, location) {
  const key = process.env.SERPAPI_KEY || process.env.SERP_API_KEY || '';
  if (!key) return { providerStat: stat('Google Jobs via SerpApi'), jobs: [] };

  const query = [q, location].filter(Boolean).join(', ');
  const url =
    'https://serpapi.com/search.json?engine=google_jobs' +
    `&q=${encodeURIComponent(query)}` +
    '&hl=en&gl=in' +
    `&api_key=${encodeURIComponent(key)}`;

  const data = await safeFetchJson(url);
  if (data && data.error) throw new Error(`SerpApi error: ${data.error}`);

  const jobs = (Array.isArray(data.jobs_results) ? data.jobs_results : []).map(j => {
    const ext = j.detected_extensions || {};
    const applyOptions = Array.isArray(j.apply_options) ? j.apply_options : [];
    return {
      title: cleanText(j.title || ''),
      link: j.job_id
        ? `https://www.google.com/search?ibp=htl;jobs&htidocid=${encodeURIComponent(String(j.job_id))}`
        : cleanText(j.share_link || ''),
      description: cleanText(
        [j.description, ext.posted_at, ext.schedule_type, ext.work_from_home === true ? 'work from home' : '']
          .filter(Boolean).join(' — ')
      ),
      pubDate: cleanText(ext.posted_at || ''),
      source: 'google_jobs',
      company: cleanText(j.company_name || ''),
      location: cleanText(j.location || ''),
      application_url: applyOptions.length && applyOptions[0].link
        ? cleanText(applyOptions[0].link)
        : (j.share_link ? cleanText(j.share_link) : ''),
    };
  });

  return { providerStat: stat('Google Jobs via SerpApi', { configured: true, items: jobs.length }), jobs };
}

/* ── Adzuna (India endpoint) ────────────────────────────────────────── */
async function fetchAdzuna(q, location) {
  const appId = process.env.ADZUNA_APP_ID || '';
  const appKey = process.env.ADZUNA_APP_KEY || '';
  if (!appId || !appKey) return { providerStat: stat('Adzuna'), jobs: [] };

  const search = q || 'civil engineering';
  const url =
    'https://api.adzuna.com/v1/api/jobs/in/search/1' +
    `?app_id=${encodeURIComponent(appId)}` +
    `&app_key=${encodeURIComponent(appKey)}` +
    '&results_per_page=30' +
    `&what=${encodeURIComponent(search)}` +
    '&content-type=application/json';

  const data = await safeFetchJson(url);
  const jobs = (Array.isArray(data.results) ? data.results : []).map(j => ({
    title: cleanText(String(j.title || '').replace(/<[^>]*>/g, '')),
    link: cleanText(j.redirect_url || j.url || ''),
    description: cleanText(j.description || ''),
    pubDate: cleanText(j.created || ''),
    source: 'adzuna',
    company: cleanText((j.company && j.company.display_name) || ''),
    location: cleanText((j.location && j.location.display_name) || ''),
    city: cleanText((j.location && j.location.area && j.location.area[1]) || ''),
    state: cleanText((j.location && j.location.area && j.location.area[0]) || ''),
    country: 'India',
    application_url: cleanText(j.redirect_url || j.url || ''),
  }));

  return { providerStat: stat('Adzuna', { configured: true, items: jobs.length }), jobs };
}

/* ── The Muse ───────────────────────────────────────────────────────── */
async function fetchTheMuse(q) {
  const key = process.env.THEMUSE_API_KEY || process.env.MUSE_API_KEY || '';
  if (!key) return { providerStat: stat('The Muse'), jobs: [] };

  const params = new URLSearchParams();
  // Category 9 = "Civil and Structural Engineering" on The Muse's public API.
  params.set('category', '9');
  if (q) params.set('query', String(q).split(/\s+/).slice(0, 4).join(' '));
  params.set('page', '1');
  params.set('api_key', key);

  const data = await safeFetchJson(`https://www.themuse.com/api/public/jobs?${params.toString()}`);

  const jobs = (Array.isArray(data.results) ? data.results : []).map(j => {
    const locs = (Array.isArray(j.locations) ? j.locations : []).map(cleanText);
    return {
      title: cleanText(j.name || ''),
      link: cleanText((j.refs && j.refs.landing_page) || ''),
      description: cleanText(j.contents || '').slice(0, 1500),
      pubDate: cleanText(j.publication_date || ''),
      source: 'the_muse',
      company: cleanText((j.company && j.company.display_name) || ''),
      location: locs[0] || '',
      application_url: cleanText((j.refs && j.refs.landing_page) || ''),
    };
  });

  return { providerStat: stat('The Muse', { configured: true, items: jobs.length }), jobs };
}

/* ── Jobvetta — no public API documented; honest no-op ──────────────── */
async function fetchJobvetta() {
  return {
    providerStat: stat('Jobvetta', {
      ok: true,
      error: 'No public API documented; source intentionally skipped (no invented endpoints).',
    }),
    jobs: [],
  };
}

/* ── Orchestration ──────────────────────────────────────────────────── */
async function runConfiguredSources({ q, location } = {}) {
  const stats = {};
  const jobs = [];

  const providers = [
    ['google_jobs', 'Google Jobs via SerpApi', () => fetchSerpApiGoogleJobs(q, location)],
    ['adzuna', 'Adzuna', () => fetchAdzuna(q, location)],
    ['the_muse', 'The Muse', () => fetchTheMuse(q)],
    ['jobvetta', 'Jobvetta', () => fetchJobvetta()],
  ];

  for (const [key, label, fn] of providers) {
    try {
      const out = await fn();
      const full = {
        ...out.providerStat,
        accepted: 0,
        rejectedCivil: 0,
        rejectedIndia: 0,
        rejectedAge: 0,
        rejectedFuture: 0,
        rejectedDupe: 0,
        unknownDate: 0,
      };
      stats[key] = full;
      jobs.push(...(Array.isArray(out.jobs) ? out.jobs : []).map(j => ({ ...j, _source: key })));
    } catch (err) {
      stats[key] = {
        ...stat(label),
        configured: true,
        ok: false,
        error: String((err && err.message) || err),
      };
    }
  }

  return { jobs, stats };
}

module.exports = { runConfiguredSources };
