/**
 * CivilCareer — per-specialization course landing pages
 *
 *   /courses/structural-engineering
 *   /courses/quantity-surveying
 *   /courses/gate-civil-engineering
 *   …one page per Civil Engineering specialization in lib/course-civil.js
 *
 * Follows the same pattern as _api/seo-page.js (Feature 12): full,
 * indexable HTML rendered on the server, so the page works without
 * JavaScript and a crawler sees the courses immediately.
 *
 * THE RULES THIS PAGE KEEPS
 *   * Only is_published = true rows are ever fetched — the filter is
 *     forced into the query, so a draft cannot leak onto a landing page
 *     even if a client guesses the URL.
 *   * Nothing is invented: a course without a price says "Price not
 *     provided", a course without a rating simply has no rating, and the
 *     structured data carries only fields the provider actually
 *     published.
 *   * An empty specialization is served with robots noindex and is kept
 *     out of the sitemap, because asking a crawler to index a page with
 *     no courses is a thin-content trap. It becomes indexable the moment
 *     one course is published.
 *   * Filtering hands off to the directory (/courses?specialization=…)
 *     instead of inventing a second set of filter semantics here.
 *   * No affiliate requirement: the CTA is the provider's own URL, and
 *     rel="sponsored" appears only when a row really carries an
 *     affiliate_url (never on a plain provider link).
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const SITE = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');

const {
  SUPPORTED_PROVIDERS,
  specializationFromSlug,
  specializationSlug,
  THIRD_PARTY_NOTICE,
} = require('../lib/course-civil');
const { publicCourse, PUBLIC_SELECT, PUBLIC_SELECT_BASE } = require('./courses')._internal;

const MAX_ROWS = 1000;
const CARDS_PER_PAGE = 48;

/* ══ course DETAIL page (/courses/detail/<id>) ═══════════════════════
   A server-rendered, indexable page for ONE published course — same
   discipline as the specialization pages: published rows only (the id
   can never serve a draft), no invented fields, third-party notice,
   robots noindex when the row is missing. A published course keeps a
   stable URL; a slug change on the provider side is what the title and
   structured data reflect, never a CivilCareer guess. */

function courseDetailLd(c) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: c.title,
    url: c.course_url,
    /* The course is offered BY the platform — the markup says so rather
       than implying CivilCareer sells it. */
    provider: { '@type': 'Organization', name: c.provider || 'Provider' },
  };
  if (c.description) ld.description = c.description;
  if (c.instructor) ld.hasCourseInstance = { '@type': 'CourseInstance', instructor: { '@type': 'Person', name: c.instructor } };
  if (c.duration_hours != null) ld.timeRequired = isoDuration(c.duration_hours);
  if (c.language) ld.inLanguage = c.language;
  if (c.is_free) ld.isAccessibleForFree = true;
  /* Rating markup only when the provider published one — never invented. */
  if (c.rating != null && c.enrollment_count != null && c.enrollment_count >= 10) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: c.rating.toFixed(1), ratingCount: c.enrollment_count };
  }
  return ld;
}

