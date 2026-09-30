'use strict';

const { allowPublicCors } = require('../lib/security');

/**
 * CivilCareer — Government Job Discovery
 * POST /api/govt-discovery   (Supabase admin session or Vercel CRON_SECRET)
 *
 * Scrapes free public sources for civil engineering government jobs in India:
 *   1. NCS Portal  (National Career Service — govt.in official job board)
 *   2. Employment News RSS  (weekly official central govt vacancies)
 *   3. PSU career RSS/HTML  (NTPC, BHEL, NHAI, AAI, ONGC, GAIL, HPCL, NHPC)
 *   4. CPWD / Railway recruitment pages
 *   5. State PSC latest-recruitment pages (KPSC, TSPSC, MPSC, TNPSC, APPSC)
 *
 * All items arrive as published=false, review_state='Pending Review'.
 * Nothing is ever published automatically.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

function isAuthorized(req) {
  if (req && req.isCron === true) return true;
  return Boolean(req && req.adminUser);
}

// ── Civil engineering keyword matching ─────────────────────────────────────

const CIVIL_KW = [
  'civil engineer', 'site engineer', 'structural engineer', 'planning engineer',
  'quantity surveyor', 'highway engineer', 'road engineer', 'bridge engineer',
  'geotechnical', 'water resources', 'irrigation engineer', 'drainage engineer',
  'surveyor', 'qs engineer', 'billing engineer', 'qaqc engineer', 'bim engineer',
  'junior engineer civil', 'assistant engineer civil', 'executive engineer civil',
  'je civil', 'ae civil', 'ee civil', 'pwd', 'cpwd', 'nhai', 'cwc',
  'construction', 'infrastructure civil', 'civil works',
];
const CIVIL_KW_RE = new RegExp(CIVIL_KW.join('|'), 'i');

function isCivilJob(text) {
  return CIVIL_KW_RE.test(text || '');
}

function detectGovScope(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(upsc|ssc|rrb|cpwd|cwc|bro|nhai|nhpc|ongc|gail|bhel|ntpc|aai|hpcl|central\s+govt|central\s+government|ministry|department of)\b/.test(lower)) return 'central';
  return 'state';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(str) {
  return String(str || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function trunc(s, n) { const v = stripHtml(s); return v.length <= n ? v : v.slice(0, n - 1).trimEnd() + '…'; }

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseRss(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const h = r.exec(block);
      return h ? h[1].trim() : '';
    };
    items.push({ title: get('title'), description: get('description') || get('summary'), link: get('link') || get('guid'), pubDate: get('pubDate') || get('dc:date') });
  }
  return items;
}

function extractLinks(html, baseUrl) {
  const items = [];
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    const text = stripHtml(m[2]);
    if (!text || text.length < 8) continue;
    let url = href;
    if (url.startsWith('/')) { try { url = new URL(href, baseUrl).href; } catch { continue; } }
    if (!url.startsWith('http')) continue;
    items.push({ title: text, link: url, pubDate: '' });
  }
  return items;
}

async function fetchSafe(url, opts = {}) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(14000),
    headers: {
      'User-Agent': 'CivilCareer-GovtBot/1.0 (+https://civilcareer-india-two.vercel.app)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// ── Source definitions ───────────────────────────────────────────────────────

const SOURCES = [

  // ① NCS Portal — India's official government job board (JSON API, no key needed)
  {
    name: 'NCS Portal — Civil Engineering',
    scope: 'central',
    fetch: async () => {
      const queries = ['civil+engineer', 'junior+engineer+civil', 'assistant+engineer+civil'];
      const items = [];
      for (const q of queries) {
        try {
          const body = await fetchSafe(
            `https://www.ncs.gov.in/api/JobSeeker/SearchJobsByKeyword?keyword=${q}&location=india&pageNo=1&pageSize=50`,
            { headers: { Accept: 'application/json', Referer: 'https://www.ncs.gov.in/' } }
          );
          const data = JSON.parse(body);
          const jobs = data?.data?.jobs || data?.jobs || data?.result || [];
          for (const j of jobs) {
            items.push({
              title: j.jobTitle || j.title || '',
              company: j.organizationName || j.organization || j.employer || '',
              location: j.jobLocation || j.location || 'India',
              description: j.jobDescription || j.description || '',
              deadline: toDate(j.lastDateToApply || j.applicationDeadline || j.closingDate),
              link: j.jobUrl || j.applyUrl || `https://www.ncs.gov.in/job/${j.jobId || j.id}`,
              pubDate: j.postedDate || j.createdDate || '',
              salary: j.salary || j.salaryRange || '',
              qualification: j.qualification || j.educationalQualification || '',
              experience: j.experience || j.experienceRange || '',
            });
          }
        } catch (_) { /* per-query failures are non-fatal */ }
      }
      return items;
    },
  },

  // ② Employment News RSS — weekly official Central Govt vacancies
  {
    name: 'Employment News RSS',
    scope: 'central',
    fetch: async () => {
      const xml = await fetchSafe('https://www.employmentnews.gov.in/rss/feed.aspx');
      return parseRss(xml).map(i => ({ ...i, company: 'Central Government', location: 'India' }));
    },
  },

  // ③ CPWD Recruitment page
  {
    name: 'CPWD Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://www.cpwd.gov.in/recruitment.aspx');
      return extractLinks(html, 'https://www.cpwd.gov.in').map(i => ({
        ...i, company: 'Central Public Works Department (CPWD)', location: 'Pan India',
      }));
    },
  },

  // ④ NHAI Recruitment
  {
    name: 'NHAI Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://www.nhai.gov.in/en/recruitment');
      return extractLinks(html, 'https://www.nhai.gov.in').map(i => ({
        ...i, company: 'National Highways Authority of India (NHAI)', location: 'Pan India',
      }));
    },
  },

  // ⑤ NTPC Recruitment (major PSU, hires Civil Engineers)
  {
    name: 'NTPC Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://www.ntpc.co.in/en/current-openings');
      return extractLinks(html, 'https://www.ntpc.co.in').map(i => ({
        ...i, company: 'NTPC Limited', location: 'Pan India',
      }));
    },
  },

  // ⑥ BHEL Recruitment
  {
    name: 'BHEL Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://www.bhel.com/careers');
      return extractLinks(html, 'https://www.bhel.com').map(i => ({
        ...i, company: 'Bharat Heavy Electricals Ltd (BHEL)', location: 'Pan India',
      }));
    },
  },

  // ⑦ AAI Recruitment (Airports Authority of India — hires Civil JEs, AEs)
  {
    name: 'AAI Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://www.aai.aero/en/careers/recruitment');
      return extractLinks(html, 'https://www.aai.aero').map(i => ({
        ...i, company: 'Airports Authority of India (AAI)', location: 'Pan India',
      }));
    },
  },

  // ⑧ NHPC Recruitment (hydropower — hires civil engineers)
  {
    name: 'NHPC Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://www.nhpcindia.com/Default.aspx?id=130&lId=1');
      return extractLinks(html, 'https://www.nhpcindia.com').map(i => ({
        ...i, company: 'NHPC Limited', location: 'Pan India',
      }));
    },
  },

  // ⑨ Indian Railways Recruitment — RRB/RRC current
  {
    name: 'Indian Railways Recruitment',
    scope: 'central',
    fetch: async () => {
      const html = await fetchSafe('https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,554');
      return extractLinks(html, 'https://indianrailways.gov.in').map(i => ({
        ...i, company: 'Indian Railways', location: 'Pan India',
      }));
    },
  },

  // ⑩ KPSC Latest Recruitments (Karnataka)
  {
    name: 'KPSC Recruitment',
    scope: 'state',
    fetch: async () => {
      const html = await fetchSafe('https://kpsc.kar.nic.in/recruitment.html');
      return extractLinks(html, 'https://kpsc.kar.nic.in').map(i => ({
        ...i, company: 'Karnataka Public Service Commission (KPSC)', location: 'Karnataka',
      }));
    },
  },

  // ⑪ TSPSC Latest Recruitments (Telangana)
  {
    name: 'TSPSC Recruitment',
    scope: 'state',
    fetch: async () => {
      const html = await fetchSafe('https://tspsc.gov.in/notifications');
      return extractLinks(html, 'https://tspsc.gov.in').map(i => ({
        ...i, company: 'Telangana State PSC (TSPSC)', location: 'Telangana',
      }));
    },
  },

  // ⑫ TNPSC Recruitment (Tamil Nadu)
  {
    name: 'TNPSC Recruitment',
    scope: 'state',
    fetch: async () => {
      const html = await fetchSafe('https://www.tnpsc.gov.in/notifications.html');
      return extractLinks(html, 'https://www.tnpsc.gov.in').map(i => ({
        ...i, company: 'Tamil Nadu Public Service Commission (TNPSC)', location: 'Tamil Nadu',
      }));
    },
  },

  // ⑬ APPSC Recruitment (Andhra Pradesh)
  {
    name: 'APPSC Recruitment',
    scope: 'state',
    fetch: async () => {
      const html = await fetchSafe('https://psc.ap.gov.in/APPSCRMT/notifications.aspx');
      return extractLinks(html, 'https://psc.ap.gov.in').map(i => ({
        ...i, company: 'Andhra Pradesh PSC (APPSC)', location: 'Andhra Pradesh',
      }));
    },
  },

  // ⑭ MPSC Recruitment (Maharashtra)
  {
    name: 'MPSC Recruitment',
    scope: 'state',
    fetch: async () => {
      const html = await fetchSafe('https://mpsc.gov.in/notification');
      return extractLinks(html, 'https://mpsc.gov.in').map(i => ({
        ...i, company: 'Maharashtra Public Service Commission (MPSC)', location: 'Maharashtra',
      }));
    },
  },
];

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  allowPublicCors(req, res, { methods: 'POST, GET, OPTIONS', headers: 'Content-Type, x-owner-key' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Administrator authentication required.' });
  }
  if (!SUPA || !KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase configuration missing.' });
  }

  const startedAt = Date.now();

  // Load existing source URLs to skip duplicates
  let existingUrls = new Set();
  try {
    const r = await db('jobs?select=source_url&published=eq.false&limit=5000');
    const r2 = await db('jobs?select=source_url&published=eq.true&limit=5000');
    if (r.ok) (await r.json()).forEach(j => j.source_url && existingUrls.add(j.source_url.toLowerCase().trim()));
    if (r2.ok) (await r2.json()).forEach(j => j.source_url && existingUrls.add(j.source_url.toLowerCase().trim()));
  } catch (_) { /* non-fatal */ }

  const sourceResults = [];
  let totalNew = 0;

  for (const source of SOURCES) {
    const result = { name: source.name, found: 0, civil: 0, saved: 0, error: null };

    try {
      const items = await source.fetch();
      result.found = items.length;

      for (const item of items) {
        const titleText = stripHtml(item.title);
        const descText  = stripHtml(item.description || '');
        const combined  = `${titleText} ${descText} ${item.company || ''}`;

        if (!titleText || titleText.length < 5) continue;
        if (!isCivilJob(combined)) continue;
        result.civil++;

        const urlKey = (item.link || '').toLowerCase().trim();
        if (urlKey && existingUrls.has(urlKey)) continue;

        const payload = {
          role:             trunc(titleText, 255),
          company:          trunc(item.company || source.name, 200) || null,
          location:         trunc(item.location || 'India', 300),
          description:      trunc(descText || `${source.name} — verify the original posting before publishing.`, 5000),
          qualification:    trunc(item.qualification || '', 500) || null,
          experience_level: trunc(item.experience || '', 200) || null,
          salary:           trunc(item.salary || '', 200) || null,
          sector:           'Government',
          employment_type:  'Full-time',
          country:          'India',
          source_url:       item.link || null,
          application_url:  item.link || null,
          /* gov_scope has no column in the jobs table (migrations never
             added it), so writing it made every insert fail silently.
             The scope now travels inside `source`, which does exist. */
          source:           `GovtDiscovery — ${source.name} (${source.scope || detectGovScope(combined)})`,
          ingestion_source: 'govt_discovery',
          deadline:         item.deadline || null,
          posted_at:        item.pubDate ? (new Date(item.pubDate).toISOString() || null) : null,
          published:        false,
          review_state:     'Pending Review',
          status:           'Active',
        };

        try {
          const ins = await db('jobs', { method: 'POST', body: JSON.stringify(payload) });
          if (ins.ok) {
            if (urlKey) existingUrls.add(urlKey);
            result.saved++;
            totalNew++;
          }
        } catch (_) { /* per-item failures non-fatal */ }
      }
    } catch (err) {
      result.error = err.message || String(err);
    }

    sourceResults.push(result);
  }

  return res.status(200).json({
    ok: true,
    totalNew,
    durationMs: Date.now() - startedAt,
    sources: sourceResults,
  });
};
