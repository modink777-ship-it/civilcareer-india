/* Course directory scope — Udemy + Coursera, Civil Engineering only.
 *
 * Covers the rules the directory spec sets, each one where it can
 * actually fail:
 *  1. classifyCourse(): civil course topics in, everything with only a
 *     weak/indirect connection out (programming, AI, marketing, finance,
 *     generic Excel, graphic design, other engineering branches, generic
 *     AutoCAD, generic project management, non-engineering 'civil').
 *  2. Provider scope: canonicalProvider is the only door, and the
 *     registry tells the truth about both providers (Udemy discontinued
 *     2025-01-01; Coursera has no API CivilCareer is authorized to call)
 *     with nothing marked available.
 *  3. The two exact sentences: PROVIDER_ACCESS_NOTICE is what the API
 *     reports, THIRD_PARTY_NOTICE is what courses.html renders.
 *  4. Import/discovery scope enforcement: wrong platform or non-civil text
 *     is rejected with a reason; the pipeline normalizes, filters,
 *     deduplicates and always stages as a draft for review.
 *  5. The publish gate: nothing non-civil reaches /courses, and only an
 *     explicit admin verification can override the classifier.
 *  6. Honest fields: a missing price stays NULL, never 0/FREE.
 *  7. Page + admin invariants, and the v34 migration being additive.
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
const courses = require(path.join(root, '_api', 'courses.js'));
const discovery = require(path.join(root, '_api', 'course-discovery.js'));
const sciv = require(path.join(root, 'lib', 'course-civil.js'));

const { coursePayload, publicCourse, publicListPath, publishGate } = courses._internal;
const { importItem, providers, availableProviders, directoryScope, stageDiscovery } = discovery._internal;
const {
  SUPPORTED_PROVIDERS, COURSE_SPECIALIZATIONS, PROVIDER_ACCESS_NOTICE,
  THIRD_PARTY_NOTICE, canonicalProvider, classifyCourse,
  normalizeSpecialization,
} = sciv;

/* ── harness (same shape as tests/courses-api.test.js) ──────────── */

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k in headers ? headers[k] : null) },
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
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
    calls.push({ url: target, method, body });
    if (route) {
      const custom = route(target, method, body);
      if (custom !== undefined) return custom;
    }
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

let ipSeq = 0;
function freshIp() { ipSeq += 1; return `10.77.${Math.floor(ipSeq / 200)}.${(ipSeq % 200) + 1}`; }

