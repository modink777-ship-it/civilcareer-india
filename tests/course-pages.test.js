/* Per-specialization course landing pages (/courses/<slug>).
 *
 * Covers:
 *  1. The slug map is a bijection over the directory's specializations —
 *     adding a label that collides would send two pages to one URL.
 *  2. Routing: vercel.json rewrites /courses/:slug before the /:seoSlug
 *     catch-all, the dispatcher has the handler, and /courses itself is
 *     still the directory.
 *  3. The page is built from published rows only, for one specialization,
 *     with a canonical URL and Course/ItemList structured data that
 *     carries only fields the provider actually published.
 *  4. Nothing is invented: no price means "Price not provided", no rating
 *     means no rating, and the structured data has no offers or
 *     aggregateRating.
 *  5. An empty specialization is honest AND noindex; a populated one is
 *     indexable. Unknown slugs 302 to the directory instead of 404ing.
 *  6. Before v34 the page still renders from the v32 columns.
 *  7. The sitemap lists only specializations that have a published course.
 *
 * No network: global.fetch is stubbed for the duration of each test.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { test } = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const root = path.join(__dirname, '..');
const dispatcher = require(path.join(root, 'api', '[[...path]].js'));
const coursePage = require(path.join(root, '_api', 'courses-page.js'));
const sitemap = require(path.join(root, '_api', 'sitemap.js'));
const {
  COURSE_SPECIALIZATIONS, specializationSlug, specializationFromSlug,
  THIRD_PARTY_NOTICE,
} = require(path.join(root, 'lib', 'course-civil.js'));
const { page, itemListLd, isoDuration, priceText } = coursePage._internal;

/* ── harness ────────────────────────────────────────────────────── */

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function stubSupabase(route) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: target, method });
    if (route) {
      const custom = route(target, method);
      if (custom !== undefined) return custom;
    }
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

function run(handler, { url, method = 'GET', query = {}, headers = {} }) {
  const req = { url, method, query, headers };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.bodyText = JSON.stringify(obj); resolve(this); return this; },
      send(data) { this.bodyText = String(data); resolve(this); return this; },
      end(data) { if (data !== undefined) this.bodyText = String(data); resolve(this); return this; },
    };
    Promise.resolve(handler(req, res)).then(() => resolve(res), reject);
  });
}

/* The page escapes text for HTML, so a notice containing an apostrophe
   arrives as &#39;. Compare what the reader actually sees. */
