'use strict';

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

function isAdmin(req) {
  return req.headers['x-owner-key'] === process.env.OWNER_KEY;
}

function isCron(req) {
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

// Keywords indicating a civil engineering exam
const CIVIL_KEYWORDS = [
  'civil', 'je', 'junior engineer', 'assistant engineer', 'gate', 'ese', 'ies',
  'ssc je', 'rrb je', 'cpwd', 'pwd', 'nhai', 'irrigation', 'structural',
  'highway', 'upsc', 'kpsc', 'mpsc', 'tnpsc', 'appsc', 'state psc',
];

function isCivilRelated(text) {
  const lower = (text || '').toLowerCase();
  return CIVIL_KEYWORDS.some(kw => lower.includes(kw));
}

function detectCategory(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('upsc') || lower.includes('ias') || lower.includes('ies') || lower.includes('ese')) return 'UPSC';
  if (lower.includes('ssc je') || lower.includes('ssc-je') || lower.includes('staff selection')) return 'SSC';
  if (lower.includes('rrb') || lower.includes('railway')) return 'RRB';
  if (lower.includes('gate')) return 'GATE';
  if (lower.match(/kpsc|mpsc|tnpsc|appsc|opsc|gpsc|rpsc|hpsc|uppsc|bpsc|state psc/)) return 'State PSC';
  return 'Government';
}

function stripHtml(str) {
  return String(str || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str, max) {
  const s = stripHtml(str);
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

// Regex-based RSS parser — no cheerio dependency
function parseRss(xml) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const hit = r.exec(block);
      return hit ? hit[1].trim() : '';
    };
    items.push({
      title: get('title'),
      description: get('description') || get('summary'),
      link: get('link') || get('guid'),
      pubDate: get('pubDate') || get('published') || get('dc:date'),
    });
  }
  return items;
}

const SOURCES = [
  {
    name: 'Employment News RSS',
    url: 'https://www.employmentnews.gov.in/rss/feed.aspx',
  },
  {
    name: 'UPSC Active Exams',
    url: 'https://upsc.gov.in/examinations/active-examinations',
    // plain HTML page — we do a best-effort regex extraction
    htmlMode: true,
  },
  {
    name: 'SSC Homepage',
    url: 'https://ssc.nic.in/',
    htmlMode: true,
  },
  {
    name: 'Sarkari Result RSS',
    url: 'https://www.sarkariresult.com/feed/',
  },
];

async function fetchSource(source) {
  const ctrl = new AbortController();
  const timer = AbortSignal.timeout(12000);
  // Combine our abort with the timeout signal
  const signal = AbortSignal.any
    ? AbortSignal.any([ctrl.signal, timer])
    : timer;

  const r = await fetch(source.url, {
    signal,
    headers: { 'User-Agent': 'CivilCareer-ExamBot/1.0 (+https://civilcareer-india-two.vercel.app)' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Scrape an HTML page for exam-looking links / headings as rough items
function extractHtmlItems(html, baseUrl) {
  const items = [];
  // Extract anchor text + href from the page
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2]);
    if (!text || text.length < 10) continue;
    let link = href;
    if (link.startsWith('/')) {
      try { link = new URL(href, baseUrl).href; } catch { link = href; }
    }
    items.push({ title: text, description: text, link, pubDate: '' });
  }
  return items;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAdmin(req) && !isCron(req)) {
    return res.status(401).json({ ok: false, error: 'Admin key or cron user-agent required.' });
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase configuration missing.' });
  }

  const startedAt = Date.now();

  // Load existing exam titles to skip duplicates
  let existingTitles = new Set();
  try {
    const r = await db('exams?select=title&limit=2000');
    if (r.ok) {
      const rows = await r.json();
      existingTitles = new Set((rows || []).map(e => (e.title || '').toLowerCase().trim()));
    }
  } catch (_) { /* non-fatal */ }

  const sourceResults = [];
  let totalNew = 0;

  for (const source of SOURCES) {
    const result = { name: source.name, found: 0, saved: 0, error: null };

    try {
      const body = await fetchSource(source);
      const items = source.htmlMode
        ? extractHtmlItems(body, source.url)
        : parseRss(body);

      const civil = items.filter(it => isCivilRelated(it.title) || isCivilRelated(it.description));
      result.found = civil.length;

      for (const item of civil) {
        const titleClean = stripHtml(item.title).slice(0, 255);
        if (!titleClean) continue;
        if (existingTitles.has(titleClean.toLowerCase())) continue;

        const descClean = truncate(item.description || item.title, 600);
        const category  = detectCategory(titleClean + ' ' + descClean);
        const sourceUrl = (item.link || source.url).slice(0, 2048);

        let notifDate = null;
        if (item.pubDate) {
          const d = new Date(item.pubDate);
          if (!isNaN(d.getTime())) notifDate = d.toISOString().slice(0, 10);
        }
        if (!notifDate) notifDate = new Date().toISOString().slice(0, 10);

        const payload = {
          title: titleClean,
          description: descClean,
          source_url: sourceUrl,
          category,
          status: 'Active',
          published: false,
          review_state: 'Pending Review',
          notification_date: notifDate,
          auto_discovered: true,
        };

        try {
          const ins = await db('exams', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          if (ins.ok) {
            existingTitles.add(titleClean.toLowerCase());
            result.saved += 1;
            totalNew += 1;
          }
        } catch (_) { /* skip failed insert */ }
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
