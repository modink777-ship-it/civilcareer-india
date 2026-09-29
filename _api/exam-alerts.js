'use strict';

const { allowPublicCors } = require('../lib/security');

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
  /* STRICT: requires the standalone word "civil" (or an explicit civil role).
     Generic exam news ("Indian Army SSC Tech") is rejected. */
  return /\bcivil\b|junior engineer \(?civil|assistant engineer \(?civil|gate[ -]?ce\b/i.test(String(text || ''));
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
  'KPSC civil engineer recruitment Karnataka notification 2025',
  'BWSSB PWD Karnataka civil engineer recruitment 2025',
  'Karnataka NHAI junior engineer civil vacancy 2025',
];

function googleNewsUrl(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

// ── Additional aggregator RSS feeds ─────────────────────────────────────────

/* RSS + HTML portals. Every source is optional; failures are reported,
   never fatal. All items pass through buildExamPayload (strict civil
   gate + enrichment + dedupe) before insertion. */
const PORTALS = [
  { name: 'SarkariResult RSS', url: 'https://www.sarkariresult.com/feed/', kind: 'rss' },
  { name: 'GovtJobGuru Openings', url: 'https://govtjobguru.in/government-jobs-openings/', kind: 'html',
    re: 'govtjobguru\\.in/jobs/|\\.pdf($|\\?)|gov\\.in/|nic\\.in/' },
  { name: 'FreeJobAlert Latest', url: 'https://www.freejobalert.com/', kind: 'html', re: '/articles/' },
  { name: 'FreeJobAlert Govt Jobs', url: 'https://www.freejobalert.com/government-jobs/', kind: 'html', re: '/articles/' },
  { name: 'IndGovtJobs', url: 'https://www.indgovtjobs.in/2015/10/Government-Jobs.html', kind: 'html',
    re: 'indgovtjobs\\.in/\\d{4}/\\d{2}/' },
  { name: 'AllGovtJobs Latest', url: 'https://allgovernmentjobs.in/latest-government-jobs', kind: 'html',
    re: 'allgovernmentjobs\\.in/[a-z0-9][a-z0-9-]+/?$' },
  { name: 'SarkariNaukriOfficial', url: 'https://www.sarkarinaukariofficial.com/latest-jobs/', kind: 'html',
    re: 'sarkarinaukariofficial\\.com/[a-z0-9][a-z0-9-]+/?$' },
  { name: 'Adda247 Govt Jobs', url: 'https://www.adda247.com/jobs/', kind: 'html', re: 'adda247\.com/(jobs|job-notification)/', ex: "adda247\\.com/jobs/?$" },
];

// ── Main handler ─────────────────────────────────────────────────────────────

/* Insert an exam row, self-healing against schema drift: when PostgREST
   reports a missing column (PGRST204), drop it and retry so a scan still
   saves everything the table can actually store. */
const droppedExamColumns = new Set();

async function insertExam(payload) {
  /* Columns already proven missing are skipped up-front, so only the first
     item ever pays the retry cost. */
  let row = { ...payload };
  for (const col of droppedExamColumns) delete row[col];
  for (let attempt = 0; attempt < 5; attempt++) {
    const ins = await db('exams', { method: 'POST', body: JSON.stringify(row) });
    if (ins.ok) return { ok: true };
    const text = await ins.text();
    const m = /Could not find the '([^']+)' column/.exec(text);
    if (ins.status === 400 && m && row[m[1]] !== undefined) { droppedExamColumns.add(m[1]); delete row[m[1]]; continue; }
    return { ok: false, status: ins.status, text };
  }
  return { ok: false, status: 0, text: 'too many schema retries' };
}
// ── Draft enrichment: strict civil filter + auto-extracted fields ──────────

