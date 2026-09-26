'use strict';

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const { requireOwner } = require('../lib/security');

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

function isCron(req) {
  const secret = String(process.env.CRON_SECRET || '');
  if (secret) return String(req.headers.authorization || '') === `Bearer ${secret}`;
  return /vercel-cron/i.test(String(req.headers['user-agent'] || ''));
}

function clean(v, n = 600) {
  return String(v || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

const KEYWORDS = /\b(civil|je|junior engineer|assistant engineer|gate|ese|ies|ssc je|rrb je|cpwd|pwd|nhai|irrigation|structural|highway|upsc|kpsc|mpsc|tnpsc|appsc|state psc)\b/i;

function parseRss(text) {
  const items = [];
  const blocks = String(text || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const get = k => {
      const m = b.match(new RegExp(`<${k}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${k}>`, 'i'));
      return m ? clean(m[1], 1200) : '';
    };
    const title = get('title');
    const link = get('link') || ((b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || '');
    const description = get('description');
    if (title) items.push({ title, link: clean(link, 1000), description });
  }
  return items;
}

function category(title) {
  const t = String(title).toLowerCase();
  if (/gate/.test(t)) return 'GATE';
  if (/ese|ies/.test(t)) return 'ESE';
  if (/ssc/.test(t)) return 'SSC';
  if (/rrb/.test(t)) return 'RRB';
  if (/psc|kpsc|mpsc|tnpsc|appsc/.test(t)) return 'State PSC';
  if (/upsc/.test(t)) return 'UPSC';
  return 'Government';
}

async function fetchSource(name, url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'CivilCareer/1.0 (+https://civilcareer-india-two.vercel.app)' },
      signal: AbortSignal.timeout(4500),
    });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return { name, url, text: await r.text() };
  } catch (error) {
    return { name, url, text: '', error: error.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isCron(req) && !requireOwner(req, res)) return;
  if (!SUPA || !KEY) return res.status(503).json({ error: 'Supabase server configuration is missing.' });

  const started = Date.now();
  const sources = [
    ['Employment News RSS', 'https://www.employmentnews.gov.in/rss/feed.aspx'],
    ['UPSC Active Examinations', 'https://upsc.gov.in/examinations/active-examinations'],
    ['SSC', 'https://ssc.nic.in/'],
    ['Sarkari Result RSS', 'https://www.sarkariresult.com/feed/'],
  ];

  // Run sources concurrently and keep the per-source timeout short enough for
  // Vercel's 15-second runtime. A slow government site must not block the scan.
  const fetched = await Promise.all(sources.map(([name, url]) => fetchSource(name, url)));
  const results = [];
  const all = [];
  for (const x of fetched) {
    let found = [];
    if (x.text) {
      found = parseRss(x.text);
      if (!found.length) {
        const titleMatches = [...x.text.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)]
          .map(m => clean(m[1], 500))
          .filter(t => t && !/rss|xml|employment news|upsc/i.test(t));
        found = titleMatches.map(title => ({ title, link: x.url, description: '' }));
      }
    }
    found = found.filter(i => KEYWORDS.test(`${i.title} ${i.description}`)).slice(0, 40);
    all.push(...found.map(i => ({ ...i, source: x.name, sourceUrl: i.link || x.url })));
    results.push({ name: x.name, found: found.length, saved: 0, error: x.error || null });
  }

  // One bounded read + one bulk insert avoids the old N+1 pattern that could
  // exceed Vercel's timeout when several new notices were found.
  const existingResponse = await db('exams?select=title_en&limit=2000');
  if (!existingResponse.ok) return res.status(502).json({ error: `Could not read existing exams (${existingResponse.status}).`, sources: results });
  const existing = await existingResponse.json();
  const seen = new Set(existing.map(x => String(x.title_en || '').trim().toLowerCase()).filter(Boolean));
  const payloads = [];
  const sourceCounts = new Map(results.map(x => [x.name, 0]));
  for (const item of all) {
    const title = clean(item.title, 240);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    payloads.push({
      title_en: title,
      overview: clean(item.description, 600),
      source_url: item.sourceUrl,
      category: category(title),
      status: 'Active',
      published: false,
      review_state: 'Pending Review',
      notification_date: new Date().toISOString().slice(0, 10),
      auto_discovered: true,
    });
    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
  }

  if (payloads.length) {
    const r = await db('exams', { method: 'POST', body: JSON.stringify(payloads) });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 500);
      return res.status(502).json({ error: detail || 'Could not save exam drafts.', sources: results, totalNew: 0, durationMs: Date.now() - started });
    }
    for (const row of results) row.saved = sourceCounts.get(row.name) || 0;
  }

  return res.status(200).json({ ok: true, totalNew: payloads.length, durationMs: Date.now() - started, sources: results });
};
