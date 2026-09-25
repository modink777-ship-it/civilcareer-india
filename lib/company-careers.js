/**
 * CivilCareer — Company career-page discovery
 *
 * Fetches vacancies directly from the CAREER PAGES of top Indian construction,
 * infrastructure, EPC and real-estate companies, so a vacancy published on a
 * company's own website reaches the admin Discovery queue even when it never
 * appears on LinkedIn/Naukri/Google.
 *
 * ── HOW A COMPANY'S CAREERS PAGE IS FOUND ──────────────────────────────
 * Career URLs are discovered, not guessed. Most companies answer `/careers`
 * with a 404 and host their vacancies on a subdomain or an ATS portal
 * (careers.<domain>, <company>careers.peoplestrong.com, Workday, Darwinbox…).
 * So for each company we:
 *
 *   1. fetch the company's own homepage and read its "Careers" / "Jobs" /
 *      "Join us" / "Work with us" links — following subdomains and ATS portals,
 *      while ignoring job aggregators and social networks;
 *   2. fetch those career URLs (plus an optional verified hint and the generic
 *      paths in CAREER_PATHS as a last resort), in parallel;
 *   3. read each page for vacancies.
 *
 * ── HOW A PAGE IS READ (in priority order) ─────────────────────────────
 *   1. schema.org JobPosting JSON-LD — the industry-standard structured block
 *      that Google for Jobs requires, so most ATS platforms emit it
 *      server-side. This is structured data, not guesswork.
 *   2. Job-detail anchors — links whose href looks like a job route
 *      (/job, /careers/job, /apply, /requisition…) and whose text names a civil
 *      or construction role.
 *
 * ── WHAT THIS MODULE NEVER DOES ────────────────────────────────────────
 *   • It never invents a URL, a company, a location or a posting date. A
 *     record without a real link is dropped; a record without a date is kept
 *     with an UNKNOWN date (never "today").
 *   • It never decides whether a record is a civil India vacancy — that stays
 *     with lib/discovery-core.js (classifyCivilRole + India eligibility).
 *   • It never fails the discovery run. A company timing out is one line in
 *     the per-company report.
 *
 * A raw item from here is only a CANDIDATE. api/jobs.js still applies the
 * civil-only gate, the India-only gate, the freshness gate and deduplication
 * before anything is stored as an unpublished draft.
 *
 * ── ADDING A COMPANY ───────────────────────────────────────────────────
 * Append one entry to COMPANIES. `domain` is required. `careers` is an
 * OPTIONAL hint for a URL that has been checked by hand — it is tried first
 * but homepage discovery usually finds the right page on its own.
 *
 * ── KNOWN LIMITATION (measured, not assumed) ────────────────────────────
 * Most large Indian employers render their vacancy list in JavaScript. A test
 * run over one batch reached most career pages but read zero vacancies from
 * them, because the served HTML contains no JobPosting block and no job links
 * — that list only exists after the page's own scripts run. L&T's careers
 * page, for instance, announces "1378 Jobs Open Now" from client-side code.
 *
 * So this track genuinely works for the companies whose career pages emit
 * server-side schema.org JobPosting data (many ATS portals do: Workday,
 * PeopleStrong, Darwinbox, Keka, Zoho Recruit, Lever, Greenhouse), and it
 * reports honestly, per company, when a page was reached but carried nothing
 * readable. Covering the JavaScript-rendered majority needs a real browser to
 * run those scripts — that is the natural next step for the CI runner, which
 * has a full Node environment and can install one. The per-company report in
 * Source Status shows exactly which companies produce vacancies and which do
 * not.
 */

'use strict';

const { cleanText, normalizeJobUrl, NON_CIVIL_REGEX } = require('./discovery-core');

/* Per-request timeout. The careers track runs in parallel with the other
 * discovery tracks, so the run costs max(tracks) rather than their sum. */
const STAGE_TIMEOUT_MS = 7000;

/* Soft budget for the three stages of one company. Stage 3 is skipped once
 * this is mostly spent, so a slow site cannot blow the function limit. */
const COMPANY_BUDGET_MS = 16000;

/* Companies processed per run. The list rotates across runs (see
 * companyBatchForRun) so every company is still checked regularly even though
 * a single 4-hourly run only touches a slice. */
const MAX_COMPANIES_PER_RUN = 12;

/* At most this many pages are fetched per company per stage. */
const MAX_PAGES_PER_STAGE = 4;

