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
   CIVILCAREER PHASE 7 — MULTI-SOURCE DISCOVERY ENGINE
   ───────────────────────────────────────────────────────────────────── */

const DISCOVERY_SITES = [
  'linkedin.com/jobs', 'naukri.com', 'indeed.com', 'foundit.in',
  'timesjobs.com', 'shine.com', 'apna.co', 'workindia.in',
  'freshersworld.com', 'gov.in', 'nic.in'
];
const DISCOVERY_KEYWORDS = [
  'civil engineer','site engineer','planning engineer','quantity surveyor',
  'structural engineer','construction engineer','project engineer',
  'estimation engineer','billing engineer','qa qc civil','bim engineer',
  'junior civil engineer','assistant engineer','civil engineering vacancy',
  'civil recruitment','pwd engineer','nhai engineer','civil supervisor',
  'graduate civil engineer','resident engineer','highway engineer',
  'road engineer','bridge engineer','geotechnical engineer',
  'water resources engineer','irrigation engineer','civil designer',
  'civil draftsman','infrastructure engineer','civil works'
];
const DISCOVERY_CITY_WORDS = [
  'bengaluru','bangalore','mumbai','delhi','new delhi','hyderabad','chennai',
  'pune','ahmedabad','kolkata','kochi','jaipur','gurugram','gurgaon','noida',
  'lucknow','indore','nagpur','surat','bhubaneswar','patna','thiruvananthapuram',
  'visakhapatnam','vizag','vadodara','coimbatore','madurai','agra','kanpur',
  'nashik','aurangabad','rajkot','meerut','faridabad','thane','navi mumbai',
  'pimpri','chandigarh','ranchi','guwahati','bhopal','dehradun','mysuru','mysore',
  'hubli','belgaum','mangalore','kozhikode','thrissur','ernakulam'
];

const INDIA_STATES = [
  'karnataka','maharashtra','telangana','tamil nadu','delhi','uttar pradesh',
  'rajasthan','gujarat','west bengal','kerala','andhra pradesh','madhya pradesh',
  'bihar','odisha','chhattisgarh','jharkhand','assam','punjab','haryana',
  'himachal pradesh','uttarakhand','goa','tripura','meghalaya','manipur',
  'nagaland','arunachal pradesh','mizoram','sikkim','jammu','kashmir',
  'chandigarh','jharkhand','uttaranchal'
];

// Explicit foreign country codes / names — used to REJECT foreign-only jobs
const FOREIGN_COUNTRIES = new Set([
  'us','usa','united states','uk','gb','united kingdom','au','australia',
  'de','germany','fr','france','ca','canada','sg','singapore','nz','new zealand',
  'ie','ireland','za','south africa','nl','netherlands','be','belgium',
  'it','italy','es','spain','ch','switzerland','se','sweden','no','norway',
  'dk','denmark','fi','finland','pl','poland','pt','portugal','jp','japan',
  'cn','china','hk','hong kong','kr','south korea','my','malaysia',
  'ph','philippines','id','indonesia','th','thailand','vn','vietnam',
  'pk','pakistan','bd','bangladesh','lk','sri lanka','np','nepal',
  // Gulf is NOT in this list — handled separately based on location text
]);

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
function discoveryNorm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function discoveryRole(title){
  const t=cleanDiscoveryText(title);
  return t.replace(/\s+(?:-|–|—|at|@|\|)\s+[^|–—-]{2,100}$/i,'').trim()||t;
}
function discoveryCompany(title,description){
  const t=cleanDiscoveryText(title);
  let m=t.match(/\s+(?:-|–|—|at|@|\|)\s+([^|–—-]{2,100})$/i);
  if(m)return m[1].trim();
  m=cleanDiscoveryText(description).match(/(?:company|employer)\s*[:\-]\s*([^.|]+)/i);
  return m?m[1].trim():'';
}
function discoveryLocation(text,requestedLocation){
  const hay=discoveryNorm(`${requestedLocation||''} ${text}`);
  for(const city of DISCOVERY_CITY_WORDS) if(hay.includes(city)) return city.replace(/\b\w/g,c=>c.toUpperCase());
  return /\bindia\b|pan india|all india/.test(hay)?'India':(requestedLocation||'India');
}
function discoverySector(text){
  return /government|govt|psu|public sector|recruitment|commission|authority|department|board|pwd|nhai|cpwd|railway/.test(discoveryNorm(text))?'Government':'Private';
}

