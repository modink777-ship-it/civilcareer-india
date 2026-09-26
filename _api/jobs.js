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
const { allowSameOrigin, requireOwner, ownerKeyMatches } = require('../lib/security');
const { runCompanyCareerSources, COMPANIES: CAREER_COMPANIES } = require('../lib/company-careers');


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
    `jobs?select=*&slug=eq.${encodeURIComponent(slug)}&published=eq.true&or=(expires_at.gte.${encodeURIComponent(new Date().toISOString())},expires_at.is.null)&limit=1`
  );

  if (!response.ok) {
    throw new Error(`Supabase job lookup failed: ${response.status}`);
  }

  const rows = await response.json();
  return rows[0] || null;
}


function canonicalExpiry(job) {
  return job.expires_at || job.valid_through || job.deadline || null;
}

function isExpired(job) {
  const value = canonicalExpiry(job);
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time < Date.now();
}

/* ── PUBLIC FIELD PROJECTION ──────────────────────────────────────────
   Public API responses expose only allow-listed fields. Internal review,
   quality, ingestion and duplicate-group metadata never reach candidates,
   and private application emails are withheld when flagged private. */
const PUBLIC_JOB_FIELDS = [
  'id','role','company','company_url','location','location_display','locations',
  'city','district','state','country','description','responsibilities','skills','qualifications',
  'qualification','qualification_notes','experience_min','experience_max','experience_level',
  'experience_ranges','employment_type','employment_types','salary','salary_min','salary_max',
  'salary_currency','sector','date_posted','posted_at','published_at','expires_at','deadline','application_url','apply_url',
  'source_url','source','verification_status','last_verified','last_verified_at','employer_verification_status','employer_profile_id','recruitment_authority',
  'vacancy_count','age_limit','application_fee','application_start','slug','status','created_at','updated_at'
];

function publicJob(job) {
  const out = {};
  for (const field of PUBLIC_JOB_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(job, field)) out[field] = job[field];
  }
  if (!job.application_email_private && job.application_email) out.application_email = job.application_email;
  if (!job.application_email_private && Array.isArray(job.application_emails)) out.application_emails = job.application_emails;
  return out;
}

function publicJobs(jobs) {
  return jobs.filter(job => !isExpired(job)).map(publicJob);
}

function publicJobQuery(extra = '') {
  const now = encodeURIComponent(new Date().toISOString());
  // expires_at is the canonical lifecycle field. NULL is retained for legacy rows
  // and checked by isExpired() below; the v8 migration backfills it.
  return `jobs?published=eq.true&or=(expires_at.gte.${now},expires_at.is.null)${extra}`;
}

/* Pagination/filter helpers (server-side listing, bounded result sizes). */
function queryValue(value) {
  return encodeURIComponent(String(value ?? '')).replace(/%2A/gi, '*');
}

