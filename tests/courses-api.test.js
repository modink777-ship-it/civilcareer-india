/* v32 — Course aggregator tests (master prompt §10–§16, §40).
 *
 * Covers:
 *  1. Public catalog is published-only BY CONSTRUCTION — the query the
 *     handler sends to PostgREST always carries is_published=eq.true, and
 *     admin_notes/external_id never enter the public projection.
 *  2. Anonymous callers cannot reach admin list / create / update / delete
 *     or /api/course-discovery (dispatcher ADMIN_RULES + handler lock).
 *  3. Click tracking verifies the row is published before recording.
 *  4. coursePayload validation: bad rating / price / URL rejected,
 *     drafts by default, affiliate_url only when valid.
 *  5. Discovery import: idempotent, forces is_published=false, keeps
 *     admin-owned affiliate/featured/notes, honest no-provider response
 *     (Udemy Affiliate API discontinued 2025-01-01) and no secrets leak.
 *  6. Page invariants for courses.html (skip link, main#content, canonical
 *     domain, disclosure, JSON-LD, rel=sponsored, no secrets).
 *  7. Routing: dispatcher maps both endpoints, /courses rewrite, sitemap.
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
const courses = require(path.join(root, '_api', 'courses.js'));
const discovery = require(path.join(root, '_api', 'course-discovery.js'));
const { coursePayload, publicCourse, publicListPath } = courses._internal;
const { importItem, normalizeUrl, providers } = discovery._internal;

/* ── harness ─────────────────────────────────────────────────────── */

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k in headers ? headers[k] : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/* Records every Supabase call; route(url, method, body) can override a
   response per test. Falls back to empty-list answers. */
function stubSupabase(route) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
    calls.push({ url: target, method, body, headers: opts.headers || {} });
    if (route) {
      const custom = route(target, method, body);
      if (custom !== undefined) return custom;
    }
    if (target.includes('/rest/v1/courses') && method === 'GET') return reply(200, []);
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

/* Each run gets its own client IP so in-memory rate limits from a
   previous run inside the same minute can never 429 the suite. */
let ipSeq = 0;
function freshIp() {
  ipSeq += 1;
  return `10.42.${Math.floor(ipSeq / 200)}.${(ipSeq % 200) + 1}`;
}

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

/* ── 1. published-only public listing ────────────────────────────── */

test('public list query always forces is_published=eq.true', () => {
  const { path: p } = publicListPath(new URLSearchParams(''));
  assert.ok(p.includes('is_published=eq.true'), 'draft filter must be baked in: ' + p);
  assert.ok(!p.includes('admin_notes'), 'admin_notes must never be selected publicly');
});

test('public list clamps limit to 50 and pages from 1', () => {
  const { path: p, limit, page } = publicListPath(new URLSearchParams('limit=999&page=-4'));
  assert.strictEqual(limit, 50, 'max page size is 50 (section 31)');
  assert.strictEqual(page, 1, 'page must never go below 1');
  assert.ok(p.includes('limit=50'));
  assert.ok(p.includes('offset=0'));
});

test('public list filters map to PostgREST params', () => {
  const q = new URLSearchParams('category=Structural&stage=Fresher&provider=Udemy&free=true&featured=true&search=auto%20cad&role=Site%20Engineer');
  const { path: p } = publicListPath(q);
  assert.ok(p.includes('category=eq.Structural'));
  assert.ok(p.includes('career_stage=eq.Fresher'));
  assert.ok(p.includes('provider=eq.Udemy'));
  assert.ok(p.includes('is_free=eq.true'));
  assert.ok(p.includes('is_featured=eq.true'));
  assert.ok(p.includes('target_roles=cs.'));
  assert.ok(p.includes('title.ilike'), 'search must match title');
  assert.ok(p.includes('order=is_featured.desc'), 'featured sort first');
});

