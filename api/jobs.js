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
    // Normal case: the URL contains the stored slug.
    let job = await getJobBySlug(slug);

    // Compatibility: if an old link uses the UUID directly, resolve it.
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

    res.setHeader(
      'Content-Type',
      'text/html; charset=utf-8'
    );

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=900'
    );
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
   Free/public sources only. No login, scraping bypass, or paid API required.
   Direct source APIs are used only where their published terms allow reuse;
   search-engine/news feeds are used for public indexed discovery.
   ───────────────────────────────────────────────────────────────────── */

const DISCOVERY_SITES = [
  'linkedin.com/jobs',
  'naukri.com',
  'indeed.com',
  'foundit.in',
  'timesjobs.com',
  'shine.com',
  'apna.co',
  'workindia.in',
  'freshersworld.com',
  'gov.in',
  'nic.in'
];

const DISCOVERY_KEYWORDS = [
  'civil engineer',
  'site engineer',
  'planning engineer',
  'quantity surveyor',
  'structural engineer',
  'construction engineer',
  'project engineer',
  'estimation engineer',
  'billing engineer',
  'qa qc civil',
  'bim engineer',
  'junior civil engineer',
  'assistant engineer',
  'civil engineering vacancy',
  'civil recruitment',
  'pwd engineer',
  'nhai engineer'
];