const AUTH_SITES = [
  [/\bupsc\b/i, 'UPSC', 'Union Public Service Commission', 'https://upsc.gov.in'],
  [/\bssc\b/i, 'SSC', 'Staff Selection Commission', 'https://ssc.gov.in'],
  [/\brrb\b|railway recruitment/i, 'RRB', 'Railway Recruitment Board', 'https://www.rrbcdg.gov.in'],
  [/\bkpsc\b|karnataka (?:public service|\bpsc\b)/i, 'KPSC', 'Karnataka Public Service Commission', 'https://kpsc.kar.nic.in'],
  [/\bbwssb\b/i, 'BWSSB', 'Bangalore Water Supply & Sewerage Board', 'https://bwssb.karnataka.gov.in'],
  [/karnataka\s+pwd|\bkpwd\b|pwd karnataka/i, 'PWD Karnataka', 'Karnataka Public Works Department', 'https://pwd.karnataka.gov.in'],
  [/\bnhai\b/i, 'NHAI', 'National Highways Authority of India', 'https://nhai.gov.in'],
  [/\bnhidcl\b/i, 'NHIDCL', 'National Highways & Infrastructure Development Corporation Ltd', 'https://nhidcl.com'],
  [/\bcpwd\b/i, 'CPWD', 'Central Public Works Department', 'https://cpwd.gov.in'],
  [/\btspsc\b/i, 'TSPSC', 'Telangana State Public Service Commission', 'https://websitetssc.gov.in'],
  [/\bappsc\b/i, 'APPSC', 'Andhra Pradesh Public Service Commission', 'https://psc.ap.gov.in'],
  [/\btnpsc\b/i, 'TNPSC', 'Tamil Nadu Public Service Commission', 'https://www.tnpsc.gov.in'],
  [/\bmpsc\b/i, 'MPSC', 'Maharashtra Public Service Commission', 'https://mpsc.gov.in'],
  [/\bgpsc\b/i, 'GPSC', 'Gujarat Public Service Commission', 'https://gpsc.gujarat.gov.in'],
  [/\brpsc\b/i, 'RPSC', 'Rajasthan Public Service Commission', 'https://rpsc.rajasthan.gov.in'],
  [/\bpsc\b/i, 'PSC', 'State Public Service Commission', null],
  [/\bcwc\b/i, 'CWC', 'Central Water Commission', 'https://cwc.gov.in'],
];

function normDdMmYyyy(s) {
  const m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(String(s || ''));
  if (!m) return null;
  let y = parseInt(m[3], 10); if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
  return (isNaN(d.getTime()) || d.getUTCFullYear() !== y) ? null : d.toISOString().slice(0, 10);
}