test('public projection drops admin-only fields even if the row has them', () => {
  const out = publicCourse({
    id: 'c1', title: 'T', provider: 'P', course_url: 'https://x.test/c',
    admin_notes: 'SECRET-NOTE', external_id: 'udemy-123', url_status: 'alive',
    target_roles: null, price_inr: null, rating: null,
  });
  assert.ok(!('admin_notes' in out), 'admin_notes leaked into public payload');
  assert.ok(!('external_id' in out), 'external_id leaked into public payload');
  assert.ok(!('url_status' in out), 'url_status leaked into public payload');
  assert.ok(!('civil_verified' in out), 'the admin verification flag leaked into public payload');
  assert.deepStrictEqual(out.target_roles, []);
  /* A row without a price is "not provided" — never rendered as 0/FREE. */
  assert.strictEqual(out.price_inr, null);
  assert.strictEqual(out.description, null);
  assert.strictEqual(out.specialization, null);
});

test('anonymous GET /api/courses returns only rows the server filtered as published', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('is_published=eq.true')) {
      return reply(200, [{ id: 'p1', title: 'Live', provider: 'NPTEL', course_url: 'https://nptel.test/c', is_published: true }]);
    }
    if (method === 'GET' && url.includes('/rest/v1/courses')) {
      /* A row that somehow included a draft must not be masked by the stub:
         the assertion below checks the *query*, this branch proves the
         handler asks the right question regardless of what comes back. */
      return reply(200, []);
    }
    return undefined;
  });
  try {
    const res = await run(courses, { url: '/api/courses?limit=10', query: { limit: '10' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.ok, true);
    const listCalls = stub.calls.filter(c => c.url.includes('/rest/v1/courses') && c.method === 'GET');
    assert.ok(listCalls.length >= 1, 'expected a catalog query');
    for (const c of listCalls) {
      if (c.url.includes('select=category,provider')) continue; /* facet scan */
      assert.ok(c.url.includes('is_published=eq.true'),
        'catalog query missing published filter: ' + c.url);
      assert.ok(!c.url.includes('admin_notes'), 'admin_notes in public select: ' + c.url);
    }
  } finally { stub.restore(); }
});

/* ── 2. anonymous callers are locked out of admin surfaces ───────── */

test('dispatcher routes /api/courses and /api/course-discovery', async () => {
  const src = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
  assert.ok(src.includes("'/api/courses'"), 'courses handler missing from dispatcher');
  assert.ok(src.includes("'/api/course-discovery'"), 'discovery handler missing from dispatcher');
  /* Public surface must stay tiny: GET without ?admin and POST ?action=click. */
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, { url: '/api/courses', method: 'GET', query: {} });
    assert.strictEqual(res.statusCode, 200, 'anonymous public GET must pass the rule');
  } finally { stub.restore(); }
});

test('anonymous GET ?admin=1 is refused by the dispatcher', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, { url: '/api/courses?admin=1', method: 'GET', query: { admin: '1' } });
    assert.strictEqual(res.statusCode, 401, 'admin list must require elevation, got ' + res.statusCode);
  } finally { stub.restore(); }
});

test('anonymous POST /api/courses (create/update) is refused', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, {
      url: '/api/courses', method: 'POST', query: {},
      body: { title: 'X', provider: 'Y', course_url: 'https://x.test/c' },
    });
    assert.strictEqual(res.statusCode, 401, 'create must require elevation, got ' + res.statusCode);
  } finally { stub.restore(); }
});

test('anonymous PATCH and PUT /api/courses are refused', async () => {
  const stub = stubSupabase();
  try {
    for (const method of ['PATCH', 'PUT']) {
      const res = await run(dispatcher, {
        url: '/api/courses', method, query: {},
        body: { id: 'c1', title: 'T', provider: 'P', course_url: 'https://x.test' },
      });
      assert.strictEqual(res.statusCode, 401, method + ' must require elevation, got ' + res.statusCode);
    }
  } finally { stub.restore(); }
});

