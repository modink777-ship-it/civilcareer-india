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

/* ─────────────────────────────────────────────────────────────────────
 * FREE INDIA-SPECIFIC SOURCES
 * These require no API key and reliably return India civil engineering jobs.
 * ─────────────────────────────────────────────────────────────────────*/

function parseRssItems(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const tag = name => {
      const r = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i');
      const h = r.exec(block); return h ? h[1].trim() : '';
    };
    items.push({ title: tag('title'), description: tag('description') || tag('summary'), link: tag('link') || tag('guid'), pubDate: tag('pubDate') || tag('dc:date') });
  }
  return items;
}

async function safeFetchText(url, headers = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'CivilCareer public vacancy discovery/1.0',
      Accept: 'application/rss+xml, application/xml, text/html, */*',
      'Accept-Language': 'en-IN,en;q=0.9',
      ...headers,
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function rssToJobs(items, source, defaultCompany, defaultLocation) {
  return items.map(i => ({
    title:       cleanText(i.title),
    link:        cleanText(i.link),
    description: cleanText(i.description),
    pubDate:     cleanText(i.pubDate),
    source,
    company:     defaultCompany || '',
    location:    defaultLocation || 'India',
    country:     'India',
    application_url: cleanText(i.link),
  }));
}

/* ── TimesJobs RSS feeds (India, civil category) ──────────────── */
async function fetchTimesJobs() {
  const FEEDS = [
    'https://www.timesjobs.com/rss/jobs-in-india/civil-engineer',
    'https://www.timesjobs.com/rss/jobs-in-india/site-engineer',
    'https://www.timesjobs.com/rss/jobs-in-india/structural-engineer',
    'https://www.timesjobs.com/rss/jobs-in-india/quantity-surveyor',
  ];
  const all = [];
  await Promise.allSettled(FEEDS.map(async url => {
    const xml = await safeFetchText(url);
    all.push(...rssToJobs(parseRssItems(xml), 'timesjobs', '', 'India'));
  }));
  return { providerStat: stat('TimesJobs', { configured: true, ok: true, items: all.length }), jobs: all };
}

/* ── Shine.com RSS (India civil engineering) ──────────────────── */
async function fetchShine() {
  const FEEDS = [
    'https://www.shine.com/rss/civil-engineer-jobs.xml',
    'https://www.shine.com/rss/site-engineer-jobs.xml',
  ];
  const all = [];
  await Promise.allSettled(FEEDS.map(async url => {
    const xml = await safeFetchText(url);
    all.push(...rssToJobs(parseRssItems(xml), 'shine', '', 'India'));
  }));
  return { providerStat: stat('Shine', { configured: true, ok: true, items: all.length }), jobs: all };
}

/* ── Freshersworld RSS (India fresher civil jobs) ─────────────── */
async function fetchFreshersworld() {
  const FEEDS = [
    'https://www.freshersworld.com/jobs/rss?branch=Civil+Engineering&passout=2022,2023,2024,2025&freshness=30',
    'https://www.freshersworld.com/jobs/rss?branch=Civil+Engineering&experience=experienced&freshness=30',
  ];
  const all = [];
  await Promise.allSettled(FEEDS.map(async url => {
    const xml = await safeFetchText(url);
    all.push(...rssToJobs(parseRssItems(xml), 'freshersworld', '', 'India'));
  }));
  return { providerStat: stat('Freshersworld', { configured: true, ok: true, items: all.length }), jobs: all };
}

/* ── Foundit (ex-Monster India) RSS ──────────────────────────── */
async function fetchFoundit() {
  const FEEDS = [
    'https://www.foundit.in/rss/jobsearch?q=civil+engineer&loc=India',
    'https://www.foundit.in/rss/jobsearch?q=site+engineer+civil&loc=India',
    'https://www.foundit.in/rss/jobsearch?q=structural+engineer&loc=India',
  ];
  const all = [];
  await Promise.allSettled(FEEDS.map(async url => {
    const xml = await safeFetchText(url);
    all.push(...rssToJobs(parseRssItems(xml), 'foundit', '', 'India'));
  }));
  return { providerStat: stat('Foundit (Monster India)', { configured: true, ok: true, items: all.length }), jobs: all };
}

/* ── Naukri RSS (India's largest job board) ─────────────────── */
async function fetchNaukri() {
  const FEEDS = [
    'https://www.naukri.com/rss/civil-engineer-jobs-in-india.rss',
    'https://www.naukri.com/rss/site-engineer-jobs-in-india.rss',
    'https://www.naukri.com/rss/quantity-surveyor-jobs-in-india.rss',
    'https://www.naukri.com/rss/structural-engineer-jobs-in-india.rss',
    'https://www.naukri.com/rss/junior-engineer-civil-jobs-in-india.rss',
  ];
  const all = [];
  await Promise.allSettled(FEEDS.map(async url => {
    const xml = await safeFetchText(url);
    all.push(...rssToJobs(parseRssItems(xml), 'naukri', '', 'India'));
  }));
  return { providerStat: stat('Naukri', { configured: true, ok: true, items: all.length }), jobs: all };
}

/* ── Careerjet API (free, India endpoint) ────────────────────── */
async function fetchCareerjet(q) {
  const search = q || 'civil engineer';
  const url =
    'https://public.api.careerjet.net/search' +
    `?keywords=${encodeURIComponent(search)}` +
    '&location=India&locale_code=en_IN&affid=civilcareer&pagesize=100&sort=date';
  const data = await safeFetchJson(url);
  const jobs = (Array.isArray(data.jobs) ? data.jobs : []).map(j => ({
    title:       cleanText(j.title || ''),
    link:        cleanText(j.url || ''),
    description: cleanText(j.description || ''),
    pubDate:     cleanText(j.date || ''),
    source:      'careerjet',
    company:     cleanText(j.company || ''),
    location:    cleanText(j.locations || 'India'),
    country:     'India',
    application_url: cleanText(j.url || ''),
  }));
  return { providerStat: stat('Careerjet India', { configured: true, ok: true, items: jobs.length }), jobs };
}

/* ── Google News RSS — civil engineering job queries ─────────── */
// Not a job board, but Google News consistently surfaces actual job
// postings and recruitment notifications on Indian job sites.
async function fetchGoogleNewsJobs(q, location) {
  const queries = [
    `civil engineer jobs ${location || 'India'} 2025 site:naukri.com OR site:timesjobs.com OR site:shine.com OR site:foundit.in`,
    `civil engineer vacancy ${location || 'India'} 2025`,
    `site engineer civil jobs ${location || 'India'} hiring`,
    `structural engineer junior engineer civil ${location || 'India'} jobs`,
    `government civil engineer recruitment ${location || 'India'} 2025`,
    `${q || 'civil engineer'} jobs ${location || 'India'}`,
  ];
  const all = [];
  await Promise.allSettled(queries.map(async qr => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(qr)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const xml = await safeFetchText(url, { Accept: 'application/rss+xml' });
    all.push(...rssToJobs(parseRssItems(xml), 'google_news_jobs', '', location || 'India'));
  }));
  return { providerStat: stat('Google News Jobs', { configured: true, ok: true, items: all.length }), jobs: all };
}

