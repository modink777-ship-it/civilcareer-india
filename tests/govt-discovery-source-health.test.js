'use strict';

/* Source health for the government discovery cron.

   _api/govt-discovery.js stages most of the leads, but only the GitHub
   crawler ever wrote items_found / items_staged / last_error — so the admin
   source-health panel (govt-review?action=health) showed zeroes for
   everything the cron produced. Just as bad, a source whose robots.txt could
   not be fetched was skipped with an empty errors[] array, so a run where a
   third of the sources never fetched still reported a clean summary.

   These drive the real handler with Supabase and the outbound fetch stubbed,
   so they assert what is actually persisted rather than what the source says. */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-key';

const SOURCES = [
  {
    id: 'src-1',
    name: 'Test Recruitment Board',
    type: 'official',
    url: 'https://board.example.gov.in/recruitment',
    kind: 'html',
    org: 'Test Board',
    category: 'PSU',
    state: null,
    enabled: true,
    robots_ok: null,
    last_run_at: null,
    last_status: null,
  },
];

const PAGE_HTML =
  '<a href="/vacancies/junior-engineer.pdf">Recruitment of Junior Engineer (Civil) - Diploma in Civil Engineering</a>';

let robotsBehaviour = 'allow';
const restCalls = [];

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const target = String(url);
  const method = String(opts.method || 'GET').toUpperCase();
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
  restCalls.push({ target, method, body });

  if (target.includes('/rest/v1/govt_sources') && method === 'GET') return jsonResponse(200, SOURCES);
  if (target.includes('/rest/v1/govt_job_leads')) return jsonResponse(200, [{ id: 'lead-1' }]);
  if (target.includes('/rest/v1/govt_job_staging')) return jsonResponse(200, []);
  if (target.includes('/rest/v1/govt_sources') && method === 'PATCH') return jsonResponse(200, []);
  return jsonResponse(200, []);
};

const realGet = https.get;
https.get = (url, opts, cb) => {
  const req = new EventEmitter();
  const u = String(url);

  setImmediate(() => {
    if (robotsBehaviour === 'unreachable') {
      req.emit('error', new Error('connect ECONNREFUSED 203.0.113.7:443'));
      return;
    }
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    cb(res);
    const payload = u.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /\n' : PAGE_HTML;
    setImmediate(() => {
      res.emit('data', Buffer.from(payload));
      res.emit('end');
    });
  });

  return req;
};

const handler = require('../_api/govt-discovery.js');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = JSON.stringify(o); return this; },
    end() { return this; },
  };
}

async function runScan() {
  restCalls.length = 0;
  const res = makeRes();
  await handler({ method: 'POST', url: '/api/govt-discovery', headers: {}, query: {}, isCron: true }, res);
  return { res, payload: JSON.parse(res.body) };
}

function sourcePatches() {
  return restCalls
    .filter(c => c.method === 'PATCH' && c.target.includes('/govt_sources'))
    .map(c => c.body);
}

test('a successful scan records items_found / items_staged / last_error for the admin panel', async () => {
  robotsBehaviour = 'allow';
  const { res, payload } = await runScan();

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(payload.summary.staged, 1, `expected one staged row, got ${JSON.stringify(payload.summary)}`);

  const health = sourcePatches().find(p => p && Object.prototype.hasOwnProperty.call(p, 'items_found'));
  assert.ok(health, `no source-health patch was written: ${JSON.stringify(sourcePatches())}`);
  assert.equal(health.items_found, 1, 'items_found must reflect what this run extracted');
  assert.equal(health.items_staged, 1, 'items_staged must reflect what this run persisted');
  assert.equal(health.last_error, null, 'a clean run must clear last_error');
  assert.equal(health.robots_ok, true);
  assert.match(String(health.last_status), /^ok;/, 'a healthy run must read as ok');

  const staged = restCalls.find(c => c.method === 'POST' && c.target.includes('/govt_job_staging'));
  assert.ok(staged, 'the scan must attempt a staging insert');
  assert.ok(!('full_payload' in staged.body), 'the staging row must not use the phantom full_payload column');
  assert.ok(!('relevance_tier' in staged.body), 'the staging row must not use the phantom relevance_tier column');
  assert.ok('payload' in staged.body, 'the publish gate reads item.payload');
  assert.ok('tier' in staged.body, 'the publish gate reads item.tier');

  /* The title guard rides along on every sweep. The stubbed govt_jobs table is
     empty, so there is nothing bad to report — but the key must be present and
     the skip must be honest, otherwise the guard is silently not running. */
  assert.ok(payload.title_guard, 'the cron response must report the title guard');
  assert.strictEqual(payload.title_guard.sent, false, 'a clean sweep sends nothing');
  assert.strictEqual(payload.title_guard.skipped, 'nothing-bad');
});

test('an unreachable robots.txt is reported instead of silently skipped', async () => {
  robotsBehaviour = 'unreachable';
  const { res, payload } = await runScan();

  assert.equal(res.statusCode, 200, res.body);
  assert.ok(payload.summary.errors >= 1, 'a source that never fetched must count as an error');
  assert.ok(
    payload.results.some(r => (r.errors || []).some(e => /robots:unreachable/.test(e))),
    `expected a robots:unreachable error, got ${JSON.stringify(payload.results)}`
  );

  const health = sourcePatches().find(p => p && Object.prototype.hasOwnProperty.call(p, 'last_error'));
  assert.ok(health, 'the source must be marked unhealthy');
  assert.match(String(health.last_error || ''), /robots:unreachable/, 'last_error must name the failure');
  assert.equal(health.robots_ok, false);
});

after(() => {
  global.fetch = realFetch;
  https.get = realGet;
});