function positiveInt(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/* City-name variants that must match each other when filtering (Gurugram/Gurgaon,
   Bengaluru/Bangalore). Values are lower-cased keys. */
const LOCATION_ALIASES = {
  gurugram: 'gurgaon',
  gurgaon: 'gurugram',
  bengaluru: 'bangalore',
  bangalore: 'bengaluru',
};

function buildJobFilters(query, { admin = false } = {}) {
  const filters = [];
  if (!admin) {
    filters.push('published=eq.true');
    filters.push(`or=(expires_at.gte.${queryValue(new Date().toISOString())},expires_at.is.null)`);
  }

  if (admin && query.status) filters.push(`status=eq.${queryValue(query.status)}`);
  if (admin && query.published === 'true') filters.push('published=eq.true');
  if (admin && query.published === 'false') filters.push('published=eq.false');
  if (admin && query.from) filters.push(`created_at.gte.${queryValue(query.from)}`);
  if (admin && query.to) filters.push(`created_at.lte.${queryValue(query.to)}`);
  if (query.status && !admin) {
    if (String(query.status).toLowerCase() === 'closed') filters.push('status=not.eq.Active');
    else if (String(query.status).toLowerCase() === 'active') filters.push('status=eq.Active');
  }

  const sector = String(query.sector || '').trim();
  if (sector === 'Private') {
    filters.push(`or=(sector.ilike.${queryValue('*private*')},sector.ilike.${queryValue('*mnc*')},sector.is.null)`);
  } else if (sector === 'Government') {
    filters.push(`or=(sector.ilike.${queryValue('*government*')},sector.ilike.${queryValue('*public*')})`);
  }

  const q = String(query.q || '').trim();
  if (q) {
    const needle = `*${q.replace(/[*]/g, ' ')}*`;
    filters.push(`or=(role.ilike.${queryValue(needle)},company.ilike.${queryValue(needle)},description.ilike.${queryValue(needle)},location.ilike.${queryValue(needle)},location_display.ilike.${queryValue(needle)},city.ilike.${queryValue(needle)},state.ilike.${queryValue(needle)},skills.ilike.${queryValue(needle)},qualification.ilike.${queryValue(needle)})`);
  }

  const ilikeFields = {
    role: 'role',
    country: 'country',
    state: 'state',
    city: 'city',
    qualification: 'qualification',
    work_type: 'employment_type',
    company: 'company',
  };
  for (const [param, field] of Object.entries(ilikeFields)) {
    const value = String(query[param] || '').trim();
    if (value) filters.push(`${field}=ilike.${queryValue(`*${value}*`)}`);
  }

  /* Multi-value "any-of" filters — comma-separated query params from the
     compound search bar and the LinkedIn-style filter row. Values inside one
     param are OR-combined (role1 OR role2), different params stay AND-combined
     (any role AND any city). Bounded to 12 values per param. */
  const anyOf = (fields, raw) => {
    const values = String(raw || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
    if (!values.length) return null;
    const clauses = [];
    for (const v of values) {
      for (const field of fields) {
        clauses.push(`${field}.ilike.${queryValue(`*${v.replace(/[*]/g, ' ')}*`)}`);
        const alias = LOCATION_ALIASES[v.toLowerCase()];
        if (alias) clauses.push(`${field}.ilike.${queryValue(`*${alias}*`)}`);
      }
    }
    return `or=(${clauses.join(',')})`;
  };
  const multiFilters = [
    anyOf(['role'], query.roles),
    anyOf(['city', 'location', 'location_display'], query.cities),
    anyOf(['state'], query.states),
    anyOf(['employment_type'], query.employment_type),
  ];
  for (const f of multiFilters) if (f) filters.push(f);

  /* Work mode — Remote / Hybrid are keyword matches; On-site excludes both. */
  const workMode = String(query.work_mode || '').trim().toLowerCase();
  if (workMode === 'remote') {
    filters.push(`or=(employment_type.ilike.${queryValue('*remote*')},description.ilike.${queryValue('*remote*')},description.ilike.${queryValue('*work from home*')},description.ilike.${queryValue('*wfh*')})`);
  } else if (workMode === 'hybrid') {
    filters.push(`or=(employment_type.ilike.${queryValue('*hybrid*')},description.ilike.${queryValue('*hybrid*')})`);
  } else if (workMode === 'onsite') {
    filters.push(`not.or=(employment_type.ilike.${queryValue('*remote*')},description.ilike.${queryValue('*work from home*')},description.ilike.${queryValue('*wfh*')},description.ilike.${queryValue('*remote*')},employment_type.ilike.${queryValue('*hybrid*')},description.ilike.${queryValue('*hybrid*')})`);
  }

  if (String(query.require_state || '') === '1') filters.push('state=not.is.null');
  if (String(query.require_city || '') === '1') filters.push('city=not.is.null');
  const govScope = String(query.gov_scope || '').trim().toLowerCase();
  if (govScope === 'state') {
    filters.push('state=not.is.null');
  } else if (govScope === 'central') {
    filters.push(`or=(recruitment_authority.ilike.${queryValue('*central*')},company.ilike.${queryValue('*central*')})`);
  }

  const experience = String(query.experience || '').trim();
  if (experience) {
    const match = experience.match(/(\d+(?:\.\d+)?)/);
    if (match) filters.push(`experience_min=lte.${queryValue(match[1])}`);
  }

  const postedDays = Number.parseInt(query.posted_days || '', 10);
  if (Number.isFinite(postedDays) && postedDays > 0) {
    const since = new Date(Date.now() - postedDays * 86400000).toISOString();
    filters.push(`or=(posted_at.gte.${queryValue(since)},published_at.gte.${queryValue(since)},created_at.gte.${queryValue(since)})`);
  }

  /* Minimum monthly salary (₹). Jobs without salary data always remain —
     the previous client-side filter kept them, and so does the server. */
  const minSalary = Number(query.min_salary);
  if (Number.isFinite(minSalary) && minSalary > 0) {
    filters.push(`or=(salary_min=gte.${queryValue(String(minSalary))},salary_min=is.null,salary=eq."")`);
  }

  return filters;
}

function buildJobListQuery(query, { admin = false } = {}) {
  const page = positiveInt(query.page, 1, 1000000);
  const limit = positiveInt(query.limit, 40, 100);
  const offset = (page - 1) * limit;
  const order = String(query.sort || 'new') === 'oldest'
    ? 'created_at.asc'
    : String(query.sort || 'new') === 'deadline'
      ? 'deadline.asc.nullslast'
      : 'created_at.desc';
  const fields = admin ? '*' : PUBLIC_JOB_FIELDS.join(',');
  const filters = buildJobFilters(query, { admin });
  filters.push(`order=${order}`);
  filters.push(`offset=${offset}`);
  filters.push(`limit=${limit}`);
  return { path: `jobs?select=${encodeURIComponent(fields)}&${filters.join('&')}`, page, limit, offset };
}

/* Homepage/live summary counts — real database counts, bounded queries. */
async function getJobSummary() {
  const makeCount = (sector) => {
    const filters = buildJobFilters({ sector });
    return supa(`jobs?select=id&${filters.join('&')}&limit=1`, {
      headers: { Prefer: 'count=exact' },
    });
  };
  const [privateResponse, governmentResponse] = await Promise.all([
    makeCount('Private'),
    makeCount('Government'),
  ]);
  const countFrom = (response) => {
    const range = response.headers.get('content-range') || '';
    const match = range.match(/\/(\d+)$/);
    return match ? Number(match[1]) : null;
  };
  return {
    private: countFrom(privateResponse),
    government: countFrom(governmentResponse),
  };
}

function setPublicCache(res, seconds = 60) {
  res.setHeader('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=${Math.max(seconds * 5, 300)}`);
  res.setHeader('Vary', 'Accept-Encoding');
}

function setPrivateNoStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
}

/* SSRF-safe URL validation for discovery-sourced URLs. */
function safeSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/* Internal admin-review quality signals. Never shown to candidates. */
function qualityFlagsForItem(item, structured, applicationUrl) {
  const flags = [];
  const company = discoveryCleanText(item.company || '');
  const snippet = discoveryCleanText(item.description || item.snippet || '');
  const src = String(item._source || item.source || '').toLowerCase();
  if (!company) flags.push('missing_company');
  if (!structured.rawLocation) flags.push('missing_location');
  if (!applicationUrl) flags.push('missing_application_url');
  if (snippet.length < 80) flags.push('short_description');
  if (!structured.rawLocation && isTrustedIndiaSource(src)) {
    flags.push('trusted_source_location_missing');
  }
  return flags;
}

async function getJobById(id) {
  const response = await supa(
    `jobs?select=*&id=eq.${encodeURIComponent(id)}&published=eq.true&or=(expires_at.gte.${encodeURIComponent(new Date().toISOString())},expires_at.is.null)&limit=1`
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

  /* Salary structured data only when the unit is known. LPA values are
     converted to annual rupees; ambiguous units are omitted, never guessed. */
  const salaryText = String(job.salary || '').toLowerCase();
  const explicitUnit = String(job.salary_unit || job.salary_period || '').toUpperCase();
  let unitText = ['HOUR','DAY','MONTH','YEAR'].includes(explicitUnit) ? explicitUnit : '';
  if (!unitText && /\b(per month|monthly|month)\b/.test(salaryText)) unitText = 'MONTH';
  if (!unitText && /\b(per year|yearly|annual|annually|lpa|pa)\b/.test(salaryText)) unitText = 'YEAR';

  if ((job.salary_min != null || job.salary_max != null) && unitText) {
    let minValue = job.salary_min != null ? Number(job.salary_min) : undefined;
    let maxValue = job.salary_max != null ? Number(job.salary_max) : undefined;
    if (unitText === 'YEAR' && /\blpa\b/.test(salaryText)) {
      if (Number.isFinite(minValue) && minValue < 100000) minValue *= 100000;
      if (Number.isFinite(maxValue) && maxValue < 100000) maxValue *= 100000;
    }
    schema.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salary_currency || 'INR',
      value: {
        '@type': 'QuantitativeValue',
        ...(Number.isFinite(minValue) ? { minValue } : {}),
        ...(Number.isFinite(maxValue) ? { maxValue } : {}),
        unitText,
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

    // Client-generated URLs end with the database id (role-company-<id>). Older
    // rows can lack a matching stored slug, so fall back to that trailing id.
    if (!job) {
      const tail = slug.split('-').pop();
      if (tail && tail !== slug && /^[0-9a-f-]{36}$/i.test(tail)) {
        job = await getJobById(tail);
      }
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

<link rel="stylesheet" href="/styles.css">

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
  parseRssItems: discoveryParseRssItems,
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
// One RSS/Atom parser for the whole project (lib/discovery-core.js): the news
// fetchers here and the company vacancy search both use it, so feed quirks
// (CDATA, entities, Atom <link href>) are fixed in exactly one place.
function parseDiscoveryRss(xml) {
  return discoveryParseRssItems(xml);
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
  if (!safeSourceUrl(url)) return { reject: { reason: 'quality: invalid or unsafe source URL' } };

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

  const applicationUrl = discoveryCleanText(item.application_url || item.apply_url || '');
  if (applicationUrl && !safeSourceUrl(applicationUrl)) {
    return { reject: { reason: 'quality: invalid application URL supplied by source' } };
  }
  const qualityFlags = qualityFlagsForItem(item, structured, applicationUrl);

  return {
    item: {
      title,
      url,
      snippet: snippet.slice(0, 800),
      pubDate: String(item.pubDate || item.published_at || item.posted_at || ''),
      postedIso: fresh.postedIso,
      source: discoveryCleanText(item.sourceLabel || '') || src || discoverySourceHost(url) || 'Public web',
      company: discoveryCleanText(item.company || ''),
      location: structured.rawLocation,
      country: structured.country,
      state: structured.state,
      city: structured.city,
      application_url: applicationUrl,
      salary: discoveryCleanText(item.salary || ''),
      employment_type: discoveryCleanText(
        Array.isArray(item.employment_type) ? item.employment_type.join(', ') : (item.employment_type || '')
      ),
      qualityFlags,
      qualityScore: Math.max(0, 100 - (qualityFlags.length * 15)),
      companyCareersPage: Boolean(item._company),
      ageMs: fresh.ageMs,
      ageHours: fresh.ageMs === null ? null : fresh.ageMs / 3600000,
      ageDisplay: fresh.ageMs === null ? null : discoveryFormatAge(fresh.ageMs),
      dateIsArticleDate: isNewsSource(src),
      _sourceId: String(item._sourceId || ''),
    },
    bucket: fresh.bucket,
  };
}

/* ── FREE-MODEL DRAFT ENRICHMENT ──────────────────────────────────────
   The deterministic gates above decide which vacancies enter the queue — AI
   never decides admission. It only fills in detail the source did not provide
   (experience, qualification, salary, a clean summary) so the admin has less
   typing to do, and it runs through the free-tier failover chain in
   lib/ai-models.js: when one free limit is exhausted the next provider is used
   automatically, and several keys can be listed in one variable.

   Capped and best-effort by design. No provider configured, every quota
   exhausted, or an unusable answer all leave the draft exactly as the
   pipeline built it. Enrichment can never lose a draft, corrupt a field or
   fail the run — and it can never invent a salary, city or company, because
   the prompt forbids it and empty answers are ignored.
*/
const AI_ENRICH_PER_RUN = 12;

function keepFirst(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

async function enrichDraftsWithAI(drafts) {
  const stat = { attempted: 0, enriched: 0, failed: 0, provider: '', skipped: '' };

  if (!Array.isArray(drafts) || !drafts.length) { stat.skipped = 'no drafts to enrich'; return stat; }

  // Lazy require so a problem in the AI module can never break the jobs API.
  let ai;
  try {
    ai = require('../lib/ai-models');
  } catch (err) {
    stat.skipped = 'AI module unavailable';
    return stat;
  }
  if (!ai.providerStatus().some(p => p.configured)) {
    stat.skipped = 'no free AI provider configured';
    return stat;
  }

  for (const draft of drafts.slice(0, AI_ENRICH_PER_RUN)) {
    stat.attempted += 1;

    const prompt = `You are completing a civil-engineering vacancy form for India.
Use ONLY the information in the posting below. Never invent a salary, a company, a city or an experience requirement: when the posting does not state it, return an empty string for that field.

Job title: ${draft.role || ''}
Company: ${draft.company || ''}
Location: ${draft.location || ''}
Source: ${draft.source || ''}
Posting text:
${String(draft.description || '').slice(0, 1500)}

Return ONLY this JSON object, with no markdown and no explanation:
{
  "role": "the job title, cleaned up",
  "company": "hiring company or organisation, or empty string",
  "location": "city, state — India only, or empty string",
  "experience_level": "e.g. 0-2 years / 3-5 years / Fresher, or empty string",
  "qualification": "e.g. B.E./B.Tech Civil, Diploma Civil, or empty string",
  "salary": "the salary range exactly as stated, or empty string",
  "employment_type": "Full-time / Contract / Internship, or empty string",
  "summary": "2-3 sentence factual summary of the role"
}`;

    try {
      const out = await ai.chatJSON({ prompt, maxTokens: 700, temperature: 0.1 });
      const data = out && out.json;
      if (!data || typeof data !== 'object') { stat.failed += 1; continue; }

      // Only ever FILL BLANKS. Anything the pipeline or the source already
      // established is the record of truth and is never overwritten.
      draft.role             = keepFirst(draft.role, data.role);
      draft.role_normalized  = keepFirst(draft.role_normalized, draft.role);
      draft.company          = keepFirst(draft.company, data.company);
      draft.location         = keepFirst(draft.location, data.location);
      draft.location_display = keepFirst(draft.location_display, draft.location);
      draft.experience_level = keepFirst(draft.experience_level, data.experience_level);
      draft.qualification    = keepFirst(draft.qualification, data.qualification);
      draft.salary           = keepFirst(draft.salary, data.salary);
      draft.employment_type  = keepFirst(draft.employment_type, data.employment_type);

      // A real summary beats our generic placeholder sentence; a real source
      // snippet beats the model's paraphrase.
      if (typeof data.summary === 'string' && data.summary.trim() && /^Vacancy discovered from/i.test(String(draft.description || ''))) {
        draft.description = data.summary.trim();
      }

      stat.enriched += 1;
      stat.provider = stat.provider || out.provider;
    } catch (err) {
      stat.failed += 1;
    }
  }

  return stat;
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

  // The discovery tracks are independent, so they are STARTED here and awaited
  // further down. Starting them together makes a run cost the slowest track
  // instead of the sum of all of them — which matters because the company
  // career track fetches real websites and is the slowest of the three.
  const runBucket = Math.floor(nowMs / (4 * 60 * 60 * 1000));

  const companyCareersPromise = runCompanyCareerSources({ runBucket }).catch(err => ({
    jobs: [],
    stat: { ...newSourceStat('company_careers', true), ok: false, error: String(err?.message || err) },
  }));

  const configuredPromise = runConfiguredSources({ q: query, location: requestedLocation }).catch(err => ({
    jobs: [],
    stats: {
      configured_sources: { ...newSourceStat('configured_sources', false), ok: false, error: String(err?.message || err) },
    },
  }));

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

  // ── COMPANY CAREER PAGES (started above) ──
  // A rotating slice of the curated top-Indian-employer list (lib/company-
  // careers.js). A vacancy published only on a company's own website is
  // invisible to job boards, so this track reads their careers pages directly
  // (schema.org JobPosting + job-detail links). Rotation keeps a 4-hourly run
  // inside the function execution limit while still covering every company on
  // the list within a few runs.
  const companyRun = await companyCareersPromise;
  sourceStats.company_careers = companyRun.stat;
  all.push(...companyRun.jobs);

  // Configured providers (SerpApi / Adzuna / The Muse / Jobvetta) — attempted
  // only when their keys exist; a missing key never fails the run. Provider
  // stats merge into sourceStats under their provider keys so the dashboard
  // can see every track (items accepted/rejected per provider).
  const configured = await configuredPromise;
  for (const [key, cs] of Object.entries(configured.stats || {})) {
    sourceStats[key] = cs;
  }
  all.push(...(Array.isArray(configured.jobs) ? configured.jobs : []));

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
  const existingUrls   = new Set(existingRows.map(r => normalizeJobUrl(r.source_url)).filter(Boolean));
  const existingTitles = new Set(existingRows.map(r => `${discoveryNormText(discoveryRole(r.role))}|${discoveryNormText(r.company || '')}`));

  const now   = new Date().toISOString();
  const fresh = limited.filter(x => {
    const company   = x.company || discoveryCompany(x.title, x.snippet);
    const urlKey    = normalizeJobUrl(x.url);
    const titleKey  = `${discoveryNormText(discoveryRole(x.title))}|${discoveryNormText(company)}`;
    if (urlKey && existingUrls.has(urlKey)) return false;
    if (company && existingTitles.has(titleKey)) return false;
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
      experience_level:    '',
      qualification:       '',
      salary:              item.salary || '',
      employment_type:     item.employment_type || '',
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

  // Fill in the detail the source did not provide (free-model failover chain).
  // Never decides admission, never invents data, never fails the run.
  const aiEnrichment = await enrichDraftsWithAI(drafts);

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
    aiEnrichment,
    companyCareerSources: {
      total:        CAREER_COMPANIES.length,
      companies:    CAREER_COMPANIES.map(c => ({ name: c.name, domain: c.domain })),
    },
    sourceStats,
    configuredSources:    Object.entries(sourceStats)
      .filter(([key, x]) => x.configured && ![
        'google_news','bing_news','jobicy','arbeitnow','onjob','hopin','company_careers',
      ].includes(key))
      .map(([key]) => key),
    runAt:                now,
    persistenceWarning,
    note: 'Source-specific validation: news = strict vacancy+India evidence; job boards = structured location checks; Hopin/OnJob/company careers pages = trusted India sources (foreign records still rejected); fresh24h <= 24h and backup30d 24h-30d use exact ms with no rounding; unknown dates are excluded from both queues and never defaulted to today. A web-search crawl date is never used as a posting date. Application URLs are only used when the source itself provides them (a company careers page, Hopin apply_url, or Hopin\'s documented per-id API route); no URL is ever fabricated and no India location is inferred from the search query.',
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

/* Scheduled-discovery authorisation.

   Preferred: the CRON_SECRET bearer token that Vercel Cron sends
   automatically once CRON_SECRET exists in the project environment — or the
   owner key, which lets GitHub Actions and manual runs trigger the exact same
   canonical pipeline.

   The original user-agent-only check is kept ONLY as a fallback for
   deployments that have not set CRON_SECRET yet, and only while it is unset:
   a spoofable header on its own would let any stranger trigger discovery runs
   and burn the configured API quotas. */
function isCronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '');
  if (secret) {
    if (String(req.headers['authorization'] || '') === `Bearer ${secret}`) return true;
    if (String(req.headers['x-cron-secret'] || '') === secret) return true;
  }
  if (isAdmin(req)) return true;
  if (!secret && /vercel-cron\/1\.0/i.test(String(req.headers['user-agent'] || ''))) return true;
  return false;
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

function normalizeMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Matches an existing active job by source URL or by role+company so the
// admin sees "already exists" before a second copy is saved. Targeted
// server-side lookups — never a 1,000-row browser-side scan.
async function findDuplicateJob(job) {
  try {
    const sourceUrl = String(job.source_url || job.apply_url || '').trim();
    if (sourceUrl) {
      const normalizedUrl = normalizeMatch(sourceUrl).replace(/\/$/, '');
      const r = await supa(`jobs?select=id,role,company,source_url,apply_url&published=eq.true&or=(source_url.ilike.${queryValue(`*${sourceUrl}*`)},apply_url.ilike.${queryValue(`*${sourceUrl}*`)})&limit=10`);
      if (r.ok) {
        const rows = await r.json();
        const byUrl = rows.find(row => {
          const rowUrl = normalizeMatch(row.source_url || row.apply_url).replace(/\/$/, '');
          return rowUrl && normalizedUrl && (rowUrl === normalizedUrl || rowUrl.includes(normalizedUrl) || normalizedUrl.includes(rowUrl));
        });
        if (byUrl) return byUrl;
      }
    }

    const role = String(job.role || '').trim();
    const company = String(job.company || '').trim();
    if (role || company) {
      const filters = [];
      if (role) filters.push(`role=ilike.${queryValue(`*${role}*`)}`);
      if (company) filters.push(`company=ilike.${queryValue(`*${company}*`)}`);
      const r = await supa(`jobs?select=id,role,company,source_url,apply_url&published=eq.true&${filters.join('&')}&limit=20`);
      if (r.ok) {
        const rows = await r.json();
        const incoming = normalizeMatch(`${role} ${company}`);
        return rows.find(row => normalizeMatch(`${row.role || ''} ${row.company || ''}`) === incoming) || null;
      }
    }

    return null;
  } catch (_) {
    return null; // never block saving because the duplicate check failed
  }
}

module.exports = async function handler(req, res) {
  const startedAt = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    if (!res.headersSent) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
    }
    return originalEnd(...args);
  };
  if (!allowSameOrigin(req, res)) return;
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key,Authorization');

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
    if (String(req.query?.discovery || '') === 'cron') {
      if (!isCronAuthorized(req)) {
        return res.status(401).json({
          ok: false,
          error: 'Scheduled discovery requires CRON_SECRET (Bearer token) or the owner key.',
        });
      }
      try {
        const result = await runPublicDiscovery({ q: 'civil engineering jobs India', location: 'India', type: 'all' });
        return res.status(200).json({ ok: true, ...result });
      } catch (err) {
        return res.status(502).json({ ok: false, error: 'Scheduled discovery failed', details: err.message });
      }
    }
    if (String(req.query?.render || '') === 'html') return renderJobPage(req, res);

    if (String(req.query?.summary || '') === '1') {
      try {
        const summary = await getJobSummary();
        setPublicCache(res, 60);
        return res.status(200).json({ ok: true, ...summary });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to load job summary', details: err.message });
      }
    }

    const slug = typeof req.query?.slug === 'string' ? req.query.slug.trim() : '';
    const id   = typeof req.query?.id   === 'string' ? req.query.id.trim()   : '';

    // Admin identification: the presence of the header selects the admin code
    // path; requireOwner validates it (constant-time + failure limiting).
    const hasOwnerHeader = Boolean(req.headers['x-owner-key']);
    if (hasOwnerHeader && !requireOwner(req, res)) return;
    const admin = hasOwnerHeader && isAdmin(req);
    if (admin) setPrivateNoStore(res);

    try {
      if (slug || id) {
        const key = slug ? `slug=eq.${encodeURIComponent(slug)}` : `id=eq.${encodeURIComponent(id)}`;
        const filters = admin
          ? [key]
          : [key, 'published=eq.true', `or=(expires_at.gte.${queryValue(new Date().toISOString())},expires_at.is.null)`];
        const r = await supa(`jobs?select=${encodeURIComponent(admin ? '*' : PUBLIC_JOB_FIELDS.join(','))}&${filters.join('&')}&limit=1`);
        if (!r.ok) {
          const detail = await r.text();
          return res.status(500).json({ error: 'Failed to load job', details: detail });
        }
        const rows = await r.json();
        const job = rows[0] || null;
        if (!admin && job && isExpired(job)) return res.status(404).json({ job: null });
        if (!admin) setPublicCache(res, 300);
        return res.status(200).json({ job: admin ? job : (job ? publicJob(job) : null) });
      }

      const { path, page, limit, offset } = buildJobListQuery(req.query || {}, { admin });
      const r = await supa(path, {
        headers: {
          Prefer: 'return=representation,count=exact',
          Range: `${offset}-${offset + limit - 1}`,
        },
      });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(500).json({ error: 'Failed to load jobs', details: detail });
      }
      const rows = await r.json();
      const visible = admin ? rows : publicJobs(rows);
      const range = r.headers.get('content-range') || '';
      const countMatch = range.match(/\/(\d+)$/);
      const total = countMatch ? Number(countMatch[1]) : visible.length;
      if (!admin) setPublicCache(res, 60);
      return res.status(200).json({
        jobs: visible,
        meta: { page, limit, total, pages: Math.ceil(total / limit) || 1, has_next: offset + limit < total },
      });
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

      // Duplicate guard — tell the admin when the vacancy is already listed
      // instead of silently creating a second copy.
      if (!rest.confirm_duplicate) {
        const dupe = await findDuplicateJob(rest);
        if (dupe) {
          return res.status(409).json({
            error: `This job already exists on CivilCareer as "${dupe.role || dupe.id}" (${dupe.company || 'same employer'}).`,
            existing_id: dupe.id,
          });
        }
      }

      /* REVIEW-FIRST SAFETY: generic job creation never publishes. A new job
         enters as an unpublished Pending Review record; publishing is always
         an explicit admin action (the editor's "Save & Publish" sends
         published:true itself, or a Publish button PATCHes it afterwards). */
      if (typeof rest.published !== 'boolean') rest.published = false;
      if (rest.published === true) {
        if (!rest.review_state) rest.review_state = 'Published';
      } else {
        if (!rest.review_state) rest.review_state = 'Pending Review';
        if (!rest.status || rest.status === 'Active') rest.status = 'Pending Review';
      }
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
  isExpired,
  canonicalExpiry,
  publicJob,
  publicJobs,
  buildJobFilters,
  buildJobListQuery,
  buildJobPosting,
  safeSourceUrl,
  qualityFlagsForItem,
};
