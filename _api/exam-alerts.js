'use strict';

/**
 * CivilCareer — Exam Alerts Scanner
 * GET /api/exam-alerts  (admin key or Vercel cron)
 *
 * WHY Google News RSS instead of scraping .gov.in:
 *   Government websites (.gov.in, .nic.in) block server-side requests from
 *   cloud functions — they return 403 or timeout. Google News RSS is publicly
 *   accessible from any server, aggregates every major exam notification, and
 *   is updated within minutes of publication.
 *
 * Sources used (all completely free, no API key):
 *   1. Google News RSS — 8 targeted civil engineering exam queries
 *   2. Employment News RSS — official Central Govt weekly gazette
 *   3. Sarkari Naukri RSS — aggregates all state/central job notifications
 *   4. SarkariResult RSS  — widely used for SSC/UPSC/RRB notifications
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

function isAdmin(req) {
  return req.headers['x-owner-key'] === process.env.OWNER_KEY;
}
function isCron(req) {
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

// ── Civil exam keyword matching ─────────────────────────────────────────────

const EXAM_KW = [
  'civil engineer', 'je civil', 'ae civil', 'junior engineer civil',
  'assistant engineer', 'executive engineer', 'gate ce', 'gate civil',
  'ese civil', 'ies civil', 'ssc je', 'rrb je civil',
  'cpwd recruitment', 'pwd recruitment', 'nhai recruitment', 'cwc recruitment',
  'kpsc civil', 'tspsc civil', 'appsc civil', 'tnpsc civil', 'mpsc civil',
  'upsc ese', 'upsc ies',
  'civil engineering recruitment', 'civil engineering vacancy',
  'civil engineering notification', 'civil engineering exam',
  'civil engineer vacancy', 'civil engineer notification',
];
const EXAM_KW_RE = new RegExp(EXAM_KW.join('|'), 'i');

// Also catch broader terms if they appear alongside civil markers
const BROAD_KW_RE = /recruitment|notification|vacancy|admit card|result|syllabus|exam date|apply online/i;
const GOVT_KW_RE  = /upsc|ssc|rrb|kpsc|tspsc|appsc|tnpsc|mpsc|gpsc|rpsc|bpsc|hpsc|opsc|ukpsc|ppsc|jpsc|cgpsc/i;

function isCivilExamRelated(text) {
  const t = (text || '').toLowerCase();
  return EXAM_KW_RE.test(t) || (BROAD_KW_RE.test(t) && GOVT_KW_RE.test(t));
}

function detectCategory(text) {
  const lower = (text || '').toLowerCase();
  if (/gate/.test(lower)) return 'GATE';
  if (/ese|ies|upsc/.test(lower)) return 'UPSC / ESE';
  if (/ssc\s?je|ssc-je|staff selection/.test(lower)) return 'SSC JE';
  if (/rrb|railway/.test(lower)) return 'RRB JE';
  if (/kpsc/.test(lower)) return 'KPSC';
  if (/tspsc/.test(lower)) return 'TSPSC';
  if (/appsc/.test(lower)) return 'APPSC';
  if (/tnpsc/.test(lower)) return 'TNPSC';
  if (/mpsc/.test(lower)) return 'MPSC';
  if (/[a-z]psc/.test(lower)) return 'State PSC';
  return 'Government';
}

// ── RSS parsing (pure regex — no dependencies) ──────────────────────────────

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function trunc(s, n) { const v = stripHtml(s); return v.length <= n ? v : v.slice(0, n - 1).trimEnd() + '…'; }

function parseRss(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const tag = (name) => {
      const r = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i');
      const h = r.exec(block);
      return h ? h[1].trim() : '';
    };
    items.push({
      title:       tag('title'),
      description: tag('description') || tag('summary'),
      link:        tag('link') || tag('guid'),
      pubDate:     tag('pubDate') || tag('published') || tag('dc:date'),
    });
  }
  return items;
}

async function fetchRss(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseRss(await r.text());
}

// ── Google News RSS queries — very specific to avoid noise ──────────────────

const GNEWS_QUERIES = [
  'civil engineering recruitment 2025 India notification',
  'SSC JE civil 2025 recruitment notification',
  'GATE civil engineering 2025 2026 notification',
  'KPSC TSPSC APPSC civil engineer vacancy 2025',
  'TNPSC MPSC civil engineer recruitment 2025',
  'UPSC ESE civil engineering 2026 notification',
  'RRB JE civil engineering recruitment 2025',
  'CPWD NHAI civil engineer vacancy 2025',
];

function googleNewsUrl(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

// ── Additional aggregator RSS feeds ─────────────────────────────────────────

const RSS_FEEDS = [
  {
    name: 'Sarkari Naukri',
    url: 'https://www.sarkarinaukri.com/rss/government-jobs.xml',
  },
  {
    name: 'SarkariResult',
    url: 'https://www.sarkariresult.com/feed/',
  },
  {
    name: 'FreshersWorld Govt Jobs',
    url: 'https://www.freshersworld.com/jobs/rss',
  },
];

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAdmin(req) && !isCron(req)) {
    return res.status(401).json({ ok: false, error: 'Admin key required.' });
  }
  if (!SUPA || !KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase not configured.' });
  }

  const startedAt = Date.now();

  // Load existing exam titles to skip duplicates
  let existingTitles = new Set();
  try {
    const r = await db('exams?select=title_en&limit=5000');
    if (r.ok) {
      (await r.json()).forEach(e => {
        if (e.title_en) existingTitles.add(e.title_en.toLowerCase().trim());
      });
    }
  } catch (_) { /* non-fatal */ }

  const sourceResults = [];
  let totalNew = 0;
  const insertErrors = [];

  // ── 1. Google News RSS — most reliable source ──────────────────────────

  const gnewsResult = { name: 'Google News RSS (8 queries)', found: 0, saved: 0, error: null };
  try {
    const settled = await Promise.allSettled(
      GNEWS_QUERIES.map(q => fetchRss(googleNewsUrl(q)))
    );
    const allItems = settled
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    gnewsResult.found = allItems.length;

    // Deduplicate by link within this batch
    const seenLinks = new Set();
    for (const item of allItems) {
      const link = (item.link || '').trim();
      if (link && seenLinks.has(link)) continue;
      if (link) seenLinks.add(link);

      const titleClean = trunc(item.title, 255);
      if (!titleClean) continue;
      if (!isCivilExamRelated(titleClean + ' ' + item.description)) continue;
      if (existingTitles.has(titleClean.toLowerCase())) continue;

      const desc      = trunc(item.description || titleClean, 600);
      const category  = detectCategory(titleClean + ' ' + desc);
      const notifDate = (() => {
        if (!item.pubDate) return new Date().toISOString().slice(0, 10);
        const d = new Date(item.pubDate);
        return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
      })();

      const payload = {
        title_en:          titleClean,
        description_en:    desc,
        source_url:        link || null,
        official_website_url: link || null,
        category,
        status:            'Open',
        published:         false,
        review_state:      'Pending Review',
        notification_date: notifDate,
        auto_discovered:   true,
      };

      try {
        const ins = await db('exams', { method: 'POST', body: JSON.stringify(payload) });
        if (ins.ok) {
          existingTitles.add(titleClean.toLowerCase());
          gnewsResult.saved++;
          totalNew++;
        } else if (insertErrors.length < 5) {
          insertErrors.push({ item: titleClean.slice(0, 80), status: ins.status, detail: (await ins.text()).slice(0, 300) });
        }
      } catch (err) { if (insertErrors.length < 5) insertErrors.push({ item: titleClean.slice(0, 80), detail: String(err.message).slice(0, 200) }); }
    }
  } catch (err) {
    gnewsResult.error = err.message;
  }
  sourceResults.push(gnewsResult);

  // ── 2. Additional RSS feeds ─────────────────────────────────────────────

  for (const feed of RSS_FEEDS) {
    const result = { name: feed.name, found: 0, saved: 0, error: null };
    try {
      const items = await fetchRss(feed.url);
      result.found = items.length;

      for (const item of items) {
        const titleClean = trunc(item.title, 255);
        if (!titleClean) continue;
        if (!isCivilExamRelated(titleClean + ' ' + item.description)) continue;
        if (existingTitles.has(titleClean.toLowerCase())) continue;

        const desc      = trunc(item.description || titleClean, 600);
        const category  = detectCategory(titleClean + ' ' + desc);
        const link      = (item.link || '').trim();
        const notifDate = (() => {
          if (!item.pubDate) return new Date().toISOString().slice(0, 10);
          const d = new Date(item.pubDate);
          return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
        })();

        const payload = {
          title_en:          titleClean,
          description_en:    desc,
          source_url:        link || null,
          official_website_url: link || null,
          category,
          status:            'Open',
          published:         false,
          review_state:      'Pending Review',
          notification_date: notifDate,
          auto_discovered:   true,
        };

        try {
          const ins = await db('exams', { method: 'POST', body: JSON.stringify(payload) });
          if (ins.ok) {
            existingTitles.add(titleClean.toLowerCase());
            result.saved++;
            totalNew++;
          } else if (insertErrors.length < 5) {
            insertErrors.push({ item: titleClean.slice(0, 80), status: ins.status, detail: (await ins.text()).slice(0, 300) });
          }
        } catch (err) { if (insertErrors.length < 5) insertErrors.push({ item: titleClean.slice(0, 80), detail: String(err.message).slice(0, 200) }); }
      }
    } catch (err) {
      result.error = err.message;
    }
    sourceResults.push(result);
  }

  return res.status(200).json({
    ok: true,
    totalNew,
    durationMs: Date.now() - startedAt,
    sources: sourceResults,
    insertErrors,
  });
};