const DISCOVERY_CITY_WORDS = [
  'bengaluru',
  'bangalore',
  'mumbai',
  'delhi',
  'new delhi',
  'hyderabad',
  'chennai',
  'pune',
  'ahmedabad',
  'kolkata',
  'kochi',
  'jaipur',
  'gurugram',
  'gurgaon',
  'noida',
  'lucknow',
  'indore',
  'nagpur',
  'surat',
  'bhubaneswar',
  'patna',
  'thiruvananthapuram'
];

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanDiscoveryText(value) {
  return decodeXml(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDiscoveryRss(xml) {
  const items = [];

  for (
    const block of String(xml || '').match(
      /<item>[\s\S]*?<\/item>/gi
    ) || []
  ) {
    const get = tag => {
      const m = block.match(
        new RegExp(
          `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
          'i'
        )
      );

      return m ? cleanDiscoveryText(m[1]) : '';
    };

    const title = get('title');
    const link = get('link');
    const description = get('description');
    const pubDate = get('pubDate');
    const source = get('source');

    if (title && link) {
      items.push({
        title,
        link,
        description,
        pubDate,
        source
      });
    }
  }

  return items;
}

function discoverySourceHost(url) {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

function discoveryNorm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function discoveryRole(title) {
  const t = cleanDiscoveryText(title);

  return (
    t.replace(
      /\s+(?:-|–|—|at|@|\|)\s+[^|–—-]{2,100}$/i,
      ''
    ).trim() || t
  );
}

function discoveryCompany(title, description) {
  const t = cleanDiscoveryText(title);

  let m = t.match(
    /\s+(?:-|–|—|at|@|\|)\s+([^|–—-]{2,100})$/i
  );

  if (m) return m[1].trim();

  m = cleanDiscoveryText(description).match(
    /(?:company|employer)\s*[:\-]\s*([^.|]+)/i
  );

  return m ? m[1].trim() : '';
}

function discoveryLocation(text, requestedLocation) {
  const hay = discoveryNorm(
    `${requestedLocation || ''} ${text}`
  );

  for (const city of DISCOVERY_CITY_WORDS) {
    if (hay.includes(city)) {
      return city.replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  return /\bindia\b|pan india|all india/.test(hay)
    ? 'India'
    : requestedLocation || 'India';
}

function discoverySector(text) {
  return /government|govt|psu|public sector|recruitment|commission|authority|department|board|pwd|nhai|cpwd|railway/.test(
    discoveryNorm(text)
  )
    ? 'Government'
    : 'Private';
}


/*
 * IMPORTANT:
 *
 * The old version checked the title AND description together.
 * That allowed unrelated jobs to pass when the description happened
 * to contain words such as "civil", "infrastructure", or "construction".
 *
 * This version makes the TITLE the primary civil-engineering test.
 */

function discoveryIsCivil(title, description) {
  const titleNorm = discoveryNorm(title);
  const textNorm = discoveryNorm(
    `${title} ${description}`
  );

  const civilTitlePatterns = [
    /\bcivil engineer\b/,
    /\bcivil engineering\b/,
    /\bsite engineer\b/,
    /\bsite engineering\b/,
    /\bplanning engineer\b/,
    /\bplanning engineering\b/,
    /\bquantity surveyor\b/,
    /\bquantity surveying\b/,
    /\bstructural engineer\b/,
    /\bstructural engineering\b/,
    /\bconstruction engineer\b/,
    /\bconstruction engineering\b/,
    /\bproject engineer\b/,
    /\bproject engineering\b/,
    /\bestimation engineer\b/,
    /\bbilling engineer\b/,
    /\bqa qc civil\b/,
    /\bqa qc engineer\b/,
    /\bbim engineer\b/,
    /\bjunior civil engineer\b/,
    /\bassistant civil engineer\b/,
    /\bcivil engineering manager\b/,
    /\bcivil project manager\b/,
    /\bcivil works\b/,
    /\bconstruction manager\b/,
    /\bconstruction project manager\b/,
    /\binfrastructure engineer\b/,
    /\bhighway engineer\b/,
    /\bbridge engineer\b/,
    /\btransportation engineer\b/,
    /\bgeotechnical engineer\b/,
    /\bgeotechnical engineering\b/,
    /\bwater resources engineer\b/,
    /\birrigation engineer\b/,
    /\bstructural designer\b/,
    /\bcivil designer\b/,
    /\bcivil supervisor\b/,
    /\bsite supervisor\b/,
    /\bresident engineer\b/
  ];

  const hasCivilTitle =
    civilTitlePatterns.some(re => re.test(titleNorm));

  if (hasCivilTitle) {
    return true;
  }

  /*
   * Reject common unrelated engineering roles.
   * These must be checked against the TITLE only.
   */
  const unrelatedTitle = [
    /\bsoftware engineer\b/,
    /\bdata engineer\b/,
    /\bdevops engineer\b/,
    /\bfrontend engineer\b/,
    /\bbackend engineer\b/,
    /\bfull stack\b/,
    /\bmachine learning\b/,
    /\bai engineer\b/,
    /\bml engineer\b/,
    /\bcloud engineer\b/,
    /\bnetwork engineer\b/,
    /\bsecurity engineer\b/,
    /\bqa engineer\b/,
    /\btest engineer\b/,
    /\bautomation engineer\b/,
    /\bcustomer engineer\b/,
    /\bsales engineer\b/,
    /\bsolutions engineer\b/,
    /\bapplication engineer\b/,
    /\bproduct engineer\b/,
    /\bproduct manager\b/,
    /\bproject manager\b/,
    /\bengineering manager\b/,
    /\bengineering lead\b/
  ];

  if (unrelatedTitle.some(re => re.test(titleNorm))) {
    return false;
  }

  /*
   * Final fallback for title wording such as:
   * "Engineer - Civil & Infrastructure"
   * "Civil / Construction Engineer"
   */
  return (
    /\bcivil\b.*\b(engineer|engineering|works|construction)\b/.test(
      titleNorm
    ) ||
    /\b(engineer|engineering)\b.*\b(civil|construction|structural|highway|bridge|geotechnical)\b/.test(
      titleNorm
    ) ||
    /\bquantity surveyor\b/.test(titleNorm) ||
    /\bsite engineer\b/.test(titleNorm)
  );
}


/*
 * Location filtering.
 *
 * Previously, a missing source location could ultimately become
 * "India". That is unsafe for an India-only discovery search.
 *
 * For India searches we now require positive India evidence.
 */

function discoveryMatchesLocation(item, requestedLocation) {
  const requested = discoveryNorm(
    requestedLocation || 'India'
  );

  const title = discoveryNorm(item.title);
  const location = discoveryNorm(item.location || '');
  const description = discoveryNorm(
    item.description || item.snippet || ''
  );
  const source = discoveryNorm(
  item.source ||
  item._source ||
  ''
);

  if (
    requested === 'india' ||
    requested.includes('india')
  ) {
    const indiaCities =
      DISCOVERY_CITY_WORDS.map(discoveryNorm);
    const indiaStates = [
  'andhra pradesh',
  'arunachal pradesh',
  'assam',
  'bihar',
  'chhattisgarh',
  'goa',
  'gujarat',
  'haryana',
  'himachal pradesh',
  'jharkhand',
  'karnataka',
  'kerala',
  'madhya pradesh',
  'maharashtra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha',
  'orissa',
  'punjab',
  'rajasthan',
  'sikkim',
  'tamil nadu',
  'telangana',
  'tripura',
  'uttar pradesh',
  'uttarakhand',
  'west bengal',
  'delhi',
  'jammu and kashmir',
  'ladakh',
  'chandigarh',
  'puducherry'
].map(discoveryNorm);

   const indiaSignals = [
  'india',
  'indian',
  'pan india',
  'all india',
  'remote india',
  ...indiaCities,
  ...indiaStates
];

    const hay =
      `${location} ${title} ${description} ${source}`;

    const hasIndiaSignal = indiaSignals.some(term => {
      if (term === 'indian') {
        return /\bindian\b/.test(hay);
      }

      if (term === 'india') {
        return /\bindia\b/.test(hay);
      }

      return hay.includes(term);
    });

    /*
     * Explicit foreign locations are rejected even if another part
     * of the text happens to contain "India".
     */
    const foreignSignals = [
      'germany',
      'berlin',
      'hamburg',
      'munich',
      'france',
      'paris',
      'london',
      'united kingdom',
      'uk',
      'england',
      'scotland',
      'ireland',
      'usa',
      'united states',
      'canada',
      'australia',
      'singapore',
      'dubai',
      'uae',
      'netherlands',
      'amsterdam',
      'spain',
      'madrid',
      'italy',
      'milan',
      'switzerland',
      'zurich',
      'sweden',
      'stockholm',
      'denmark',
      'norway',
      'poland',
      'warsaw',
      'belgium',
      'brussels',
      'portugal',
      'lisbon'
    ];

  const foreignMatchText =
  `${location} ${title} ${description}`;

const hasForeignSignal =
  foreignSignals.some(term => {
    const escaped = term.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    return new RegExp(
      `\\b${escaped}\\b`,
      'i'
    ).test(foreignMatchText);
  });

if (hasForeignSignal) {
  return false;
}

    /*
     * CRITICAL:
     * Missing location is NOT assumed to be India.
     */
    return hasIndiaSignal;
  }

  /*
   * For another requested location, require that location to occur
   * in the available source information.
   */
  const hay =
    `${location} ${title} ${description}`;

  return hay.includes(requested);
}


function discoveryQueries(q, location) {
  const base = cleanDiscoveryText(
    q || 'civil engineering jobs'
  );

  const loc = cleanDiscoveryText(
    location || 'India'
  );

  const generic = [
    `${base} ${loc}`
  ];

  for (
    const role of DISCOVERY_KEYWORDS.slice(0, 7)
  ) {
    generic.push(`${role} ${loc}`);
  }

  const siteQueries =
    DISCOVERY_SITES
      .slice(0, 7)
      .map(
        site =>
          `site:${site} ${base} ${loc}`
      );

  return [
    ...generic,
    ...siteQueries
  ].slice(0, 14);
}

async function fetchText(url, headers = {}) {
  const r = await fetch(url, {
    headers: {
      'User-Agent':
        'CivilCareer public vacancy discovery/1.0',
      'Accept':
        'application/rss+xml, application/json, text/xml, text/plain;q=0.9, */*',
      ...headers
    },
    signal: AbortSignal.timeout(5000),
    redirect: 'follow'
  });

  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }

  return await r.text();
}


async function discoveryFetchGoogleNews(query) {
  const url =
    `https://news.google.com/rss/search?q=` +
    `${encodeURIComponent(`${query} when:1d`)}` +
    `&hl=en-IN&gl=IN&ceid=IN:en`;

  return parseDiscoveryRss(
    await fetchText(url)
  );
}


async function discoveryFetchBingNews(query) {
  const url =
    `https://www.bing.com/news/search?q=` +
    `${encodeURIComponent(
      `${query} after:${new Date(
        Date.now() - 86400000
      ).toISOString().slice(0, 10)}`
    )}` +
    `&format=rss`;

  return parseDiscoveryRss(
    await fetchText(url)
  );
}


async function discoveryFetchJobicy(query) {
  const tag =
    (
      query.match(
        /civil engineer|site engineer|planning engineer|quantity surveyor|structural engineer|construction engineer|project engineer|bim engineer/i
      ) || ['civil']
    )[0];

  const url =
    `https://jobicy.com/api/v2/remote-jobs` +
    `?count=50&tag=${encodeURIComponent(tag)}`;

  const raw = JSON.parse(
    await fetchText(url, {
      Accept: 'application/json'
    })
  );

  return (raw.jobs || []).map(j => ({
    title: j.jobTitle || '',
    link: j.url || '',
    description: cleanDiscoveryText(
      j.jobExcerpt ||
      j.jobDescription ||
      ''
    ),
    pubDate: j.pubDate || '',
    source: 'jobicy.com',
    company: j.companyName || '',
    location: j.jobGeo || ''
  }));
}
async function discoveryFetchArbeitnow() {
  const raw = JSON.parse(
    await fetchText(
      'https://www.arbeitnow.com/api/job-board-api',
      {
        Accept: 'application/json'
      }
    )
  );

  return (raw.data || []).map(j => ({
    title: j.title || '',
    link: j.url || '',
    description: cleanDiscoveryText(
      j.description || ''
    ),
    pubDate: j.created_at
      ? new Date(
          j.created_at * 1000
        ).toISOString()
      : (j.created_at || ''),
    source: 'arbeitnow.com',
    company:
      j.company_name ||
      j.company ||
      '',
    location: j.location || ''
  }));
}


async function discoveryFetchOnJob() {
  const raw = JSON.parse(
    await fetchText(
      'https://onjob.io/feeds/jobs.json',
      {
        Accept: 'application/json'
      }
    )
  );

  return (raw.jobs || []).map(j => ({
    title: j.title || '',
    link: j.url || '',
    description: cleanDiscoveryText(
      j.descriptionHtml ||
      j.description ||
      ''
    ),
    pubDate: j.datePosted || '',
    source: 'onjob.io',
    company: j.company || '',
    location: j.location || '',
    application_url:
      j.applyUrl ||
      j.url ||
      ''
  }));
}


/*
 * Normalize one discovered listing.
 *
 * The important filtering order is:
 *
 * 1. Must have a title and URL.
 * 2. Must be a genuine civil/construction role.
 * 3. Must match the requested location.
 * 4. Must be recent enough.
 */

function discoveryAgeLabel(ageHours) {
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return '';
  }

  const minutes = Math.floor(ageHours * 60);

  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  const weeks = Math.floor(days / 7);

  if (days < 30) {
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function normalizeDiscoveryItem(
  item,
  requestedLocation,
  sourceLabel
) {
  const title =
    cleanDiscoveryText(item.title);

  const snippet =
    cleanDiscoveryText(
      item.description ||
      item.snippet ||
      ''
    );

  const url =
    item.link ||
    item.url ||
    '';

  if (
    !title ||
    !url ||
    !discoveryIsCivil(
      title,
      snippet
    )
  ) {
    return null;
  }

  /*
   * New location gate.
   *
   * This is what stops:
   * - Germany
   * - France
   * - London
   * - US
   * - Canada
   * etc.
   *
   * from being stored during an India search.
   */
  if (
    !discoveryMatchesLocation(
      item,
      requestedLocation
    )
  ) {
    return null;
  }

  const parsed = Date.parse(
    item.pubDate ||
    item.published_at ||
    ''
  );

  const age =
    Number.isFinite(parsed)
      ? Date.now() - parsed
      : (
          Number.isFinite(item.ageHours)
            ? item.ageHours * 3600000
            : null
        );

  /*
   * Keep the existing 48-hour source validation.
   *
   * The later queue logic reduces this to the
   * requested 24-hour fresh-job window.
   */
  if (
  age !== null &&
  age < -2 * 3600000
) {
  return null;
}

  const source =
    sourceLabel ||
    item.source ||
    discoverySourceHost(url) ||
    'Public web';

  return {
    title,
    url,
    snippet: snippet.slice(0, 800),
    pubDate:
      item.pubDate || '',
    source,
    company:
      item.company || '',
    location:
      item.location ||
      '',
    ageHours:
      age === null
        ? null
        : Math.max(
            0,
            age / 3600000
          )
  };
}


async function runPublicDiscovery({
  q,
  location,
  type
} = {}) {
  const requestedLocation =
    cleanDiscoveryText(
      location || 'India'
    );

  const query =
    cleanDiscoveryText(
      q ||
      'civil engineering jobs India'
    );

  const sourceStats = {};
  const all = [];


  /*
   * Configured providers are independent.
   *
   * A missing key, quota response, or outage
   * must not stop the public feeds.
   */
  const configured =
    await runConfiguredSources({
      q: query,
      location: requestedLocation
    });

  Object.assign(
    sourceStats,
    configured.stats
  );

  all.push(
    ...configured.jobs
  );


  /*
   * Public no-key sources.
   */
  const publicSources = [
    [
      'google_news',
      () =>
        discoveryFetchGoogleNews(
          `${query} ${requestedLocation}`
        )
    ],

    [
      'bing_news',
      () =>
        discoveryFetchBingNews(
          `${query} ${requestedLocation}`
        )
    ],

    [
      'jobicy',
      () =>
        discoveryFetchJobicy(
          query
        )
    ],

    [
      'arbeitnow',
      () =>
        discoveryFetchArbeitnow()
    ],

    [
      'onjob',
      () =>
        discoveryFetchOnJob()
    ]
  ];


  const publicResults =
    await Promise.allSettled(
      publicSources.map(
        ([, fn]) => fn()
      )
    );


  publicResults.forEach(
    (result, i) => {
      const name =
        publicSources[i][0];

      if (
        result.status ===
        'fulfilled'
      ) {
        const rows =
          result.value || [];

        sourceStats[name] = {
          name,
          configured: true,
          ok: true,
          items: rows.length,
          error: null,
          remaining: null,
          reset: null
        };

        all.push(
          ...rows.map(x => ({
            ...x,
            _source: name
          }))
        );
      } else {
        sourceStats[name] = {
          name,
          configured: true,
          ok: false,
          items: 0,
          error: String(
            result.reason?.message ||
            result.reason
          ),
          remaining: null,
          reset: null
        };
      }
    }
  );


  /*
   * Normalize, filter, de-duplicate.
   */
  const seen = new Set();
  const candidates = [];
  const older = [];
  let unknownDateCount = 0;


  for (const item of all) {
    const normalized =
      normalizeDiscoveryItem(
        item,
        requestedLocation,
        item._source ||
          item.source
      );

    if (!normalized) {
      continue;
    }

   const age =
  Number.isFinite(
    normalized.ageHours
  )
    ? normalized.ageHours
    : null;

    const key =
      normalized.url.replace(
        /[?#].*$/,
        ''
      ) +
      '|' +
      discoveryNorm(
        normalized.title
      );

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);


    /*
     * Daily discovery window:
     * - 0–24 hours = primary fresh queue.
     * - 24 hours–30 days = backup queue.
     * - >30 days or unknown date = never queued.
     */
    if (age === null) {
      unknownDateCount++;
      continue;
    }

    if (age > 30 * 24) {
      older.push(normalized);
      continue;
    }

    candidates.push(normalized);
  }

  /*
   * Each candidate is tagged with its freshness tier so the tag
   * survives the type-filter, limit, and deduplication steps below,
   * letting us report post-dedup counts that are actually accurate.
   */
  const fresh24h = candidates
    .filter(x => x.ageHours !== null && x.ageHours <= 24)
    .sort((a, b) => a.ageHours - b.ageHours)
    .map(x => ({ ...x, _tier: 'fresh24h' }));

  const backup30d = candidates
    .filter(x => x.ageHours !== null && x.ageHours > 24 && x.ageHours <= 30 * 24)
    .sort((a, b) => a.ageHours - b.ageHours)
    .map(x => ({ ...x, _tier: 'backup30d' }));

  /* Fresh jobs always appear first; older jobs are backup results. */
  const dailyCandidates = [
    ...fresh24h,
    ...backup30d
  ];

  /*
   * Employment type / sector filter.
   */
  const typeFiltered =
  dailyCandidates.filter(x => {
      if (
        !type ||
        type === 'all'
      ) {
        return true;
      }

      const sector =
        discoverySector(
          `${x.title} ${x.snippet}`
        );

      if (
        type === 'government'
      ) {
        return (
          sector ===
          'Government'
        );
      }

      if (
        type === 'private'
      ) {
        return (
          sector ===
          'Private'
        );
      }

      if (
        type === 'mnc'
      ) {
        return /mnc|multinational|large employer|corporation|ltd|limited|pvt|private/i.test(
          `${x.company} ${x.snippet}`
        );
      }

      return true;
    });


  /*
   * Protect the database from an excessively
   * large discovery result.
   */
  const limited =
    typeFiltered.slice(
      0,
      80
    );


  /*
   * Load existing jobs so discovery does not
   * repeatedly create the same drafts.
   */
  const existingResponse =
    await supa(
      'jobs?select=id,source_url,role,company,created_at'
    );

  if (
    !existingResponse.ok
  ) {
    const err =
      new Error(
        `Supabase job lookup failed: ${existingResponse.status}`
      );

    err.sourceStats =
      sourceStats;

    throw err;
  }


  const existingRows =
    await existingResponse.json();


  const existingUrls =
    new Set(
      existingRows
        .map(r =>
          String(
            r.source_url || ''
          ).replace(
            /[?#].*$/,
            ''
          )
        )
        .filter(Boolean)
    );


  const existingTitles =
    new Set(
      existingRows.map(
        r =>
          `${discoveryNorm(
            r.role
          )}|${discoveryNorm(
            r.company
          )}`
      )
    );


  const now =
    new Date().toISOString();


  const newCandidates =
    limited.filter(x => {
      const company =
        x.company ||
        discoveryCompany(
          x.title,
          x.snippet
        );

      const titleKey =
        `${discoveryNorm(
          discoveryRole(
            x.title
          )
        )}|${discoveryNorm(
          company
        )}`;

      return (
        !existingUrls.has(
          x.url.replace(
            /[?#].*$/,
            ''
          )
        ) &&
        !existingTitles.has(
          titleKey
        )
      );
    });


  /*
   * Build a tier map from the exact slice that will become drafts.
   *
   * WHY THIS MATTERS:
   * fresh24h.length is a PRE-deduplication count. If 3 fresh jobs were
   * already in the database, fresh24h.length = 3 but 0 fresh jobs are
   * actually inserted — only backup30d jobs are new. Reporting
   * fresh24h.length as "fresh candidates (last 24 h)" is the root cause
   * of the "3 fresh candidates" count showing alongside old-dated jobs.
   *
   * insertedFresh24hCount and insertedBackup30dCount are POST-dedup:
   * they reflect what was actually newly saved this run.
   */
  const draftSlice = newCandidates.slice(0, 40);
  const candidateTierMap = new Map();
  let insertedFresh24hCount = 0;
  let insertedBackup30dCount = 0;

  draftSlice.forEach(item => {
    const urlKey = item.url.replace(/[?#].*$/, '');
    const tier = item._tier || 'backup30d';
    candidateTierMap.set(urlKey, {
      tier,
      ageHours: item.ageHours,
      pubDate: item.pubDate || '',
      /* true when the source date is a news-article date, not a job-board
         datePosted field — i.e. the age reflects how old the article is,
         not necessarily how old the job vacancy is. */
      isNewsSource: /^(?:google_news|bing_news)$/.test(
        String(item._source || '')
      ),
    });
    if (tier === 'fresh24h') {
      insertedFresh24hCount++;
    } else {
      insertedBackup30dCount++;
    }
  });

  /*
   * Convert fresh discoveries into unpublished
   * CivilCareer drafts.
   */
  const drafts =
    newCandidates
      .slice(0, 40)
      .map(
        (item, index) => {
          const role =
            discoveryRole(
              item.title
            );

          const company =
            item.company ||
            discoveryCompany(
              item.title,
              item.snippet
            );

          const date =
            Date.parse(
              item.pubDate || ''
            );

          const posted =
            Number.isFinite(date)
              ? new Date(
                  date
                ).toISOString()
              : '';


          /*
           * Because the item has already passed
           * discoveryMatchesLocation(), its location
           * is now safe to persist.
           */
          const resolvedLocation =
            item.location ||
            discoveryLocation(
              `${item.title} ${item.snippet}`,
              requestedLocation
            );


          return {
            source_url:
              item.url,

            role,

            role_normalized:
              role,

            company:
              company || null,

            location:
              resolvedLocation,

            location_display:
              resolvedLocation,

            country:
              requestedLocation &&
              discoveryNorm(
                requestedLocation
              ).includes('india')
                ? 'India'
                : requestedLocation,

            description:
              item.snippet ||
              `Fresh vacancy discovered from ${item.source}. Verify the original source before publishing.`,

            sector:
              discoverySector(
                `${item.title} ${item.snippet}`
              ),

            date_posted:
              posted
                ? posted.slice(0, 10)
                : null,

            posted_at:
              posted || null,

            source:
              `Multi-source discovery — ${item.source}`,

            source_domain:
              discoverySourceHost(
                item.url
              ),

            status:
              'Draft',

            published:
              false,

            review_state:
              'Draft',

            verification_status:
              'Pending',

            created_at:
              now,

            updated_at:
              now,

            application_url:
              item.application_url ||
              item.url,

            slug:
              makeSlug(
                role,
                company ||
                  'civilcareer',
                `${Date.now()}-${index}`
              )
          };
        }
      );


  let inserted = [];
  let persistenceWarning = '';


  /*
   * Save drafts.
   */
  if (drafts.length) {
    let write =
      await supa(
        'jobs',
        {
          method: 'POST',
                    body: JSON.stringify(
            drafts
          ),
          headers: {
            Prefer:
              'return=representation'
          }
        }
      );


    if (!write.ok) {
      const detail =
        await write.text();


      /*
       * Compatibility retry for databases that
       * do not yet have all optional discovery fields.
       */
      const minimal =
        drafts.map(d => ({
          source_url:
            d.source_url,

          role:
            d.role,

          role_normalized:
            d.role_normalized,

          company:
            d.company,

          location:
            d.location,

          location_display:
            d.location_display,

          country:
            d.country,

          description:
            d.description,

          date_posted:
            d.date_posted,

          source:
            d.source,

          published:
            false,

          created_at:
            d.created_at,

          application_url:
            d.application_url,

          slug:
            d.slug
        }));


      write =
        await supa(
          'jobs',
          {
            method: 'POST',
            body:
              JSON.stringify(
                minimal
              ),
            headers: {
              Prefer:
                'return=representation'
            }
          }
        );


      if (!write.ok) {
        const detail2 =
          await write.text();

        const err =
          new Error(
            `Supabase discovery insert failed: ${
              detail2.slice(
                0,
                700
              ) ||
              detail.slice(
                0,
                700
              )
            }`
          );

        err.sourceStats =
          sourceStats;

        throw err;
      }


      persistenceWarning =
        'Discovery used the compatibility draft schema because some optional job columns are not present in the current database.';
    }


    inserted =
      await write.json();
  }


  return {
    count:
      inserted.length,

    drafts:
      inserted,

    results:
      inserted.map(j => {
        const urlKey =
          String(j.source_url || '').replace(/[?#].*$/, '');

        const tierInfo =
          candidateTierMap.get(urlKey) || {
            tier: 'backup30d',
            ageHours: null,
            pubDate: '',
            isNewsSource: false,
          };

        /*
         * Prefer the stored posted_at (full ISO timestamp) over the
         * date-only date_posted so millisecond-level sorting is possible.
         * Fall back to the raw pubDate recorded at normalization time.
         */
        const raw =
          j.posted_at ||
          j.date_posted ||
          tierInfo.pubDate ||
          '';

        const parsedMs = Date.parse(raw);

        const ageHoursNow =
          Number.isFinite(parsedMs)
            ? Math.max(0, (Date.now() - parsedMs) / 3600000)
            : null;

        /*
         * If the DB row has no usable date (rare — happens when the
         * minimal fallback schema is used and pubDate was empty),
         * fall back to the ageHours recorded at normalization time.
         * This gives a close approximation rather than an empty label.
         */
        const ageForLabel =
          ageHoursNow !== null
            ? ageHoursNow
            : tierInfo.ageHours;

        return {
          id: j.id,

          title: j.role,

          company: j.company || '',

          location:
            j.location_display ||
            j.location ||
            '',

          url: j.source_url,

          applicationUrl:
            j.application_url ||
            j.source_url ||
            '',

          snippet:
            (j.description || '')
              .slice(0, 400),

          source: j.source || '',

          sourceDomain: j.source_domain || '',

          /*
           * 'fresh24h'  = source date is within the last 24 hours.
           * 'backup30d' = source date is 24 hours–30 days old.
           * The Admin UI must never label a 'backup30d' item as "fresh".
           */
          tier: tierInfo.tier,

          /*
           * Convenience boolean for simpler frontend conditionals.
           */
          isFresh24h: tierInfo.tier === 'fresh24h',

          /*
           * Floating-point hours since the source date.
           * A job posted 20 minutes ago has ageHours ≈ 0.33.
           * null when no date is available.
           */
          ageHours: ageHoursNow,

          /*
           * Human-readable age label computed at response time.
           * Examples: "Just now", "5 minutes ago", "3 hours ago",
           * "2 days ago", "1 week ago", "2 months ago".
           * Empty string when no usable date exists.
           */
          postedAt:
            ageForLabel !== null
              ? discoveryAgeLabel(ageForLabel)
              : '',

          /*
           * Raw date/timestamp string as stored in the database.
           * Use this when you want to display the literal date.
           */
          postedAtRaw: raw,

          /*
           * Full ISO 8601 timestamp for precise client-side sorting
           * (newest-first: sort ascending by postedAtISO descending).
           */
          postedAtISO:
            Number.isFinite(parsedMs)
              ? new Date(parsedMs).toISOString()
              : '',

          /*
           * true  → the date is the publication date of a news article
           *         (Google News / Bing News), NOT the original job posting
           *         date. The job itself may be older than the article.
           * false → the date comes from a structured job board (Jobicy,
           *         Arbeitnow, OnJob, or a configured API) and is the
           *         actual datePosted field for the vacancy.
           */
          dateIsArticleDate: tierInfo.isNewsSource,

          /*
           * 100 = fresh24h (primary queue), 50 = backup30d.
           * Lets the UI sort or badge items without re-checking tier.
           */
          score: tierInfo.tier === 'fresh24h' ? 100 : 50,
        };
      }),

    scanned:
      limited.length,

    /*
     * POST-deduplication freshness counts.
     *
     * These count ONLY newly inserted drafts, grouped by tier.
     * They answer "how many genuinely new jobs did we save right now?"
     *
     * The previous value was fresh24h.length (PRE-dedup), which
     * could show "3 fresh candidates" while the 3 newly inserted
     * jobs all had dates from 10+ days ago — the 3 truly fresh jobs
     * already existed in the database and were skipped.
     */
    candidates:
      insertedFresh24hCount,

    fresh24hCandidates:
      insertedFresh24hCount,

    backup30dCandidates:
      insertedBackup30dCount,

    /*
     * Pre-deduplication totals — how many candidates were found
     * across all sources before the existing-job filter ran.
     * Useful for debugging source coverage.
     */
    totalFresh24hFound:
      fresh24h.length,

    totalBackup30dFound:
      backup30d.length,

    /*
     * Candidates dropped because no usable posting date was present.
     * These are never queued as drafts.
     */
    unknownDateCandidates:
      unknownDateCount,

    typeFilteredCandidates:
      typeFiltered.length,

    olderCandidates:
      older.length,

    expiredCandidates:
      older.length,

    skippedExisting:
      Math.max(
        0,
        limited.length -
        newCandidates.length
      ),

    sourceStats,

    configuredSources:
      Object.values(
        sourceStats
      )
        .filter(
          x =>
            x.configured &&
            x.name &&
            ![
              'google_news',
              'bing_news',
              'jobicy',
              'arbeitnow',
              'onjob'
            ].includes(
              x.name
            )
        )
        .map(
          x => x.name
        ),

    runAt:
      now,

    persistenceWarning,

    note:
  'Discovery window: jobs from the last 24 hours are the primary daily queue (tier=fresh24h); jobs 24 hours–30 days old are backup results (tier=backup30d). Listings without a usable source date or older than 30 days are not queued. ' +
  'candidates/fresh24hCandidates is a POST-deduplication count — it reflects genuinely new fresh24h drafts saved this run, not the pre-dedup total. ' +
  'totalFresh24hFound/totalBackup30dFound give the pre-dedup source counts for debugging. ' +
  'Results are sorted newest-first; each result carries tier, isFresh24h, ageHours, postedAt (human label), postedAtRaw (stored string), postedAtISO (full timestamp), and dateIsArticleDate (true for Google/Bing News sources). ' +
  'Configured job APIs are tried alongside no-key public feeds; quota/error on one source does not stop the others. LinkedIn/Naukri logins or bypass scraping are not used.'
  };
}

function supa(path, opts = {}) {
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


function getKey(req) {
  return req.headers['x-owner-key'] || '';
}


function isAdmin(req) {
  return getKey(req) === process.env.OWNER_KEY;
}


function cleanDates(obj) {
  const dateFields = [
    'application_start',
    'deadline',
    'posted_at',
    'published_at',
    'expires_at',
    'last_verified',
    'last_verified_at',
    'updated_at',
    'created_at',
  ];

  for (const field of dateFields) {
    if (obj[field] === '') {
      obj[field] = null;
    }
  }

  return obj;
}


function cleanArrays(obj) {
  const arrayFields = [
    'skills',
    'qualifications',
    'employment_types',
    'experience_ranges',
    'application_emails',
    'locations',
  ];

  for (const field of arrayFields) {
    if (obj[field] === '') {
      obj[field] = [];
    }

    if (typeof obj[field] === 'string') {
      try {
        const parsed = JSON.parse(obj[field]);

        if (Array.isArray(parsed)) {
          obj[field] = parsed;
        }
      } catch (e) {
        // Leave normal text values unchanged.
      }
    }
  }

  return obj;
}


function makeSlug(role, company, id) {
  const base =
    `${role || 'job'}-${company || 'company'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);

  return `${base || 'job'}-${id || Date.now()}`;
}


module.exports = async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,DELETE,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,x-owner-key'
  );


  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }


  /*
   * Dedicated Admin authentication check.
   *
   * This runs before the Supabase configuration check
   * so Admin login can distinguish an invalid owner key
   * from a database/configuration error.
   */
  if (
    req.method === 'GET' &&
    String(
      req.query?.auth || ''
    ) === '1'
  ) {
    if (!process.env.OWNER_KEY) {
      return res.status(503).json({
        ok: false,
        error:
          'Admin authentication is not configured on this deployment',
      });
          }

    if (!isAdmin(req)) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid owner key',
      });
    }

    return res.status(200).json({
      ok: true,
      authenticated: true,
    });
  }


  /*
   * Normal API configuration check.
   */
  if (!SUPA || !KEY) {
    return res.status(500).json({
      error:
        'Supabase server configuration is missing',
    });
  }


  // ────────────────────────────────────────────────────────────────────
  // GET
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'GET') {

    /*
     * Vercel Cron invokes GET and identifies itself with this user-agent.
     * Keep scheduled discovery separate from the public jobs response.
     */
    if (
      String(
        req.query?.discovery || ''
      ) === 'cron' &&
      /vercel-cron\/1\.0/i.test(
        String(
          req.headers[
            'user-agent'
          ] || ''
        )
      )
    ) {
      try {
        const result =
          await runPublicDiscovery({
            q:
              'civil engineering jobs India',
            location:
              'India',
            type:
              'all',
          });

        return res.status(200).json({
          ok: true,
          ...result,
        });

      } catch (err) {
        return res.status(502).json({
          ok: false,
          error:
            'Scheduled discovery failed',
          details:
            err.message,
        });
      }
    }


    /*
     * Server-rendered public job page via /jobs/:slug rewrite.
     *
     * Direct /api/jobs?slug=... remains JSON unless
     * render=html is supplied.
     */
    if (
      String(
        req.query?.render || ''
      ) === 'html'
    ) {
      return renderJobPage(
        req,
        res
      );
    }


    const slug =
      typeof req.query?.slug === 'string'
        ? req.query.slug.trim()
        : '';


    const id =
      typeof req.query?.id === 'string'
        ? req.query.id.trim()
        : '';


    let query;


    if (slug) {

      query =
        `jobs?slug=eq.${encodeURIComponent(
          slug
        )}` +
        (
          isAdmin(req)
            ? ''
            : '&published=eq.true'
        ) +
        '&limit=1';

    } else if (id) {

      query =
        `jobs?id=eq.${encodeURIComponent(
          id
        )}` +
        (
          isAdmin(req)
            ? ''
            : '&published=eq.true'
        ) +
        '&limit=1';

    } else {

      query =
        isAdmin(req)
          ? 'jobs?order=created_at.desc'
          : 'jobs?published=eq.true&order=created_at.desc';
    }


    try {
      const r =
        await supa(query);


      if (!r.ok) {
        const detail =
          await r.text();

        return res.status(500).json({
          error:
            'Failed to load jobs',
          details:
            detail,
        });
      }


      const jobs =
        await r.json();


      if (slug || id) {
        return res.status(200).json({
          job:
            jobs[0] || null,
        });
      }


      return res.status(200).json({
        jobs,
      });

    } catch (err) {
      return res.status(500).json({
        error:
          'Failed to load jobs',
        details:
          err.message,
      });
    }
  }


  // ────────────────────────────────────────────────────────────────────
  // ADMIN AUTH REQUIRED FOR WRITES
  // ────────────────────────────────────────────────────────────────────

  if (!isAdmin(req)) {
    return res.status(401).json({
      error:
        'Invalid owner key',
    });
  }


  let body =
    req.body || {};


  if (typeof body === 'string') {
    try {
      body =
        JSON.parse(body);
    } catch (e) {
      return res.status(400).json({
        error:
          'Invalid JSON body',
      });
    }
  }


  // ────────────────────────────────────────────────────────────────────
  // PHASE 7 — ADMIN DISCOVERY
  // ────────────────────────────────────────────────────────────────────

  if (
    req.method === 'POST' &&
    String(
      req.query?.discovery || ''
    ) === '1'
  ) {
    try {

      const result =
        await runPublicDiscovery({
          q:
            body.q,
          location:
            body.location,
          type:
            body.type,
        });


      return res.status(200).json(
        result
      );

    } catch (err) {

      return res.status(502).json({
        error:
          'Discovery search failed',
        details:
          err.message,
        sourceStats:
          err.sourceStats || {},
      });
    }
  }


  // ────────────────────────────────────────────────────────────────────
  // POST — CREATE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'POST') {
    try {

      const {
        id,
        key,
        ...rest
      } = body;


      cleanDates(rest);
      cleanArrays(rest);


      if (
        typeof rest.published !==
        'boolean'
      ) {
        rest.published =
          true;
      }


      if (!rest.status) {
        rest.status =
          rest.published
            ? 'Active'
            : 'Pending Review';
      }


      if (!rest.created_at) {
        rest.created_at =
          new Date().toISOString();
      }


      /*
       * Generate slug if one was not supplied.
       */
      if (!rest.slug) {
        rest.slug =
          makeSlug(
            rest.role,
            rest.company,
            Date.now()
          );
      }


      const r =
        await supa(
          'jobs',
          {
            method: 'POST',
            body:
              JSON.stringify(rest),
          }
        );


      if (!r.ok) {
        const detail =
          await r.text();

        return res.status(500).json({
          error:
            'Job could not be saved',
          details:
            detail,
        });
      }


      const data =
        await r.json();


      return res.status(201).json({
        success: true,
        job:
          Array.isArray(data)
            ? data[0]
            : data,
      });
          } catch (err) {

      return res.status(500).json({
        error:
          'Job could not be saved',
        details:
          err.message,
      });
    }
  }


  // ────────────────────────────────────────────────────────────────────
  // PATCH — UPDATE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'PATCH') {
    try {

      const {
        id,
        key,
        ...rest
      } = body;


      if (!id) {
        return res.status(400).json({
          error:
            'Missing id',
        });
      }


      cleanDates(rest);
      cleanArrays(rest);


      const r =
        await supa(
          `jobs?id=eq.${encodeURIComponent(
            id
          )}`,
          {
            method: 'PATCH',
            body:
              JSON.stringify(rest),
          }
        );


      if (!r.ok) {
        const detail =
          await r.text();

        return res.status(500).json({
          error:
            'Job could not be updated',
          details:
            detail,
        });
      }


      const data =
        await r.json();


      return res.status(200).json({
        success: true,
        job:
          Array.isArray(data)
            ? data[0]
            : data,
      });

    } catch (err) {

      return res.status(500).json({
        error:
          'Job could not be updated',
        details:
          err.message,
      });
    }
  }


  // ────────────────────────────────────────────────────────────────────
  // DELETE — DELETE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'DELETE') {
    try {

      const {
        id
      } = body;


      if (!id) {
        return res.status(400).json({
          error:
            'Missing id',
        });
      }


      const r =
        await supa(
          `jobs?id=eq.${encodeURIComponent(
            id
          )}`,
          {
            method:
              'DELETE',
          }
        );


      if (!r.ok) {
        const detail =
          await r.text();

        return res.status(500).json({
          error:
            'Job could not be deleted',
          details:
            detail,
        });
      }


      return res.status(200).json({
        success:
          true,
      });

    } catch (err) {

      return res.status(500).json({
        error:
          'Job could not be deleted',
        details:
          err.message,
      });
    }
  }


  return res.status(405).json({
    error:
      'Method not allowed',
  });
};