function buildExamPayload(item) {
  const rawText = `${item.title || ''} ${item.description || ''}`;
  /* STRICT civil-only: standalone word "civil" or an explicit civil role.
     Anything else (Army/Navy/general tech posts) is rejected. */
  if (!/\bcivil\b|junior engineer \(?civil|assistant engineer \(?civil|gate[ -]?ce\b/i.test(rawText)) return null;
  /* Title: strip trailing aggregator/site names the RSS feeds append. */
  let title = String(item.title || '').replace(/\s*[-–|]\s*(adda247|sarkari result|careers360|free job alert|jagran josh|testbook|oliveboard|sarkari exam|shiksha|collegedunia|pw ?live|study for civil|times of india|hindustan times|india today|ndtv|business standard|economic times|moneycontrol)\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (title.length > 255) title = title.slice(0, 252) + "…";
  const desc = String(item.description || title).replace(/\s+/g, ' ').trim().slice(0, 600);
  /* Jobs-only: articles (salary insights, trends, syllabus, analysis) never become drafts. */
  if (!isJobPosting(title + " " + desc)) return null;
  /* Authority / code / official website from known government bodies. */
  let code = null, authority = null, site = null;
  for (const [re, c, a, s] of AUTH_SITES) { if (re.test(rawText)) { code = c; authority = a; site = s; break; } }
  /* Vacancy count: "1,748 Posts", "350 Vacancies", "120 openings"… */
  let vacancy = null;
  const vm = /(\d[\d,]{0,7})[^\d.]{0,30}?\b(vacanc\w*|posts?|openings?|positions?)\b/i.exec(rawText);
  if (vm) { const n = parseInt(vm[1].replace(/,/g, ''), 10); if (n > 0 && n < 500000 && !(n >= 1900 && n <= 2100)) vacancy = n; }
  /* Dates: only accept a dd-mm-yyyy that follows a known context phrase. */
  const appEnd   = normDdMmYyyy((/(?:last date|closing date|apply (?:by|before))[^0-9]{0,40}(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.exec(rawText) || [])[1]);
  const appStart = normDdMmYyyy((/(?:apply online[^.]{0,40}(?:from|begins|starts)|application (?:start|begin)s?)[^0-9]{0,40}(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.exec(rawText) || [])[1]);
  const examDate = normDdMmYyyy((/(?:exam (?:date|on)|cbt[ -]?1)[^0-9]{0,40}(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.exec(rawText) || [])[1]);
  /* Post names: "Junior Engineer (Civil)", "AE Civil"… */
  const posts = [];
  const pre = /(?:junior|assistant|executive|deputy)\s+engineer\s*\(?\s*civil\s*\)?|\b[aj]e\s+civil\b|\bcivil\s+(?:engineer|assistant)\b/gi;
  let pm; while ((pm = pre.exec(rawText)) !== null && posts.length < 4) { const v = pm[0].replace(/\s+/g, " ").trim(); if (!posts.includes(v)) posts.push(v); }
  let notif = null;
  if (item.pubDate) { const d = new Date(item.pubDate); if (!isNaN(d.getTime())) notif = d.toISOString().slice(0, 10); }
  if (!notif) notif = new Date().toISOString().slice(0, 10);
  const link = String(item.link || '').trim();
  return {
    title_en: title,
    description_en: desc,
    code, authority,
    source_url: link || null,
    /* Google News links are aggregator redirects — never present them as the
       apply/official link. Only a mapped official site is offered. */
    official_website_url: site,
    apply_url: null,
    category: detectCategory(title + " " + desc),
    status: 'Open',
    published: false,
    review_state: 'Pending Review',
    notification_date: notif,
    application_start: appStart,
    application_end: appEnd,
    exam_date: examDate,
    vacancy_count: vacancy,
    post_names: posts.join(', ') || null,
    last_verified: new Date().toISOString().slice(0, 10),
    auto_discovered: true,
  };
}
// ── Portal harvesters ───────────────────────────────────────────────────────

async function fetchPortalHtml(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-IN,en;q=0.9',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/* Extract posting links from a listing page. Returns {title, link} pairs. */
function extractPortalLinks(html, portal) {
  const out = [];
  const seen = new Set();
  const rule = portal.re ? new RegExp(portal.re, "i") : null;
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    let href = m[1];
    const text = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (text.length < 20 || text.length > 220) continue;
    if (!/^https?:\/\//.test(href)) { try { href = new URL(href, portal.url).href; } catch (_) { continue; } }
    if (rule && !rule.test(href)) continue;
    if (portal.ex && new RegExp(portal.ex, "i").test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ title: text, description: text, link: href, pubDate: "" });
  }
  return out;
}
async function harvestPortal(portal) {
  const body = await fetchPortalHtml(portal.url);
  if (portal.kind === "rss") return parseRss(body);
  return extractPortalLinks(body, portal);
}

// ── Two-stage civil gate (free / safe / legal) ──────────────────────────────
/* Only public listing pages are read, once a day, with a polite UA and hard
   timeouts. We store the posting title, a short snippet and a link back to
   the source (attribution) — never bulk content. Detail pages are fetched
   within a small budget (so one scan stays inside the function time limit),
   same-host only for portal links, and PDFs are skipped. Everything lands as
   Pending Review: nothing is published without human approval. */
const detailBudget = { left: 30 };

function looksLikeRecruitment(txt) {
  return /recruitment|notification|vacanc|apply online|online form|bharti|\d+\s*(posts?|vacanc)/i.test(String(txt || ""));
}

async function fetchPageHtml(url, timeoutMs) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs || 8000),
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-IN,en;q=0.9',
    },
  });
  if (!r.ok) return null;
  if (!/text\/html/i.test(r.headers.get('content-type') || '')) return null;
  const html = await r.text();
  return { html, text: stripHtml(html).replace(/\s+/g, ' ').slice(0, 20000) };
}

async function fetchDetailIfSafe(url, portal) {
  if (detailBudget.left <= 0) return null;
  try {
    const u = new URL(url);
    const origin = new URL(portal.url);
    if (u.hostname !== origin.hostname) return null;   /* same-host only */
    if (/\.pdf($|\?)/i.test(u.pathname)) return null;  /* skip PDFs */
  } catch (_) { return null; }
  detailBudget.left--;
  try { return await fetchPageHtml(url, 8000); } catch (_) { return null; }
}

/* RSS links (Google News) redirect to the publisher, so the same-host rule
   does not apply — the redirect resolves inside fetch itself. */
async function fetchDetailForRss(url) {
  if (detailBudget.left <= 0) return null;
  try {
    if (/\.pdf($|\?)/i.test(new URL(url).pathname)) return null;
  } catch (_) { return null; }
  detailBudget.left--;
  try { return await fetchPageHtml(url, 9000); } catch (_) { return null; }
}

/* Merge detail-page fields into a payload WITHOUT clobbering values the
   title/snippet already produced. This is what fills the admin editor's
   overview / eligibility / age limit / pay scale / fee / dates / links
   instead of leaving them blank. Columns the table does not have are
   dropped later by insertExam's PGRST204 self-healing. */
function mergeDetailFields(row, f) {
  row.overview = row.overview || f.overview;
  row.eligibility_en = row.eligibility_en || f.eligibility_en;
  row.age_limit = row.age_limit || f.age_limit;
  row.pay_scale = row.pay_scale || f.pay_scale;
  row.application_fee = row.application_fee || f.application_fee;
  row.selection_process = row.selection_process || f.selection_process;
  row.how_to_apply = row.how_to_apply || f.how_to_apply;
  row.notification_pdf_url = row.notification_pdf_url || f.notification_pdf_url;
  row.official_notification_url = row.official_notification_url || f.notification_pdf_url;
  row.apply_url = row.apply_url || f.apply_url;
  row.application_start = row.application_start || f.application_start;
  row.application_end = row.application_end || f.application_end;
  row.exam_date = row.exam_date || f.exam_date;
  row.post_names = row.post_names || f.post_names;
  return row;
}

/* Pull structured fields out of a recruitment article page. */
function extractDetailFields(html, text) {
  const out = {};
  const grab = (labels, max) => {
    for (const lab of labels) {
      const i = text.toLowerCase().indexOf(lab.toLowerCase());
      if (i === -1) continue;
      const seg = text.slice(i + lab.length, i + lab.length + 600).replace(/^[\s:.;•\-–—]+/, '').trim();
      if (seg.length > 3) return seg.slice(0, max || 350);
    }
    return null;
  };
  out.overview = grab(['Job Overview', 'About the Recruitment', 'Overview', 'Introduction'], 700);
  out.eligibility_en = grab(['Educational Qualification', 'Eligibility Criteria', 'Eligibility'], 600);
  out.age_limit = grab(['Age Limit', 'Age as on'], 200);
  out.pay_scale = grab(['Pay Scale', 'Pay Matrix', 'Salary', 'Remuneration'], 200);
  out.application_fee = grab(['Application Fee', 'Exam Fee'], 200);
  out.selection_process = grab(['Selection Process', 'Selection Procedure'], 400);
  out.how_to_apply = grab(['How to Apply', 'Application Procedure'], 500);
  /* Dates: the same context-phrase rules used for RSS snippets, now over the
     full article text (snippets rarely carry dates). */
  const dd = '(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4})';
  out.application_end   = normDdMmYyyy((new RegExp('(?:last date|closing date|apply (?:by|before))[^0-9]{0,40}' + dd, 'i').exec(text) || [])[1]);
  out.application_start = normDdMmYyyy((new RegExp('(?:apply online[^.]{0,40}(?:from|begins|starts)|application (?:start|begin)s?)[^0-9]{0,40}' + dd, 'i').exec(text) || [])[1]);
  out.exam_date         = normDdMmYyyy((new RegExp('(?:exam (?:date|on)|cbt[ -]?1)[^0-9]{0,40}' + dd, 'i').exec(text) || [])[1]);
  /* Links: notification PDF vs official apply page (gov.in / nic.in). */
  out.notification_pdf_url = null;
  out.apply_url = null;
  let govHref = null;
  for (const hm of html.matchAll(/href="([^"]+)"/gi)) {
    const u = hm[1];
    const ul = u.toLowerCase();
    if (!out.notification_pdf_url && ul.includes('.pdf')) out.notification_pdf_url = u.slice(0, 500);
    if (!govHref && (ul.includes('gov.in') || ul.includes('nic.in')) && !ul.includes('.pdf')) govHref = u.slice(0, 500);
  }
  if (govHref) out.apply_url = govHref;
  return out;
}