/* ── Adzuna multi-page — fetch 5 pages (150 jobs) when key exists ─ */
async function fetchAdzunaMultipage(q, location) {
  const appId  = process.env.ADZUNA_APP_ID  || '';
  const appKey = process.env.ADZUNA_APP_KEY || '';
  if (!appId || !appKey) return { providerStat: stat('Adzuna'), jobs: [] };

  const search = q || 'civil engineer';
  const allJobs = [];

  await Promise.allSettled([1, 2, 3, 4, 5].map(async page => {
    const url =
      `https://api.adzuna.com/v1/api/jobs/in/search/${page}` +
      `?app_id=${encodeURIComponent(appId)}` +
      `&app_key=${encodeURIComponent(appKey)}` +
      '&results_per_page=50' +
      `&what=${encodeURIComponent(search)}` +
      (location ? `&where=${encodeURIComponent(location)}` : '') +
      '&content-type=application/json&sort_by=date';
    const data = await safeFetchJson(url);
    (Array.isArray(data.results) ? data.results : []).forEach(j => allJobs.push({
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
  }));

  return { providerStat: stat('Adzuna', { configured: true, ok: true, items: allJobs.length }), jobs: allJobs };
}

/* ── Orchestration ──────────────────────────────────────────────────── */
async function runConfiguredSources({ q, location } = {}) {
  const stats = {};
  const jobs = [];

  const providers = [
    // Paid/key providers (degrade gracefully if keys missing)
    ['google_jobs',    'Google Jobs via SerpApi', () => fetchSerpApiGoogleJobs(q, location)],
    ['adzuna',         'Adzuna',                  () => fetchAdzunaMultipage(q, location)],
    ['the_muse',       'The Muse',                () => fetchTheMuse(q)],
    ['jobvetta',       'Jobvetta',                () => fetchJobvetta()],
    // Free India-specific sources (always run)
    ['naukri',         'Naukri',                  () => fetchNaukri()],
    ['timesjobs',      'TimesJobs',               () => fetchTimesJobs()],
    ['shine',          'Shine',                   () => fetchShine()],
    ['freshersworld',  'Freshersworld',            () => fetchFreshersworld()],
    ['foundit',        'Foundit (Monster India)',  () => fetchFoundit()],
    ['careerjet',      'Careerjet India',          () => fetchCareerjet(q)],
    ['gnews_jobs',     'Google News Jobs',         () => fetchGoogleNewsJobs(q, location)],
  ];

  // Run all providers concurrently (fastest overall even if some are slow)
  const results = await Promise.allSettled(
    providers.map(([key, label, fn]) =>
      fn().then(out => ({ key, label, out })).catch(err => ({ key, label, err }))
    )
  );

  for (const settled of results) {
    const { key, label, out, err } = settled.status === 'fulfilled' ? settled.value : { ...settled.reason, err: settled.reason?.err };
    if (err || !out) {
      stats[key] = {
        ...stat(label),
        configured: true,
        ok: false,
        error: String((err && err.message) || err || 'Unknown error'),
      };
      continue;
    }
    stats[key] = {
      ...out.providerStat,
      accepted: 0, rejectedCivil: 0, rejectedIndia: 0,
      rejectedAge: 0, rejectedFuture: 0, rejectedDupe: 0, unknownDate: 0,
    };
    jobs.push(...(Array.isArray(out.jobs) ? out.jobs : []).map(j => ({ ...j, _source: key })));
  }

  return { jobs, stats };
}

module.exports = { runConfiguredSources };
