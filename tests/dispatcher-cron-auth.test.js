'use strict';

/* Regression guard for the dispatcher's cron authorization.

   The CRON_ROUTES allowlist rules are the NEGATION of the credential check
   ('/api/govt-discovery': req => !isValidCronRequest(req)). The dispatcher used
   to set req.isCron only inside `if (rule && rule(req))`, which is exactly the
   branch a valid scheduler request skips — so req.isCron was never set and
   _api/govt-discovery answered 401 "Cron authorization required." for every
   legitimate scheduled run. The credential must win before the rule is read.

   These tests drive the real dispatcher with stubbed endpoint modules, so they
   assert behavior rather than the shape of the source. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SECRET = 'unit-test-cron-secret';
const OWNER = 'unit-test-owner-key';

const seen = {};
function stub(name) {
  const id = require.resolve(path.join(__dirname, '..', '_api', `${name}.js`));
  seen[name] = [];
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    children: [],
    paths: [],
    exports: (req, res) => {
      seen[name].push({ isCron: req.isCron === true });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ isCron: req.isCron === true, isSocialCron: req.isSocialCron === true }));
    },
  };
  return id;
}

stub('govt-discovery');
stub('exam-alerts');
stub('social');

process.env.CRON_SECRET = SECRET;
process.env.OWNER_KEY = OWNER;

const dispatch = require('../api/[[...path]].js');

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    end(b) { this.body = b == null ? '' : String(b); },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = JSON.stringify(o); return this; },
  };
}

function makeReq(url, headers) {
  return { method: 'POST', url, headers: headers || {}, query: {} };
}

function parse(res) {
  try { return JSON.parse(res.body); } catch (_) { return null; }
}

test('a valid CRON_SECRET bearer sets req.isCron on /api/govt-discovery', async () => {
  const res = makeRes();
  await dispatch(makeReq('/api/govt-discovery', { authorization: `Bearer ${SECRET}` }), res);
  assert.equal(res.statusCode, 200, `unexpected status: ${res.statusCode} ${res.body}`);
  assert.equal(parse(res)?.isCron, true, 'the handler must see req.isCron = true');
});

test('the scheduler credential also unlocks /api/exam-alerts', async () => {
  const res = makeRes();
  await dispatch(makeReq('/api/exam-alerts', { authorization: `Bearer ${SECRET}` }), res);
  assert.equal(res.statusCode, 200, `unexpected status: ${res.statusCode} ${res.body}`);
  assert.equal(parse(res)?.isCron, true);
});

test('a missing credential is rejected before the handler runs', async () => {
  const before = seen['govt-discovery'].length;
  const res = makeRes();
  await dispatch(makeReq('/api/govt-discovery', {}), res);
  assert.equal(res.statusCode, 401);
  assert.equal(parse(res)?.error, 'Admin authentication required.');
  assert.equal(seen['govt-discovery'].length, before, 'handler must not run without a credential');
});

test('a wrong credential is never treated as a cron request', async () => {
  const before = seen['govt-discovery'].length;
  const res = makeRes();
  await dispatch(makeReq('/api/govt-discovery', { authorization: 'Bearer not-the-secret' }), res);
  assert.ok(res.statusCode >= 400, `expected a rejection, got ${res.statusCode}`);
  assert.equal(seen['govt-discovery'].length, before);
});

test('the scheduler credential cannot unlock an unrelated admin route', async () => {
  const before = seen['social'].length;
  const res = makeRes();
  await dispatch(makeReq('/api/social', { authorization: `Bearer ${SECRET}` }), res);
  assert.ok(res.statusCode >= 400, `expected a rejection, got ${res.statusCode}`);
  assert.equal(seen['social'].length, before, 'an admin handler must not run on a cron credential');
});
