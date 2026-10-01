/**
 * CivilCareer — Dynamic SEO Content Pages (Feature 12)
 *
 * Serves full, self-contained HTML for programmatic-SEO routes that
 * used to be empty SPA shells:
 *   /civil-engineer-jobs-in-bengaluru
 *   /site-engineer-jobs
 *   /site-engineer-jobs-in-mumbai
 *
 * The single vercel.json catch-all  { ":seoSlug" → /api/seo-page?slug=:seoSlug }
 * feeds every such URL here. We parse the slug, query Supabase for real,
 * published jobs and render a static-friendly page with:
 *   - unique <title> / meta description / canonical / OG tags
 *   - ItemList JSON-LD of the live jobs
 *   - static intro copy (indexable without JavaScript)
 *   - job cards (server-rendered) linking into the SPA
 *   - FAQ JSON-LD + internal links to related pages
 *
 * Unknown slug patterns still 302 into the SPA (never a dead end).
 * No cron, no build step, free tier only.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const SITE = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');

const CITIES = {
  bengaluru: 'Bengaluru', bangalore: 'Bengaluru', mumbai: 'Mumbai',
  delhi: 'Delhi', 'new-delhi': 'Delhi', hyderabad: 'Hyderabad',
  chennai: 'Chennai', pune: 'Pune', ahmedabad: 'Ahmedabad',
  kolkata: 'Kolkata', kochi: 'Kochi', noida: 'Noida',
  gurugram: 'Gurugram', gurgaon: 'Gurugram', jaipur: 'Jaipur',
};

const ROLES = {
  'civil-engineer': 'Civil Engineer',
  'site-engineer': 'Site Engineer',
  'quantity-surveyor': 'Quantity Surveyor',
  'planning-engineer': 'Planning Engineer',
  'structural-engineer': 'Structural Engineer',
  'bim-engineer': 'BIM Engineer',
  'qa-qc-engineer': 'QA/QC Engineer',
  'estimation-engineer': 'Estimation Engineer',
  'project-engineer': 'Project Engineer',
  'junior-engineer': 'Junior Engineer',
};

const FAQ = [
  {
    q: 'Are these job listings verified?',
    a: 'Every listing is human-reviewed before publication and links to the official company or recruitment source. CivilCareer never charges candidates to apply.',
  },
  {
    q: 'How often are new civil engineering jobs added?',
    a: 'New openings are added continuously as employers submit them and as our discovery pipeline finds official recruitment notifications.',
  },
  {
    q: 'Do I need to sign up to apply?',
    a: 'No. Every job links directly to the employer or official notification — apply at the source, always for free.',
  },
];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseSlug(slug) {
  const s = String(slug || '').toLowerCase().replace(/\/+$/, '');
  if (!s.endsWith('-jobs')) return null;
  const parts = s.slice(0, -5); // strip "-jobs"

  const inMatch = parts.match(/^(.*)-in-([a-z-]+)$/);
  if (inMatch) {
    const roleKey = inMatch[1];
    const cityKey = inMatch[2];
    const city = CITIES[cityKey];
    if (!city) return null;
    if (roleKey === 'civil-engineer' || roleKey === '') {
      return { city, role: 'Civil Engineer', roleKey: 'civil-engineer' };
    }
    const role = ROLES[roleKey];
    if (!role) return null;
    return { city, role, roleKey };
  }

  const role = ROLES[parts];
  if (!role) return null;
  return { city: null, role, roleKey: parts };
}

function salaryText(j) {
  const fmt = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L` : `₹${n}`);
  if (j.salary_min && j.salary_max) return `${fmt(j.salary_min)} – ${fmt(j.salary_max)} a year`;
  if (j.salary) return String(j.salary).slice(0, 60);
  return 'Salary not disclosed';
}

function jobCard(j) {
  const city = esc(j.city || j.location || 'India');
  const href = `/private-jobs?job=${encodeURIComponent(j.slug || j.id)}`;
  const deadline = j.deadline
    ? `<span class="cc-deadline">Apply by ${esc(String(j.deadline).slice(0, 10))}</span>`
    : '';
  return `<a class="cc-job-card" href="${href}">
    <div class="cc-job-top"><strong>${esc(j.role || 'Civil Engineer')}</strong><span class="cc-badge">Verified listing</span></div>
    <div class="cc-job-co">${esc(j.company || 'Employer')}</div>
    <div class="cc-job-meta">📍 ${city} · 💼 ${esc(j.employment_type || 'Full-time')}</div>
    <div class="cc-job-sal">${esc(salaryText(j))}</div>
    ${deadline}
  </a>`;
}

function page({ title, heading, description, canonical, intro, jobs, companies, cityName, roleName, faq }) {
  const cards = jobs.map(jobCard).join('\n');
  const jobLd = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: jobs.slice(0, 20).map((j, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: `${SITE}/private-jobs?job=${encodeURIComponent(j.slug || j.id)}`,
      name: `${j.role || 'Civil Engineer'} at ${j.company || 'Employer'}`,
    })),
  };
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const companyLinks = companies.map((c) =>
    `<a href="/private-jobs?q=${encodeURIComponent(c)}">${esc(c)}</a>`).join(' · ');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta name="robots" content="index,follow">
<link rel="stylesheet" href="/styles.css?v=20260926-400">
<script type="application/ld+json">${JSON.stringify(jobLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<style>
.cc-seo-wrap{max-width:960px;margin:0 auto;padding:2rem 1rem}
.cc-seo-wrap h1{font-size:1.9rem;line-height:1.25}
.cc-seo-intro{color:var(--text);max-width:70ch}
.cc-job-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin:1.5rem 0}
.cc-job-card{display:block;border:1px solid var(--line);border-radius:12px;padding:1rem;background:var(--white);text-decoration:none;color:var(--ink)}
.cc-job-card:hover{box-shadow:var(--shadow)}
.cc-job-top{display:flex;justify-content:space-between;gap:.5rem;align-items:center}
.cc-badge{font-size:.65rem;font-weight:700;background:var(--soft);color:var(--navy);border-radius:999px;padding:2px 8px;white-space:nowrap}
.cc-job-co{color:var(--text);font-size:.9rem;margin-top:.15rem}
.cc-job-meta{font-size:.85rem;color:var(--muted);margin-top:.35rem}
.cc-job-sal{font-weight:700;margin-top:.35rem;font-size:.9rem}
.cc-deadline{display:inline-block;font-size:.75rem;color:var(--red);margin-top:.35rem}
.cc-companies{color:var(--text);font-size:.9rem}
.cc-faq{margin:2rem 0}
.cc-faq h3{margin:.8rem 0 .2rem;font-size:1rem}
.cc-faq p{color:var(--text);margin:0}
.cc-links{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2rem}
.cc-links a{color:var(--blue);font-weight:600;font-size:.9rem}
</style></head><body>
<main class="cc-seo-wrap">
<p class="cc-eyebrow">CivilCareer · India's Civil Engineering Career Platform</p>
<h1>${esc(heading)}</h1>
<p class="cc-seo-intro">${intro}</p>
${jobs.length ? `<div class="cc-job-grid">${cards}</div>` :
`<p class="cc-seo-intro">No open listings match this page right now. New opportunities are added continuously — check the full listings below for the latest roles.</p>`}
<p><a class="btn primary" href="/private-jobs">Browse all civil engineering jobs →</a></p>
<h2>Companies hiring ${esc(roleName)}${cityName ? ` in ${esc(cityName)}` : ''}</h2>
<p class="cc-companies">${companyLinks || 'Employers across India post openings here regularly.'}</p>
<section class="cc-faq"><h2>Frequently asked questions</h2>
${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
</section>
<nav class="cc-links" aria-label="Related pages">
<a href="/government-jobs">Government Civil Jobs</a>
<a href="/exam-tracker">Exam Tracker</a>
<a href="/salary">Salary Guide</a>
<a href="/walk-in">Walk-In Interviews</a>
<a href="/companies">Company Reviews</a>
</nav>
</main></body></html>`;
}

function notFoundHtml(slug) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=/private-jobs">
<link rel="canonical" href="${SITE}/private-jobs"><title>CivilCareer</title></head>
<body><p>Redirecting to <a href="/private-jobs">civil engineering jobs</a>…</p></body></html>`;
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const slug = url.searchParams.get('slug') || '';
    const parsed = parseSlug(slug);

    if (!parsed) {
      res.statusCode = 302;
      res.setHeader('Location', '/private-jobs');
      return res.end();
    }

    const { city, role } = parsed;
    const filters = ['published=eq.true'];
    if (city) filters.push(`or=(city.ilike.*${encodeURIComponent(city)}*,location.ilike.*${encodeURIComponent(city)}*)`);
    if (role && role !== 'Civil Engineer') filters.push(`role.ilike.*${encodeURIComponent(role)}*`);

    const headers = {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    };
    const qs = filters.join('&');
    let jobs = [];
    try {
      const r = await fetch(
        `${SUPA}/rest/v1/jobs?${qs}&select=slug,id,role,company,city,location,employment_type,salary,salary_min,salary_max,deadline&order=created_at.desc&limit=12`,
        { headers }
      );
      if (r.ok) jobs = await r.json();
    } catch (_) { jobs = []; }

    const companies = [...new Set(jobs.map((j) => j.company).filter(Boolean))].slice(0, 8);
    const heading = city
      ? `${role} Jobs in ${city} 2026`
      : `${role} Jobs in India 2026`;
    const title = `${heading} | CivilCareer`;
    const countNote = jobs.length ? `${jobs.length} open ` : '';
    const description = city
      ? `Find ${countNote}civil engineering jobs in ${city}. ${role} positions at verified employers — apply directly at the source, always free. Updated continuously.`
      : `Find ${countNote}${role.toLowerCase()} jobs across India. Verified listings at private companies, MNCs and PSUs — apply directly at the source, always free.`;
    const intro = city
      ? `Looking for ${role.toLowerCase()} jobs in ${city}? Below are ${countNote ? `<strong>${jobs.length} live ${role.toLowerCase()} openings in ${city}</strong>` : 'the latest verified openings'} from employers actively hiring. Every listing is human-reviewed and links to the official source — never pay anyone to apply.`
      : `Browse ${countNote ? `<strong>${jobs.length} live ${role.toLowerCase()} openings across India</strong>` : 'the latest verified openings'} from employers actively hiring civil engineers. Every listing is human-reviewed and links to the official source — never pay anyone to apply.`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Accept-Encoding');
    return res.end(page({
      title,
      heading,
      description,
      canonical: `${SITE}/${slug}`,
      intro,
      jobs,
      companies,
      cityName: city,
      roleName: role,
      faq: FAQ,
    }));
  } catch (e) {
    console.error('seo-page error:', e.message);
    res.statusCode = 302;
    res.setHeader('Location', '/private-jobs');
    return res.end();
  }
};
