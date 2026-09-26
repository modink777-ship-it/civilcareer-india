'use strict';

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const { requireOwner } = require('../lib/security');

function db(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Number(opts.timeoutMs || 4500), 4500));
  const { timeoutMs, ...fetchOpts } = opts;
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...fetchOpts,
    signal: controller.signal,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(fetchOpts.headers || {}),
    },
  }).finally(() => clearTimeout(timer));
}

function isCron(req) {
  const secret = String(process.env.CRON_SECRET || '');
  if (secret) return String(req.headers.authorization || '') === `Bearer ${secret}`;
  return /vercel-cron/i.test(String(req.headers['user-agent'] || ''));
}

function clean(v, n = 900) {
  return String(v || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

// Keep this focused on civil-engineering/government-exam relevance. The scanner
// should not import unrelated UPSC/SSC notices merely because the source is official.
const CIVIL_KEYWORDS = /\b(civil|engineering services|engineering service|junior engineer|\bje\b|assistant engineer|\bae\b|gate|ese|diploma engineer|civil engineering|structural|highway|transport|geotechnical|quantity survey|cpwd|pwd|nhai|irrigation|rrb\s*je|ssc\s*je|dms|cma)\b/i;
const EXAM_CONTEXT = /\b(exam|examination|recruitment|vacancy|notification|notice|centralised employment notice|cen)\b/i;

function parseRss(text) {
  const items = [];
  const blocks = String(text || '').match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const b of blocks) {
    const get = k => {
      const m = b.match(new RegExp(`<${k}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${k}>`, 'i'));
      return m ? clean(m[1], 1200) : '';
    };
    const title = get('title');
    const linkMatch = b.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
    const hrefMatch = b.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = clean((linkMatch && linkMatch[1]) || (hrefMatch && hrefMatch[1]) || ((b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || ''), 1000);
    const description = get('description') || get('summary') || get('content');
    if (title) items.push({ title, link, description });
  }
  return items;
}

function parseHtmlLinks(text, baseUrl) {
  const items = [];
  const html = String(text || '');
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const title = clean(m[2], 500);
    if (!title) continue;
    const href = (attrs.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    let link = baseUrl;
    try { link = href ? new URL(href, baseUrl).href : baseUrl; } catch {}
    items.push({ title, link, description: '' });
  }
  return items;
}

function sourceItems(text, type, url) {
  const rss = parseRss(text);
  if (rss.length) return rss;
  const links = parseHtmlLinks(text, url);
  // Official government pages frequently render useful notices as ordinary links
  // rather than RSS. Keep only reasonably notice-like link text before the civil filter.
  return links.filter(x => EXAM_CONTEXT.test(x.title));
}

function category(title) {
  const t = String(title).toLowerCase();
  if (/ssc\s*je|staff selection.*junior engineer/.test(t)) return 'SSC JE';
  if (/rrb\s*je|je\s*\/\s*dms|dms|cma/.test(t)) return 'RRB JE';
  if (/gate/.test(t)) return 'GATE';
  if (/engineering services|\bese\b/.test(t)) return 'ESE';
  if (/upsc/.test(t)) return 'UPSC';
  return 'Government';
}

async function fetchSource(source) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source.timeoutMs || 3500);
    const r = await fetch(source.url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CivilCareerExamScanner/1.1; +https://civilcareer-india-two.vercel.app/)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-IN,en;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    const text = await r.text();
    // Protect the function from unexpectedly huge source responses.
    return { ...source, text: text.slice(0, 2_000_000), durationMs: Date.now() - started };
  } catch (error) {
    return { ...source, text: '', error: error.name === 'AbortError' ? 'Timed out' : error.message, durationMs: Date.now() - started };
  }
}

function relevant(item) {
  const hay = `${item.title} ${item.description}`;
  return CIVIL_KEYWORDS.test(hay) && (EXAM_CONTEXT.test(hay) || /engineering services|gate|ese|junior engineer|assistant engineer/i.test(hay));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isCron(req) && !requireOwner(req, res)) return;
  if (!SUPA || !KEY) return res.status(503).json({ error: 'Supabase server configuration is missing.' });

  const started = Date.now();
  // Use currently reachable official/primary government sources. The previous
  // Employment News RSS URL returned 404, and the previous UPSC/SSC URLs were
  // either obsolete or unnecessarily expensive to scrape.
  const sources = [
    { name: 'Employment News', url: 'https://employmentnews.gov.in/newemp/home.aspx', timeoutMs: 3200 },
    { name: 'UPSC Active Examinations', url: 'https://www.upsc.gov.in/examinations/active-exams', timeoutMs: 3200 },
    { name: 'SSC', url: 'https://ssc.gov.in/', timeoutMs: 3200 },
    { name: 'RRB Recruitment Notices', url: 'https://www.rrbcdg.gov.in/employment-notices.php', timeoutMs: 3200 },
  ];

  // All sources are independent. A slow source must never hold the others hostage.
  const fetched = await Promise.all(sources.map(fetchSource));
  const results = [];
  const all = [];

  for (const source of fetched) {
    let found = source.text ? sourceItems(source.text, source.type, source.url) : [];
    found = found.filter(relevant).slice(0, 50);
    all.push(...found.map(i => ({ ...i, source: source.name, sourceUrl: i.link || source.url })));
    results.push({
      name: source.name,
      found: found.length,
      saved: 0,
      error: source.error || null,
      durationMs: source.durationMs,
    });
  }

  const existingResponse = await db('exams?select=title_en&limit=5000', { timeoutMs: 3500 });
  if (!existingResponse.ok) {
    const detail = await existingResponse.text();
    return res.status(502).json({
      error: `Could not read existing exams (${existingResponse.status}).`,
      detail: detail.slice(0, 300),
      sources: results,
      durationMs: Date.now() - started,
    });
  }
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
    const r = await db('exams', { method: 'POST', body: JSON.stringify(payloads), timeoutMs: 3500 });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 500);
      return res.status(502).json({ error: detail || 'Could not save exam drafts.', sources: results, totalNew: 0, durationMs: Date.now() - started });
    }
    for (const row of results) row.saved = sourceCounts.get(row.name) || 0;
  }

  const failed = results.filter(x => x.error).length;
  return res.status(200).json({
    ok: true,
    partial: failed > 0,
    totalNew: payloads.length,
    durationMs: Date.now() - started,
    sources: results,
    message: failed ? `${failed} source${failed === 1 ? '' : 's'} failed; successful sources were still processed.` : 'All configured sources completed successfully.',
  });
};
