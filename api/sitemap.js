/**
 * CivilCareer — dynamic XML sitemap
 *
 * Phase 1:
 * - Keeps the existing /sitemap.xml -> /api/sitemap rewrite.
 * - Lists important static pages.
 * - Lists published, non-expired jobs.
 * - Uses existing Supabase/Vercel environment variables only.
 *
 * No paid service required.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const SITE_URL = (
  process.env.SITE_URL ||
  'https://civilcareer-india-two.vercel.app'
).replace(/\/+$/, '');

function supa(path) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
  });
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function jobSlug(job) {
  if (job.slug) return String(job.slug);

  const role = String(job.role || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${role || 'job'}-${job.id}`;
}

function addUrl(loc, priority, changefreq, lastmod) {
  return `<url>
  <loc>${xmlEscape(loc)}</loc>
  ${lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : ''}
  <changefreq>${changefreq}</changefreq>
  <priority>${priority}</priority>
</url>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  if (!SUPA || !KEY) {
    return res.status(500).send(
      'Sitemap server configuration is missing'
    );
  }

  try {
    const staticPages = [
      ['/', '1.0', 'daily'],
      ['/private-jobs', '0.9', 'daily'],
      ['/government-jobs', '0.9', 'daily'],
      ['/exams', '0.8', 'weekly'],
      ['/study-materials', '0.8', 'weekly'],
      ['/about', '0.5', 'monthly'],
      ['/career-guides.html', '0.7', 'weekly'],
      ['/career-tools.html', '0.7', 'weekly'],
      ['/job-alerts.html', '0.7', 'weekly'],
      ['/legal.html', '0.3', 'monthly'],
      ['/post-a-job', '0.6', 'weekly'],
      ['/submit-resource', '0.6', 'weekly'],
      ['/civil-engineer-jobs', '0.8', 'daily'],
      ['/site-engineer-jobs', '0.8', 'daily'],
      ['/quantity-surveyor-jobs', '0.8', 'daily'],
      ['/planning-engineer-jobs', '0.8', 'daily'],
      ['/structural-engineer-jobs', '0.8', 'daily'],
      ['/bim-engineer-jobs', '0.8', 'daily'],
      ['/qa-qc-engineer-jobs', '0.8', 'daily'],
      ['/estimation-engineer-jobs', '0.8', 'daily'],
      ['/project-engineer-jobs', '0.8', 'daily'],
      ['/junior-engineer-jobs', '0.8', 'daily'],
    ];

    const urls = staticPages.map(([path, priority, changefreq]) =>
      addUrl(`${SITE_URL}${path}`, priority, changefreq)
    );

    // Paginate job URLs so the sitemap remains correct beyond 5,000 jobs.
    // A single sitemap supports up to 50,000 URLs; each batch below is only
    // 1,000 rows, so memory use stays bounded as CivilCareer grows.
    const batchSize = 1000;
    let offset = 0;
    let jobCount = 0;
    let response = null;
    let jobs = [];
    do {
      response = await supa(
        'jobs?select=id,slug,role,created_at,date_posted,expires_at' +
        '&published=eq.true' +
        '&or=(expires_at.gte.' + encodeURIComponent(new Date().toISOString()) + ',expires_at.is.null)' +
        '&order=created_at.desc' +
        `&offset=${offset}&limit=${batchSize}`
      );
      if (!response.ok) break;
      jobs = await response.json();
      jobCount += jobs.length;
      offset += jobs.length;

      const now = Date.now();
      for (const job of jobs) {
        const expiry = job.expires_at;
        if (expiry) {
          const expiryTime = new Date(expiry).getTime();
          if (Number.isFinite(expiryTime) && expiryTime < now) continue;
        }
        const lastmod = job.date_posted || job.created_at || '';
        urls.push(addUrl(`${SITE_URL}/jobs/${encodeURIComponent(jobSlug(job))}`, '0.8', 'daily', lastmod));
      }
    } while (jobs.length === batchSize && jobCount < 50000 - staticPages.length);

    if (response && !response.ok) {
      const detail = await response.text();
      console.warn(`Sitemap job query failed (${response.status}); returning static sitemap only: ${detail.slice(0, 500)}`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

    res.setHeader(
      'Content-Type',
      'application/xml; charset=utf-8'
    );

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=600, stale-while-revalidate=3600'
    );

    return res.status(200).send(xml);
  } catch (error) {
    console.error('sitemap error:', error);
    return res.status(500).send(
      'Unable to generate sitemap.'
    );
  }
};