function run(handler, { url, method = 'GET', query = {}, body = null, adminUser = null, headers = {} }) {
  const req = { url, method, query, body, headers, adminUser };
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

const CIVIL_TITLES = [
  'AutoCAD Civil 3D Essentials',
  'AutoCAD for Civil Engineers',
  'STAAD.Pro Complete Course',
  'ETABS for RCC Building Design',
  'Revit Structure: BIM for Civil Engineers',
  'Primavera P6 Professional',
  'Quantity Surveying and BBS Masterclass',
  'Estimation and Costing of Buildings',
  'Construction Management: Project Planning',
  'Design of Reinforced Concrete Structures (IS 456)',
  'Steel Structure Design as per IS 800',
  'Geotechnical Engineering and Soil Mechanics',
  'Foundation Engineering: Pile Design',
  'Transportation Engineering: Traffic Analysis',
  'Highway and Pavement Design',
  'Water Resources Engineering and Hydraulics',
  'Environmental Engineering: Water Treatment',
  'Surveying and Levelling with Total Station',
  'Concrete Technology and Mix Design',
  'Building Materials and Material Testing',
  'Construction Technology and Site Supervision',
  'GATE Civil Engineering 2027',
  'SSC JE Civil Engineering Preparation',
  'RRB JE Civil Crash Course',
  'State AE/JE Civil Junior Engineer Exam Prep',
  'Interview Skills for Civil Engineers',
];

const NON_CIVIL_TITLES = [
  'Complete Python Bootcamp',
  'Machine Learning A-Z',
  'Digital Marketing Masterclass',
  'Business Analytics with Excel',
  'Financial Accounting Fundamentals',
  'Graphic Design for Beginners',
  'Mechanical Engineering: AutoCAD for Machine Design',
  'Electrical Engineering Fundamentals',
  'AutoCAD 2025 Complete Guide',
  'Project Management Professional (PMP) Exam Prep',
  'Civil Servants Exam Preparation',
];

/* ── 1. classification ──────────────────────────────────────────── */

test('every Civil Engineering topic in the spec classifies as civil', () => {
  for (const title of CIVIL_TITLES) {
    const r = classifyCourse({ title });
    assert.strictEqual(r.civil, true, `should be in scope: ${title} (${r.reasons.join(',')})`);
    assert.ok(COURSE_SPECIALIZATIONS.includes(r.specialization),
      `specialization must be a selectable label for ${title}: ${r.specialization}`);
  }
});

test('generic and unrelated courses are excluded, with a reason', () => {
  for (const title of NON_CIVIL_TITLES) {
    const r = classifyCourse({ title });
    assert.strictEqual(r.civil, false, `must not be listed: ${title} -> ${r.specialization}`);
    assert.ok(r.reasons.length, 'a rejection must carry its reason: ' + title);
    assert.strictEqual(r.specialization, null, 'no specialization may be invented');
  }
});

test('other branches are excluded even when they use civil software', () => {
  const r = classifyCourse({ title: 'Mechanical Engineering: AutoCAD for Machine Design', description: 'Draw machine parts' });
  assert.strictEqual(r.civil, false);
  assert.ok(/other_engineering_branch|hard_negative/.test(r.reasons.join(',')), r.reasons.join(','));
  /* The same tool with a civil context IS in scope. */
  assert.strictEqual(classifyCourse({ title: 'AutoCAD for Site Engineers', description: 'Drafting for construction sites' }).civil, true);
});

test('the classifier never needs a rating, price or enrolment to decide', () => {
  const r = classifyCourse({ title: 'STAAD.Pro Complete Course' });
  assert.deepStrictEqual(Object.keys(r).sort(), ['civil', 'level', 'reasons', 'specialization']);
});

test('an admin classification overrides the heuristic, and only a known label is accepted', () => {
  const r = classifyCourse({ title: 'Unusual course wording', specialization: 'Structural Engineering' });
  assert.strictEqual(r.civil, true, 'the admin decision wins');
  assert.deepStrictEqual(r.reasons, ['admin_classification']);
  assert.strictEqual(normalizeSpecialization('structural engineering'), 'Structural Engineering', 'case-insensitive');
  assert.strictEqual(normalizeSpecialization('Astrology'), null, 'unknown labels are refused');
  assert.strictEqual(normalizeSpecialization(''), null);
});

test('the course vocabulary is a superset of the spec examples', () => {
  for (const label of ['AutoCAD & Civil 3D', 'STAAD.Pro', 'ETABS', 'Revit & BIM', 'Primavera P6 & MS Project',
    'Quantity Surveying', 'Estimation & Costing', 'Construction Management', 'Structural Engineering',
    'Geotechnical Engineering', 'Soil Mechanics', 'Foundation Engineering', 'Transportation & Traffic Engineering',
    'Highway Engineering', 'Hydraulics & Water Resources', 'Environmental Engineering', 'Surveying',
    'Concrete Technology', 'Building Materials', 'Construction Technology', 'Project Planning',
    'GATE Civil Engineering', 'SSC JE Civil', 'RRB JE Civil', 'State AE/JE Civil']) {
    assert.ok(COURSE_SPECIALIZATIONS.includes(label), 'missing specialization: ' + label);
  }
});

/* ── 2. provider scope ──────────────────────────────────────────── */

test('only Udemy and Coursera are providers of this directory', () => {
  assert.deepStrictEqual(SUPPORTED_PROVIDERS, ['Udemy', 'Coursera']);
  assert.strictEqual(canonicalProvider('udemy'), 'Udemy');
  assert.strictEqual(canonicalProvider(' COURSERA '), 'Coursera');
  for (const other of ['NPTEL', 'YouTube', 'edX', 'Skillshare', '']) {
    assert.strictEqual(canonicalProvider(other), null, other + ' must not be in scope');
  }
});

test('the provider registry states the verified facts and claims no availability', () => {
  const list = providers();
  const ids = list.map((p) => p.id).sort();
  assert.deepStrictEqual(ids, ['coursera', 'udemy'], 'registry must cover exactly the two platforms');
  const udemy = list.find((p) => p.id === 'udemy');
  const coursera = list.find((p) => p.id === 'coursera');
  assert.strictEqual(udemy.status, 'discontinued');
  assert.ok(/2025-01-01|1\/1\/2025/.test(udemy.note), 'Udemy note must date the discontinuation');
  assert.ok(/robots|Disallow|authorized|partner/i.test(coursera.note), 'Coursera note must say why it is not called');
  assert.ok(/robots|Disallow/.test(coursera.note), 'Coursera note must name the robots restriction that stops us');
  for (const p of list) {
    assert.strictEqual(p.available, false, p.id + ' must not claim availability');
    assert.notStrictEqual(p.status, 'available');
  }
  assert.deepStrictEqual(availableProviders(), [], 'no provider may be runnable today');
});

test('provider credentials alone never enable discovery', () => {
  process.env.UDEMY_CLIENT_ID = 'x';
  process.env.UDEMY_CLIENT_SECRET = 'y';
  try {
    assert.deepStrictEqual(availableProviders(), [], 'a discontinued API cannot be switched on by env vars');
    const udemy = providers().find((p) => p.id === 'udemy');
    assert.strictEqual(udemy.configured, true, 'the registry still reports what is configured');
    assert.strictEqual(udemy.available, false);
  } finally {
    delete process.env.UDEMY_CLIENT_ID;
    delete process.env.UDEMY_CLIENT_SECRET;
  }
});

/* ── 3. the two exact sentences ─────────────────────────────────── */

test('the provider-access notice is the spec sentence, word for word', () => {
  assert.strictEqual(PROVIDER_ACCESS_NOTICE,
    'Automatic provider API access not configured; manual/bulk Civil Engineering course import remains available.');
});

test('the public page carries the third-party notice verbatim', () => {
  const html = fs.readFileSync(path.join(root, 'courses.html'), 'utf8');
  assert.ok(html.includes(THIRD_PARTY_NOTICE),
    'courses.html must render the notice from lib/course-civil.js unchanged');
  assert.ok(/provided by third-party platforms/.test(html) && /does not sell these courses/.test(html)
    && /Verify course details and pricing on the provider's website/.test(html), 'notice wording drifted');
});

test('GET /api/course-discovery reports the notice and never a secret', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(discovery, { url: '/api/course-discovery', method: 'GET', query: {}, adminUser: { id: 'admin' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    assert.strictEqual(body.apiAccess.configured, false);
    assert.strictEqual(body.apiAccess.notice, PROVIDER_ACCESS_NOTICE);
    assert.deepStrictEqual(body.apiAccess.providers, []);
    assert.deepStrictEqual(body.scope.providers, SUPPORTED_PROVIDERS);
    assert.strictEqual(body.scope.civilOnly, true);
    assert.deepStrictEqual(body.scope.specializations, COURSE_SPECIALIZATIONS);
    assert.ok(body.manualImport && /Udemy \| Coursera/.test(body.manualImport.bodyShape.items[0].provider),
      'the manual import shape must state the provider scope');
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|service-role/i.test(res.bodyText), 'no secret in the response');
  } finally { stub.restore(); }
});

test('action=run answers with the exact notice and calls no provider', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(discovery, {
      url: '/api/course-discovery?action=run', method: 'POST', query: { action: 'run' },
      body: {}, adminUser: { id: 'admin' }, headers: { 'x-forwarded-for': freshIp() },
    });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    assert.strictEqual(body.code, 'no-provider-available');
    assert.strictEqual(body.message, PROVIDER_ACCESS_NOTICE, 'the report must use the spec sentence');
    assert.strictEqual(body.staged, 0);
    assert.ok(/discontinued/i.test(body.details || ''), 'the details must state the Udemy fact');
    assert.ok(/robots/i.test(body.details || ''), 'the details must state the Coursera fact');
    const external = stub.calls.filter((c) => /udemy|coursera|nptel/i.test(c.url));
    assert.deepStrictEqual(external, [], 'no provider host may be called');
  } finally { stub.restore(); }
});