function visibleText(html) {
  return String(html)
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const UDEMY = {
  id: 'c1', title: 'STAAD.Pro Complete Course', provider: 'Udemy', instructor: 'Ravi Kumar',
  category: 'Structural', target_roles: ['Structural Engineer'], career_stage: 'Fresher',
  price_inr: 499, original_price_inr: 3499, rating: 4.6, enrollment_count: 18422,
  duration_hours: 12.5, language: 'English', thumbnail_url: null,
  course_url: 'https://www.udemy.com/course/staad-pro-complete/', affiliate_url: null,
  description: 'Model, analyse and design steel and concrete frames.',
  specialization: 'STAAD.Pro', is_free: false, is_featured: true, created_at: '2026-10-01T00:00:00Z',
};
const COURSERA_NO_PRICE = {
  id: 'c2', title: 'Structural Dynamics for Civil Engineers', provider: 'Coursera', instructor: null,
  category: 'Structural', target_roles: [], career_stage: null,
  price_inr: null, original_price_inr: null, rating: null, enrollment_count: null,
  duration_hours: 8, language: null, thumbnail_url: null,
  course_url: 'https://www.coursera.org/learn/structural-dynamics', affiliate_url: null,
  description: null, specialization: 'STAAD.Pro', is_free: false, is_featured: false,
  created_at: '2026-09-10T00:00:00Z',
};

/* ── 1. slug map ────────────────────────────────────────────────── */

test('every specialization has a unique, reversible slug', () => {
  const seen = new Map();
  for (const label of COURSE_SPECIALIZATIONS) {
    const slug = specializationSlug(label);
    assert.ok(slug && /^[a-z0-9-]+$/.test(slug), `bad slug for ${label}: ${slug}`);
    assert.ok(!seen.has(slug), `slug collision: ${label} and ${seen.get(slug)} both map to ${slug}`);
    seen.set(slug, label);
    assert.strictEqual(specializationFromSlug(slug), label, 'slug must round-trip: ' + slug);
  }
  assert.strictEqual(specializationFromSlug('structural-engineering'), 'Structural Engineering');
  assert.strictEqual(specializationFromSlug('gate-civil-engineering'), 'GATE Civil Engineering');
  assert.strictEqual(specializationFromSlug('staad-pro'), 'STAAD.Pro');
  /* Unknown slugs resolve to nothing so the handler can redirect. */
  for (const bogus of ['pmp', 'machine-learning', 'structural-engineering-2026', '']) {
    assert.strictEqual(specializationFromSlug(bogus), null, bogus + ' must not resolve');
  }
});

/* ── 2. routing ─────────────────────────────────────────────────── */

test('vercel.json sends /courses/<slug> to the course page, before the SEO catch-all', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rewrites = vercel.rewrites || [];
  const directory = rewrites.findIndex(r => r.source === '/courses');
  const spec = rewrites.findIndex(r => r.source === '/courses/:slug');
  const catchAll = rewrites.findIndex(r => r.source === '/:seoSlug');
  assert.strictEqual(rewrites[directory].destination, '/courses.html', 'the directory must stay on courses.html');
  assert.ok(spec > -1, '/courses/:slug rewrite missing');
  assert.strictEqual(rewrites[spec].destination, '/api/courses-page?slug=:slug');
  assert.ok(spec > directory, 'the specialization rule must not shadow /courses');
  assert.ok(spec < catchAll, '/courses/:slug must be matched before /:seoSlug');
});

test('the dispatcher resolves /courses/<slug> even when the rewrite leaves the path intact', async () => {
  const stub = stubSupabase((url) => {
    if (url.includes('select=specialization')) return reply(200, [{ specialization: 'STAAD.Pro' }]);
    if (url.includes('/rest/v1/courses')) return reply(200, [UDEMY]);
    return undefined;
  });
  try {
    const res = await run(dispatcher, { url: '/courses/staad-pro', method: 'GET', query: {} });
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.ok(/STAAD\.Pro Courses for Civil Engineers/.test(res.bodyText), 'the page did not render');
    const src = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
    assert.ok(src.includes("'/api/courses-page'"), 'handler not registered in the dispatcher');
    assert.ok(/\/\^\\\/courses\\\//.test(src) || src.includes('courseSlug'), 'path normalisation missing');
  } finally { stub.restore(); }
});

test('/courses itself is still the directory page, not a specialization', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, { url: '/courses', method: 'GET', query: {} });
    /* The directory is a static rewrite, so the dispatcher must NOT claim
       /courses for the course-page handler. */
    assert.strictEqual(res.statusCode, 404, 'the dispatcher should not own /courses, got ' + res.statusCode);
    const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    assert.ok((vercel.rewrites || []).some(r => r.source === '/courses' && r.destination === '/courses.html'));
  } finally { stub.restore(); }
});

/* ── 3. published rows only ─────────────────────────────────────── */