test('admin PATCH updates and refuses an id-less PATCH instead of inserting', async () => {
  const stub = stubSupabase((url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/courses')) {
      return reply(200, [Object.assign({ id: 'c-pub-1' }, body)]);
    }
    return undefined;
  });
  try {
    const patched = await run(courses, {
      url: '/api/courses', method: 'PATCH', query: {},
      body: { id: 'c-pub-1', title: 'Updated title', provider: 'Udemy', course_url: 'https://udemy.test/c', is_published: false },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(patched.statusCode, 200, patched.bodyText);
    const verb = stub.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/courses'));
    assert.ok(verb, 'expected a PostgREST PATCH');
    assert.strictEqual(verb.body.is_published, false);
    stub.calls.length = 0;

    const noId = await run(courses, {
      url: '/api/courses', method: 'PATCH', query: {},
      body: { title: 'No id', provider: 'P', course_url: 'https://x.test' },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(noId.statusCode, 400, 'id-less PATCH must not create a row: ' + noId.bodyText);
    assert.strictEqual(stub.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/courses')).length, 0,
      'a PATCH must never insert');
  } finally { stub.restore(); }
});

test('anonymous DELETE /api/courses is refused', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, { url: '/api/courses?id=abc', method: 'DELETE', query: { id: 'abc' } });
    assert.strictEqual(res.statusCode, 401, 'delete must require elevation, got ' + res.statusCode);
  } finally { stub.restore(); }
});

test('every method of /api/course-discovery is admin-only', async () => {
  const stub = stubSupabase();
  try {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const res = await run(dispatcher, { url: '/api/course-discovery', method, query: {} });
      assert.strictEqual(res.statusCode, 401, method + ' must be admin-only, got ' + res.statusCode);
    }
  } finally { stub.restore(); }
});

test('handler second lock: without req.adminUser the admin branch 401s', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(courses, { url: '/api/courses?admin=1', query: { admin: '1' }, adminUser: null });
    assert.strictEqual(res.statusCode, 401);
    const res2 = await run(discovery, { url: '/api/course-discovery', method: 'GET', query: {} });
    assert.strictEqual(res2.statusCode, 401);
  } finally { stub.restore(); }
});

/* ── 3. click tracking ───────────────────────────────────────────── */

test('click on a draft/unknown course is rejected before insert', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('is_published=eq.true')) {
      return reply(200, []); /* not published → not found */
    }
    return undefined;
  });
  try {
    const res = await run(courses, {
      url: '/api/courses?action=click', method: 'POST',
      query: { action: 'click' }, body: { id: 'draft-1' },
      headers: { 'x-forwarded-for': freshIp() },
    });
    assert.strictEqual(res.statusCode, 404, 'draft click must not be recorded, got ' + res.statusCode);
    const inserts = stub.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/course_clicks'));
    assert.strictEqual(inserts.length, 0, 'no click row may be written for an unpublished course');
  } finally { stub.restore(); }
});

test('click on a published course records only id/referrer/source — no PII', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('is_published=eq.true')) {
      return reply(200, [{ id: 'pub-1' }]);
    }
    if (method === 'POST' && url.includes('/rest/v1/course_clicks')) return reply(201, [{}]);
    return undefined;
  });
  try {
    const res = await run(courses, {
      url: '/api/courses?action=click', method: 'POST',
      query: { action: 'click' },
      body: { id: 'pub-1', referrer: 'https://civilcareer-india-two.vercel.app/courses', source: 'courses' },
      headers: { 'x-forwarded-for': freshIp() },
    });
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    const insert = stub.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/course_clicks'));
    assert.ok(insert, 'expected a course_clicks insert');
    const keys = Object.keys(insert.body);
    for (const k of keys) {
      assert.ok(['course_id', 'referrer', 'source'].includes(k),
        'unexpected click field collected: ' + k);
    }
    assert.strictEqual(insert.body.course_id, 'pub-1');
  } finally { stub.restore(); }
});

/* ── 4. validation ───────────────────────────────────────────────── */