// ── CIVIL JOB FILTER ──
// Rejects non-civil engineering roles (software, data, ML, etc.)
const REJECT_KEYWORDS = [
  'software engineer','data engineer','ml engineer','machine learning engineer',
  'ai engineer','cloud engineer','network engineer','cybersecurity',
  'frontend engineer','backend engineer','full stack','fullstack',
  'devops','sre','site reliability','mobile engineer','android engineer',
  'ios engineer','qa automation','test automation','sales engineer',
  'product manager','product engineer','application engineer','solutions engineer',
  'customer success','business analyst','data analyst','data scientist',
  'blockchain','crypto','defi','game developer','graphics engineer',
  'embedded engineer','firmware engineer','rf engineer','vlsi','fpga',
  'electrical engineer','mechanical engineer','chemical engineer',
  'aerospace engineer','petroleum engineer','mining engineer',
  // only reject electrical/mechanical/etc when no civil context
];

function discoveryIsCivil(title, description) {
  const t = discoveryNorm(`${title} ${description}`);

  // Strong accept: explicit civil engineering keywords
  if (DISCOVERY_KEYWORDS.some(k => t.includes(discoveryNorm(k)))) return true;

  // Accept if description contains civil/construction context
  if (/civil construction|civil works|infrastructure construction|road construction|bridge construction|dam construction|rcc|reinforced concrete|structural drawings|concrete|reinforcement bar|rebar|pile foundation|earthwork|excavation|bored pile/.test(t)) return true;

  // Reject if explicitly a non-civil engineering role (no civil override)
  const hasCivilContext = /civil|construction|structural|geotechnical|highway|infrastructure|quantity survey|bim|planning engineer/.test(t);
  if (!hasCivilContext) {
    if (REJECT_KEYWORDS.some(k => t.includes(k))) return false;
  }

  return false;
}

// ── INDIA LOCATION FILTER ──
function discoveryIsIndia(loc, country, state, city) {
  // Explicit country code
  if (country) {
    const c = String(country).toLowerCase().trim().replace(/\.$/, '');
    if (c === 'in' || c === 'india') return true;
    if (FOREIGN_COUNTRIES.has(c)) return false;
  }

  const haystack = discoveryNorm(`${loc || ''} ${state || ''} ${city || ''}`);

  // Positive India signals
  if (/\bindia\b|pan[\s-]?india|all[\s-]?india|india[\s-]?based|india[\s-]?remote/.test(haystack)) return true;

  // City match (word-boundary)
  for (const c of DISCOVERY_CITY_WORDS) {
    // Use word boundary: c must not be preceded or followed by a letter
    const re = new RegExp(`(?:^|[^a-z])${c.replace(/\s+/g, '[\\s-]+')}(?:[^a-z]|$)`);
    if (re.test(haystack)) return true;
  }

  // State match
  for (const s of INDIA_STATES) {
    const re = new RegExp(`(?:^|[^a-z])${s.replace(/\s+/g, '[\\s-]+')}(?:[^a-z]|$)`);
    if (re.test(haystack)) return true;
  }

  // Do NOT assume an empty/unknown location is India.
  // An India result must have an explicit India country/location signal.
  return false;
}

// ── AGE DISPLAY ──
function discoveryFormatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(ms / 86400000);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// ── FRESHNESS CONSTANTS ──
const FRESH_24H_MS  = 24  * 3600000;
const BACKUP_30D_MS = 30  * 24 * 3600000;
const FUTURE_TOL_MS = 2   * 3600000;  // 2h future tolerance