/* ── 4. import + discovery scope enforcement ────────────────────── */

test('importItem refuses a specialization outside the directory vocabulary', () => {
  const bad = importItem({ title: 'STAAD.Pro Course', provider: 'Udemy', course_url: 'https://udemy.test/1', specialization: 'Astrology' });
  assert.ok(bad.error && /specialization/i.test(bad.error), 'unknown labels must be rejected');
  const ok = importItem({ title: 'STAAD.Pro Course', provider: 'udemy', course_url: 'https://udemy.test/2', specialization: 'staad.pro' });
  assert.ok(!ok.error, ok.error || '');
  assert.strictEqual(ok.payload.provider, 'Udemy', 'the provider is canonicalised');
  assert.strictEqual(ok.payload.specialization, 'STAAD.Pro');
});

test('directoryScope rejects another platform and non-civil text, with reasons', () => {
  const platform = directoryScope({ title: 'STAAD.Pro Complete Course', provider: 'NPTEL' });
  assert.ok(platform.error && /Udemy or Coursera/.test(platform.error), platform.error);
  const subject = directoryScope({ title: 'Machine Learning A-Z', provider: 'Coursera' });
  assert.ok(subject.error && /not a Civil Engineering course/.test(subject.error), subject.error);
  const good = directoryScope({ title: 'ETABS for RCC Building Design', provider: 'coursera', description: 'IS 456' });
  assert.strictEqual(good.provider, 'Coursera');
  assert.strictEqual(good.specialization, 'ETABS');
});

