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
    const nowIso = new Date().toISOString();
    const batchSize = 1000;
    const sitemapLimit = 45000;
    const partRaw = Number.parseInt(new URL(req.url, 'http://localhost').searchParams.get('part') || '', 10);

    async function countJobs() {
      const r = await supa('jobs?select=id&published=eq.true&or=(expires_at.gte.' + encodeURIComponent(nowIso) + ',expires_at.is.null)', {
        headers: { Prefer: 'count=exact' },
      });
      if (!r.ok) return null;
      const range = r.headers.get('content-range') || '';
      const m = range.match(/\/(\d+)$/);
      return m ? Number(m[1]) : null;
    }

    async function fetchJobSlice(offset, limit) {
      const r = await supa(
        'jobs?select=id,slug,role,created_at,date_posted,expires_at' +
        '&published=eq.true' +
        '&or=(expires_at.gte.' + encodeURIComponent(nowIso) + ',expires_at.is.null)' +
        '&order=created_at.desc' +
        `&offset=${offset}&limit=${limit}`
      );
      if (!r.ok) throw new Error(`job sitemap query failed (${r.status})`);
      return r.json();
    }

    const totalJobs = await countJobs();
    const effectiveTotal = Number.isFinite(totalJobs) ? totalJobs : 0;
    const partCount = Math.max(1, Math.ceil(effectiveTotal / sitemapLimit));

    if (!Number.isFinite(partRaw) && partCount > 1) {
      const indexEntries = Array.from({length: partCount}, (_, i) =>
        `  <sitemap><loc>${xmlEscape(`${SITE_URL}/sitemap.xml?part=${i + 1}`)}</loc></sitemap>`
      ).join('\n');
      const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexEntries}\n</sitemapindex>`;
      res.setHeader('Content-Type','application/xml; charset=utf-8');
      res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).send(indexXml);
    }

    const part = Number.isFinite(partRaw) && partRaw > 0 ? Math.min(partRaw, partCount) : 1;
    const offset = (part - 1) * sitemapLimit;
    const urls = [];
    if (part === 1) {
      const staticPages = [
        ['/', '1.0', 'daily'], ['/private-jobs', '0.9', 'daily'], ['/government-jobs', '0.9', 'daily'],
        ['/exams', '0.8', 'weekly'], ['/study-materials', '0.8', 'weekly'], ['/about', '0.5', 'monthly'],
        ['/career-guides.html', '0.7', 'weekly'], ['/career-tools.html', '0.7', 'weekly'], ['/job-alerts.html', '0.7', 'weekly'],
        ['/legal.html', '0.3', 'monthly'], ['/post-a-job', '0.6', 'weekly'], ['/submit-resource', '0.6', 'weekly'],
        ['/civil-engineer-jobs', '0.8', 'daily'], ['/site-engineer-jobs', '0.8', 'daily'], ['/quantity-surveyor-jobs', '0.8', 'daily'],
        ['/planning-engineer-jobs', '0.8', 'daily'], ['/structural-engineer-jobs', '0.8', 'daily'], ['/bim-engineer-jobs', '0.8', 'daily'],
        ['/qa-qc-engineer-jobs', '0.8', 'daily'], ['/estimation-engineer-jobs', '0.8', 'daily'], ['/project-engineer-jobs', '0.8', 'daily'],
        ['/junior-engineer-jobs', '0.8', 'daily'],
      ];
      urls.push(...staticPages.map(([path, priority, changefreq]) => addUrl(`${SITE_URL}${path}`, priority, changefreq)));
    }
    for (let localOffset = 0; localOffset < sitemapLimit; localOffset += batchSize) {
      const jobs = await fetchJobSlice(offset + localOffset, batchSize);
      for (const job of jobs) {
        const expiry = job.expires_at;
        if (expiry && Number.isFinite(new Date(expiry).getTime()) && new Date(expiry).getTime() < Date.now()) continue;
        urls.push(addUrl(`${SITE_URL}/jobs/${encodeURIComponent(jobSlug(job))}`, '0.8', 'daily', job.date_posted || job.created_at || ''));
      }
      if (jobs.length < batchSize) break;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

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