/* ─────────────────────────────────────────────────────────────────────
   THE COMPANY LIST — top Indian construction / infrastructure / EPC /
   real-estate / public-sector employers.
   ───────────────────────────────────────────────────────────────────── */
const COMPANIES = [
  // ── Large contractors & EPC majors ──
  { name: 'Larsen & Toubro', aliases: ['L&T', 'Larsen and Toubro'], domain: 'larsentoubro.com', careers: 'https://www.larsentoubro.com/careers' },
  { name: 'Tata Projects', aliases: ['Tata Projects Limited'], domain: 'tataprojects.com', careers: 'https://careers.tataprojects.com/' },
  { name: 'Shapoorji Pallonji', aliases: ['SP Group', 'Shapoorji Pallonji Group'], domain: 'shapoorjipallonji.com', careers: '' },
  { name: 'Afcons Infrastructure', aliases: ['Afcons'], domain: 'afcons.com', careers: '' },
  { name: 'NCC Limited', aliases: ['Nagarjuna Construction Company', 'NCC'], domain: 'ncclimited.com', careers: '' },
  { name: 'Hindustan Construction Company', aliases: ['HCC', 'HCC India'], domain: 'hccindia.com', careers: '' },
  { name: 'Megha Engineering & Infrastructures', aliases: ['MEIL', 'Megha Engineering'], domain: 'meil.in', careers: '' },
  { name: 'Kalpataru Projects International', aliases: ['JMC Projects', 'Kalpataru Power', 'KPIL'], domain: 'jmcprojects.com', careers: '' },
  { name: 'KEC International', aliases: ['KEC'], domain: 'kecinternational.com', careers: '' },
  { name: 'Simplex Infrastructures', aliases: ['Simplex'], domain: 'simplexinfra.com', careers: '' },

  // ── Roads, highways & transport infrastructure ──
  { name: 'IRB Infrastructure Developers', aliases: ['IRB', 'IRB Infra'], domain: 'irb.co.in', careers: '' },
  { name: 'Dilip Buildcon', aliases: ['DBL'], domain: 'dilipbuildcon.co.in', careers: '' },
  { name: 'Ashoka Buildcon', aliases: ['Ashoka'], domain: 'ashokabuildcon.com', careers: '' },
  { name: 'PNC Infratech', aliases: ['PNC'], domain: 'pncinfratech.com', careers: '' },
  { name: 'KNR Constructions', aliases: ['KNR'], domain: 'knrcl.com', careers: '' },
  { name: 'GR Infraprojects', aliases: ['GRIL', 'GR Infra'], domain: 'grinfra.com', careers: '' },
  { name: 'Gayatri Projects', aliases: ['Gayatri'], domain: 'gayatri.co.in', careers: '' },
  { name: 'BSCPL Infrastructure', aliases: ['BSCPL'], domain: 'bscpl.com', careers: '' },

  // ── Water, power, industrial & heavy civil ──
  { name: 'Patel Engineering', aliases: ['PEL'], domain: 'patelengineering.in', careers: '' },
  { name: 'Ramky Infrastructure', aliases: ['Ramky'], domain: 'ramky.com', careers: '' },
  { name: 'Power Mech Projects', aliases: ['PMPL', 'Power Mech'], domain: 'powermechprojects.com', careers: '' },
  { name: 'Adani Group', aliases: ['Adani', 'Adani Infra'], domain: 'adani.com', careers: '' },
  { name: 'Reliance Industries', aliases: ['RIL', 'Reliance Projects'], domain: 'ril.com', careers: 'https://careers.ril.com' },
  { name: 'GMR Group', aliases: ['GMR', 'GMR Infra'], domain: 'gmrgroup.in', careers: '' },

  // ── Real estate / building construction developers ──
  { name: 'Godrej Properties', aliases: ['Godrej'], domain: 'godrejproperties.com', careers: '' },
  { name: 'DLF', aliases: ['DLF Limited'], domain: 'dlf.in', careers: '' },
  { name: 'Macrotech Developers', aliases: ['Lodha', 'Lodha Group'], domain: 'lodhagroup.in', careers: '' },
  { name: 'Sobha Limited', aliases: ['Sobha'], domain: 'sobha.com', careers: '' },
  { name: 'Brigade Enterprises', aliases: ['Brigade Group', 'Brigade'], domain: 'brigadegroup.com', careers: '' },
  { name: 'Prestige Group', aliases: ['Prestige Estates'], domain: 'prestigegroup.com', careers: '' },

  // ── Public-sector infrastructure bodies ──
  { name: 'NBCC (India) Limited', aliases: ['NBCC', 'National Buildings Construction Corporation'], domain: 'nbccindia.in', careers: 'https://www.nbccindia.in/careers' },
  { name: 'IRCON International', aliases: ['IRCON'], domain: 'ircon.org', careers: '' },
  { name: 'Rail Vikas Nigam Limited', aliases: ['RVNL'], domain: 'rvnl.org', careers: '' },
  { name: 'Delhi Metro Rail Corporation', aliases: ['DMRC'], domain: 'delhimetrorail.com', careers: '' },
  { name: 'NHAI', aliases: ['National Highways Authority of India'], domain: 'nhai.gov.in', careers: '' },
  { name: 'CPWD', aliases: ['Central Public Works Department'], domain: 'cpwd.gov.in', careers: '' },
];