test('bulk import stores civil courses as drafts and reports the rest', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses')) return reply(200, []);
    if (method === 'POST' && url.includes('/rest/v1/courses')) return reply(201, [{}]);
    return undefined;
  });
  try {
    const res = await run(discovery, {
      url: '/api/course-discovery?action=import', method: 'POST', query: { action: 'import' },
      body: {
        items: [
          { title: 'Primavera P6 for Construction Projects', provider: 'Udemy', course_url: 'https://udemy.test/p6', description: 'Scheduling for construction sites' },
          { title: 'Complete Python Bootcamp', provider: 'Udemy', course_url: 'https://udemy.test/py' },
          { title: 'STAAD.Pro Complete Course', provider: 'NPTEL', course_url: 'https://nptel.test/staad' },
        ],
      },
      adminUser: { id: 'admin' }, headers: { 'x-forwarded-for': freshIp() },
    });
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(body.imported, 1, 'only the in-scope course may be stored: ' + res.bodyText);
    assert.strictEqual(body.rejected.length, 2, 'both out-of-scope rows must be reported');
    assert.ok(body.rejected.some((r) => /Civil Engineering/.test(r.reason)), 'the non-civil reason is named');
    assert.ok(body.rejected.some((r) => /Udemy or Coursera/.test(r.reason)), 'the platform reason is named');
    const insert = stub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/courses'));
    assert.strictEqual(insert.body.is_published, false, 'imports are drafts');
    assert.strictEqual(insert.body.civil_verified, false, 'an import can never self-verify');
    assert.strictEqual(insert.body.specialization, 'Primavera P6 & MS Project', 'the classifier assigns the specialization');
    assert.strictEqual(insert.body.provider, 'Udemy', 'the provider is canonicalised');
  } finally { stub.restore(); }
});