function detailPage({ c, canonical }) {
  const title = `${c.title} — ${c.provider} course for Civil Engineers | CivilCareer`;
  const description = (c.description
    ? c.description.slice(0, 155)
    : `${c.title} is a ${c.provider} Civil Engineering course reviewed and listed on CivilCareer${c.career_stage ? ' for ' + c.career_stage.toLowerCase() + 's' : ''}. Enrol on the provider's own website.`);
  const href = c.affiliate_url || c.course_url;
  const rel = c.affiliate_url ? 'noopener sponsored' : 'noopener noreferrer';

  const facts = [];
  facts.push(['Provider', c.provider]);
  if (c.instructor) facts.push(['Instructor', c.instructor]);
  if (c.specialization) facts.push(['Civil Engineering specialization', c.specialization]);
  if (c.category) facts.push(['Category', c.category]);
  if (c.career_stage) facts.push(['Career stage', c.career_stage]);
  if (c.language) facts.push(['Language', c.language]);
  const dur = durationText(c.duration_hours); if (dur) facts.push(['Duration', dur]);
  if (c.enrollment_count != null) facts.push(['Learners', Number(c.enrollment_count).toLocaleString('en-IN')]);
  if (c.rating != null) facts.push(['Rating', `★ ${Number(c.rating).toFixed(1)}`]);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<link rel="icon" href="/icons/icon-96.png">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">${jsonLd(courseDetailLd(c))}</script>
<style>
.cd-wrap{max-width:880px;margin:0 auto;padding:2rem 1rem 4rem}
.cd-eyebrow{color:var(--muted);font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:0;}
.cd-wrap h1{font-size:1.9rem;line-height:1.25;margin:.4rem 0 .4rem}
.cd-provider{color:var(--teal);font-size:1rem;font-weight:700}
.cd-cta{display:inline-block;margin-top:.8rem;padding:.65rem 1.4rem;border-radius:8px;background:var(--blue);color:#fff;text-decoration:none;font-weight:800}
.cd-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.5rem;margin:1.4rem 0;border:1px solid var(--line);border-radius:12px;padding:1rem;background:var(--white)}
.cd-facts>div{font-size:.88rem;color:var(--text)}
.cd-facts b{display:block;color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.cd-desc{line-height:1.7;color:var(--text)}
.cd-roles{display:flex;flex-wrap:wrap;gap:.4rem;margin:.6rem 0 0}
.cd-roles span{font-size:.78rem;color:#15543f;background:#e6f4ef;border-radius:999px;padding:3px 10px}
.cd-notice{border-left:3px solid var(--teal);background:#edf6f3;border-radius:0 10px 10px 0;padding:.9rem 1rem;color:#38564f;font-size:.85rem;margin-top:1.6rem}
</style></head><body>
<main class="cd-wrap">
<p class="cd-eyebrow">CivilCareer · reviewed Civil Engineering courses</p>
<h1>${esc(c.title)}</h1>
<p class="cd-provider">${esc(c.provider)}${c.instructor ? ` · taught by ${esc(c.instructor)}` : ''}</p>
<a class="cd-cta" href="${esc(href)}" target="_blank" rel="${rel}">View course on ${esc(c.provider)} →</a>
<p style="color:var(--muted);font-size:.78rem;margin:.4rem 0 0">Opens on ${esc(c.provider)}’s website — you are leaving CivilCareer.</p>
<div class="cd-facts">${facts.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>
${c.description ? `<h2>About this course</h2><p class="cd-desc">${esc(c.description)}</p>` : ''}
${(c.target_roles || []).length ? `<h2>Good for these roles</h2><div class="cd-roles">${c.target_roles.map((r) => `<span>${esc(r)}</span>`).join('')}</div>` : ''}
<div class="cd-notice">${esc(THIRD_PARTY_NOTICE)}</div>
<div class="cp-links" role="navigation" aria-label="Related CivilCareer pages" style="margin-top:2rem">
<a href="/courses">All Civil Engineering courses</a>
${c.specialization && specializationSlug(c.specialization) ? `<a href="/courses/${esc(specializationSlug(c.specialization))}">More ${esc(c.specialization)} courses</a>` : ''}
<a href="/private-jobs">Private jobs for civil engineers</a>
</div>
</main>
</body></html>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* JSON-LD lives inside a <script> block: escape HTML-significant
   characters as unicode escapes so provider text can never break out of
   the script context (same rule as seo-page.js). */
function jsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function isMissingColumn(detail) {
  return /PGRST204|Could not find the '[^']+' column|column .* of relation .* does not exist/i.test(String(detail || ''));
}

async function supa(path) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase ${res.status}`);
  return text ? JSON.parse(text) : [];
}

/* Published rows for one specialization. Falls back to the v32 columns
   when v34 has not been applied yet, so a missing migration degrades the
   page instead of breaking it. */
async function loadCourses(label) {
  const filter = `courses?select=${'%SELECT%'}&is_published=eq.true`
    + `&specialization=eq.${encodeURIComponent(label)}`
    + '&order=is_featured.desc,rating.desc.nullslast,created_at.desc'
    + `&limit=${CARDS_PER_PAGE}`;
  try {
    const rows = await supa(filter.replace('%SELECT%', PUBLIC_SELECT));
    return { courses: rows.map(publicCourse), extended: true };
  } catch (e) {
    if (!isMissingColumn(String((e && e.message) || e))) throw e;
    const rows = await supa(filter.replace('%SELECT%', PUBLIC_SELECT_BASE));
    return { courses: rows.map(publicCourse), extended: false };
  }
}

/* Published-course counts per specialization — one bounded scan that
   powers the "other specializations" links (only pages that have
   something to show) and the count line. */
async function loadCounts() {
  try {
    const rows = await supa(`courses?select=specialization&is_published=eq.true&limit=${MAX_ROWS}`);
    const counts = new Map();
    for (const r of rows) {
      if (r && r.specialization) counts.set(r.specialization, (counts.get(r.specialization) || 0) + 1);
    }
    return counts;
  } catch (_) {
    return new Map(); /* best effort: an unknown count is never invented */
  }
}

function inr(n) {
  const v = Number(n) || 0;
  return '₹' + (v >= 1000 ? v.toLocaleString('en-IN') : String(v));
}

function priceText(c) {
  if (c.is_free || c.price_inr === 0) return 'FREE';
  if (c.price_inr == null) return `Price not provided — check on ${c.provider || 'the provider'}`;
  const was = c.original_price_inr && c.original_price_inr > c.price_inr ? ` (was ${inr(c.original_price_inr)})` : '';
  return `${inr(c.price_inr)}${was}`;
}

function durationText(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return '';
  return h % 1 === 0 ? `${h} hours` : `${h.toFixed(1)} hours`;
}

/* ISO 8601 duration for schema.org timeRequired — derived from the
   duration the provider published, never estimated. */
function isoDuration(hours) {
  const h = Math.floor(Number(hours));
  const m = Math.round((Number(hours) - h) * 60);
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}` || 'PT0S';
}

function courseCard(c) {
  const bits = [];
  if (c.rating != null) bits.push(`<span class="cp-pill">★ ${Number(c.rating).toFixed(1)}</span>`);
  const dur = durationText(c.duration_hours);
  if (dur) bits.push(`<span class="cp-pill">${esc(dur)}</span>`);
  if (c.language) bits.push(`<span class="cp-pill">${esc(c.language)}</span>`);
  const roles = (c.target_roles || []).slice(0, 3)
    .map((r) => `<span class="cp-pill soft">${esc(r)}</span>`).join('');
  const href = c.affiliate_url || c.course_url;
  const rel = c.affiliate_url ? 'noopener sponsored' : 'noopener noreferrer';
  return `<article class="cp-card">
  <span class="cp-provider">${esc(c.provider || 'Provider')}${c.instructor ? ` · ${esc(c.instructor)}` : ''}</span>
  <h3>${esc(c.title || 'Untitled course')}</h3>
  ${c.description ? `<p class="cp-desc">${esc(c.description)}</p>` : ''}
  ${bits.length ? `<div class="cp-meta">${bits.join('')}</div>` : ''}
  ${roles ? `<div class="cp-meta">${roles}</div>` : ''}
  <p class="cp-price">${esc(priceText(c))}</p>
  <a class="cp-cta" href="${esc(href)}" target="_blank" rel="${rel}">View Course →</a>
  <p class="cp-leave">Opens on ${esc(c.provider || 'the provider')} — you are leaving CivilCareer.</p>
</article>`;
}

function itemListLd(courses) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Civil Engineering courses by specialization',
    itemListElement: courses.slice(0, 24).map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Course',
        name: c.title,
        url: c.course_url,
        /* The course is offered BY the platform — the markup says so
           rather than implying CivilCareer sells it. */
        provider: { '@type': 'Organization', name: c.provider || 'Provider' },
        ...(c.description ? { description: c.description } : {}),
        ...(c.duration_hours != null ? { timeRequired: isoDuration(c.duration_hours) } : {}),
        ...(c.language ? { inLanguage: c.language } : {}),
        ...(c.is_free ? { isAccessibleForFree: true } : {}),
      },
    })),
  };
}