test('coursePayload requires title, provider and a valid http(s) URL', () => {
  assert.ok(coursePayload({ provider: 'P', course_url: 'https://x.test' }).error, 'missing title must fail');
  assert.ok(coursePayload({ title: 'T', course_url: 'https://x.test' }).error, 'missing provider must fail');
  assert.ok(coursePayload({ title: 'T', provider: 'P', course_url: 'javascript:alert(1)' }).error, 'non-http URL must fail');
  assert.ok(coursePayload({ title: 'T', provider: 'P', course_url: 'notaurl' }).error, 'junk URL must fail');
  assert.ok(coursePayload({
    title: 'T', provider: 'P', course_url: 'https://x.test',
    affiliate_url: 'ftp://bad',
  }).error, 'bad affiliate_url must fail');
});

test('coursePayload rejects malformed numbers and clamps bad ratings', () => {
  const bad = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', rating: 9.4 });
  assert.ok(bad.error && /rating/.test(bad.error), 'rating above 5 must fail: ' + (bad && bad.error));
  const neg = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', enrollment_count: -5 });
  assert.ok(neg.error && /enrollment/.test(neg.error), 'negative enrollment must fail');
  const ok = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', rating: '4.5', price_inr: '399' });
  assert.ok(!ok.error, 'clean payload must pass: ' + (ok.error || ''));
  assert.strictEqual(ok.payload.rating, 4.5);
  assert.strictEqual(ok.payload.price_inr, 399);
});

test('new courses default to drafts; published only when explicitly true', () => {
  const auto = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test' });
  assert.strictEqual(auto.payload.is_published, false, 'never silently public');
  const lie = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', is_published: 'yes' });
  assert.strictEqual(lie.payload.is_published, false, 'truthy string must not publish');
  const real = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', is_published: true });
  assert.strictEqual(real.payload.is_published, true);
});

test('price 0 implies free; paid price clears the free flag', () => {
  const free = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', price_inr: 0 });
  assert.strictEqual(free.payload.is_free, true);
  const paid = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test', price_inr: 499 });
  assert.strictEqual(paid.payload.is_free, false);
  /* An OMITTED price is unknown, not free (directory spec: never invent a
     price, and "Not provided" is a legitimate state). */
  const unknown = coursePayload({ title: 'T', provider: 'P', course_url: 'https://x.test' });
  assert.strictEqual(unknown.payload.price_inr, null);
  assert.strictEqual(unknown.payload.is_free, false, 'a missing price must not read as FREE');
});

test('admin create persists through the elevated branch (adminUser set)', async () => {
  const stub2 = stubSupabase();
  try {
    const res = await run(courses, {
      url: '/api/courses', method: 'POST', query: {},
      body: { title: 'STAAD Pro 101', provider: 'Udemy', course_url: 'https://udemy.test/c/1', is_published: true },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(res.statusCode, 201, res.bodyText);
    const post = stub2.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/courses'));
    assert.ok(post, 'expected insert');
    assert.strictEqual(post.body.is_published, true, 'explicit admin publish must survive');
    assert.strictEqual(post.body.title, 'STAAD Pro 101');
  } finally { stub2.restore(); }
});

test('admin update of an unknown id answers 404, not a silent success', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'PATCH') return reply(200, []);
    return undefined;
  });
  try {
    const res = await run(courses, {
      url: '/api/courses', method: 'POST', query: {},
      body: { id: 'ghost', title: 'T', provider: 'P', course_url: 'https://x.test' },
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(res.statusCode, 404, res.bodyText);
  } finally { stub.restore(); }
});

/* ── 5. discovery ────────────────────────────────────────────────── */