/* Generic paths probed ONLY when homepage discovery finds nothing. */
const CAREER_PATHS = ['/careers', '/careers/', '/en/careers', '/job-openings'];

/* Job aggregators and social networks are never a company's own careers page
 * — the board/news sources already cover them, and following one would just
 * duplicate those results. */
const AGGREGATOR_HOST = /(^|\.)(linkedin\.[a-z.]+|naukri\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|google\.[a-z.]+|bing\.com|wikipedia\.org|timesjobs\.com|shine\.com|foundit\.in|apna\.co|workindia\.in|freshersworld\.com|monster\.[a-z.]+|quikr\.com|olx\.[a-z.]+|ycombinator\.com|crunchbase\.com|ambitionbox\.com|glassdoor\.co\.[a-z.]+)$/i;

/* Anchor text / href that marks a careers landing page. */
const CAREER_LINK_TEXT = /(careers?|career opportunities|job openings?|current openings?|openings?|jobs?|vacanc|join us|join our team|work with us|work for us|life at|opportunit|recruit|apply now|apply here)/i;

/* Careers-links ranked first when several are found on a homepage. */
const CAREER_LINK_PRIMARY = /^\s*(careers?|jobs?|job openings?|current openings?|career opportunities|join us|join our team|work with us|work for us|life at [a-z ]+|openings?)\s*$/i;

/* Anchor text that is navigation chrome, never a job title. */
const NAV_LINK_TEXT = /^(careers?|jobs?|job openings?|current openings?|openings?|apply|apply now|apply here|view all|view more|see all|read more|learn more|more|search|search jobs|join us|join our team|work with us|life at|why join us|students|graduates|internships?|contact|contact us|about us|home|login|sign in|register|privacy policy|terms|cookie|sitemap|english|menu|close|next|previous|back|submit|upload resume|referral|alumni|faqs?|blog|news|media|investors?|suppliers?|vendors?)$/i;

/* A href that looks like a job-detail route (not a nav/filter link). */
const JOB_HREF = /(\/job[s]?\/|\/job-|\/careers?\/[^?#]*\/|\/apply\/|\/application|\/vacanc|\/opening|\/position|\/requisition|\/requirement|\/detail\/|\/jobs\/[A-Za-z0-9_-]{3,}|[?&](job|jobId|job_id|req|requisition|posting|career)[=_]|_[A-Z]{2,}\d{3,}|\d{5,})/i;

/* Light pre-filter so obviously non-civil anchors never become candidates.
 * A yank filter only — classifyCivilRole() stays the authoritative civil gate. */
const CIVIL_HINT = /\b(civil|construction|structural|site|project|planning|quantity|survey|billing|estimat|qa\/?qc|quality|bim|design|execution|highway|road|bridge|metro|rail|tunnel|water|irrigation|geotech|infra|engineer|engineerings?|supervisor|draughtsman|draftsman|architect)\b/i;

/* ── helpers ─────────────────────────────────────────────────────────── */

function absoluteUrl(href, baseUrl) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  if (/^(#|javascript:|mailto:|tel:|data:)/i.test(raw)) return '';
  try {
    const u = new URL(raw, baseUrl);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.toString();
  } catch (_) {
    return '';
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
}

function isAggregator(url) {
  return AGGREGATOR_HOST.test(hostOf(url));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/&hellip;/gi, '…');
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function anchors(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) out.push({ href: match[1], text: stripTags(match[2]) });
  return out;
}

/* ── careers-URL discovery from a homepage ───────────────────────────── */

/**
 * Find the company's own careers page from its homepage links.
 * Subdomains (careers.acme.com) and ATS portals are followed; job aggregators
 * and social networks are not.
 * @returns {string[]} best-first, de-duplicated absolute URLs
 */
function discoverCareersUrls(html, pageUrl) {
  const primary = [];
  const secondary = [];
  const seen = new Set();

  for (const { href, text } of anchors(html)) {
    const looksLikeCareer = CAREER_LINK_TEXT.test(text) || CAREER_LINK_TEXT.test(href.replace(/[-_/]/g, ' '));
    if (!looksLikeCareer) continue;

    const url = absoluteUrl(href, pageUrl);
    if (!url || isAggregator(url)) continue;

    const key = normalizeJobUrl(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);

    if (CAREER_LINK_PRIMARY.test(text)) primary.push(url);
    else secondary.push(url);
  }

  return [...primary, ...secondary];
}

/* ── JSON-LD JobPosting extraction ───────────────────────────────────── */

function collectJobPostings(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectJobPostings(child, out);
    return;
  }
  const type = node['@type'];
  const types = Array.isArray(type) ? type.map(String) : [String(type || '')];
  if (types.some(t => /^jobposting$/i.test(t))) out.push(node);

  for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasPart']) {
    if (node[key]) collectJobPostings(node[key], out);
  }
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const body = String(match[1] || '').trim();
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch (_) {
      // Some CMSs emit trailing commas or HTML comments inside the block.
      const cleaned = body.replace(/<!--[\s\S]*?-->/g, '').replace(/,\s*([}\]])/g, '$1').trim();
      try { blocks.push(JSON.parse(cleaned)); } catch (_e) { /* unparseable — skipped */ }
    }
  }
  return blocks;
}

