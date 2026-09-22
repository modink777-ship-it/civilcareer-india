/**
 * CivilCareer — Jobs API v3
 * - Public GET: published jobs only
 * - Admin GET: all jobs
 * - Admin POST/PATCH/DELETE
 * - Handles empty optional date fields safely
 * - Uses Supabase service-role key on the server
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const SITE_URL = (
  process.env.SITE_URL ||
  'https://civilcareer-india-two.vercel.app'
).replace(/\/+$/, '');

const { runConfiguredSources } = require('../lib/discovery-sources');


// Phase 1 server-rendered job page helpers. Kept in jobs.js to stay within Vercel Hobby limits.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, max = 160) {
  const text = stripHtml(value);
  return text.length <= max
    ? text
    : `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function asArray(value) {
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}

    return value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }

  return [];
}

async function getJobBySlug(slug) {
  const response = await supa(
    `jobs?select=*&slug=eq.${encodeURIComponent(slug)}&published=eq.true&limit=1`
  );

  if (!response.ok) {
    throw new Error(`Supabase job lookup failed: ${response.status}`);
  }

  const rows = await response.json();
  return rows[0] || null;
}


function isExpired(job) {
  const value = job.valid_through || job.expires_at || job.deadline;
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time < Date.now();
}

async function getJobById(id) {
  const response = await supa(
    `jobs?select=*&id=eq.${encodeURIComponent(id)}&published=eq.true&limit=1`
  );

  if (!response.ok) {
    throw new Error(`Supabase job ID lookup failed: ${response.status}`);
  }

  const rows = await response.json();
  return rows[0] || null;
}

function buildJobPosting(job, canonical) {
  const locationText =
    job.location_display ||
    [job.city, job.district, job.state, job.country]
      .filter(Boolean)
      .join(', ') ||
    job.location ||
    '';

  const employer =
    job.company ||
    job.recruitment_authority ||
    'Employer';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.role || 'Civil Engineering Job',
    description:
      stripHtml(job.description) ||
      `Civil engineering opportunity at ${employer}.`,
    url: canonical,
    hiringOrganization: {
      '@type': 'Organization',
      name: employer,
    },
  };

  const datePosted =
    job.date_posted ||
    job.published_at ||
    job.posted_at ||
    job.created_at;

  if (datePosted) schema.datePosted = datePosted;

  const validThrough =
    job.valid_through ||
    job.expires_at ||
    job.deadline;

  if (validThrough) schema.validThrough = validThrough;

  if (job.company_url) {
    schema.hiringOrganization.sameAs = job.company_url;
  }

  if (locationText) {
    schema.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '',
        addressLocality: job.city || job.district || '',
        addressRegion: job.state || '',
        addressCountry: job.country || 'IN',
      },
    };
  }

  const employmentTypes = asArray(job.employment_types);
  if (employmentTypes.length === 1) {
    schema.employmentType = employmentTypes[0];
  } else if (job.employment_type) {
    schema.employmentType = job.employment_type;
  }

  if (job.salary_min || job.salary_max) {
    schema.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salary_currency || 'INR',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salary_min != null ? { minValue: job.salary_min } : {}),
        ...(job.salary_max != null ? { maxValue: job.salary_max } : {}),
        unitText: 'MONTH',
      },
    };
  }

  if (job.application_url) {
    schema.directApply = true;
  }

  const qualifications = asArray(job.qualifications);
  if (qualifications.length) {
    schema.qualifications = qualifications.join(', ');
  }

  return schema;
}

function jobSlug(job) {
  if (job.slug) return String(job.slug);

  const role = String(job.role || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${role || 'job'}-${job.id}`;
}

async function renderJobPage(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  if (!SUPA || !KEY) {
    return res.status(500).send('Server configuration is missing');
  }

  const slug = String(req.query?.slug || '').trim();

  if (!slug) {
    return res.status(400).send('Missing job slug');
  }

  try {
    let job = await getJobBySlug(slug);

    if (!job && /^[0-9a-f-]{36}$/i.test(slug)) {
      job = await getJobById(slug);
    }

    if (!job) {
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      return res.status(404).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>Job Not Found | CivilCareer</title>
</head>
<body>
<main>
<h1>Job not found</h1>
<p>This CivilCareer opportunity may have been removed or the link may be incorrect.</p>
<p><a href="${SITE_URL}/private-jobs">Browse Civil Engineering Jobs</a></p>
</main>
</body>
</html>`);
    }

    const actualSlug = jobSlug(job);
    const canonical = `${SITE_URL}/jobs/${encodeURIComponent(actualSlug)}`;

    const role = job.role || 'Civil Engineering Job';
    const company =
      job.company ||
      job.recruitment_authority ||
      'Employer';

    const location =
      job.location_display ||
      [job.city, job.district, job.state, job.country]
        .filter(Boolean)
        .join(', ') ||
      job.location ||
      '';

    const title = `${role} at ${company} | CivilCareer`;
    const expired = isExpired(job);
    const robotsDirective = expired ? 'noindex,follow' : 'index,follow';

    const description = truncate(
      job.description ||
      `${role} opportunity at ${company}${location ? ` in ${location}` : ''}. Find civil engineering career opportunities on CivilCareer.`
    );

    const postingSchema = buildJobPosting(job, canonical);

    const qualifications = asArray(job.qualifications);
    const employmentTypes = asArray(job.employment_types);
    const skills = asArray(job.skills);

    const responsibilities = stripHtml(job.responsibilities);

    const salary =
      job.salary ||
      (
        job.salary_min != null || job.salary_max != null
          ? `${job.salary_min ?? ''}${job.salary_min != null && job.salary_max != null ? ' - ' : ''}${job.salary_max ?? ''} ${job.salary_currency || 'INR'}`
          : ''
      );

    const postedDate =
      job.date_posted ||
      job.published_at ||
      job.posted_at ||
      job.created_at;

    const deadline =
      job.valid_through ||
      job.expires_at ||
      job.deadline;

    const applyUrl =
      job.application_url ||
      job.source_url ||
      '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    res.setHeader('X-Robots-Tag', robotsDirective);
    if (postedDate) {
      res.setHeader('Last-Modified', new Date(postedDate).toUTCString());
    }

    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${robotsDirective}">
<link rel="canonical" href="${escapeHtml(canonical)}">

<meta property="og:site_name" content="CivilCareer">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonical)}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">

<script type="application/ld+json">${JSON.stringify(postingSchema)}</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {'@type':'ListItem','position':1,'name':'Home','item':SITE_URL},
    {'@type':'ListItem','position':2,'name':'Civil Engineering Jobs','item':`${SITE_URL}/private-jobs`},
    {'@type':'ListItem','position':3,'name':role,'item':canonical}
  ]
})}</script>

<style>
  :root {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #172033;
    background: #f6f8fb;
  }
  body { margin: 0; }
  header {
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    padding: 16px 20px;
  }
  nav {
    max-width: 1000px;
    margin: 0 auto;
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  nav a {
    color: inherit;
    text-decoration: none;
    font-weight: 600;
  }
  main {
    max-width: 900px;
    margin: 0 auto;
    padding: 32px 20px 60px;
  }
  article {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 28px;
  }
  h1 { margin-top: 12px; line-height: 1.15; }
  h2 { margin-top: 28px; }
  .muted { color: #667085; }
  .apply {
    display: inline-block;
    padding: 12px 18px;
    border-radius: 10px;
    background: #111827;
    color: #fff;
    text-decoration: none;
    font-weight: 700;
  }
  footer {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 20px 40px;
    color: #667085;
  }
</style>
</head>

<body>
<header>
<nav>
  <a href="${SITE_URL}" aria-label="CivilCareer home">CivilCareer</a>
  <a href="${SITE_URL}/private-jobs">Civil Jobs</a>
  <a href="${SITE_URL}/government-jobs">Government Jobs</a>
  <a href="${SITE_URL}/exams">Exams</a>
  <a href="${SITE_URL}/study-materials">Study Materials</a>
</nav>
</header>

<main>
<article>

<p><a href="${SITE_URL}/private-jobs">← Back to Civil Engineering Jobs</a></p>

<p class="muted">CivilCareer / Job Opportunity</p>

<h1>${escapeHtml(role)}</h1>

<p><strong>${escapeHtml(company)}</strong>${location ? ` · ${escapeHtml(location)}` : ''}</p>

${postedDate ? `<p><strong>Posted:</strong> ${escapeHtml(formatDate(postedDate))}</p>` : ''}
${deadline ? `<p><strong>Application deadline:</strong> ${escapeHtml(formatDate(deadline))}</p>` : ''}
${job.status ? `<p><strong>Status:</strong> ${escapeHtml(job.status)}</p>` : ''}

${location ? `<section><h2>Location</h2><p>${escapeHtml(location)}</p></section>` : ''}

${salary ? `<section><h2>Salary</h2><p>${escapeHtml(salary)}</p></section>` : ''}

${employmentTypes.length || job.employment_type ? `
<section>
<h2>Employment type</h2>
<p>${escapeHtml(employmentTypes.length ? employmentTypes.join(', ') : job.employment_type)}</p>
</section>` : ''}

${qualifications.length ? `
<section>
<h2>Qualifications</h2>
<ul>${qualifications.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
</section>` : ''}

${skills.length ? `
<section>
<h2>Skills</h2>
<p>${escapeHtml(skills.join(', '))}</p>
</section>` : ''}

${job.description ? `
<section>
<h2>Job description</h2>
<p>${escapeHtml(stripHtml(job.description))}</p>
</section>` : ''}

${responsibilities ? `
<section>
<h2>Responsibilities</h2>
<p>${escapeHtml(responsibilities)}</p>
</section>` : ''}

<section>
<h2>Apply</h2>
${
  applyUrl
    ? `<p><a class="apply" href="${escapeHtml(applyUrl)}" target="_blank" rel="noopener noreferrer">Apply / View Official Source ↗</a></p>`
    : '<p>Check the official recruitment information before applying.</p>'
}
</section>

<hr>

<p><strong>Safety:</strong> CivilCareer does not charge candidates to apply for jobs. Always verify the employer and application instructions from the official source.</p>

</article>
</main>

<footer>
<p>© ${new Date().getFullYear()} CivilCareer</p>
</footer>
</body>
</html>`);
  } catch (error) {
    console.error('job-page error:', error);
    return res.status(500).send('Unable to load this job right now.');
  }

}


/* ─────────────────────────────────────────────────────────────────────
   CIVILCAREER — MULTI-SOURCE DISCOVERY ENGINE (source-specific validation)
   Shared pure logic lives in ../lib/discovery-core.js; configured providers
   in ../lib/discovery-sources.js. No additional Vercel function is created.
   ───────────────────────────────────────────────────────────────────── */

