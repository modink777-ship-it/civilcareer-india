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
  const base = `${role || 'job'}-${company || 'company'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return `${base || 'job'}-${id || Date.now()}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  if (!SUPA || !KEY) {
    return res.status(500).json({
      error: 'Supabase server configuration is missing',
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // GET
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'GET') {
    // Server-rendered public job page via /jobs/:slug rewrite.
    // Direct /api/jobs?slug=... remains a JSON API unless render=html is supplied.
    if (String(req.query?.render || '') === 'html') {
      return renderJobPage(req, res);
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
        `jobs?slug=eq.${encodeURIComponent(slug)}` +
        (isAdmin(req) ? '' : '&published=eq.true') +
        '&limit=1';
    } else if (id) {
      query =
        `jobs?id=eq.${encodeURIComponent(id)}` +
        (isAdmin(req) ? '' : '&published=eq.true') +
        '&limit=1';
    } else {
      query = isAdmin(req)
        ? 'jobs?order=created_at.desc'
        : 'jobs?published=eq.true&order=created_at.desc';
    }

    try {
      const r = await supa(query);

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Failed to load jobs',
          details: detail,
        });
      }

      const jobs = await r.json();

      if (slug || id) {
        return res.status(200).json({
          job: jobs[0] || null,
        });
      }

      return res.status(200).json({ jobs });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to load jobs',
        details: err.message,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // ADMIN AUTH REQUIRED FOR WRITES
  // ────────────────────────────────────────────────────────────────────

  if (!isAdmin(req)) {
    return res.status(401).json({
      error: 'Invalid owner key',
    });
  }

  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid JSON body',
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // POST — CREATE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'POST') {
    try {
      const { id, key, ...rest } = body;

      cleanDates(rest);
      cleanArrays(rest);

      if (typeof rest.published !== 'boolean') {
  rest.published = true;
}

if (!rest.status) {
  rest.status = rest.published ? 'Active' : 'Pending Review';
}

      if (!rest.created_at) {
        rest.created_at = new Date().toISOString();
      }

      // Generate slug if one was not supplied.
      if (!rest.slug) {
        rest.slug = makeSlug(
          rest.role,
          rest.company,
          Date.now()
        );
      }

      const r = await supa('jobs', {
        method: 'POST',
        body: JSON.stringify(rest),
      });

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Job could not be saved',
          details: detail,
        });
      }

      const data = await r.json();

      return res.status(201).json({
        success: true,
        job: Array.isArray(data) ? data[0] : data,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Job could not be saved',
        details: err.message,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // PATCH — UPDATE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'PATCH') {
    try {
      const { id, key, ...rest } = body;

      if (!id) {
        return res.status(400).json({
          error: 'Missing id',
        });
      }

      cleanDates(rest);
      cleanArrays(rest);

      const r = await supa(
        `jobs?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(rest),
        }
      );

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Job could not be updated',
          details: detail,
        });
      }

      const data = await r.json();

      return res.status(200).json({
        success: true,
        job: Array.isArray(data) ? data[0] : data,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Job could not be updated',
        details: err.message,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // DELETE — DELETE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'DELETE') {
    try {
      const { id } = body;

      if (!id) {
        return res.status(400).json({
          error: 'Missing id',
        });
      }

      const r = await supa(
        `jobs?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Job could not be deleted',
          details: detail,
        });
      }

      return res.status(200).json({
        success: true,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Job could not be deleted',
        details: err.message,
      });
    }
  }

  return res.status(405).json({
    error: 'Method not allowed',
  });
};