test('provider registry is honest about the discontinued Udemy API', () => {
  const list = providers();
  const udemy = list.find(p => p.id === 'udemy');
  assert.ok(udemy, 'udemy entry required');
  assert.strictEqual(udemy.status, 'discontinued', 'Udemy Affiliate API ended 2025-01-01');
  assert.ok(/discontinued|1\/1\/2025|2025/i.test(udemy.note), 'the note must say why');
  assert.ok(list.every(p => p.status !== 'available'), 'nothing may claim availability today');
  assert.ok(list.every(p => p.available !== true), 'without an authorized API nothing may be runnable');
  /* The registry covers exactly the directory's two platforms now. */
  assert.deepStrictEqual(list.map(p => p.id).sort(), ['coursera', 'udemy']);
});

test('discovery GET exposes config booleans, never secret values', async () => {
  process.env.UDEMY_CLIENT_ID = 'udemy-id-SUPERSECRET';
  process.env.UDEMY_CLIENT_SECRET = 'udemy-secret-SUPERSECRET';
  const stub = stubSupabase();
  try {
    const res = await run(discovery, {
      url: '/api/course-discovery', method: 'GET', query: {},
      adminUser: { id: 'admin' },
    });
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    assert.ok(!res.bodyText.includes('SUPERSECRET'), 'provider secret leaked to the admin UI');
    const body = JSON.parse(res.bodyText);
    const udemy = body.providers.find(p => p.id === 'udemy');
    assert.strictEqual(udemy.configured, true, 'configured flag should reflect env');
    assert.strictEqual(typeof udemy.status, 'string');
    assert.ok(Array.isArray(body.searchTerms) && body.searchTerms.length >= 10,
      'the 10 standing search terms must be exposed for operators');
  } finally {
    delete process.env.UDEMY_CLIENT_ID;
    delete process.env.UDEMY_CLIENT_SECRET;
    stub.restore();
  }
});

test('action=run answers no-provider-available without faking results', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(discovery, {
      url: '/api/course-discovery?action=run', method: 'POST',
      query: { action: 'run' }, body: {}, adminUser: { id: 'admin' },
      headers: { 'x-forwarded-for': freshIp() },
    });
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(body.code, 'no-provider-available');
    assert.strictEqual(body.staged, 0, 'nothing may be invented');
    /* The exact sentence the directory spec requires, and the facts behind
       it in the details rather than in the headline. */
    assert.strictEqual(body.message,
      'Automatic provider API access not configured; manual/bulk Civil Engineering course import remains available.');
    assert.ok(/discontinued/i.test(body.details || ''), 'the details must state the Udemy fact');
    const external = stub.calls.filter(c => /udemy|coursera/i.test(c.url));
    assert.strictEqual(external.length, 0, 'no provider API may be called: ' + JSON.stringify(external.map(c => c.url)));
  } finally { stub.restore(); }
});

test('importItem forces drafts and validates input', () => {
  const drafted = importItem({
    title: 'GATE Crash Course', provider: 'Udemy', course_url: 'https://udemy.test/gate',
    is_published: true, price_inr: 499, rating: 4.4,
  });
  assert.ok(!drafted.error, drafted.error || '');
  assert.strictEqual(drafted.payload.is_published, false, '§16: imports are always drafts');

  assert.ok(importItem({ provider: 'P', course_url: 'https://x.test' }).error, 'missing title');
  assert.ok(importItem({ title: 'T', course_url: 'https://x.test' }).error, 'missing provider');
  assert.ok(importItem({ title: 'T', provider: 'P', course_url: 'x' }).error, 'bad url');
  assert.ok(importItem({ title: 'T', provider: 'P', course_url: 'https://x.test', rating: 5.5 }).error, 'rating > 5');
  assert.ok(importItem(null).error, 'non-object');
});

test('normalizeUrl strips campaign noise so the same course matches twice', () => {
  const a = normalizeUrl('https://udemy.test/course/?utm_source=aff&utm_campaign=x&fbclid=abc');
  const b = normalizeUrl('https://UDEMY.test/course');
  assert.strictEqual(a, b, 'tracking params must not defeat idempotency: ' + a + ' vs ' + b);
  assert.strictEqual(normalizeUrl('not a url'), null);
});