test('stageDiscovery is the provider pipeline: normalize, filter, dedupe, pending review', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses')) return reply(200, []);
    if (method === 'POST' && url.includes('/rest/v1/courses')) return reply(201, [{}]);
    return undefined;
  });
  try {
    const result = await stageDiscovery('Coursera', [
      { title: 'Surveying and Levelling with Total Station', course_url: 'https://coursera.test/v1?utm_source=x', external_id: 'c-1' },
      { title: 'Financial Accounting Fundamentals', course_url: 'https://coursera.test/v2' },
    ]);
    assert.strictEqual(result.staged, 1);
    assert.strictEqual(result.rejected.length, 1);
    const insert = stub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/courses'));
    assert.ok(insert, 'the in-scope row must be inserted');
    assert.strictEqual(insert.body.provider, 'Coursera');
    assert.strictEqual(insert.body.is_published, false);
    assert.strictEqual(insert.body.source, 'discovery:coursera');
    assert.strictEqual(insert.body.specialization, 'Surveying');
    /* Normalisation exists for IDENTITY, not to rewrite what the provider
       gave us: the URL is stored exactly as supplied, while the duplicate
       lookup also tries the campaign-stripped form so the same course
       pasted twice matches whichever shape it arrives in. */
    assert.strictEqual(insert.body.course_url, 'https://coursera.test/v1?utm_source=x');
    const lookups = stub.calls.filter((c) => c.method === 'GET' && c.url.includes('/rest/v1/courses'));
    assert.ok(lookups.some((c) => c.url.includes('course_url=eq.https%3A%2F%2Fcoursera.test%2Fv1')),
      'the normalised URL must be used for deduplication: ' + JSON.stringify(lookups.map((c) => c.url)));
  } finally { stub.restore(); }
});

test('stageDiscovery is not reachable through the HTTP action surface', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(discovery, {
      url: '/api/course-discovery?action=stage', method: 'POST', query: { action: 'stage' },
      body: { items: [] }, adminUser: { id: 'admin' }, headers: { 'x-forwarded-for': freshIp() },
    });
    assert.strictEqual(res.statusCode, 400, 'only run and import are exposed: ' + res.bodyText);
    assert.strictEqual(stub.calls.length, 0, 'an unknown action must not touch the database');
  } finally { stub.restore(); }
});

/* ── 5. the publish gate ────────────────────────────────────────── */

test('publishGate lets drafts through and blocks unclassified publications', () => {
  assert.strictEqual(publishGate({ is_published: false, title: 'Complete Python Bootcamp' }), null);
  assert.ok(publishGate({ is_published: true, title: 'Complete Python Bootcamp', provider: 'Udemy' }),
    'a generic course must not become public');
  assert.strictEqual(publishGate({ is_published: true, title: 'STAAD.Pro Complete Course', provider: 'Udemy' }), null);
  assert.strictEqual(publishGate({ is_published: true, title: 'STAAD.Pro Complete Course', provider: 'Udemy', civil_verified: true }), null);
  assert.strictEqual(publishGate({ is_published: true, title: 'Anything at all', provider: 'Coursera', civil_verified: true }), null,
    'an explicit admin verification overrides the classifier');
  assert.strictEqual(publishGate({ is_published: true, title: 'Anything at all', specialization: 'Structural Engineering' }), null);
});

test('POST with is_published on a non-civil course is refused with the reason', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(courses, {
      url: '/api/courses', method: 'POST', query: {},
      body: { title: 'Complete Python Bootcamp', provider: 'Udemy', course_url: 'https://udemy.test/py', is_published: true },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(res.statusCode, 409, res.bodyText);
    const body = JSON.parse(res.bodyText);
    assert.ok(/Civil Engineering/.test(body.error), 'the refusal must explain itself');
    assert.ok(body.classification && body.classification.civil === false, 'the classification travels with the refusal');
    assert.strictEqual(stub.calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/courses')).length, 0,
      'a refused publish must not write');
  } finally { stub.restore(); }
});

