/* v29 regression: the admin Jobs tab.
 *
 * The dashboard signs in with a Supabase session against the ADMIN_EMAIL /
 * ADMIN_USER_ID allowlist and never holds the raw OWNER_KEY. The handler used
 * to re-check only the owner key for ?auth=1 GETs, so every dashboard request
 * was answered 401 ("Invalid owner key") and the tab showed
 * "Unable to load jobs: Jobs API returned no job list." — even though the
 * public list worked. The dispatcher-verified session (req.adminUser) must be
 * accepted, must receive the admin projection (drafts included), and an
 * anonymous ?auth=1 request must still be refused.
 */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
delete process.env.OWNER_KEY;   // dashboard-only deployment: no owner key configured

const root = path.join(__dirname, '..');
const jobs = require(path.join(root, '_api', 'jobs.js'));

function stubSupabase() {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase() });
    const rows = [{ id: 'j1', role: 'Site Engineer', published: false, status: 'Active' }];
    return {
      ok: true,
      status: 200,
      headers: { get: () => '0-0/1' },
      text: async () => JSON.stringify(rows),
      json: async () => rows,
    };
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

async function run(req0) {
  const req = Object.assign({ method: 'GET', headers: {}, query: {}, body: null, adminUser: null }, req0);
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.bodyText = JSON.stringify(obj); resolve(this); return this; },
      send(data) { this.bodyText = String(data); resolve(this); return this; },
      end(data) { if (data !== undefined) this.bodyText = String(data); resolve(this); return this; },
    };
    Promise.resolve(jobs(req, res)).then(() => resolve(res), reject);
  });
}

const URL_ADMIN = '/api/jobs?page=1&limit=50&auth=1&lifecycle=all';
const QUERY = { page: '1', limit: '50', auth: '1', lifecycle: 'all' };

test('a dispatcher-verified admin session can load the Jobs tab', async () => {
  const stub = stubSupabase();
  try {
    const res = await run({ url: URL_ADMIN, query: QUERY, adminUser: { id: 'admin-1', email: 'admin@example.com' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.ok(Array.isArray(body.jobs), 'admin list payload expected');
  } finally { stub.restore(); }
});

test('the admin query is not restricted to published rows', async () => {
  const stub = stubSupabase();
  try {
    await run({ url: URL_ADMIN, query: QUERY, adminUser: { id: 'admin-1', email: 'admin@example.com' } });
    const listCall = stub.calls.find(c => c.url.includes('/rest/v1/jobs?'));
    assert.ok(listCall, 'expected a jobs query');
    assert.ok(!listCall.url.includes('published=eq.true'),
      'drafts/pending rows must be visible to the admin: ' + listCall.url);
  } finally { stub.restore(); }
});

test('an anonymous auth=1 request is still refused', async () => {
  const stub = stubSupabase();
  try {
    const res = await run({ url: URL_ADMIN, query: QUERY });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 401);
    assert.match(String(body.error || ''), /admin/i);
  } finally { stub.restore(); }
});