/* Portal items: enrich from the posting's own detail page whenever the link
   is same-host (no SSRF). A strong title can pass the civil gate on its own
   — it still gets one detail fetch, which is what stops saved exams from
   having every field blank. Items that neither look like recruitment nor
   pass the civil gate never cost a fetch. */
async function buildCivilExamPayload(item, portal) {
  const preText = `${item.title || ''} ${item.description || ''}`;
  let built = buildExamPayload(item);            /* strict civil gate */
  const worthDetail = looksLikeRecruitment(preText);
  if (item.link && detailBudget.left > 0 && (built || worthDetail)) {
    const detail = await fetchDetailIfSafe(item.link, portal);
    if (detail) {
      const f = extractDetailFields(detail.html, detail.text);
      if (built) return mergeDetailFields(built, f);
      const civ = detail.text.toLowerCase().indexOf('civil');
      if (civ !== -1) {
        const ctx = detail.text.slice(Math.max(0, civ - 400), civ + 900);
        const enriched = {
          ...item,
          description: `${item.description || ''} ${f.overview || ctx}`.replace(/\s+/g, ' ').slice(0, 1200),
        };
        built = buildExamPayload(enriched);
        if (built) return mergeDetailFields(built, f);
      }
      return null;
    }
  }
  return built || null;
}

