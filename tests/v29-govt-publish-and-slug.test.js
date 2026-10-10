/* v29 regression tests.
 *
 * 1. vercel.json's SEO catch-all (/:seoSlug → /api/seo-page) prefix-matches
 *    every /api/* path and leaks slug=<first path segment> ("api") into the
 *    query string. List endpoints used to take their detail branch and answer
 *    {"job":null}, so jobs disappeared from the public site and the admin
 *    Jobs tab. The dispatcher now strips exactly that leaked value.
 *
 * 2. Publishing a government job must survive real-world payloads: a column
 *    the live schema lacks (pay_level had no migration) and free-text
 *    deadlines that Postgres date columns reject.
 *
 * No network: global.fetch is stubbed for the duration of each test.
 */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const root = path.join(__dirname, '..');
const dispatcher = require(path.join(root, 'api', '[[...path]].js'));
const govtReview = require(path.join(root, '_api', 'govt-review.js'));

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/* Stubs Supabase; returns a recorder plus a restorer. */
function stubSupabase({ failPayLevelOnce = false } = {}) {
  const realFetch = global.fetch;
  const calls = [];
  let fail = failPayLevelOnce;
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
    calls.push({ url: target, method, body });

    if (target.includes('/rest/v1/govt_job_staging') && method === 'GET') {
      return reply(200, [{
        id: 'stage-1', status: 'pending', civil_status: 'civil', tier: 2,
        payload: {
          title: 'Assistant Engineer (Civil)', organization: 'NHAI', source_type: 'official',
          official_notice_url: 'https://nhai.gov.in/notice.pdf',
          apply_end: '31 Oct 2026', pay_level: 'Level-7', post_candidates: [],
          deadline: { kind: 'fixed', text: '31 Oct 2026', date: null },
        },
      }]);
    }
    if (target.includes('/rest/v1/govt_jobs') && method === 'POST') {
      if (fail) {
        fail = false;
        return reply(400, { code: 'PGRST204', message: "Could not find the 'pay_level' column of 'govt_jobs' in the schema cache" });
      }
      return reply(201, [Object.assign({}, body, { id: 'job-1' })]);
    }
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

async function run(handler, { url, method = 'GET', query = {}, body = null, adminUser = null }) {
  const req = { url, method, query, body, headers: {}, adminUser };
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

test('a list request carrying the leaked slug=api still returns the list', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, { url: '/api/jobs?limit=5&slug=api', query: { limit: '5', slug: 'api' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(body.jobs), 'list shape expected, got ' + res.bodyText.slice(0, 80));
    assert.ok(!('job' in body), 'detail branch must not answer a list request');
  } finally { stub.restore(); }
});

test('the government jobs list survives the same leaked slug', async () => {
  const stub = stubSupabase();
  try {
    const res = await run(dispatcher, { url: '/api/govt-jobs?limit=3&slug=api', query: { limit: '3', slug: 'api' } });
    assert.strictEqual(res.statusCode, 200);
    const lookup = stub.calls.find(c => c.url.includes('/rest/v1/govt_jobs'));
    assert.ok(lookup, 'expected a government jobs query');
    assert.ok(!lookup.url.includes('slug=eq.api'), 'leaked slug must not reach the query: ' + lookup.url);
  } finally { stub.restore(); }
});

test('a genuine slug is preserved, with or without the leaked one', async () => {
  const stub = stubSupabase();
  try {
    await run(dispatcher, { url: '/api/jobs?slug=api&slug=messer-jr-engineer', query: { slug: ['api', 'messer-jr-engineer'] } });
    let detail = stub.calls.slice().reverse().find(c => c.url.includes('slug=eq.'));
    assert.ok(detail && detail.url.includes('slug=eq.messer-jr-engineer'),
      'real slug lost: ' + (detail ? detail.url : 'no detail lookup'));

    stub.calls.length = 0;
    await run(dispatcher, { url: '/api/jobs?slug=messer-jr-engineer', query: { slug: 'messer-jr-engineer' } });
    detail = stub.calls.slice().reverse().find(c => c.url.includes('slug=eq.'));
    assert.ok(detail && detail.url.includes('slug=eq.messer-jr-engineer'),
      'unrelated slug must never be stripped: ' + (detail ? detail.url : 'no detail lookup'));
  } finally { stub.restore(); }
});

test('publish survives a column the live schema lacks and keeps the review gate', async () => {
  const stub = stubSupabase({ failPayLevelOnce: true });
  try {
    const res = await run(govtReview, {
      url: '/api/govt-review?action=approve', method: 'POST', body: { id: 'stage-1' },
      adminUser: { id: 'admin-1', email: 'admin@example.com' },
    });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.strictEqual(body.ok, true);

    const inserts = stub.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/govt_jobs'));
    assert.strictEqual(inserts.length, 2, 'expected one retry without the unknown column');
    assert.ok('pay_level' in inserts[0].body);
    assert.ok(!('pay_level' in inserts[1].body), 'retry must drop the unknown column');

    const saved = inserts[1].body;
    assert.strictEqual(saved.human_reviewed, true, 'publication gate must stay satisfied by the human action');
    assert.strictEqual(saved.status, 'active');
    assert.strictEqual(saved.apply_end, '2026-10-31', 'free-text deadline must be normalised for the date column');
    assert.strictEqual(saved.closes_at, '2026-10-31T23:59:59.000Z');
  } finally { stub.restore(); }
});

/* ── slug_export: the published-slug audit ──────────────────────────────
   Exports active rows (id, slug, public URL…) as CSV or JSON so a broken-link
   audit can crawl every published path. Admin-only caller; no id argument,
   so it works even when the review cache is empty. */

test('slug_export returns a CSV with a header and one quoted row per active job', async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      const target = String(url);
      if (target.includes('/rest/v1/govt_jobs')) {
        return reply(200, [
          { id: 'job-a', slug: 'rrb-je-civil-2026', title: 'JE (Civil), "Shift" 2', organization: 'RRB', state: 'All India', verification_status: 'official', published_at: '2026-09-01T00:00:00Z' },
          { id: 'job-b', slug: 'nhai-deputy-manager', title: 'Deputy Manager', organization: 'NHAI', state: 'Delhi', verification_status: 'unverified', published_at: '2026-09-02T00:00:00Z' },
        ]);
      }
      return reply(200, []);
    };
    const res = await run(govtReview, {
      url: '/api/govt-review?action=slug_export', method: 'POST', body: { format: 'csv' },
      adminUser: { id: 'admin-1', email: 'admin@example.com' },
    });
    assert.strictEqual(res.statusCode, 200);
    const ctype = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type');
    assert.ok(ctype && /text\/csv/.test(ctype[1]), 'CSV content type');
    const lines = res.bodyText.trim().split(/\r\n/);
    assert.strictEqual(lines[0], 'id,slug,public_url,title,organization,state,source_status,published_at');
    assert.strictEqual(lines.length, 3, 'header + 2 rows');
    assert.match(lines[1], /^"job-a","rrb-je-civil-2026","https:\/\/civilcareer-india-two\.vercel\.app\/government-jobs\/job\/rrb-je-civil-2026"/);
    assert.ok(lines[1].includes('""Shift""'), 'embedded quotes must be doubled (RFC 4180)');
    assert.match(lines[2], /"job-b","nhai-deputy-manager"/);
  } finally { global.fetch = realFetch; }
});

test('slug_export JSON mode works and the format guard rejects unknown formats', async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async (url) => (String(url).includes('/rest/v1/govt_jobs')
      ? reply(200, [{ id: 'job-a', slug: 'rrb-je-civil-2026', title: 'JE', organization: 'RRB', state: 'All India', verification_status: 'official', published_at: '2026-09-01T00:00:00Z' }])
      : reply(200, []));
    const res = await run(govtReview, {
      url: '/api/govt-review?action=slug_export', method: 'POST', body: { format: 'json' },
      adminUser: { id: 'admin-1', email: 'admin@example.com' },
    });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.count, 1);
    assert.match(body.items[0].url, /\/government-jobs\/job\/rrb-je-civil-2026$/);

    const bad = await run(govtReview, {
      url: '/api/govt-review?action=slug_export', method: 'POST', body: { format: 'xlsx' },
      adminUser: { id: 'admin-1', email: 'admin@example.com' },
    });
    assert.strictEqual(bad.statusCode, 400);
    assert.match(bad.bodyText, /format must be/);
  } finally { global.fetch = realFetch; }
});