test('the page queries only published rows for one specialization', async () => {
  const stub = stubSupabase((url) => {
    if (url.includes('select=specialization')) return reply(200, [{ specialization: 'STAAD.Pro' }]);
    if (url.includes('/rest/v1/courses')) return reply(200, [UDEMY]);
    return undefined;
  });
  try {
    const res = await run(coursePage, { url: '/courses/staad-pro?slug=staad-pro', query: { slug: 'staad-pro' } });
    assert.strictEqual(res.statusCode, 200);
    const list = stub.calls.filter(c => c.url.includes('/rest/v1/courses') && c.url.includes('is_published=eq.true'));
    assert.ok(list.length >= 1, 'the page must query published rows');
    for (const c of list) {
      if (c.url.includes('select=specialization')) continue;
      assert.ok(c.url.includes('is_published=eq.true'), 'published filter missing: ' + c.url);
      assert.ok(c.url.includes('specialization=eq.STAAD.Pro'), 'specialization filter missing: ' + c.url);
      assert.ok(!c.url.includes('admin_notes'), 'admin_notes must never reach a public page');
      assert.ok(c.url.includes('select=id,title,provider'), 'the public projection must be reused');
    }
  } finally { stub.restore(); }
});

/* ── 4. rendering + structured data ─────────────────────────────── */

test('the rendered page carries the honest card fields and the third-party notice', () => {
  const html = page({
    label: 'STAAD.Pro', slug: 'staad-pro', counts: new Map([['STAAD.Pro', 2]]),
    courses: [require(path.join(root, '_api', 'courses.js'))._internal.publicCourse(UDEMY),
      require(path.join(root, '_api', 'courses.js'))._internal.publicCourse(COURSERA_NO_PRICE)],
    extended: true,
  });
  assert.ok(html.includes('<h1>STAAD.Pro Courses for Civil Engineers</h1>'), 'heading missing');
  assert.ok(visibleText(html).includes(THIRD_PARTY_NOTICE), 'the directory notice must appear word for word');
  assert.ok(html.includes('/courses?specialization=STAAD.Pro&amp;provider=Udemy'), 'provider filter links must reuse the directory filters');
  assert.ok(html.includes('View Course →'), 'the card CTA is missing');
  assert.ok(html.includes('https://www.udemy.com/course/staad-pro-complete/'), 'the CTA must point at the provider');
  assert.ok(html.includes('rel="noopener noreferrer"'), 'a plain provider link must not be labelled sponsored');
  assert.ok(!/rel="noopener sponsored"/.test(html), 'nothing here carries an affiliate_url');
  assert.ok(html.includes('★ 4.6'), 'a published rating must be shown');
  assert.ok(html.includes('12.5 hours'), 'duration must be shown when published');
  assert.ok(html.includes('₹499'), 'price must be shown when published');
  assert.ok(html.includes('Price not provided — check on Coursera'), 'an unknown price must say so');
  assert.ok(html.includes('Ravi Kumar'), 'instructor must be shown when published');
  /* styles.css has a global nav{} rule that pins any <nav> at <=1050px,
     which pushed this page's link lists over the content when they were
     <nav> elements (seen in a browser at 872px wide). */
  assert.ok(!/<nav\b/.test(html), 'the page must not use <nav>: styles.css positions it as the site mobile menu');
  assert.ok(html.includes('<div class="cp-links" role="navigation"'), 'the link lists keep their navigation semantics');
  assert.ok(!/undefined|null/.test(html.replace(/nullslast/g, '')), 'no raw null may leak into the page');
});

test('an affiliate link is the only link marked sponsored', () => {
  const withAff = Object.assign({}, UDEMY, { id: 'c9', affiliate_url: 'https://www.udemy.com/course/staad-pro-complete/?aff=cc' });
  const html = page({ label: 'STAAD.Pro', slug: 'staad-pro', counts: new Map(), courses: [withAff], extended: true });
  assert.ok(html.includes('href="https://www.udemy.com/course/staad-pro-complete/?aff=cc"'), 'the affiliate link must be the CTA');
  assert.ok(html.includes('rel="noopener sponsored"'), 'and it must be labelled sponsored');
});