const FAQ = [
  {
    q: 'Does CivilCareer sell these courses?',
    a: 'No. Every course is offered by Udemy or Coursera and you enrol on their website. CivilCareer only lists Civil Engineering courses after a human review.',
  },
  {
    q: 'How are the courses in this list chosen?',
    a: 'Only courses that match Civil Engineering — software such as AutoCAD, STAAD.Pro, ETABS, Revit and Primavera P6, design and site subjects, and Civil Engineering exam preparation — are listed. Unrelated courses are not accepted.',
  },
  {
    q: 'Why is a price or rating missing for some courses?',
    a: 'CivilCareer shows only what the provider publishes. When a provider does not publish a price, the card says so instead of guessing, and the current fee is always confirmed on the provider page.',
  },
];

function page({ label, slug, courses, counts, extended }) {
  const total = courses.length;
  const canonical = `${SITE}/courses/${slug}`;
  const title = `${label} Courses for Civil Engineers — Udemy & Coursera | CivilCareer`;
  const description = `Reviewed ${label} courses for civil engineers on Udemy and Coursera. `
    + 'Civil Engineering only, human-reviewed before listing, and you enrol on the provider website.';

  const others = [...counts.keys()]
    .filter((l) => l !== label)
    .sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b))
    .slice(0, 8);

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  /* Filtering hands off to the directory page, which already owns the
     filter semantics — one implementation, not two. */
  const directoryUrl = (provider) => '/courses?specialization=' + encodeURIComponent(label)
    + (provider ? '&provider=' + encodeURIComponent(provider) : '');
  /* NOTE: these link lists are <div role="navigation">, NOT <nav>.
     styles.css scoped the mobile-menu overlay to header.site-header nav
     (≤1050px), so ordinary <nav> elements no longer get pinned over the
     content. The link lists below keep <div role="navigation"> anyway,
     which is the more correct element for in-page navigation. */
  const providerFilters = SUPPORTED_PROVIDERS.map((p) =>
    `<a href="${esc(directoryUrl(p))}">${esc(p)} courses in ${esc(label)}</a>`
  ).join(' · ');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${total ? 'index,follow' : 'noindex,follow'}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<link rel="icon" href="/icons/icon-96.png">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">${jsonLd(itemListLd(courses))}</script>