// ── Jobs-only gate + deep detail extraction ────────────────────────────────
const ARTICLE_RE = /salary|insight|trends?|highest[- ]pay|career options?|top \d+|best books|syllabus|cut ?off|answer key|exam (?:analysis|review)|preparation (?:tips|strategy)|rank predictor|results? (?:out|declared)/i;
const RECRUIT_RE = /recruitment|notification|vacanc|apply online|online form|application (?:start|begin|fee)|last date|bharti|\d+\s*(?:posts?|vacanc|openings?)/i;

function isJobPosting(text) {
  const s = String(text || '');
  return RECRUIT_RE.test(s) && !ARTICLE_RE.test(s);
}
function isJobPosting(text) {
  const s = String(text || "");
  return RECRUIT_RE.test(s) && !ARTICLE_RE.test(s);
}

function extractDetailFields(html, text) {
  const out = {};
  const grab = (labels, max) => {
    for (const lab of labels) {
      const i = text.toLowerCase().indexOf(lab.toLowerCase());
      if (i === -1) continue;
      const seg = text.slice(i + lab.length, i + lab.length + 600).replace(/^s*[:-]*s*/, "").trim();
      if (seg.length > 3) return seg.slice(0, max || 350);
    }
    return null;
  };
  out.overview = grab(["Job Overview", "About the Recruitment", "Overview"], 700) || text.slice(0, 400);
  out.eligibility_en = grab(["Eligibility", "Educational Qualification"], 600);
  out.age_limit = grab(["Age Limit", "Age as on"], 200);
  out.pay_scale = grab(["Pay Scale", "Salary", "Pay Matrix", "Remuneration"], 200);
  out.application_fee = grab(["Application Fee", "Exam Fee"], 200);
  out.selection_process = grab(["Selection Process", "Selection Procedure"], 400);
  out.how_to_apply = grab(["How to Apply", "Application Procedure"], 500);
  out.notification_pdf_url = null;
  out.apply_url = null;
  for (const hm of html.matchAll(/href="([^"]+)"/gi)) {
    const u = hm[1];
    const ul = u.toLowerCase();
    if (!out.notification_pdf_url && ul.includes(".pdf")) out.notification_pdf_url = u.slice(0, 500);
    if (!out.apply_url && (ul.includes("gov.in") || ul.includes("nic.in")) && !ul.includes(".pdf")) out.apply_url = u.slice(0, 500);
  }
  return out;
}