test('the same course published with an explicit verification is stored', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'POST' && url.includes('/rest/v1/courses')) return reply(201, [{}]);
    return undefined;
  });
  try {
    const res = await run(courses, {
      url: '/api/courses', method: 'POST', query: {},
      body: {
        title: 'Complete Python Bootcamp', provider: 'Udemy', course_url: 'https://udemy.test/py',
        is_published: true, civil_verified: true,
      },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(res.statusCode, 201, res.bodyText);
    const insert = stub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/courses'));
    assert.strictEqual(insert.body.civil_verified, true);
    assert.strictEqual(insert.body.is_published, true);
  } finally { stub.restore(); }
});

test('a draft row still saves with no classification, so the queue can hold it', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'POST' && url.includes('/rest/v1/courses')) return reply(201, [{}]);
    return undefined;
  });
  try {
    const res = await run(courses, {
      url: '/api/courses', method: 'POST', query: {},
      body: { title: 'Complete Python Bootcamp', provider: 'Udemy', course_url: 'https://udemy.test/py', is_published: false },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(res.statusCode, 201, res.bodyText);
  } finally { stub.restore(); }
});

test('admin GET labels each row with the server-side classification', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('select=*')) {
      return reply(200, [
        { id: 'a', title: 'STAAD.Pro Complete Course', provider: 'Udemy', course_url: 'https://udemy.test/a', is_published: false },
        { id: 'b', title: 'Complete Python Bootcamp', provider: 'Udemy', course_url: 'https://udemy.test/b', is_published: false },
      ]);
    }
    return undefined;
  });
  try {
    const res = await run(courses, { url: '/api/courses?admin=1', query: { admin: '1' }, adminUser: { id: 'admin' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    const a = body.courses.find((c) => c.id === 'a');
    const b = body.courses.find((c) => c.id === 'b');
    assert.strictEqual(a.classification.civil, true);
    assert.strictEqual(b.classification.civil, false);
    assert.strictEqual(body.stats.needsClassification, 1, 'the reviewer must see how many need a decision');
  } finally { stub.restore(); }
});

/* ── 6. honest fields ───────────────────────────────────────────── */

test('a price the provider did not supply stays NULL, never 0 or FREE', () => {
  const omitted = coursePayload({ title: 'STAAD.Pro Course', provider: 'Udemy', course_url: 'https://udemy.test/1' });
  assert.strictEqual(omitted.payload.price_inr, null, 'an absent price must not become 0');
  assert.strictEqual(omitted.payload.is_free, false, 'an absent price must not become FREE');
  const zero = coursePayload({ title: 'STAAD.Pro Course', provider: 'Udemy', course_url: 'https://udemy.test/1', price_inr: 0 });
  assert.strictEqual(zero.payload.price_inr, 0);
  assert.strictEqual(zero.payload.is_free, true, 'an explicit 0 IS free');
  assert.strictEqual(publicCourse({ id: 'x', title: 't', provider: 'Udemy', course_url: 'https://u.test', price_inr: null }).price_inr, null);
});

test('the public projection exposes description and specialization only for real values', () => {
  const out = publicCourse({
    id: 'x', title: 't', provider: 'Udemy', course_url: 'https://u.test',
    description: 'A short summary', specialization: 'STAAD.Pro',
    admin_notes: 'secret', civil_verified: true, url_status: 'alive',
  });
  assert.strictEqual(out.description, 'A short summary');
  assert.strictEqual(out.specialization, 'STAAD.Pro');
  assert.ok(!('admin_notes' in out), 'admin_notes must not leak');
  assert.ok(!('civil_verified' in out), 'the admin verification flag must not leak');
  assert.strictEqual(publicCourse({ id: 'y', title: 't', provider: 'Udemy', course_url: 'https://u.test' }).description, null);
});

test('the public list filters by specialization and free/paid', () => {
  const { path: p } = publicListPath(new URLSearchParams('specialization=STAAD.Pro&paid=true&provider=Udemy'));
  assert.ok(p.includes('specialization=eq.STAAD.Pro'), p);
  assert.ok(p.includes('is_free=eq.false'), 'paid must exclude free courses');
  assert.ok(p.includes('description'), 'the card needs the description');
  const unknown = publicListPath(new URLSearchParams('specialization=Astrology')).path;
  assert.ok(!unknown.includes('specialization='), 'an unknown specialization must not be queried');
});

test('the public provider facet always offers Udemy and Coursera', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses')) return reply(200, []);
    return undefined;
  });
  try {
    const res = await run(courses, { url: '/api/courses', query: {} });
    const body = JSON.parse(res.bodyText);
    assert.deepStrictEqual(body.filters.providers, ['Udemy', 'Coursera']);
    assert.deepStrictEqual(body.filters.specializations, COURSE_SPECIALIZATIONS);
    assert.ok(!body.columnsMissing, 'v34 present: no fallback flag');
  } finally { stub.restore(); }
});