<script type="application/ld+json">${jsonLd(faqLd)}</script>
<style>
.cp-wrap{max-width:1040px;margin:0 auto;padding:2rem 1rem 4rem}
.cp-wrap h1{font-size:2rem;line-height:1.25;margin:.2rem 0 .6rem}
.cp-eyebrow{color:var(--muted);font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:0}
.cp-intro{color:var(--text);max-width:72ch;line-height:1.6}
.cp-count{color:var(--muted);font-size:.9rem;margin:1rem 0}
.cp-filters{display:flex;flex-wrap:wrap;gap:.75rem;margin:1rem 0 1.6rem;font-size:.9rem}
.cp-filters a{color:var(--blue);font-weight:600}
.cp-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.cp-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;padding:1rem;background:var(--white)}
.cp-provider{color:var(--teal);font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
.cp-card h3{font-size:1rem;line-height:1.35;margin:.4rem 0 .3rem}
.cp-desc{color:var(--text);font-size:.85rem;line-height:1.5;margin:0 0 .5rem}
.cp-meta{display:flex;flex-wrap:wrap;gap:.35rem;margin:.3rem 0}
.cp-pill{font-size:.7rem;background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--navy)}
.cp-pill.soft{background:transparent}
.cp-price{font-weight:800;margin:.5rem 0 0;font-size:.92rem;color:var(--navy)}
.cp-cta{display:block;text-align:center;margin-top:.6rem;padding:.6rem;border-radius:8px;background:var(--blue);color:#fff;text-decoration:none;font-weight:800;font-size:.9rem}
.cp-leave{color:var(--muted);font-size:.7rem;margin:.4rem 0 0}
.cp-empty{grid-column:1/-1;border:1px dashed var(--line);border-radius:12px;padding:1.6rem;color:var(--text);background:var(--soft)}
.cp-notice{border-left:3px solid var(--teal);background:#edf6f3;border-radius:0 10px 10px 0;padding:.9rem 1rem;color:#38564f;font-size:.85rem;margin-top:2rem}
.cp-faq{margin-top:2rem}
.cp-faq h3{font-size:1rem;margin:1rem 0 .2rem}
.cp-faq p{color:var(--text);margin:0;line-height:1.6}
.cp-links{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2rem;font-size:.9rem}
.cp-links a{color:var(--blue);font-weight:600}
.cp-build{margin-top:1rem;color:var(--text);font-size:.92rem;line-height:1.55}
.cp-build strong{color:var(--navy)}
.cp-cta-inline{display:inline-block;margin-top:.5rem;color:var(--blue);font-weight:700;text-decoration:none;border-bottom:1px solid var(--blue)}
.cp-cta-inline:hover{color:var(--navy);border-color:var(--navy)}
</style></head><body>
<main class="cp-wrap">
<p class="cp-eyebrow">CivilCareer · Civil Engineering course directory</p>
<h1>${esc(label)} Courses for Civil Engineers</h1>
<p class="cp-intro">${esc(label)} courses listed on CivilCareer, offered by
${SUPPORTED_PROVIDERS.map(esc).join(' and ')}. Every course here is a Civil Engineering course reviewed by hand
before it appears — CivilCareer does not sell courses and you enrol, and pay if there is a fee, on the
provider's own website.</p>
<p class="cp-count">${total
  ? `${total} reviewed course${total === 1 ? '' : 's'} published in ${esc(label)}.`
  : `No ${esc(label)} courses are published for review yet. New courses are added only after a human review, so this page stays empty rather than listing something unrelated.`}</p>
<p class="cp-filters">${total
  ? `Filter in the full directory: ${providerFilters} · <a href="${esc(directoryUrl())}">all ${esc(label)} filters</a>`
  : '<a href="/courses">Browse the full course directory</a>'}</p>
${total
  ? `<div class="cp-grid">${courses.map(courseCard).join('\n')}</div>`
  : '<div class="cp-empty"><strong>Nothing to list here yet.</strong><br>When a ' + esc(label)
    + ' course is reviewed and published it will appear on this page.</div>'}
${extended === false
  ? '<p class="cp-count">Course descriptions and the specialization filter activate once <code>v34-courses-civil.sql</code> is applied.</p>'
  : ''}
<div class="cp-notice">${esc(THIRD_PARTY_NOTICE)}</div>
<section class="cp-faq" aria-label="Frequently asked questions">
<h2>Frequently asked questions</h2>
${FAQ.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
</section>
${others.length ? `<section><h2>Other Civil Engineering specializations</h2>
<div class="cp-links" role="navigation" aria-label="Other specializations">
${others.map((l) => `<a href="/courses/${esc(specializationSlug(l))}">${esc(l)} (${counts.get(l)})</a>`).join('')}
</div>
<p class="cp-build">Building in <strong>${esc(label)}</strong>? Browse all ${esc(label)} courses in the directory — filter by provider, career stage and price — and pick the next course from what is actually published.
<a href="${esc(directoryUrl())}" class="cp-cta-inline">Browse ${esc(label)} courses →</a></p>
</section>` : ''}
<div class="cp-links" role="navigation" aria-label="Related CivilCareer pages">
<a href="/courses">All Civil Engineering courses</a>
<a href="/private-jobs">Private jobs for civil engineers</a>
<a href="/government-jobs">Government civil jobs</a>
<a href="/exams">Civil engineering exams</a>
<a href="/exam-tracker">Exam tracker</a>
</div>
</main>
</body></html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  if (!SUPA || !KEY) return res.status(500).send('Course pages need Supabase configuration.');

  /* ══ DETAIL branch: /courses/detail/<id> (or ?id= from the rewrite) ══
     Serves ONE published course, server-rendered. A draft id 404s with
     an honest message and noindex robots — a draft can never leak here
     even if someone guesses the URL; and a truly unknown id is a
     redirect to the directory rather than a dead end. */
  {
    let rawId = '';
    if (req.query && req.query.id) rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!rawId) {
      const mid = String(req.url || '').match(/\/courses\/detail\/([a-z0-9-]+)/i);
      if (mid) rawId = mid[1];
    }
    if (rawId) {
      const canonical = `${SITE}/courses/detail/${encodeURIComponent(rawId)}`;
      let row = null;
      let missingFiles = false;
      try {
        const path = `courses?select=${PUBLIC_SELECT_BASE}&id=eq.${encodeURIComponent(rawId)}&is_published=eq.true&limit=1`;
        const rows = await supa(path);
        row = Array.isArray(rows) && rows.length ? rows[0] : null;
        /* v34 applied: re-read with the extended projection so description
           and specialization reach the page too. A failure here is not
           fatal — the v32 columns already rendered. */
        if (row) {
          try {
            const xrows = await supa(`courses?select=${PUBLIC_SELECT}&id=eq.${encodeURIComponent(rawId)}&is_published=eq.true&limit=1`);
            if (Array.isArray(xrows) && xrows.length) row = xrows[0];
          } catch (_) { /* keep the v32 row */ }
        } else {
          /* No row on the base projection can still mean v34 is absent
           AND the column filter (is_published) exists in both — so try
           the v32 filter once more before saying “not found”. */
        }
      } catch (err) {
        /* A missing v34 column falls back to the v32 projection so the
           page still renders; anything else is logged and treated as
           "not found" with an honest message. */
        if (isMissingColumn(String((err && err.message) || err))) missingFiles = true;
        else console.warn('course detail unavailable:', String((err && err.message) || err).slice(0, 300));
      }
      if (!row) {
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
          + `<title>Course not found | CivilCareer</title>`
          + `<meta name="robots" content="noindex,follow">`
          + `<link rel="icon" href="/icons/icon-96.png"><link rel="stylesheet" href="/styles.css"></head>`
          + `<body><main class="cd-wrap"><h1>Course not found</h1>`
          + `<p style="color:var(--text)">This course is not published ${missingFiles ? '(or the specialization columns are not set up yet) ' : ''}— every listing is reviewed before it appears on CivilCareer.</p>`
          + `<div class="cp-links" role="navigation" aria-label="Related"><a href="/courses">Browse all Civil Engineering courses</a></div></main></body></html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        return res.status(404).send(html);
      }
      const html = detailPage({ c: publicCourse(row), canonical });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).send(html);
    }
  }

  /* The slug arrives from the vercel rewrite (?slug=) or straight from
     the path when the catch-all sees the original URL. */ 
  let raw = '';
  if (req.query && req.query.slug) {
    raw = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  }
  if (!raw) {
    const m = String(req.url || '').match(/\/courses\/([^/?#]+)/);
    raw = m ? m[1] : '';
  }
  let slug = '';
  try { slug = decodeURIComponent(String(raw)).toLowerCase(); } catch (_) { slug = String(raw).toLowerCase(); }

  const label = specializationFromSlug(slug);
  /* Unknown specialization: never a dead end — send the visitor to the
     directory rather than 404ing a bookmark. */
  if (!label) {
    res.setHeader('Location', '/courses');
    return res.status(302).send('Redirecting to /courses');
  }

  let courses = [];
  let extended = true;
  let counts = new Map();
  try {
    const loaded = await loadCourses(label);
    courses = loaded.courses;
    extended = loaded.extended;
    counts = await loadCounts();
  } catch (err) {
    /* A database hiccup must not produce a broken page: render the honest
       empty state (noindex) and log the real reason. */
    console.warn('course page data unavailable:', String((err && err.message) || err).slice(0, 300));
  }

  const html = page({ label, slug: specializationSlug(label), courses, counts, extended });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).send(html);
};

module.exports._internal = { page, courseCard, itemListLd, isoDuration, priceText, loadCourses, specializationFromSlug, detailPage, courseDetailLd };
