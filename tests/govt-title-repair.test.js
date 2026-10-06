/* Title-clean pipeline tests (title_audit / repair_titles).
 *
 * The dry-run of the pipeline surfaced two behaviours that must hold:
 *
 * 1. title_audit and repair_titles(dry default) are READ-ONLY: the reviewer must be
 *    able to run them against the live queue without a single write.
 * 2. The verdict is computed on the CLEANED title, so an "ok" row whose stored text
 *    still carries the notice wrapper ("Advertisement for the post of …") must be
 *    rewritten to the bare post name the audit already proposes — previously the
 *    ok branch skipped it and the padding stayed published. Junk link-text titles
 *    and non-recruitment pages (results, keys) must never be written at all.
 *
 * No network: global.fetch is stubbed for the duration of each test.
 */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const root = path.join(__dirname, '..');
const govtReview = require(path.join(root, '_api', 'govt-review.js'));

/* The four published-bad-title shapes from 2026-10-03 plus controls: a wrapped
   headline (fixable by peel), a clean row (must not move) and a long headline
   (fixable by trim). */
const SEEDED = [
  { id: 'j1', title: 'Traffic Survey Result', slug: 'traffic-survey-result', post_name: null,
    organization: 'Airports Authority of India', status: 'active', published_at: '2026-10-03T09:00:00.000Z' },
  { id: 'j2', title: 'Click here to view the advertisement', slug: 'click-here-to-view-the-advertisement', post_name: null,
    organization: 'Railway Recruitment Board', status: 'active', published_at: '2026-10-03T09:05:00.000Z' },
  { id: 'j3', title: 'Read more about the notification', slug: 'read-more-about-the-notification', post_name: null,
    organization: 'State PWD', status: 'active', published_at: '2026-10-03T09:10:00.000Z' },
  { id: 'j4', title: 'Advertisement for the post of Assistant Engineer (Civil) on Direct Recruitment basis',
    slug: 'assistant-engineer-civil', post_name: 'Assistant Engineer (Civil)',
    organization: 'Water Resources Department', status: 'active', published_at: '2026-10-03T09:15:00.000Z' },
  { id: 'j5', title: 'Junior Engineer (Civil) Recruitment', slug: 'junior-engineer-civil-recruitment', post_name: null,
    organization: 'NHAI', status: 'active', published_at: '2026-10-04T09:00:00.000Z' },
  { id: 'j6', title: 'Applications are invited for the post of Junior Engineer (Civil) in the Water Resources Department of the Government of Assam, please read the advertisement carefully before applying online',
    slug: 'je-civil-assam-long', post_name: null,
    organization: 'Water Resources Department, Assam', status: 'active', published_at: '2026-10-04T09:05:00.000Z' },
];

function reply(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    json: async () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
  };
}

/* Stubs Supabase; returns a recorder plus a restorer. */
function stubSupabase() {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
    calls.push({ url: target, method, body });
    if (target.includes('/rest/v1/govt_jobs') && method === 'GET') return reply(200, SEEDED);
    if (target.includes('/rest/v1/govt_jobs') && method === 'PATCH') return reply(204, null);
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

function run(action, body) {
  const req = {
    url: '/api/govt-review?action=' + action, method: 'POST', query: {}, body: body || {},
    headers: {}, adminUser: { id: 'admin-1', email: 'admin@example.com' },
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.bodyText = JSON.stringify(o); resolve(this); return this; },
      send(d) { this.bodyText = String(d); resolve(this); return this; },
      end(d) { if (d !== undefined) this.bodyText = String(d); resolve(this); return this; },
    };
    Promise.resolve(govtReview(req, res)).then(() => resolve(res), reject);
  });
}

test('title_audit classifies the published-title shapes and never writes', async () => {
  const stub = stubSupabase();
  try {
    const res = await run('title_audit');
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.count, 6);

    const v = Object.fromEntries(body.audit.map(a => [a.id, a.verdict]));
    assert.strictEqual(v.j1, 'not_recruitment', 'a results page must never be treated as a vacancy');
    assert.strictEqual(v.j2, 'junk');
    assert.strictEqual(v.j3, 'junk');
    assert.strictEqual(v.j4, 'ok', 'a wrapped headline verdicts ok once cleaned');
    assert.strictEqual(v.j5, 'ok');
    assert.strictEqual(v.j6, 'weak', 'a long notice headline is trimmable');

    const j4 = body.audit.find(a => a.id === 'j4');
    assert.notStrictEqual(j4.cleaned, j4.title, 'the audit must propose the peeled title');
    assert.strictEqual(j4.cleaned, 'Assistant Engineer (Civil)');

    assert.strictEqual(stub.calls.filter(c => c.method !== 'GET').length, 0,
      'title_audit must be read-only');
  } finally { stub.restore(); }
});

test('repair_titles defaults to a dry run and writes nothing', async () => {
  const stub = stubSupabase();
  try {
    const res = await run('repair_titles');
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.dry, true, 'dry must default to on');
    assert.strictEqual(stub.calls.filter(c => c.method === 'PATCH').length, 0,
      'a dry run must issue zero writes');

    assert.strictEqual(body.fixed, 2, 'the wrapped peel and the long trim are the fixable two');
    assert.strictEqual(body.kept.length, 2, 'junk titles stay parked for the reviewer');
    assert.ok(body.kept.every(k => k.id === 'j2' || k.id === 'j3'));
    assert.ok(body.skipped.some(s => s.id === 'j1' && /not a recruitment/.test(s.reason)),
      'the results page is skipped, never repaired');
  } finally { stub.restore(); }
});

test('repair_titles applies the proven peel and never touches junk', async () => {
  const stub = stubSupabase();
  try {
    const res = await run('repair_titles', { dry: false });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.strictEqual(body.ok, true);

    const patches = stub.calls.filter(c => c.method === 'PATCH');
    assert.strictEqual(patches.length, 2, 'exactly the two fixable rows are written');
    assert.ok(patches.every(p => p.url.includes('id=eq.j4') || p.url.includes('id=eq.j6')));

    const j4 = patches.find(p => p.url.includes('id=eq.j4'));
    assert.strictEqual(j4.body.title, 'Assistant Engineer (Civil)',
      'the wrapper must be peeled down to the bare post name');
    assert.ok(j4.body.verified_at, 'an active row keeps its verification stamp on repair');

    for (const id of ['j1', 'j2', 'j3', 'j5']) {
      assert.ok(!patches.some(p => p.url.includes('id=eq.' + id)),
        'row ' + id + ' must never be written');
    }
    assert.strictEqual(body.fixed, 2);
  } finally { stub.restore(); }
});