test('before v34 is applied the public list still serves the v32 columns', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('description')) {
      return reply(400, { code: 'PGRST204', message: "Could not find the 'description' column of 'courses' in the schema cache" });
    }
    if (method === 'GET' && url.includes('/rest/v1/courses')) {
      return reply(200, [{ id: 'legacy', title: 'STAAD.Pro Course', provider: 'Udemy', course_url: 'https://udemy.test/legacy', is_published: true }]);
    }
    return undefined;
  });
  try {
    const res = await run(courses, { url: '/api/courses', query: {} });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, 'a missing migration must not take /courses down: ' + res.bodyText);
    assert.strictEqual(body.columnsMissing, true);
    assert.ok(/v34-courses-civil\.sql/.test(body.notice || ''), 'the owner must be told which migration to run');
    assert.strictEqual(body.courses.length, 1, 'the legacy columns are still served');
    const refused = stub.calls.filter((c) => c.url.includes('description'));
    assert.ok(refused.length >= 1, 'the extended query was attempted first');
  } finally { stub.restore(); }
});

/* ── 7. surfaces ────────────────────────────────────────────────── */

test('courses.html is the Civil Engineering course directory the spec describes', () => {
  const html = fs.readFileSync(path.join(root, 'courses.html'), 'utf8');
  assert.ok(/<h1>Civil Engineering Courses<\/h1>/.test(html), 'the page needs the spec heading');
  assert.ok(html.includes('Discover Civil Engineering courses from Udemy and Coursera'), 'the spec subtitle is missing');
  for (const id of ['coProvider', 'coCategory', 'coStage', 'coPrice', 'coSpec', 'coSearch', 'coGrid', 'coReset']) {
    assert.ok(html.includes(`id="${id}"`), 'missing filter/control: ' + id);
  }
  /* Provider filter offers All / Udemy / Coursera. */
  assert.ok(/All providers/.test(html), 'the provider filter needs an All option');
  assert.ok(/Free only/.test(html) && /Paid only/.test(html), 'free/paid must be selectable');
  assert.ok(html.includes('View Course →'), 'the card CTA must read View Course');
  assert.ok(/Opens on /.test(html), 'the leaving notice must name the provider');
  /* Card fields, each rendered only when the provider supplied them. */
  assert.ok(/c\.rating!=null/.test(html), 'rating must be conditional');
  assert.ok(/c\.duration_hours!=null/.test(html), 'duration must be conditional');
  assert.ok(/c\.instructor/.test(html), 'instructor must be conditional');
  assert.ok(/c\.description/.test(html) && /c\.thumbnail_url/.test(html), 'description and thumbnail must be rendered');
  assert.ok(/Price not provided/.test(html), 'an unknown price must say so instead of 0/FREE');
  /* Affiliate hygiene: nothing is called an affiliate link unless it is one. */
  assert.ok(!/Affiliate disclosure/.test(html), 'the old blanket affiliate claim must be gone');
  assert.ok(/c\.affiliate_url\?'noopener sponsored':'noopener noreferrer'/.test(html),
    'rel=sponsored must be conditional on a real affiliate link');
  assert.ok(!/rel="noopener sponsored"/.test(html), 'a plain provider URL must never be pre-labelled sponsored');
  /* Structure + SEO from v32 stay intact. */
  assert.ok(html.includes('<a class="skip" href="#content">'), 'skip link required');
  assert.ok(/<main id="content"/.test(html), 'main#content required');
  assert.ok(html.includes('"@type":"CollectionPage"'), 'JSON-LD required');
  assert.ok(html.includes('<link rel="canonical" href="https://civilcareer-india-two.vercel.app/courses">'), 'canonical required');
});