const {
  FRESH_24H_MS,
  BACKUP_30D_MS,
  FUTURE_TOL_MS,
  isNewsSource,
  isTrustedIndiaSource,
  cleanText: discoveryCleanText,
  normText: discoveryNormText,
  classifyCivilRole,
  newsVacancyCheck,
  extractStructuredLocation,
  resolveIndiaEligibility,
  classifyFreshness,
  formatAge: discoveryFormatAge,
  normalizeJobUrl,
  dedupeKey,
  newSourceStat,
  extractRole: discoveryRole,
  extractCompany: discoveryCompany,
  classifySector: discoverySector,
  buildNewsQueryPlan,
} = require('../lib/discovery-core');

const DISCOVERY_SITES = [
  'linkedin.com/jobs', 'naukri.com', 'indeed.com', 'foundit.in',
  'timesjobs.com', 'shine.com', 'apna.co', 'workindia.in',
  'freshersworld.com', 'gov.in', 'nic.in'
];

function decodeXml(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function cleanDiscoveryText(value) {
  return decodeXml(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}
function parseDiscoveryRss(xml) {
  const items=[];
  for (const block of String(xml||'').match(/<item>[\s\S]*?<\/item>/gi)||[]) {
    const get=tag=>{const m=block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?cleanDiscoveryText(m[1]):''};
    const title=get('title'), link=get('link'), description=get('description'), pubDate=get('pubDate'), source=get('source');
    if(title&&link) items.push({title,link,description,pubDate,source});
  }
  return items;
}
function discoverySourceHost(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}}

async function fetchText(url,headers={}){
  const r=await fetch(url,{headers:{'User-Agent':'CivilCareer public vacancy discovery/1.0','Accept':'application/rss+xml, application/json, text/xml, text/plain;q=0.9, */*',...headers},signal:AbortSignal.timeout(8000),redirect:'follow'});
  if(!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return await r.text();
}

// ── NEWS FETCHERS ──
// Google News / Bing News are NEWS sources, never job boards. Returned items
// pass through the strict news-vacancy gate + India evidence gate later.
async function discoveryFetchGoogleNews(queries){
  const list=(Array.isArray(queries)&&queries.length?queries:['civil engineer jobs India']).slice(0,6);
  const all=[];
  await Promise.allSettled(list.map(async q=>{
    const url=`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:3d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
    all.push(...parseDiscoveryRss(await fetchText(url)));
  }));
  return all.map(x=>({ ...x, source:'google_news' }));
}
async function discoveryFetchBingNews(queries){
  const list=(Array.isArray(queries)&&queries.length?queries:['civil engineer jobs India']).slice(0,4);
  const all=[];
  await Promise.allSettled(list.map(async q=>{
    const url=`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`;
    all.push(...parseDiscoveryRss(await fetchText(url)));
  }));
  return all.map(x=>({ ...x, source:'bing_news' }));
}

// ── JOB BOARD FETCHERS (structured job/location fields) ──
async function discoveryFetchJobicy(){
  // Jobicy is a remote-tech board; pull the engineering feed and let the
  // civil + location gates decide. jobGeo is preserved for validation.
  const url='https://jobicy.com/api/v2/remote-jobs?count=50&tag=engineering';
  const raw=JSON.parse(await fetchText(url,{'Accept':'application/json'}));
  return (raw.jobs||[]).map(j=>({
    title:j.jobTitle||'',link:j.url||'',
    description:discoveryCleanText(j.jobExcerpt||j.jobDescription||''),
    pubDate:j.pubDate||'',source:'jobicy',company:j.companyName||'',
    location:j.jobGeo||''
  }));
}
async function discoveryFetchArbeitnow(){
  const raw=JSON.parse(await fetchText('https://www.arbeitnow.com/api/job-board-api',{'Accept':'application/json'}));
  return (raw.data||[]).map(j=>({
    title:j.title||'',link:j.url||'',description:discoveryCleanText(j.description||''),
    pubDate:j.created_at?new Date(j.created_at*1000).toISOString():(j.created_at||''),
    source:'arbeitnow',company:j.company_name||j.company||'',location:j.location||''
  }));
}
// OnJob documents itself as India's AI job search platform with a public
// crawlable feed (https://onjob.io/for-job-boards/) — India-specific source.
async function discoveryFetchOnJob(){
  const raw=JSON.parse(await fetchText('https://onjob.io/feeds/jobs.json',{'Accept':'application/json'}));
  const rows=Array.isArray(raw)?raw:(raw.jobs||raw.data||[]);
  return rows.map(j=>({
    title:j.title||'',link:j.url||'',
    description:discoveryCleanText(j.descriptionHtml||j.description||''),
    pubDate:j.datePosted||j.published_at||j.createdAt||'',
    source:'onjob',company:j.company||j.companyName||'',
    location:j.location||'',city:j.city||'',state:j.state||'',country:j.country||'India',
    application_url:j.applyUrl||j.application_url||''
  }));
}

// ── HOPIN ADAPTER ──
// Verified against the live API (2026-09):
//   GET https://api.hopinjobs.com/api/jobs                  → {"jobs":[]} (official collection)
//   GET https://api.hopinjobs.com/api/jobs?is_unofficial=true → {"jobs":[...]} live corpus
//   GET https://api.hopinjobs.com/api/jobs/{id}             → {"job":{...}} DOCUMENTED route
// List records carry: id, company, title, description, location (e.g.
// "Remote, India"), posted_at, apply_url (sometimes), work_type. Records may
// have an id but NO URL — the per-id route above is real, so the source record
// URL is that route. An application_url is only ever set from apply_url /
// application_url present in the payload — never invented.
async function discoveryFetchHopin(query, requestedLocation) {
  const urls = [
    'https://api.hopinjobs.com/api/jobs',
    'https://api.hopinjobs.com/api/jobs?is_unofficial=true',
  ];

  const payloads = [];
  for (const url of urls) {
    try {
      payloads.push(JSON.parse(await fetchText(url, { 'Accept': 'application/json' })));
    } catch (err) {
      payloads.push(null); // one collection may fail while the other works
    }
  }
  if (!payloads.some(Boolean)) {
    throw new Error('Hopin API error: both public job collections failed');
  }

  let jobsArray = [];
  for (const raw of payloads) {
    if (Array.isArray(raw)) jobsArray.push(...raw);
    else if (raw && typeof raw === 'object') {
      const rows = Array.isArray(raw.jobs)    ? raw.jobs
                 : Array.isArray(raw.data)    ? raw.data
                 : Array.isArray(raw.results) ? raw.results
                 : Array.isArray(raw.items)   ? raw.items
                 : [];
      jobsArray.push(...rows);
    }
  }

  const normalized = [];
  const seenIds = new Set();
  for (const j of jobsArray) {
    if (!j || typeof j !== 'object') continue;
    const sourceId = j.id ? String(j.id) : '';
    if (sourceId && seenIds.has(sourceId)) continue;
    if (sourceId) seenIds.add(sourceId);

    const title = discoveryCleanText(j.title || j.job_title || j.position || j.name || '');
    if (!title) continue;

    const company = discoveryCleanText(
      typeof j.company === 'object' ? ((j.company && (j.company.name || j.company.title)) || '')
        : (j.company || j.company_name || j.employer || j.organisation || '')
    );

    // Real URL only: explicit URLs win; otherwise the DOCUMENTED per-id API
    // route (verified live) — never an invented web page.
    const link = j.url || j.job_url || j.link || j.source_url ||
      (sourceId ? `https://api.hopinjobs.com/api/jobs/${encodeURIComponent(sourceId)}` : '');
    if (!link) continue;

    const description = discoveryCleanText(
      [j.description, j.summary, j.excerpt, j.body, j.role_type, j.industry]
        .filter(Boolean).join(' — ')
    );

    const city    = discoveryCleanText(j.city || j.town || '');
    const state   = discoveryCleanText(j.state || j.region || '');
    const country = discoveryCleanText(j.country || j.country_code || '');
    const locationText = discoveryCleanText(
      j.location || j.location_display || j.place ||
      [city, state, country].filter(Boolean).join(', ') || ''
    );

    const pubDate = j.posted_at || j.published_at || j.created_at || j.date_posted
                  || j.posted_at || j.post_date || j.pubDate || '';

    // Application URL: use ONLY what Hopin itself provides (apply_url /
    // application_url on the record). Otherwise leave blank — no fabrication.
    const application_url = j.apply_url || j.application_url || '';

    normalized.push({
      title,
      link,
      description,
      pubDate,
      source: 'hopin',
      company,
      location: locationText,
      country,
      state,
      city,
      application_url,
      _sourceId: sourceId,
      experience: j.experience || j.experience_level || '',
      employment_type: j.work_type || j.job_type || j.employment_type || '',
    });
  }

  return normalized;
}

// ── SINGLE-ITEM VALIDATION PIPELINE ──
// Returns { item } when accepted or { reject: {reason} } when rejected.
// Source class drives the validation profile:
//   news            → strict news-vacancy gate + record-level India evidence
//   job board       → structured location validation (no invented India)
//   India-specific  → trusted source-level India, foreign still rejected
function pipelineValidateItem(item, nowMs) {
  const src = String(item._source || item.source || '').toLowerCase();
  const title = discoveryCleanText(item.title || '');
  const snippet = discoveryCleanText(item.description || item.snippet || '');
  const url = item.link || item.url || '';

  if (!title) return { reject: { reason: 'empty title' } };
  if (!url) return { reject: { reason: 'no URL in record (never fabricated)' } };

  // 1. NEWS GATE (strict): news articles must be genuine vacancy adverts.
  //    Runs before everything else — a news article that is not advertising a
  //    vacancy is never a job, whatever its terminology.
  if (isNewsSource(src)) {
    const nv = newsVacancyCheck(title, snippet);
    if (!nv.isVacancy) return { reject: { reason: `news: ${nv.reason}` } };
  }

  // 2. Civil/construction role gate
  const civil = classifyCivilRole(title, snippet);
  if (!civil.accept) return { reject: { reason: `civil: ${civil.reason}` } };

  // 3. India eligibility — evidence from the record only, per source class
  const structured = extractStructuredLocation(item);
  const india = resolveIndiaEligibility(structured, title, snippet, src);
  if (!india.eligible) return { reject: { reason: `india: ${india.reason}` } };

  // 4. Freshness — exact milliseconds, never rounded before classification
  const fresh = classifyFreshness(item.pubDate || item.published_at || item.posted_at, nowMs);
  if (fresh.bucket === 'too_old') return { reject: { reason: 'age: older than 30 days' } };
  if (fresh.bucket === 'future') return { reject: { reason: 'age: date too far in the future' } };

  return {
    item: {
      title,
      url,
      snippet: snippet.slice(0, 800),
      pubDate: String(item.pubDate || item.published_at || item.posted_at || ''),
      postedIso: fresh.postedIso,
      source: src || discoverySourceHost(url) || 'Public web',
      company: discoveryCleanText(item.company || ''),
      location: structured.rawLocation,
      country: structured.country,
      state: structured.state,
      city: structured.city,
      application_url: discoveryCleanText(item.application_url || item.apply_url || ''),
      ageMs: fresh.ageMs,
      ageHours: fresh.ageMs === null ? null : fresh.ageMs / 3600000,
      ageDisplay: fresh.ageMs === null ? null : discoveryFormatAge(fresh.ageMs),
      dateIsArticleDate: isNewsSource(src),
      _sourceId: String(item._sourceId || ''),
    },
    bucket: fresh.bucket,
  };
}

async function runPublicDiscovery({q, location, type} = {}) {
  const requestedLocation = discoveryCleanText(location || 'India');
  const query             = discoveryCleanText(q || 'civil engineering jobs India');
  const sourceStats       = {};
  const nowMs             = Date.now();
  const all               = [];

  // News query plan: exact role+India queries (news evidence is item-level,
  // so queries carry the terms while validation never trusts them alone).
  const newsPlan = buildNewsQueryPlan(query, requestedLocation);

  // Public sources — always run; one failure does not stop others
  const publicSources = [
    ['google_news', () => discoveryFetchGoogleNews(newsPlan)],
    ['bing_news',   () => discoveryFetchBingNews(newsPlan)],
    ['jobicy',      () => discoveryFetchJobicy()],
    ['arbeitnow',   () => discoveryFetchArbeitnow()],
    ['onjob',       () => discoveryFetchOnJob()],
    ['hopin',       () => discoveryFetchHopin(query, requestedLocation)],
  ];

  const publicResults = await Promise.allSettled(publicSources.map(([, fn]) => fn()));
  publicResults.forEach((result, i) => {
    const name = publicSources[i][0];
    if (result.status === 'fulfilled') {
      const rows = Array.isArray(result.value) ? result.value : [];
      sourceStats[name] = { ...newSourceStat(name, true), items: rows.length };
      all.push(...rows.map(x => ({ ...x, _source: name })));
    } else {
      sourceStats[name] = {
        ...newSourceStat(name, true),
        ok: false,
        items: 0,
        error: String(result.reason?.message || result.reason),
      };
    }
  });

  // Configured providers (SerpApi / Adzuna / The Muse / Jobvetta) — attempted
  // only when their keys exist; a missing key never fails the run. Provider
  // stats merge into sourceStats under their provider keys so the dashboard
  // can see every track (items accepted/rejected per provider).
  try {
    const configured = await runConfiguredSources({ q: query, location: requestedLocation });
    const cfgJobs = Array.isArray(configured.jobs) ? configured.jobs : [];
    for (const [key, cs] of Object.entries(configured.stats || {})) {
      sourceStats[key] = cs;
    }
    all.push(...cfgJobs);
  } catch (err) {
    sourceStats.configured_sources = {
      ...newSourceStat('configured_sources', false),
      ok: false,
      error: String(err?.message || err),
    };
  }

  // ── VALIDATE + CLASSIFY (per source stats) ──
  const seen       = new Set();
  const fresh24h   = [];   // exact ageMs <= 24 h
  const backup30d  = [];   // exact 24 h < ageMs <= 30 d
  const unknownDate = [];  // unparseable/missing date — tracked, not silently "today"

  for (const item of all) {
    const src = String(item._source || item.source || 'unknown').toLowerCase();
    const st = sourceStats[src];
    const outcome = pipelineValidateItem(item, nowMs);

    if (outcome.reject) {
      if (st) {
        const reason = String(outcome.reject.reason || '');
        if (reason.startsWith('news:')) st.rejectedNews = (st.rejectedNews || 0) + 1;
        else if (reason.startsWith('civil:')) st.rejectedCivil += 1;
        else if (reason.startsWith('india:')) st.rejectedIndia += 1;
        else if (reason.startsWith('age:')) st.rejectedAge += 1;
        else st.rejectedOther = (st.rejectedOther || 0) + 1;
      }
      continue;
    }

    const n = outcome.item;

    // Deduplication: normalized URL + normalized title (never invented URLs)
    const key = dedupeKey(n.url, n.title);
    if (key && seen.has(key)) {
      if (st) st.rejectedDupe += 1;
      continue;
    }
    if (key) seen.add(key);

    if (st) st.accepted += 1;

    // Freshness buckets use exact ms; unknown dates are NOT treated as today
    if (outcome.bucket === 'unknown') {
      if (st) st.unknownDate += 1;
      unknownDate.push(n);
    } else if (outcome.bucket === 'fresh24h') {
      fresh24h.push(n);
    } else {
      backup30d.push(n);
    }
  }

  // Sort newest-first by exact ageMs (unknown dates last, never "now")
  const byAge = (a, b) => (a.ageMs ?? Infinity) - (b.ageMs ?? Infinity);
  fresh24h.sort(byAge);
  backup30d.sort(byAge);

  // Candidates = fresh24h first, then backup30d, then unknown-date records.
  // Unknown dates are excluded from the fresh24h/backup30d counts and get tier
  // "unknown", but are still queued as drafts for admin review.
  const candidates = [...fresh24h, ...backup30d, ...unknownDate];

  const typeFiltered = candidates.filter(x => {
    if (!type || type === 'all') return true;
    const sector = discoverySector(`${x.title} ${x.snippet}`);
    if (type === 'government') return sector === 'Government';
    if (type === 'private')    return sector === 'Private';
    if (type === 'mnc')        return /mnc|multinational|large employer|corporation|ltd|limited|pvt|private/i.test(`${x.company} ${x.snippet}`);
    return true;
  });

  const limited = typeFiltered.slice(0, 80);

  // Dedup against existing Supabase jobs (normalized URL or role+company)
  const existingResponse = await supa('jobs?select=id,source_url,role,company,created_at');
  if (!existingResponse.ok) {
    const err = new Error(`Supabase job lookup failed: ${existingResponse.status}`);
    err.sourceStats = sourceStats;
    throw err;
  }
  const existingRows   = await existingResponse.json();
  const existingUrls = new Set(
    existingRows.map(r => normalizeJobUrl(r.source_url)).filter(Boolean)
  );
  const existingApplications = new Set(
    existingRows.map(r => normalizeJobUrl(r.application_url)).filter(Boolean)
  );
  const existingIdentities = new Set(
    existingRows.map(r => {
      const role = discoveryNormText(discoveryRole(r.role));
      const company = discoveryNormText(r.company || '');
      const location = discoveryNormText(
        r.location_display ||
        [r.city, r.state, r.country].filter(Boolean).join(', ') ||
        r.location || ''
      );
      return `${role}|${company}|${location}`;
    })
  );

  const now = new Date().toISOString();
  const fresh = limited.filter(x => {
    const company = x.company || discoveryCompany(x.title, x.snippet);
    const urlKey = normalizeJobUrl(x.url);
    const applyKey = normalizeJobUrl(x.application_url);
    const roleKey = discoveryNormText(discoveryRole(x.title));
    const companyKey = discoveryNormText(company);
    const locationKey = discoveryNormText(x.location || '');
    const identityKey = `${roleKey}|${companyKey}|${locationKey}`;

    if (urlKey && (existingUrls.has(urlKey) || existingApplications.has(urlKey))) return false;
    if (applyKey && (existingUrls.has(applyKey) || existingApplications.has(applyKey))) return false;
    if (identityKey !== '||' && existingIdentities.has(identityKey)) return false;

    return true;
  });

  const drafts = fresh.slice(0, 40).map((item, index) => {
    const role    = discoveryRole(item.title);
    const company = item.company || discoveryCompany(item.title, item.snippet);
    // Full ISO timestamp when known; unknown-date drafts keep NULL (never "today")
    const posted  = item.postedIso || '';
    return {
      source_url:          item.url,
      role,
      role_normalized:     role,
      company:             company || null,
      location:            item.location || '',
      location_display:    item.location || '',
      country:             'India',
      description:         item.snippet || `Vacancy discovered from ${item.source}. Verify the original source before publishing.`,
      sector:              discoverySector(`${item.title} ${item.snippet}`),
      date_posted:         posted ? posted.slice(0, 10) : null,
      posted_at:           posted || null,
      source:              `Multi-source discovery — ${item.source}`,
      source_domain:       discoverySourceHost(item.url),
      status:              'Draft',
      published:           false,
      review_state:        'Draft',
      verification_status: 'Pending',
      created_at:          now,
      updated_at:          now,
      application_url:     item.application_url || item.url,
      slug:                makeSlug(role, company || 'civilcareer', `${Date.now()}-${index}`),
    };
  });

  let inserted = [];
  let persistenceWarning = '';
  if (drafts.length) {
    let write = await supa('jobs', {
      method:  'POST',
      body:    JSON.stringify(drafts),
      headers: { Prefer: 'return=representation' },
    });
    if (!write.ok) {
      const detail = await write.text();
      const minimal = drafts.map(d => ({
        source_url:   d.source_url,
        role:         d.role,
        role_normalized: d.role_normalized,
        company:      d.company,
        location:     d.location,
        location_display: d.location_display,
        country:      d.country,
        description:  d.description,
        date_posted:  d.date_posted,
        source:       d.source,
        published:    false,
        created_at:   d.created_at,
        application_url: d.application_url,
        slug:         d.slug,
      }));
      write = await supa('jobs', {
        method:  'POST',
        body:    JSON.stringify(minimal),
        headers: { Prefer: 'return=representation' },
      });
      if (!write.ok) {
        const detail2 = await write.text();
        const err = new Error(`Supabase discovery insert failed: ${(detail2 || detail).slice(0, 700)}`);
        err.sourceStats = sourceStats;
        throw err;
      }
      persistenceWarning = 'Discovery used the compatibility draft schema because some optional job columns are not present in the current database.';
    }
    inserted = await write.json();
  }

  // Freshness counts are computed from THE SAME inserted draft rows that are
  // returned below — UI counts always match the review queue exactly.
  const insertedFresh24hCount = inserted.filter(j => {
    const d = j.posted_at || j.date_posted || '';
    const ms = d ? Date.parse(d) : NaN;
    return Number.isFinite(ms) && (nowMs - ms) <= FRESH_24H_MS;
  }).length;
  const insertedBackup30dCount = inserted.filter(j => {
    const d = j.posted_at || j.date_posted || '';
    const ms = d ? Date.parse(d) : NaN;
    const age = Number.isFinite(ms) ? nowMs - ms : NaN;
    return Number.isFinite(age) && age > FRESH_24H_MS && age <= BACKUP_30D_MS;
  }).length;
  const insertedUnknownDateCount = inserted.length - insertedFresh24hCount - insertedBackup30dCount;

  return {
    count:                inserted.length,
    drafts:               inserted,
    results:              inserted.map(j => {
      // Age is recalculated from the SAVED timestamp for accurate display
      const dateStr = j.posted_at || j.date_posted || '';
      const dateMs  = dateStr ? Date.parse(dateStr) : NaN;
      const ageMs   = Number.isFinite(dateMs) ? nowMs - dateMs : null;
      const tier    = ageMs === null ? 'unknown'
                    : ageMs <= FRESH_24H_MS ? 'fresh24h' : 'backup30d';
      return {
        id:            j.id,
        title:         j.role,
        company:       j.company || '',
        location:      j.location_display || j.location || '',
        url:           j.source_url,
        applicationUrl:j.application_url || j.source_url || '',
        snippet:       (j.description || '').slice(0, 400),
        source:        j.source || '',
        sourceDomain:  j.source_domain || '',
        postedAt:      j.date_posted   || '',
        postedAtIso:   j.posted_at     || '',
        postedAtRaw:   dateStr,
        ageDisplay:    ageMs !== null ? discoveryFormatAge(ageMs) : null,
        ageHours:      ageMs === null ? null : ageMs / 3600000,
        tier,
        freshness:     tier,
        dateIsArticleDate: /news/i.test(String(j.source || '')),
        score:         100,
      };
    }),
    // Freshness breakdown — computed from the same rows shown in the queue
    fresh24hCount:        insertedFresh24hCount,
    fresh24hCandidates:   insertedFresh24hCount,
    backup30dCount:       insertedBackup30dCount,
    backup30dCandidates:  insertedBackup30dCount,
    unknownDateCount:     insertedUnknownDateCount,
    unknownDateCandidates: insertedUnknownDateCount,
    olderCandidates:      Math.max(0, candidates.length - typeFiltered.length),
    // Legacy: kept for backward compat — pre-dedup accepted candidates
    candidates:           candidates.length,
    typeFilteredCandidates: typeFiltered.length,
    scanned:              limited.length,
    skippedExisting:      Math.max(0, limited.length - fresh.length),
    sourceStats,
    configuredSources:    Object.entries(sourceStats)
      .filter(([key, x]) => x.configured && !['google_news','bing_news','jobicy','arbeitnow','onjob','hopin'].includes(key))
      .map(([key]) => key),
    runAt:                now,
    persistenceWarning,
    note: 'Source-specific validation: news = strict vacancy+India evidence; job boards = structured location checks; Hopin/OnJob = trusted India sources (foreign records still rejected). fresh24h <= 24h and backup30d 24h-30d use exact ms with no rounding; unknown dates are excluded from both queues and never defaulted to today. Application URLs are only used when the source itself provides them (Hopin apply_url or its documented per-id API route); no URL is ever fabricated and no India location is inferred from the search query.',
  };
}

function supa(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey:         KEY,
      Authorization:  `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function getKey(req) {
  return req.headers['x-owner-key'] || '';
}

function isAdmin(req) {
  return getKey(req) === process.env.OWNER_KEY;
}

function cleanDates(obj) {
  const dateFields = [
    'application_start','deadline','posted_at','published_at',
    'expires_at','last_verified','last_verified_at','updated_at','created_at',
  ];
  for (const field of dateFields) {
    if (obj[field] === '') obj[field] = null;
  }
  return obj;
}

function cleanArrays(obj) {
  const arrayFields = [
    'skills','qualifications','employment_types',
    'experience_ranges','application_emails','locations',
  ];
  for (const field of arrayFields) {
    if (obj[field] === '') obj[field] = [];
    if (typeof obj[field] === 'string') {
      try {
        const parsed = JSON.parse(obj[field]);
        if (Array.isArray(parsed)) obj[field] = parsed;
      } catch (e) {}
    }
  }
  return obj;
}

function makeSlug(role, company, id) {
  const base = `${role || 'job'}-${company || 'company'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${base || 'job'}-${id || Date.now()}`;
}


// ── PRECISE JOB DUPLICATE IDENTITY ───────────────────────────────────
// Same link OR same title+company+location = existing vacancy.
// Same company with a different title is allowed.
function duplicateNorm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function duplicateUrl(value) {
  return normalizeJobUrl(String(value || '').trim());
}
function jobIdentityKey(job) {
  const role = duplicateNorm(job.role || job.title || '');
  const company = duplicateNorm(job.company || '');
  const location = duplicateNorm(
    job.location_display ||
    [job.city, job.state, job.country].filter(Boolean).join(', ') ||
    job.location || ''
  );
  return `${role}|${company}|${location}`;
}
async function findExistingJobForCreate(job) {
  const r = await supa(
    'jobs?select=id,role,company,location,location_display,city,state,country,source_url,application_url&limit=10000'
  );
  if (!r.ok) throw new Error(`Existing-job check failed: ${r.status}`);
  const rows = await r.json();
  const incomingSource = duplicateUrl(job.source_url);
  const incomingApply = duplicateUrl(job.application_url);
  const incomingIdentity = jobIdentityKey(job);

  for (const existing of rows) {
    const existingSource = duplicateUrl(existing.source_url);
    const existingApply = duplicateUrl(existing.application_url);

    if (
      (incomingSource && existingSource && incomingSource === existingSource) ||
      (incomingApply && existingApply && incomingApply === existingApply)
    ) {
      return { id: existing.id, reason: 'same-link', role: existing.role, company: existing.company };
    }

    if (incomingIdentity !== '||' && incomingIdentity === jobIdentityKey(existing)) {
      return { id: existing.id, reason: 'same-job', role: existing.role, company: existing.company };
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET' && String(req.query?.auth || '') === '1') {
    if (!process.env.OWNER_KEY) {
      return res.status(503).json({ ok: false, error: 'Admin authentication is not configured on this deployment' });
    }
    if (!isAdmin(req)) {
      return res.status(401).json({ ok: false, error: 'Invalid owner key' });
    }
    return res.status(200).json({ ok: true, authenticated: true });
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Supabase server configuration is missing' });
  }

  if (req.method === 'GET') {
    if (String(req.query?.discovery || '') === 'cron' && /vercel-cron\/1\.0/i.test(String(req.headers['user-agent'] || ''))) {
      try {
        const result = await runPublicDiscovery({ q: 'civil engineering jobs India', location: 'India', type: 'all' });
        return res.status(200).json({ ok: true, ...result });
      } catch (err) {
        return res.status(502).json({ ok: false, error: 'Scheduled discovery failed', details: err.message });
      }
    }
    if (String(req.query?.render || '') === 'html') return renderJobPage(req, res);

    const slug = typeof req.query?.slug === 'string' ? req.query.slug.trim() : '';
    const id   = typeof req.query?.id   === 'string' ? req.query.id.trim()   : '';

    let query;
    if (slug) {
      query = `jobs?slug=eq.${encodeURIComponent(slug)}` + (isAdmin(req) ? '' : '&published=eq.true') + '&limit=1';
    } else if (id) {
      query = `jobs?id=eq.${encodeURIComponent(id)}`     + (isAdmin(req) ? '' : '&published=eq.true') + '&limit=1';
    } else {
      query = isAdmin(req) ? 'jobs?order=created_at.desc' : 'jobs?published=eq.true&order=created_at.desc';
    }

    try {
      const r = await supa(query);
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Failed to load jobs', details: detail });
      }
      const jobs = await r.json();
      if (slug || id) return res.status(200).json({ job: jobs[0] || null });
      return res.status(200).json({ jobs });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load jobs', details: err.message });
    }
  }

  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Invalid owner key' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  if (req.method === 'POST' && String(req.query?.discovery || '') === '1') {
    try {
      const result = await runPublicDiscovery({ q: body.q, location: body.location, type: body.type });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(502).json({ error: 'Discovery search failed', details: err.message, sourceStats: err.sourceStats || {} });
    }
  }

  if (req.method === 'POST') {
    try {
      const { id, key, ...rest } = body;
      cleanDates(rest);
      cleanArrays(rest);
      if (typeof rest.published !== 'boolean') rest.published = true;
      if (!rest.status) rest.status = rest.published ? 'Active' : 'Pending Review';
      if (!rest.created_at) rest.created_at = new Date().toISOString();
      if (!rest.slug) rest.slug = makeSlug(rest.role, rest.company, Date.now());

      // Company alone is NEVER a duplicate criterion.
      // Only the same link or same title+company+location is blocked.
      const existing = await findExistingJobForCreate(rest);
      if (existing) {
        return res.status(409).json({
          error: 'Already exists in CivilCareer',
          duplicate: true,
          reason: existing.reason,
          existing_id: existing.id,
          existing_role: existing.role,
          existing_company: existing.company,
        });
      }

      const r = await supa('jobs', { method: 'POST', body: JSON.stringify(rest) });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Job could not be saved', details: detail });
      }
      const data = await r.json();
      return res.status(201).json({ success: true, job: Array.isArray(data) ? data[0] : data });
    } catch (err) {
      return res.status(500).json({ error: 'Job could not be saved', details: err.message });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id, key, ...rest } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      cleanDates(rest);
      cleanArrays(rest);
      const r = await supa(`jobs?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(rest) });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Job could not be updated', details: detail });
      }
      const data = await r.json();
      return res.status(200).json({ success: true, job: Array.isArray(data) ? data[0] : data });
    } catch (err) {
      return res.status(500).json({ error: 'Job could not be updated', details: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const r = await supa(`jobs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Job could not be deleted', details: detail });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Job could not be deleted', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// Internals exposed for unit-style testing only. Vercel invokes the exported
// handler function directly; these extra properties never execute in prod.
module.exports._internal = {
  pipelineValidateItem,
  discoveryFetchHopin,
  discoveryFetchJobicy,
  discoveryFetchArbeitnow,
  discoveryFetchOnJob,
  runPublicDiscovery,
  classifyFreshness,
  classifyCivilRole,
  newsVacancyCheck,
  resolveIndiaEligibility,
  extractStructuredLocation,
  dedupeKey,
  normalizeJobUrl,
  discoveryFormatAge,
  FRESH_24H_MS,
  BACKUP_30D_MS,
  FUTURE_TOL_MS,
};