function addressFromLocation(loc) {
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first) return { city: '', region: '', country: '', location: '' };
  if (typeof first === 'string') return { city: '', region: '', country: '', location: cleanText(first) };

  const addr = first.address || first;
  const city = cleanText(addr.addressLocality || addr.addressCity || '');
  const region = cleanText(addr.addressRegion || '');
  const countryRaw = addr.addressCountry || '';
  const country = typeof countryRaw === 'object' ? cleanText(countryRaw.name || '') : cleanText(countryRaw);
  const parts = [city, region, country].filter(Boolean);
  return { city, region, country, location: parts.join(', ') };
}

function salaryFromBase(base) {
  if (!base) return '';
  const value = base.value || base;
  const currency = cleanText(base.currency || value.currency || '');
  const min = value.minValue ?? value.value ?? '';
  const max = value.maxValue ?? '';
  const unit = cleanText(value.unitText || '');
  if (min === '' && max === '') return '';
  const range = max && String(max) !== String(min) ? `${min} - ${max}` : `${min}`;
  return cleanText([currency, range, unit].filter(Boolean).join(' '));
}

function itemFromJobPosting(job, company, pageUrl) {
  const title = cleanText(job.title || job.name || '');
  const href = absoluteUrl(
    job.url || (job.mainEntityOfPage && job.mainEntityOfPage['@id']) || (job.identifier && job.identifier.url) || '',
    pageUrl
  );
  if (!title || !href) return null;

  // Drop postings the employer already marked as expired.
  const validThrough = cleanText(job.validThrough || '');
  if (validThrough) {
    const ms = Date.parse(validThrough);
    if (Number.isFinite(ms) && ms < Date.now()) return null;
  }

  const where = addressFromLocation(job.jobLocation);
  const org = job.hiringOrganization;
  const orgName = cleanText((org && (org.name || org.legalName)) || company.name);

  return {
    title,
    link: href,
    description: cleanText(job.description || '').slice(0, 1500),
    pubDate: cleanText(job.datePosted || ''),
    source: `${company.name} careers page`,
    sourceLabel: `${company.name} — official careers page`,
    company: orgName || company.name,
    location: where.location,
    city: where.city,
    state: where.region,
    country: where.country,
    employment_type: cleanText(Array.isArray(job.employmentType) ? job.employmentType.join(', ') : job.employmentType || ''),
    salary: salaryFromBase(job.baseSalary),
    application_url: href,
    _sourceId: cleanText((job.identifier && (job.identifier.value || job.identifier)) || ''),
    _discoveryVia: 'jobposting-jsonld',
  };
}

/* ── Job-link heuristic ──────────────────────────────────────────────── */