test('bulk import: idempotent, drafts, admin fields preserved', async () => {
  const stub = stubSupabase((url, method) => {
    /* Existing row discovered by provider+external_id → PATCH branch. */
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('external_id=eq.ext-1')) {
      return reply(200, [{ id: 'existing-1' }]);
    }
    /* Second item matches its raw URL (campaign noise and all) → PATCH;
       later items with real course_url lookups must NOT match. */
    if (method === 'GET' && url.includes('/rest/v1/courses') && url.includes('course_url=eq.')) {
      return reply(200, url.includes('coursera.test') ? [{ id: 'existing-2' }] : []);
    }
    if (method === 'POST' && url.includes('/rest/v1/courses')) return reply(201, [{}]);
    if (method === 'PATCH' && url.includes('/rest/v1/courses')) return reply(200, [{}]);
    return undefined;
  });
  try {
    const res = await run(discovery, {
      url: '/api/course-discovery?action=import', method: 'POST',
      query: { action: 'import' },
      body: {
        items: [
          { title: 'STAAD.Pro Complete Course', provider: 'Udemy', course_url: 'https://udemy.test/1', external_id: 'ext-1', is_published: true },
          { title: 'Quantity Surveying Masterclass', provider: 'Coursera', course_url: 'https://coursera.test/2?utm_source=x', is_published: true },
          { title: 'Primavera P6 for Construction Projects', provider: 'Udemy', course_url: 'https://udemy.test/3', rating: 4.2 },
          { title: '', provider: 'Udemy', course_url: 'https://udemy.test/4' }, /* rejected: no title */
        ],
      },
      adminUser: { id: 'admin' },
      headers: { 'x-forwarded-for': freshIp() },
    });
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(body.imported, 1, 'only the unknown row inserts: ' + res.bodyText);
    assert.strictEqual(body.updated, 2, 'known rows update, never duplicate');
    assert.strictEqual(body.rejected.length, 1, 'invalid row reported, not fatal');
    assert.ok(/title/i.test(body.rejected[0].reason));

    for (const c of stub.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/courses'))) {
      assert.strictEqual(c.body.is_published, false, 'imported row must be a draft');
    }
    const patches = stub.calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/courses'));
    assert.strictEqual(patches.length, 2);
    for (const p of patches) {
      assert.ok(!('is_published' in p.body) || p.body.is_published === false,
        'import must never publish an existing row');
      assert.ok(!('affiliate_url' in p.body), 'affiliate_url is admin-owned; import must not touch it');
      assert.ok(!('admin_notes' in p.body), 'admin_notes is admin-owned; import must not touch it');
      assert.ok(!('is_featured' in p.body), 'is_featured is admin-owned; import must not touch it');
    }
  } finally { stub.restore(); }
});

test('import with no table answers an actionable setup error, not a crash', async () => {
  const stub = stubSupabase((url, method) => {
    if (method === 'GET' && url.includes('/rest/v1/courses')) {
      return reply(404, { code: 'PGRST205', message: 'Could not find the table public.courses in the schema cache' });
    }
    return undefined;
  });
  try {
    const res = await run(courses, { url: '/api/courses', method: 'GET', query: {} });
    assert.strictEqual(res.statusCode, 503, res.bodyText);
    assert.ok(/v32-courses\.sql/.test(res.bodyText), 'must tell the owner which migration to run');
  } finally { stub.restore(); }
});

/* ── 6. page invariants ──────────────────────────────────────────── */