function discoveryQueries(q,location){
  const base=cleanDiscoveryText(q||'civil engineering jobs');
  const loc=cleanDiscoveryText(location||'India');
  const generic=[`${base} ${loc}`];
  for(const role of DISCOVERY_KEYWORDS.slice(0,7)) generic.push(`${role} ${loc}`);
  const siteQueries=DISCOVERY_SITES.slice(0,7).map(site=>`site:${site} ${base} ${loc}`);
  return [...generic,...siteQueries].slice(0,14);
}

async function fetchText(url,headers={}){
  const r=await fetch(url,{headers:{'User-Agent':'CivilCareer public vacancy discovery/1.0','Accept':'application/rss+xml, application/json, text/xml, text/plain;q=0.9, */*',...headers},signal:AbortSignal.timeout(8000),redirect:'follow'});
  if(!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return await r.text();
}

async function discoveryFetchGoogleNews(query){
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
  return parseDiscoveryRss(await fetchText(url));
}
async function discoveryFetchBingNews(query){
  const url=`https://www.bing.com/news/search?q=${encodeURIComponent(`${query} after:${new Date(Date.now()-86400000).toISOString().slice(0,10)}`)}&format=rss`;
  return parseDiscoveryRss(await fetchText(url));
}
async function discoveryFetchJobicy(query){
  const tag=(query.match(/civil engineer|site engineer|planning engineer|quantity surveyor|structural engineer|construction engineer|project engineer|bim engineer/i)||['civil'])[0];
  const url=`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`;
  const raw=JSON.parse(await fetchText(url,{'Accept':'application/json'}));
  return (raw.jobs||[]).map(j=>({
    title:j.jobTitle||'',link:j.url||'',description:cleanDiscoveryText(j.jobExcerpt||j.jobDescription||''),
    pubDate:j.pubDate||'',source:'jobicy.com',company:j.companyName||'',location:j.jobGeo||''
  }));
}
async function discoveryFetchArbeitnow(){
  const raw=JSON.parse(await fetchText('https://www.arbeitnow.com/api/job-board-api',{'Accept':'application/json'}));
  return (raw.data||[]).map(j=>({
    title:j.title||'',link:j.url||'',description:cleanDiscoveryText(j.description||''),
    pubDate:j.created_at?new Date(j.created_at*1000).toISOString():(j.created_at||''),
    source:'arbeitnow.com',company:j.company_name||j.company||'',location:j.location||''
  }));
}
async function discoveryFetchOnJob(){
  const raw=JSON.parse(await fetchText('https://onjob.io/feeds/jobs.json',{'Accept':'application/json'}));
  return (raw.jobs||[]).map(j=>({
    title:j.title||'',link:j.url||'',description:cleanDiscoveryText(j.descriptionHtml||j.description||''),
    pubDate:j.datePosted||'',source:'onjob.io',company:j.company||'',location:j.location||'',
    application_url:j.applyUrl||j.url||''
  }));
}

// ── HOPIN ADAPTER ──
// Fetches from https://api.hopinjobs.com/api/jobs
// Handles all known Hopin response shapes defensively.
async function discoveryFetchHopin(query, requestedLocation) {
  // Use Hopin's public jobs endpoint without assuming unsupported
  // server-side filters. India/civil validation is performed below.
  const urls = [
    'https://api.hopinjobs.com/api/jobs',
    'https://api.hopinjobs.com/api/jobs?is_unofficial=true',
  ];

  const payloads = [];
  for (const url of urls) {
    try {
      const text = await fetchText(url, { 'Accept': 'application/json' });
      payloads.push(JSON.parse(text));
    } catch (err) {
      // One Hopin collection may fail while the other is available.
      // Only fail the source if both requests fail.
      payloads.push(null);
    }
  }
  if (!payloads.some(Boolean)) {
    throw new Error('Hopin API error: both public job collections failed');
  }

  // Hopin may return: array directly, { jobs:[...] }, { data:[...] }, { results:[...] }
  let jobsArray = [];
  for (const raw of payloads) {
    if (Array.isArray(raw)) {
      jobsArray.push(...raw);
    } else if (raw && typeof raw === 'object') {
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

    // Title — required
    const title = cleanDiscoveryText(
      j.title || j.job_title || j.position || j.name || ''
    );
    if (!title) continue;

    // Company — may be object or string
    const company = cleanDiscoveryText(
      typeof j.company === 'object'
        ? (j.company?.name || j.company?.title || '')
        : (j.company || j.company_name || j.employer || j.organisation || '')
    );

    // URL — required (never fabricated)
    // Hopin's list endpoint does not guarantee a public job URL.
    // When it supplies an id, use the documented getJob endpoint as the
    // source record URL. This is a real Hopin URL, not a fabricated job page.
    const link = j.url || j.job_url || j.link || j.source_url ||
      (j.id ? `https://api.hopinjobs.com/api/jobs/${encodeURIComponent(String(j.id))}` : '');
    if (!link) continue;

    // Description
    const description = cleanDiscoveryText(
      j.description || j.summary || j.excerpt || j.body || ''
    );

    // Location — preserve structured fields
    const city    = cleanDiscoveryText(j.city    || j.town   || '');
    const state   = cleanDiscoveryText(j.state   || j.region || '');
    const country = cleanDiscoveryText(j.country || j.country_code || '');
    const locationText = cleanDiscoveryText(
      j.location || j.location_display || j.place
      || [city, state, country].filter(Boolean).join(', ')
      || ''
    );

    // Posted date — prefer precise timestamp over date-only
    const pubDate = j.published_at || j.created_at || j.date_posted
                  || j.posted_at   || j.post_date  || j.pubDate || '';

    // Application URL
    const application_url = j.apply_url || j.application_url || '';

    normalized.push({
      title,
      link,
      description,
      pubDate,
      source: 'hopinjobs.com',
      company,
      location: locationText,
      country,
      state,
      city,
      application_url,
      _sourceId: sourceId,
      experience: j.experience || j.experience_level || '',
      employment_type: j.job_type || j.employment_type || '',
    });
  }

  return normalized;
}

// ── NORMALISE A SINGLE DISCOVERY ITEM ──
// Returns null if the item should be rejected.
// FIX: uses exact milliseconds for age — never rounds before filtering.
// FIX: max window is 30 days (not 48 h) to allow backup30d queue.
function discoveryIsNewsVacancy(item, sourceLabel) {
  const src = discoveryNorm(sourceLabel || item._source || item.source || '');
  if (src !== 'google_news' && src !== 'bing_news') return true;

  const title = cleanDiscoveryText(item.title || '');
  const text = discoveryNorm(`${title} ${item.description || item.snippet || ''}`);

  // News feeds are not vacancy feeds. Require explicit hiring/vacancy language
  // plus explicit India evidence before a news result can enter the job queue.
  const vacancySignal = /\b(job|jobs|vacancy|vacancies|hiring|hire|recruitment|recruiting|career|careers|position|positions|opening|openings|apply|employment)\b/.test(text);
  const indiaSignal = discoveryIsIndia(item.location || '', item.country || '', item.state || '', item.city || '') ||
    /\bindia\b|pan[\s-]?india|all[\s-]?india|india[\s-]?based|india[\s-]?remote/.test(text);

  if (!vacancySignal || !indiaSignal) return false;

  // Reject common news/project-report wording even if an article happens to
  // mention a hiring-related word elsewhere.
  if (/\b(network rail|wales and borders|pudsey|project delivery|airport delivery|aquifers|tender award|construction update|project update|infrastructure news|industry news)\b/.test(text) &&
      !/\b(job|jobs|vacancy|vacancies|hiring|recruitment|career|careers|apply)\b/.test(title)) {
    return false;
  }

  return true;
}

function normalizeDiscoveryItem(item, requestedLocation, sourceLabel) {
  const title   = cleanDiscoveryText(item.title);
  const snippet = cleanDiscoveryText(item.description || item.snippet || '');
  const url     = item.link || item.url || '';

  if (!title || !url) return null;
  if (!discoveryIsCivil(title, snippet)) return null;
  if (!discoveryIsNewsVacancy(item, sourceLabel)) return null;

  // Parse posting date — prefer ISO/RFC timestamps over date-only strings.
  // Date-only strings (e.g. "2026-09-11") are parsed as UTC midnight per spec.
  const rawDate  = String(item.pubDate || item.published_at || item.posted_at || '').trim();
  const parsedMs = rawDate ? Date.parse(rawDate) : NaN;

  // Exact age in milliseconds — null means the date is unknown/unparseable.
  const ageMs = Number.isFinite(parsedMs) ? Date.now() - parsedMs : null;

  // Reject: future dates beyond 2 h tolerance
  if (ageMs !== null && ageMs < -FUTURE_TOL_MS) return null;

  // Reject: older than 30 days
  if (ageMs !== null && ageMs > BACKUP_30D_MS) return null;

  const source    = sourceLabel || item.source || discoverySourceHost(url) || 'Public web';
  const postedIso = Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : '';

  return {
    title,
    url,
    snippet:        snippet.slice(0, 800),
    pubDate:        rawDate,
    postedIso,                                // full ISO timestamp — never truncated
    source,
    company:        item.company         || '',
    // Never infer India from the search query. A missing source location stays empty.
    location:       item.location        || '',
    country:        item.country         || '',
    state:          item.state           || '',
    city:           item.city            || '',
    application_url:item.application_url || '',
    ageMs,                                    // exact ms — null if unknown
    // ageHours is kept for backward compat but is NOT used for fresh/backup gating.
    ageHours:       ageMs === null ? null : ageMs / 3600000,
    ageDisplay:     ageMs === null ? null : discoveryFormatAge(ageMs),
    _sourceId:      item._sourceId       || '',
  };
}

async function runPublicDiscovery({q, location, type} = {}) {
  const requestedLocation = cleanDiscoveryText(location || 'India');
  const query             = cleanDiscoveryText(q || 'civil engineering jobs India');
  const isIndiaSearch     = /\bindia\b/i.test(requestedLocation);
  const sourceStats       = {};
  const all               = [];

  // Configured providers (lib/discovery-sources.js)
  const configured = await runConfiguredSources({ q: query, location: requestedLocation });
  Object.assign(sourceStats, configured.stats || {});
  all.push(...(configured.jobs || []));

  // Public sources — always run; one failure does not stop others
  const publicSources = [
    ['google_news', () => discoveryFetchGoogleNews(`${query} ${requestedLocation}`)],
    ['bing_news',   () => discoveryFetchBingNews(`${query} ${requestedLocation}`)],
    ['jobicy',      () => discoveryFetchJobicy(query)],
    ['arbeitnow',   () => discoveryFetchArbeitnow()],
    ['onjob',       () => discoveryFetchOnJob()],
    ['hopin',       () => discoveryFetchHopin(query, requestedLocation)],
  ];

  const publicResults = await Promise.allSettled(publicSources.map(([, fn]) => fn()));
  publicResults.forEach((result, i) => {
    const name = publicSources[i][0];
    if (result.status === 'fulfilled') {
      const rows = Array.isArray(result.value) ? result.value : [];
      sourceStats[name] = { name, configured: true, ok: true, items: rows.length, error: null, remaining: null, reset: null, rejectedCivil: 0, rejectedIndia: 0, rejectedAge: 0, rejectedDupe: 0 };
      all.push(...rows.map(x => ({ ...x, _source: name })));
    } else {
      sourceStats[name] = { name, configured: true, ok: false, items: 0, error: String(result.reason?.message || result.reason), remaining: null, reset: null };
    }
  });

  // ── CLASSIFY ITEMS ──
  const seen       = new Set();
  const fresh24h   = [];   // ageMs <= 24h (exact)
  const backup30d  = [];   // 24h < ageMs <= 30d (exact)
  const unknownDate = [];  // ageMs === null

  for (const item of all) {
    const src = item._source || item.source || 'unknown';
    const normalized = normalizeDiscoveryItem(item, requestedLocation, src);

    if (!normalized) {
      // Track source-specific news/vacancy rejection separately from civil/date rejection.
      if (sourceStats[src]) {
        const title = cleanDiscoveryText(item.title || '');
        const snippet = cleanDiscoveryText(item.description || item.snippet || '');
        if (!discoveryIsCivil(title, snippet) || !discoveryIsNewsVacancy(item, src)) {
          sourceStats[src].rejectedCivil = (sourceStats[src].rejectedCivil || 0) + 1;
        } else {
          sourceStats[src].rejectedAge = (sourceStats[src].rejectedAge || 0) + 1;
        }
      }
      continue;
    }

    // India location filter (only applied when India is requested)
    if (isIndiaSearch) {
      const locationCheck = `${normalized.location} ${normalized.country} ${normalized.state} ${normalized.city}`;
      const explicitIndia = discoveryIsIndia(locationCheck, normalized.country, normalized.state, normalized.city);
      // Hopin's public corpus is explicitly India-focused. Its list API can
      // omit location/country on individual rows, so do not throw away a
      // genuine Hopin listing solely because those fields are blank.
      const trustedIndiaSource = src === 'hopin' || src === 'hopinjobs.com';
      const rawHopinLocation = discoveryNorm(`${normalized.location} ${normalized.city} ${normalized.state}`);
      const hopinRemoteOnly = /^(remote|remote remote|work from home|wfh)$/.test(rawHopinLocation);
      const hasUnknownLocation = !normalized.location && !normalized.country && !normalized.state && !normalized.city;
      if (!explicitIndia && !(trustedIndiaSource && (hasUnknownLocation || hopinRemoteOnly))) {
        if (sourceStats[src]) sourceStats[src].rejectedIndia = (sourceStats[src].rejectedIndia || 0) + 1;
        continue;
      }
    }

    // Deduplication
    const key = normalized.url.replace(/[?#].*$/, '') + '|' + discoveryNorm(normalized.title);
    if (seen.has(key)) {
      if (sourceStats[src]) sourceStats[src].rejectedDupe = (sourceStats[src].rejectedDupe || 0) + 1;
      continue;
    }
    seen.add(key);

    // Freshness gating — use exact ageMs, never rounded
    if (normalized.ageMs === null) {
      unknownDate.push(normalized);
    } else if (normalized.ageMs <= FRESH_24H_MS) {
      fresh24h.push(normalized);
    } else {
      // ageMs > FRESH_24H_MS and <= BACKUP_30D_MS (enforced in normalizeDiscoveryItem)
      backup30d.push(normalized);
    }
  }

  // Sort each queue newest-first using exact ageMs
  const byAge = (a, b) => (a.ageMs ?? Infinity) - (b.ageMs ?? Infinity);
  fresh24h.sort(byAge);
  backup30d.sort(byAge);

  // Candidates = fresh24h first, then backup30d as fallback
  const candidates = [...fresh24h, ...backup30d];

  const typeFiltered = candidates.filter(x => {
    if (!type || type === 'all') return true;
    const sector = discoverySector(`${x.title} ${x.snippet}`);
    if (type === 'government') return sector === 'Government';
    if (type === 'private')    return sector === 'Private';
    if (type === 'mnc')        return /mnc|multinational|large employer|corporation|ltd|limited|pvt|private/i.test(`${x.company} ${x.snippet}`);
    return true;
  });

  const limited = typeFiltered.slice(0, 80);

  // Dedup against existing Supabase jobs
  const existingResponse = await supa('jobs?select=id,source_url,role,company,created_at');
  if (!existingResponse.ok) {
    const err = new Error(`Supabase job lookup failed: ${existingResponse.status}`);
    err.sourceStats = sourceStats;
    throw err;
  }
  const existingRows   = await existingResponse.json();
  const existingUrls   = new Set(existingRows.map(r => String(r.source_url || '').replace(/[?#].*$/, '')).filter(Boolean));
  const existingTitles = new Set(existingRows.map(r => `${discoveryNorm(r.role)}|${discoveryNorm(r.company)}`));

  const now   = new Date().toISOString();
  const fresh = limited.filter(x => {
    const company   = x.company || discoveryCompany(x.title, x.snippet);
    const titleKey  = `${discoveryNorm(discoveryRole(x.title))}|${discoveryNorm(company)}`;
    return !existingUrls.has(x.url.replace(/[?#].*$/, '')) && !existingTitles.has(titleKey);
  });

  const drafts = fresh.slice(0, 40).map((item, index) => {
    const role    = discoveryRole(item.title);
    const company = item.company || discoveryCompany(item.title, item.snippet);
    // Prefer full ISO timestamp; fall back to pubDate for date_posted
    const posted  = item.postedIso || (item.pubDate ? new Date(Date.parse(item.pubDate) || Date.now()).toISOString() : '');
    return {
      source_url:          item.url,
      role,
      role_normalized:     role,
      company:             company || null,
      location:            item.location || discoveryLocation(`${item.title} ${item.snippet}`, requestedLocation),
      location_display:    item.location || discoveryLocation(`${item.title} ${item.snippet}`, requestedLocation),
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

  // Report freshness for the drafts actually returned to the review queue.
  // This keeps the dashboard counts aligned with what the reviewer sees,
  // including databases where only date_posted is retained.
  const insertedFresh24hCount = inserted.filter(j => {
    const d = j.posted_at || j.date_posted || '';
    const ms = d ? Date.parse(d) : NaN;
    return Number.isFinite(ms) && (Date.now() - ms) <= FRESH_24H_MS;
  }).length;
  const insertedBackup30dCount = inserted.filter(j => {
    const d = j.posted_at || j.date_posted || '';
    const ms = d ? Date.parse(d) : NaN;
    const age = Number.isFinite(ms) ? Date.now() - ms : NaN;
    return Number.isFinite(age) && age > FRESH_24H_MS && age <= BACKUP_30D_MS;
  }).length;
  const insertedUnknownDateCount = inserted.length - insertedFresh24hCount - insertedBackup30dCount;

  return {
    count:                inserted.length,
    drafts:               inserted,
    results:              inserted.map(j => {
      // Recalculate age from the saved timestamp for accurate display
      const dateStr = j.posted_at || j.date_posted || '';
      const dateMs  = dateStr ? Date.parse(dateStr) : NaN;
      const ageMs   = Number.isFinite(dateMs) ? Date.now() - dateMs : null;
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
        ageDisplay:    ageMs !== null ? discoveryFormatAge(ageMs) : null,
        freshness:     ageMs !== null ? (ageMs <= FRESH_24H_MS ? 'fresh24h' : 'backup30d') : 'unknown',
        score:         100,
      };
    }),
    // Freshness breakdown — basis for UI labelling
    fresh24hCount:        insertedFresh24hCount,
    backup30dCount:       insertedBackup30dCount,
    unknownDateCount:     insertedUnknownDateCount,
    // Legacy field — kept for backward compat; now equals fresh24h + backup30d
    candidates:           candidates.length,
    typeFilteredCandidates: typeFiltered.length,
    scanned:              limited.length,
    skippedExisting:      Math.max(0, limited.length - fresh.length),
    sourceStats,
    configuredSources:    Object.values(sourceStats)
      .filter(x => x.configured && x.name && !['google_news','bing_news','jobicy','arbeitnow','onjob','hopin'].includes(x.name))
      .map(x => x.name),
    runAt:                now,
    persistenceWarning,
    note: 'Freshness: fresh24h uses exact ms (no rounding). fresh24h <= 24 h; backup30d 24 h–30 d; unknown-date items excluded from both queues. India location filter applied. Hopin included as public source.',
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