function itemsFromJobLinks(html, company, pageUrl) {
  const items = [];
  const seen = new Set();
  const host = hostOf(pageUrl);

  for (const { href, text } of anchors(html)) {
    const url = absoluteUrl(href, pageUrl);
    if (!url) continue;

    // A company's own careers host only (careers.acme.com, or an ATS portal
    // the careers page linked to). Board/social links are handled elsewhere.
    if (isAggregator(url)) continue;

    if (!JOB_HREF.test(url)) continue;

    if (text.length < 4 || text.length > 140) continue;
    if (NAV_LINK_TEXT.test(text)) continue;
    if (!CIVIL_HINT.test(text)) continue;
    // Reuse the canonical non-civil vocabulary (software/sales/accounts/…) so
    // such an anchor never becomes a candidate. classifyCivilRole() still has
    // the final say on acceptance.
    if (NON_CIVIL_REGEX.test(text.toLowerCase())) continue;

    const key = normalizeJobUrl(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title: text,
      link: url,
      description: '',
      pubDate: '',                 // unknown — never guessed, never "today"
      source: `${company.name} careers page`,
      sourceLabel: `${company.name} — official careers page`,
      company: company.name,
      location: '',
      country: '',
      application_url: url,
      _discoveryVia: 'career-page-link',
      _pageHost: host,
    });
  }
  return items;
}

function readPage(html, company, pageUrl) {
  const postings = [];
  for (const block of jsonLdBlocks(html)) collectJobPostings(block, postings);

  const fromJsonLd = postings.map(job => itemFromJobPosting(job, company, pageUrl)).filter(Boolean);
  const fromLinks = itemsFromJobLinks(html, company, pageUrl);
  return { fromJsonLd, fromLinks };
}

/* ── Page fetching ───────────────────────────────────────────────────── */

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CivilCareerBot/1.0; +https://civilcareer-india-two.vercel.app)',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9',
    },
    signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers.get('content-type') || '');
  if (type && !/html|xml|text/i.test(type)) throw new Error(`content-type ${type.slice(0, 40)}`);
  return await res.text();
}

function reasonOf(reason) {
  return String((reason && reason.message) || reason).slice(0, 80);
}

/**
 * Read one company's career pages and return candidate vacancies.
 * Never throws: a failure becomes ok:false + error in the company report.
 *
 * Three bounded stages:
 *   1. the company's own homepage (+ a verified hint, if any)
 *   2. the careers URLs discovered in stage 1 — or, when nothing was
 *      discovered, the generic CAREER_PATHS
 *   3. the generic CAREER_PATHS, only if stages 1–2 found no vacancies yet
 *      and the time budget still allows it
 */
async function fetchCompany(company) {
  const startedAt = Date.now();
  const report = {
    company: company.name,
    domain: company.domain,
    ok: true,
    homepage: '',
    page: '',
    pagesRead: 0,
    discovered: [],
    items: 0,
    viaJsonLd: 0,
    viaLinks: 0,
    error: null,
  };

  const items = [];
  const errors = [];
  const tried = new Set();

  /** Fetch up to MAX_PAGES_PER_STAGE not-yet-tried URLs in parallel. */
  async function batch(urls) {
    const list = [];
    for (const url of urls) {
      if (!url || tried.has(url)) continue;
      tried.add(url);
      list.push(url);
      if (list.length >= MAX_PAGES_PER_STAGE) break;
    }
    if (!list.length) return [];

    const settled = await Promise.allSettled(list.map(url => fetchPage(url)));
    const pages = [];
    settled.forEach((result, i) => {
      if (result.status !== 'fulfilled') {
        errors.push(`${list[i]} (${reasonOf(result.reason)})`);
        return;
      }
      report.pagesRead += 1;
      pages.push({ url: list[i], html: result.value });
    });
    return pages;
  }

  function consume(pages) {
    for (const { url, html } of pages) {
      const { fromJsonLd, fromLinks } = readPage(html, company, url);
      if (fromJsonLd.length || fromLinks.length) {
        report.page = report.page || url;
        report.viaJsonLd += fromJsonLd.length;
        report.viaLinks += fromLinks.length;
        items.push(...fromJsonLd, ...fromLinks);
      }
    }
  }

  const genericUrls = () => CAREER_PATHS.map(p => `https://www.${company.domain}${p}`);

  // ── Stage 1: the company's own homepage (a verified hint rides along) ──
  const homeUrls = [`https://www.${company.domain}/`, `https://${company.domain}/`];
  const stage1 = await batch([...homeUrls, ...(company.careers ? [company.careers] : [])]);
  report.homepage = homeUrls.find(u => tried.has(u)) || '';
  consume(stage1);

  // Discover the real careers URLs from whatever stage 1 returned. The
  // homepage is the point, but a verified /careers hint often links straight
  // on to the company's ATS portal, so both are mined.
  const discovered = [];
  const discoveredSeen = new Set();
  for (const { url, html } of stage1) {
    for (const candidate of discoverCareersUrls(html, url)) {
      if (tried.has(candidate) || discoveredSeen.has(candidate)) continue;
      if (candidate === url) continue;
      discoveredSeen.add(candidate);
      discovered.push(candidate);
    }
  }
  report.discovered = discovered.slice(0, 3);

  // ── Stage 2: follow what was discovered, else guess the usual paths ──
  consume(await batch(discovered.length ? discovered : genericUrls()));

  // ── Stage 3: last-resort generic paths, budget permitting ──
  if (!items.length && Date.now() - startedAt < COMPANY_BUDGET_MS * 0.55) {
    consume(await batch(genericUrls()));
  }

  report.items = items.length;
  if (!items.length) {
    // Honest outcome: the pages answered but advertised nothing we could read.
    const reached = report.pagesRead > 0;
    report.ok = reached;
    report.error = reached
      ? 'careers page reached, no civil vacancy listed in readable form'
      : `unreachable: ${errors.slice(0, 2).join('; ') || 'no page answered'}`;
  }

  // De-duplicate across every page probed — a company often links the same
  // job from /careers and from its ATS portal.
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = normalizeJobUrl(item.link) || item.link;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return { report, items: unique };
}