test('structured data lists the courses as Courses offered by their platform', () => {
  const ld = itemListLd([
    Object.assign({}, UDEMY, { rating: 4.6, enrollment_count: 18422 }),
    COURSERA_NO_PRICE,
  ]);
  assert.strictEqual(ld['@type'], 'ItemList');
  assert.strictEqual(ld.itemListElement.length, 2);
  const first = ld.itemListElement[0];
  assert.strictEqual(first.position, 1);
  assert.strictEqual(first.item['@type'], 'Course');
  assert.strictEqual(first.item.name, UDEMY.title);
  assert.strictEqual(first.item.url, UDEMY.course_url, 'the Course URL is the provider page');
  assert.deepStrictEqual(first.item.provider, { '@type': 'Organization', name: 'Udemy' });
  assert.strictEqual(first.item.timeRequired, 'PT12H30M');
  assert.strictEqual(first.item.inLanguage, 'English');
  assert.ok(!('isAccessibleForFree' in first.item), 'a paid course must not claim to be free');
  /* Fields the provider did not publish must be absent, not null. */
  assert.ok(!('description' in ld.itemListElement[1].item), 'a missing description must be omitted');
  assert.ok(!('offers' in first.item), 'no invented offer');
  assert.ok(!('aggregateRating' in first.item), 'no invented rating markup');
  const free = itemListLd([Object.assign({}, UDEMY, { is_free: true, price_inr: 0, description: 'x' })]);
  assert.strictEqual(free.itemListElement[0].item.isAccessibleForFree, true, 'a free course may say so');
});

test('helper formatting stays factual', () => {
  assert.strictEqual(isoDuration(12.5), 'PT12H30M');
  assert.strictEqual(isoDuration(8), 'PT8H');
  assert.strictEqual(isoDuration(0.5), 'PT30M');
  assert.strictEqual(priceText({ is_free: true, price_inr: 0 }), 'FREE');
  assert.strictEqual(priceText({ is_free: false, price_inr: null, provider: 'Coursera' }), 'Price not provided — check on Coursera');
  assert.strictEqual(priceText({ is_free: false, price_inr: 499, original_price_inr: 3499 }), '₹499 (was ₹3,499)');
});

/* ── 5. empty, populated, unknown ───────────────────────────────── */

test('an empty specialization is honest and noindex; a populated one is indexable', async () => {
  const empty = stubSupabase((url) => {
    if (url.includes('select=specialization')) return reply(200, []);
    if (url.includes('/rest/v1/courses')) return reply(200, []);
    return undefined;
  });
  try {
    const res = await run(coursePage, { url: '/courses/steel-design?slug=steel-design', query: { slug: 'steel-design' } });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.bodyText.includes('<meta name="robots" content="noindex,follow">'), 'an empty page must not be indexed');
    assert.ok(/No Steel Design courses are published/.test(res.bodyText), 'an empty page must say so honestly');
    assert.ok(!res.bodyText.includes('<article'), 'an empty page must not render course cards');
    assert.ok(visibleText(res.bodyText).includes(THIRD_PARTY_NOTICE), 'the notice stays');
  } finally { empty.restore(); }

  const filled = stubSupabase((url) => {
    if (url.includes('select=specialization')) return reply(200, [{ specialization: 'STAAD.Pro' }]);
    if (url.includes('/rest/v1/courses')) return reply(200, [UDEMY]);
    return undefined;
  });
  try {
    const res = await run(coursePage, { url: '/courses/staad-pro?slug=staad-pro', query: { slug: 'staad-pro' } });
    assert.ok(res.bodyText.includes('<meta name="robots" content="index,follow">'), 'a populated page must be indexable');
    assert.ok(res.bodyText.includes('<article class="cp-card">'), 'cards are expected on a populated page');
    assert.ok(/1 reviewed course published in STAAD\.Pro/.test(res.bodyText), 'the count must be factual: ' + res.bodyText.slice(0, 400));
  } finally { filled.restore(); }
});