test('courses.html: accessibility + SEO + affiliate hygiene', () => {
  const html = fs.readFileSync(path.join(root, 'courses.html'), 'utf8');
  assert.ok(html.includes('<a class="skip" href="#content">'), 'skip link required');
  assert.ok(/<main id="content"/.test(html), 'main#content required');
  assert.ok(html.includes('<link rel="canonical" href="https://civilcareer-india-two.vercel.app/courses">'),
    'canonical must use the production domain');
  assert.ok(html.includes('"@type":"CollectionPage"'), 'JSON-LD CollectionPage required');
  /* Directory spec: the third-party notice is required, and a plain
     provider link must never be labelled an affiliate link. `sponsored`
     appears only in the branch that actually uses an affiliate_url. */
  assert.ok(html.includes('Courses are provided by third-party platforms. CivilCareer does not sell these courses. Verify course details and pricing on the provider\'s website.'),
    'the third-party notice must be present verbatim');
  assert.ok(!/Affiliate disclosure/.test(html), 'the blanket affiliate claim must be gone');
  assert.ok(/c\.affiliate_url\?'noopener sponsored':'noopener noreferrer'/.test(html),
    'rel=sponsored must be conditional on a real affiliate link');
  assert.ok(html.includes('action=click'), 'click beacon must target /api/courses');
  assert.ok(html.includes('<title>'), 'title tag required');
  assert.ok(html.includes('og:url'), 'og:url required');
  /* §3: no secrets in client code. */
  assert.ok(!/SUPABASE_SERVICE_ROLE|UDEMY_CLIENT_SECRET|UDEMY_CLIENT_ID/.test(html),
    'no secrets or provider credentials in the public page');
  assert.ok(!html.includes('is_admin'), 'no fake client-side admin flag');
  /* §4: no mixed canonical domains. */
  assert.ok(!html.includes('civilcareer.in/'), 'legacy domain must not appear as a live URL');
});

test('vercel.json rewrites /courses and the sitemap lists it', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rule = (vercel.rewrites || []).find(r => r.source === '/courses');
  assert.ok(rule, '/courses rewrite missing');
  assert.strictEqual(rule.destination, '/courses.html');
  /* The generic /:seoSlug rewrite (→ /api/seo-page) must never win: it is
     last in the list, so an explicit /courses page route resolves first. */
  const rewrites = vercel.rewrites || [];
  const catchAll = rewrites.findIndex(r => r.source === '/:seoSlug');
  assert.ok(rewrites.findIndex(r => r.source === '/courses') < catchAll,
    '/courses must be rewritten before the SEO catch-all');
  /* Canonical hygiene: the .html spelling 301s to the clean URL, like the
     other named pages. */
  const redirect = (vercel.redirects || []).find(r => r.source === '/courses.html');
  assert.ok(redirect && redirect.destination === '/courses' && redirect.permanent === true,
    '/courses.html must 301 to /courses');
  const sitemap = fs.readFileSync(path.join(root, '_api', 'sitemap.js'), 'utf8');
  assert.ok(sitemap.includes("['/courses'"), '/courses missing from the sitemap');
  /* A static sitemap.xml at the repo root is served from the filesystem
     BEFORE the /sitemap.xml -> /api/sitemap rewrite, so it silently
     replaced the generated one (148 stale URLs, zero job pages) while
     /api/sitemap was never reachable by crawlers. Keep it deleted. */
  assert.strictEqual(fs.existsSync(path.join(root, 'sitemap.xml')), false,
    'a static sitemap.xml would shadow the dynamic /api/sitemap (and omit /courses and every job URL)');
  /* With the static file gone the rewrite lands on the catch-all with the
     original path, so the dispatcher must map it or /sitemap.xml 404s. */
  const dispatcher = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
  assert.ok(/pathName === '\/sitemap\.xml'/.test(dispatcher),
    'dispatcher must map /sitemap.xml to the sitemap handler');
});