/* ── Run rotation ────────────────────────────────────────────────────── */

/**
 * Pick which slice of the company list this run covers. Deterministic from the
 * clock, so no database state is needed and every company is still visited
 * regularly: company i is checked once every ceil(N / MAX_COMPANIES_PER_RUN)
 * runs — with 35 companies that is every 3rd run, i.e. every 12 hours.
 */
function companyBatchForRun(runBucket) {
  const batchCount = Math.max(1, Math.ceil(COMPANIES.length / MAX_COMPANIES_PER_RUN));
  const index = ((Number(runBucket) || 0) % batchCount + batchCount) % batchCount;
  const start = index * MAX_COMPANIES_PER_RUN;
  const slice = COMPANIES.slice(start, start + MAX_COMPANIES_PER_RUN);
  return {
    index,
    batchCount,
    companies: slice.length ? slice : COMPANIES.slice(0, MAX_COMPANIES_PER_RUN),
  };
}

/**
 * Discovery track: read this run's slice of company career pages.
 * Never throws — every failure is reported per company.
 * @returns {Promise<{jobs:Array, stat:Object}>}
 */
async function runCompanyCareerSources({ runBucket = 0 } = {}) {
  const { index, batchCount, companies } = companyBatchForRun(runBucket);

  const results = await Promise.allSettled(companies.map(fetchCompany));

  const jobs = [];
  const reports = [];
  let failed = 0;
  let withItems = 0;

  results.forEach((result, i) => {
    const company = companies[i];
    if (result.status !== 'fulfilled') {
      failed += 1;
      reports.push({
        company: company.name,
        domain: company.domain,
        ok: false,
        items: 0,
        error: reasonOf(result.reason),
      });
      return;
    }
    reports.push(result.value.report);
    if (result.value.items.length) withItems += 1;
    jobs.push(...result.value.items);
  });

  const stat = {
    name: `Company careers (batch ${index + 1}/${batchCount})`,
    configured: true,
    ok: failed < companies.length,
    items: jobs.length,
    companiesChecked: companies.length,
    companiesTotal: COMPANIES.length,
    companiesWithVacancies: withItems,
    companiesFailed: failed,
    accepted: 0,
    rejectedCivil: 0,
    rejectedIndia: 0,
    rejectedAge: 0,
    rejectedFuture: 0,
    rejectedDupe: 0,
    unknownDate: 0,
    error: failed === companies.length
      ? `all ${companies.length} career pages failed this run`
      : null,
    reports,
  };

  return {
    jobs: jobs.map(item => ({ ...item, _source: 'company_careers', _company: item.company || '' })),
    stat,
  };
}

module.exports = {
  COMPANIES,
  CAREER_PATHS,
  MAX_COMPANIES_PER_RUN,
  runCompanyCareerSources,

  companyBatchForRun,
  // exported for tests / diagnostics
  discoverCareersUrls,
  itemsFromJobLinks,
  itemFromJobPosting,
  jsonLdBlocks,
  collectJobPostings,
};