module.exports = async function handler(req, res) {
  allowPublicCors(req, res, { headers: 'Content-Type, x-owner-key' });
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

        /* Enrich from the linked article before saving — title alone is not
           enough; the admin editor kept showing blank detail fields. */
        let built = buildExamPayload(item);
        if (!built) continue;
        if (existingTitles.has(built.title_en.toLowerCase())) continue;
        if (item.link && detailBudget.left > 0) {
          const detail = await fetchDetailForRss(item.link);
          if (detail) built = mergeDetailFields(built, extractDetailFields(detail.html, detail.text));
        }
        const payload = built;

      try {
        const ins = await insertExam(payload);
        if (ins.ok) {
          existingTitles.add(payload.title_en.toLowerCase());
          gnewsResult.saved++;
          totalNew++;
        } else if (insertErrors.length < 5) {
          insertErrors.push({ item: payload.title_en.slice(0, 80), status: ins.status, detail: String(ins.text).slice(0, 300) });
        }
      } catch (err) { if (insertErrors.length < 5) insertErrors.push({ item: payload.title_en.slice(0, 80), detail: String(err.message).slice(0, 200) }); }
    }
  } catch (err) {
    gnewsResult.error = err.message;
  }
  sourceResults.push(gnewsResult);

  // ── 2. Additional RSS feeds ─────────────────────────────────────────────

  /* Portals run in parallel; inserts stay sequential inside each portal. */
  const portalResults = await Promise.all(PORTALS.map(async (portal) => {
    const result = { name: portal.name, found: 0, saved: 0, error: null };
    try {
      const items = await harvestPortal(portal);
      result.found = items.length;
      for (const item of items) {
        const built = await buildCivilExamPayload(item, portal);
        if (!built) continue;
        if (existingTitles.has(built.title_en.toLowerCase())) continue;
        const payload = built;

        try {
          const ins = await insertExam(payload);
          if (ins.ok) {
            existingTitles.add(payload.title_en.toLowerCase());
            result.saved++;
            totalNew++;
          } else if (insertErrors.length < 5) {
            insertErrors.push({ item: payload.title_en.slice(0, 80), status: ins.status, detail: String(ins.text).slice(0, 300) });
          }
        } catch (err) { if (insertErrors.length < 5) insertErrors.push({ item: payload.title_en.slice(0, 80), detail: String(err.message).slice(0, 200) }); }
      }
    } catch (err) {
      result.error = err.message;
    }
    return result;
  }));
  sourceResults.push(...portalResults);

  return res.status(200).json({
    ok: true,
    totalNew,
    durationMs: Date.now() - startedAt,
    sources: sourceResults,
    insertErrors,
  });
};