test('the admin Courses tab shows the scope, the notice, and the classification controls', () => {
  const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.ok(admin.includes('id="crNotice"'), 'the provider-access notice element is missing');
  assert.ok(!admin.includes(PROVIDER_ACCESS_NOTICE),
    'the notice must come from the API at runtime, not be retyped into the page');
  assert.ok(/crApiAccess=disc\.apiAccess/.test(admin), 'the notice source must be the API response');
  assert.ok(admin.includes('Civil Engineering only'), 'the panel must state the directory scope');
  assert.ok(admin.includes('Pending review'), 'discovered rows must be marked pending review');
  for (const control of ['name="specialization"', 'name="description"', 'name="civil_verified"', 'name="course_url"', 'name="category"']) {
    assert.ok(admin.includes(control), 'the editor is missing ' + control);
  }
  assert.ok(/Needs classification/.test(admin), 'unclassified drafts must be flagged in the queue');
  assert.ok(/No civil match/.test(admin), 'the stats row must count rows needing a civil decision');
  assert.ok(!/function classifyCourse|COURSE_TOPICS/.test(admin),
    'the browser must not re-implement the classifier — the server decides');
  /* The publish override must be driven by the server refusing, not by a
     copy of the rule in the browser. */
  assert.ok(/does not classify as Civil Engineering/.test(admin), 'the override must key off the server message');
  /* A8 byte-equality gate. */
  const bundle = require(path.join(root, '_api', 'admin-page-html.js'));
  assert.strictEqual(bundle.html, admin, 'stale admin bundle — run: node scripts/build-admin-bundle.js');
});

test('v34 is additive, keeps the v32 RLS model, and cannot invent a price', () => {
  const sql = fs.readFileSync(path.join(root, 'v34-courses-civil.sql'), 'utf8');
  assert.ok(/add column if not exists description/i.test(sql), 'description column missing');
  assert.ok(/add column if not exists specialization/i.test(sql), 'specialization column missing');
  assert.ok(/add column if not exists civil_verified/i.test(sql), 'civil_verified column missing');
  assert.ok(/drop not null/i.test(sql) && /drop default/i.test(sql), 'price_inr must become unknown-aware');
  assert.ok(!/drop\s+(column|table)/i.test(sql), 'v34 must be additive only');
  assert.ok(!/create policy|alter policy/i.test(sql), 'v34 must not change the RLS policies from v32');
  assert.ok(!/disable row level security/i.test(sql), 'RLS must stay on');
  assert.ok(/v34-courses-civil\.sql/.test(fs.readFileSync(path.join(root, '_api', 'courses.js'), 'utf8')),
    'the API must name the migration to run');
});

test('normalizeUrl is the dedupe identity for a provider URL', () => {
  const { normalizeUrl } = discovery._internal;
  assert.strictEqual(
    normalizeUrl('https://coursera.test/v1?utm_source=x&fbclid=y'),
    normalizeUrl('https://COURSERA.test/v1')
  );
  assert.strictEqual(normalizeUrl('not a url'), null);
});

test('the directory never hides non-civil rows behind a client filter', () => {
  /* The published-only constraint and the civil gate must both be
     server-side: a client asking for drafts gets nothing, and the public
     projection cannot carry an unverified classification. */
  const src = fs.readFileSync(path.join(root, '_api', 'courses.js'), 'utf8');
  assert.ok(/is_published=eq\.true/.test(src), 'the public query must force published');
  assert.ok(/function publishGate/.test(src), 'the publish gate must live in the API');
});