test('admin.html carries the Courses tab, panel and JS; bundle regenerated', () => {
  const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.ok(admin.includes('<button data-tab="courses">'), 'Courses tab button missing');
  assert.ok(admin.includes('id="panel-courses"'), 'Courses panel missing');
  assert.ok(/function crLoad\s*\(/.test(admin), 'crLoad missing');
  assert.ok(/function crEditor\s*\(/.test(admin), 'crEditor missing');
  assert.ok(/function crRunDiscovery\s*\(/.test(admin), 'crRunDiscovery missing');
  assert.ok(/function crImport\s*\(/.test(admin), 'crImport missing');
  assert.ok(admin.includes("if(b.dataset.tab==='courses'){crLoad();}"), 'tab-load hook missing');
  assert.ok(admin.includes("'/api/courses?admin=1'"), 'admin list call missing');
  /* A8 byte-equality gate: bundle must match source right now. */
  const bundle = require(path.join(root, '_api', 'admin-page-html.js'));
  assert.strictEqual(bundle.html, admin, 'stale admin bundle — run: node scripts/build-admin-bundle.js');
});

test('every inline script in admin.html actually parses', () => {
  /* A malformed ternary in the Review Jobs / Government Jobs block used to
     make the whole 54 KB script fail to PARSE in the browser, so every
     function it defined (rjRunScraper, govtLoad, govtPost, …) was silently
     undefined. Static syntax checking catches it before a deploy. */
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m; let n = 0; const failures = [];
  while ((m = re.exec(html))) {
    if (/src\s*=/i.test(m[1] || '')) continue;          /* external */
    if (/application\/ld\+json/i.test(m[1] || '')) continue; /* data */
    n += 1;
    try { new Function(m[2]); }
    catch (e) { failures.push(`block ${n}: ${e.message}`); }
  }
  assert.ok(n >= 2, 'expected inline script blocks, found ' + n);
  assert.deepStrictEqual(failures, [], 'inline script syntax errors: ' + failures.join(' | '));
});

test('migration creates the two tables, indexes, trigger and RLS policies', () => {
  const sql = fs.readFileSync(path.join(root, 'v32-courses.sql'), 'utf8');
  assert.ok(/create table.*\bcourses\b/i.test(sql), 'courses table missing');
  assert.ok(/create table.*\bcourse_clicks\b/i.test(sql), 'course_clicks table missing');
  assert.ok(/uuid primary key|gen_random_uuid/i.test(sql), 'UUID primary key required');
  assert.ok(/unique[\s\S]*?\(provider, external_id\)/i.test(sql), 'provider+external_id uniqueness required');
  assert.ok(/enable row level security/i.test(sql), 'RLS required');
  assert.ok(/courses_published_read|is_published = true|is_published=true/i.test(sql),
    'anon read must be limited to published rows');
  assert.ok(/updated_at/i.test(sql) && /trigger/i.test(sql), 'updated_at trigger required');
  assert.ok(!/service_role.*insert.*anon|policy.*for all.*to anon/i.test(sql),
    'no anon write policy may exist');
  /* No write policy at all for anon/authenticated on courses. */
  const policies = sql.match(/create policy[\s\S]*?;/gi) || [];
  for (const p of policies) {
    assert.ok(!/for (insert|update|delete)/i.test(p) || /to\s+service_role/i.test(p),
      'write policy must not grant anon/authenticated: ' + p.slice(0, 90));
    assert.ok(!/for all/i.test(p), 'no blanket FOR ALL policy: ' + p.slice(0, 90));
  }
});

test('no secrets in the new sources', () => {
  for (const f of ['_api/courses.js', '_api/course-discovery.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/sk_live|eyJhbGciOi|service_role.*=.*['"][A-Za-z0-9]{20,}/i.test(src),
      'hardcoded credential in ' + f);
    /* Keys only ever come from process.env. */
    assert.ok(!/process\.env\.\w+\s*\|\|\s*['"][^'"]{10,}['"]/.test(src),
      'credential fallback literal in ' + f);
  }
  const disc = fs.readFileSync(path.join(root, '_api', 'course-discovery.js'), 'utf8');
  assert.ok(!/JSON\.stringify\([^)]*UDEMY_CLIENT_SECRET/.test(disc), 'secret echoed in response');
  assert.ok(!/headers?[^)]*UDEMY_CLIENT_SECRET/i.test(disc), 'secret sent outbound');
});