test('an unknown specialization redirects to the directory instead of 404ing', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(coursePage, { url: '/courses/pmp-certification?slug=pmp-certification', query: { slug: 'pmp-certification' } });
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.Location, '/courses');
    assert.deepStrictEqual(stub.calls, [], 'no database call for an unknown specialization');
  } finally { stub.restore(); }
});

test('without v34 the page still renders from the v32 columns and says what is missing', async () => {
  const stub = stubSupabase((url) => {
    if (url.includes('description') && url.includes('/rest/v1/courses')) {
      return reply(400, { code: 'PGRST204', message: "Could not find the 'description' column of 'courses' in the schema cache" });
    }
    if (url.includes('select=specialization')) return reply(400, { code: 'PGRST204', message: "Could not find the 'specialization' column" });
    if (url.includes('/rest/v1/courses')) return reply(200, [Object.assign({}, UDEMY, { description: undefined, specialization: undefined })]);
    return undefined;
  });
  try {
    const res = await run(coursePage, { url: '/courses/staad-pro?slug=staad-pro', query: { slug: 'staad-pro' } });
    assert.strictEqual(res.statusCode, 200, 'a missing migration must not break the page');
    assert.ok(res.bodyText.includes('STAAD.Pro Courses for Civil Engineers'), 'the page still renders');
    assert.ok(res.bodyText.includes('v34-courses-civil.sql'), 'the owner is told which migration is missing');
    assert.ok(res.bodyText.includes('<meta name="robots" content="index,follow">'), 'a page with courses stays indexable');
  } finally { stub.restore(); }
});

test('a database failure renders the honest empty page, never a stack trace', async () => {
  const stub = stubSupabase((url) => {
    if (url.includes('/rest/v1/courses')) return reply(500, 'boom');
    return undefined;
  });
  try {
    const res = await run(coursePage, { url: '/courses/staad-pro?slug=staad-pro', query: { slug: 'staad-pro' } });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.bodyText.includes('noindex,follow'), 'a page with no verified data must not be indexed');
    assert.ok(!/boom/.test(res.bodyText), 'the upstream error must not leak into the page');
  } finally { stub.restore(); }
});

/* ── 6. sitemap ─────────────────────────────────────────────────── */

test('the sitemap lists only specializations that have a published course', async () => {
  const stub = stubSupabase((url) => {
    if (url.includes('select=specialization')) return reply(200, [
      { specialization: 'STAAD.Pro' },
      { specialization: 'STAAD.Pro' },
      { specialization: 'Structural Engineering' },
      { specialization: null },
    ]);
    if (url.includes('/rest/v1/jobs')) return reply(200, []);
    return undefined;
  });
  try {
    const res = await run(sitemap, { url: '/sitemap.xml', method: 'GET', query: {} });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.bodyText.includes('<loc>') , 'not XML: ' + res.bodyText.slice(0, 80));
    assert.ok(res.bodyText.includes('/courses/staad-pro'), 'a populated specialization must be listed');
    assert.ok(res.bodyText.includes('/courses/structural-engineering'), 'a second one must be listed too');
    assert.ok(!res.bodyText.includes('/courses/gate-civil-engineering'), 'an empty specialization must not be listed');
    /* The directory itself stays listed exactly once. */
    assert.strictEqual(res.bodyText.split('<loc>https://civilcareer-india-two.vercel.app/courses</loc>').length - 1, 1);
  } finally { stub.restore(); }
});

test('a failing course query keeps the sitemap alive', async () => {
  const stub = stubSupabase((url) => {
    if (url.includes('select=specialization')) return reply(400, { code: 'PGRST204', message: 'no specialization column' });
    if (url.includes('/rest/v1/jobs')) return reply(200, []);
    return undefined;
  });
  try {
    const res = await run(sitemap, { url: '/sitemap.xml', method: 'GET', query: {} });
    assert.strictEqual(res.statusCode, 200, 'the sitemap must survive a missing v34 column');
    assert.ok(res.bodyText.includes('/courses<'), 'the directory is still listed');
  } finally { stub.restore(); }
});
