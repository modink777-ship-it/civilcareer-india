/* v31 — Sieve scrape API integration.
 *
 * The logic under test is the real code in lib/sieve.js and _api/sieve.js.
 * Only the HTTP boundary is mocked (global.fetch), which is explicitly
 * allowed. No network is used.
 *
 * Required coverage:
 *   - request building
 *   - status handling: running / done / refused / unknown
 *   - the follow-up turn check
 *   - error mapping
 *   - "never retry POST /api/scrapes on timeout"
 */
const path = require('path');
const assert = require('assert/strict');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const sieve = require(path.join(root, 'lib', 'sieve'));
const handler = require(path.join(root, '_api', 'sieve'));

const BASE = 'https://scrape.test';

function makeRes(status, payload, out) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload === undefined ? {} : payload);
  const bytes = out && out.bytes !== undefined ? out.bytes : '';
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(k) {
        const key = String(k).toLowerCase();
        if (key === 'content-type') return (out && out.content_type) || 'application/json';
        if (out && out.headers && out.headers[key] !== undefined) return out.headers[key];
        return null;
      },
    },
    json: async () => JSON.parse(text),
    text: async () => text,
    arrayBuffer: async () => Buffer.from(String(bytes)),
  };
}

function mockFetch(routes) {
  const real = global.fetch;
  const calls = [];
  const seen = new Map();
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const call = { url: u, method, headers: opts.headers || {}, body: opts.body ? String(opts.body) : null };
    calls.push(call);
    for (const route of routes) {
      if ((route.method || 'GET') !== method || u.indexOf(route.match) === -1) continue;
      if (route.guard && !route.guard(call)) continue;
      if (route.throw) throw new Error(route.throw);
      let out;
      if (route.replies) {
        const i = seen.get(route) || 0;
        seen.set(route, i + 1);
        out = route.replies[Math.min(i, route.replies.length - 1)];
      } else {
        out = typeof route.reply === 'function' ? route.reply(call) : route.reply;
      }
      const status = (out && out.status) || 200;
      const payload = out && Object.prototype.hasOwnProperty.call(out, 'body') ? out.body : out;
      return makeRes(status, payload, out);
    }
    return makeRes(200, []);
  };
  return { calls, restore() { global.fetch = real; } };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

/* ── request building ─────────────────────────────────────────────────── */

test('buildStartPayload requires an instruction', () => {
  const out = sieve.buildStartPayload({});
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /instruction/i);
});

test('buildStartPayload defaults compliance_mode to regular and keeps fields', () => {
  const out = sieve.buildStartPayload({
    instruction: 'Extract the text and author of each quote',
    target_urls: ['https://quotes.toscrape.com'],
    fields: ['quote', 'author'],
    table_shape: 'long',
  });
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.value.compliance_mode, 'regular');
  assert.deepEqual(out.value.target_urls, ['https://quotes.toscrape.com']);
  assert.deepEqual(out.value.fields, ['quote', 'author']);
});

test('buildStartPayload rejects bad targets, modes, shapes and oversized schemas', () => {
  assert.equal(sieve.buildStartPayload({ instruction: 'x', compliance_mode: 'wild' }).ok, false);
  assert.equal(sieve.buildStartPayload({ instruction: 'x', table_shape: 'diagonal' }).ok, false);
  assert.equal(sieve.buildStartPayload({ instruction: 'x', target_urls: ['ftp://x'] }).ok, false);
  assert.equal(sieve.buildStartPayload({ instruction: 'x', target_urls: ['http://127.0.0.1/'] }).ok, false);
  const big = { type: 'object', properties: { a: { description: 'x'.repeat(40000) } } };
  const out = sieve.buildStartPayload({ instruction: 'x', output_schema: big });
  assert.equal(out.ok, false);
  assert.match(out.errors.join(' '), /32KB/);
});

test('buildStartPayload accepts yolo only when explicitly chosen', () => {
  const out = sieve.buildStartPayload({ instruction: 'x', compliance_mode: 'yolo' });
  assert.equal(out.ok, true);
  assert.equal(out.value.compliance_mode, 'yolo');
});

/* ── status handling ──────────────────────────────────────────────────── */

test('classifyRunStatus maps the four documented values', () => {
  assert.equal(sieve.classifyRunStatus('running'), 'running');
  assert.equal(sieve.classifyRunStatus('done'), 'done');
  assert.equal(sieve.classifyRunStatus('refused'), 'refused');
  assert.equal(sieve.classifyRunStatus('something-else'), 'unknown');
  assert.equal(sieve.classifyRunStatus(undefined), 'unknown');
});

test('getScrape surfaces running, done and refused as-is, unknown as an error', async () => {
  const stub = mockFetch([
    { match: '/api/scrapes/s1', reply: { body: { status: 'running', turns: 0 } } },
    { match: '/api/scrapes/s2', reply: { body: { status: 'done', turns: 1, files: [{ name: 'a.csv', url: '/files/a.csv' }] } } },
    { match: '/api/scrapes/s3', reply: { body: { status: 'refused', refusal: { code: 'quota' } } } },
    { match: '/api/scrapes/s4', reply: { body: { status: 'weird' } } },
  ]);
  try {
    const running = await sieve.getScrape('s1');
    assert.equal(running.ok, true);
    assert.equal(sieve.classifyRunStatus(running.run.status), 'running');

    const done = await sieve.getScrape('s2');
    assert.equal(sieve.classifyRunStatus(done.run.status), 'done');
    assert.equal(done.run.files[0].name, 'a.csv');

    const refused = await sieve.getScrape('s3');
    assert.equal(sieve.classifyRunStatus(refused.run.status), 'refused');

    const unknown = await sieve.getScrape('s4');
    assert.equal(sieve.classifyRunStatus(unknown.run.status), 'unknown');
  } finally { stub.restore(); }
});

/* ── error mapping ────────────────────────────────────────────────────── */

test('mapError classifies every documented status', () => {
  assert.equal(sieve.mapError(400, { error: 'bad' }).kind, 'bad_request');
  assert.equal(sieve.mapError(400, {}).retryable, false);
  assert.equal(sieve.mapError(401, {}).kind, 'unauthorized');
  assert.equal(sieve.mapError(402, {}).kind, 'payment_required');
  assert.equal(sieve.mapError(404, {}).kind, 'not_found');
  assert.equal(sieve.mapError(409, {}).kind, 'turn_in_flight');
  const limited = sieve.mapError(429, {}, { get: (k) => (String(k).toLowerCase() === 'retry-after' ? '3' : null) });
  assert.equal(limited.kind, 'rate_limited');
  assert.equal(limited.retryable, true);
  assert.equal(limited.retryAfterMs, 3000);
  assert.equal(sieve.mapError(500, {}).kind, 'server_error');
  assert.equal(sieve.mapError(0, {}).kind, 'network');
});

/* ── backoff and follow-up ────────────────────────────────────────────── */

test('nextPollDelay starts at 5s and caps around 30s', () => {
  assert.equal(sieve.nextPollDelay(0), 5000);
  assert.equal(sieve.nextPollDelay(5000), 9000);
  assert.equal(sieve.nextPollDelay(30000), 30000);
  assert.ok(sieve.nextPollDelay(60000) <= 30000);
});

test('isFollowUpReady needs done AND an advanced turn counter', () => {
  assert.equal(sieve.isFollowUpReady({ status: 'running', turns: 2 }, 1), false);
  assert.equal(sieve.isFollowUpReady({ status: 'done', turns: 1 }, 1), false, 'previous answer must not be read');
  assert.equal(sieve.isFollowUpReady({ status: 'done', turns: 2 }, 1), true);
  assert.equal(sieve.isFollowUpReady({ status: 'refused', turns: 2 }, 1), false);
});

test('classifyDevicePoll maps pending, slow_down, denied, expired, success', () => {
  assert.equal(sieve.classifyDevicePoll(400, { error: 'authorization_pending' }).state, 'pending');
  assert.equal(sieve.classifyDevicePoll(400, { error: 'slow_down' }).state, 'slow_down');
  assert.equal(sieve.classifyDevicePoll(400, { error: 'access_denied' }).state, 'denied');
  assert.equal(sieve.classifyDevicePoll(400, { error: 'expired_token' }).state, 'expired');
  const ok = sieve.classifyDevicePoll(200, { api_key: 'dc_sk_abc', key_name: 'k' });
  assert.equal(ok.state, 'success');
  assert.equal(ok.apiKey, 'dc_sk_abc');
  assert.equal(sieve.classifyDevicePoll(500, {}).state, 'error');
});

test('resolveFileUrl prefixes the base for relative urls', () => {
  return withEnv({ SIEVE_BASE_URL: BASE }, () => {
    assert.equal(sieve.resolveFileUrl('/files/x.csv'), BASE + '/files/x.csv');
    assert.equal(sieve.resolveFileUrl('https://cdn.example/x.csv'), 'https://cdn.example/x.csv');
  });
});

/* ── POST /api/scrapes must never be retried ──────────────────────────── */

test('startScrape never retries POST after a timeout/network error', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ method: 'POST', match: '/api/scrapes', throw: 'The operation was aborted due to timeout' }]);
    try {
      const out = await sieve.startScrape({ instruction: 'Extract quotes' });
      assert.equal(out.ok, false);
      assert.equal(out.ambiguous, true, 'a timed-out start may have succeeded');
      assert.equal(out.retryable, false);
      assert.equal(stub.calls.length, 1, 'exactly one attempt');
    } finally { stub.restore(); }
  });
});

test('startScrape reports 429 as retry-safe but still does not retry by itself', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ method: 'POST', match: '/api/scrapes', reply: { status: 429, body: { error: 'rate limited' }, headers: { 'retry-after': '2' } } }]);
    try {
      const out = await sieve.startScrape({ instruction: 'x' });
      assert.equal(out.ok, false);
      assert.equal(out.retryable, true);
      assert.equal(out.retryAfterMs, 2000);
      assert.equal(stub.calls.length, 1);
    } finally { stub.restore(); }
  });
});

test('startScrape sends the Bearer key and returns session_id on 202', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ method: 'POST', match: '/api/scrapes', reply: { status: 202, body: { status: 'queued', session_id: 'ses_1', poll: '/api/scrapes/ses_1' } } }]);
    try {
      const out = await sieve.startScrape({ instruction: 'Extract quotes', target_urls: ['https://quotes.toscrape.com'] });
      assert.equal(out.ok, true);
      assert.equal(out.session_id, 'ses_1');
      const call = stub.calls[0];
      assert.equal(call.headers.Authorization, 'Bearer dc_sk_test');
      assert.equal(JSON.parse(call.body).compliance_mode, 'regular');
    } finally { stub.restore(); }
  });
});

/* ── polling and follow-ups ───────────────────────────────────────────── */

test('pollScrape backs off 5s → 9s and stops at done', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const sleeps = [];
    const stub = mockFetch([{ match: '/api/scrapes/ses_1', replies: [{ body: { status: 'running', turns: 0 } }, { body: { status: 'done', turns: 1 } }] }]);
    try {
      const out = await sieve.pollScrape('ses_1', {
        sleep: async (ms) => { sleeps.push(ms); },
        now: () => 0,
      });
      assert.equal(out.ok, true);
      assert.equal(out.state, 'done');
      assert.deepEqual(sleeps, [5000, 9000]);
    } finally { stub.restore(); }
  });
});

test('pollScrape treats an unexpected status as an error', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ match: '/api/scrapes/ses_9', reply: { body: { status: 'paused' } } }]);
    try {
      const out = await sieve.pollScrape('ses_9', { sleep: async () => {}, now: () => 0 });
      assert.equal(out.ok, false);
      assert.equal(out.kind, 'unknown_status');
    } finally { stub.restore(); }
  });
});

test('pollForFollowUp ignores a done run whose turn counter has not advanced', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ match: '/api/scrapes/ses_2', replies: [{ body: { status: 'done', turns: 1 } }, { body: { status: 'done', turns: 2 } }] }]);
    try {
      const out = await sieve.pollForFollowUp('ses_2', 1, { sleep: async () => {}, now: () => 0 });
      assert.equal(out.ok, true);
      assert.equal(out.state, 'done');
      assert.equal(out.run.turns, 2);
      assert.equal(stub.calls.length, 2, 'must poll past the stale answer');
    } finally { stub.restore(); }
  });
});

test('pollScrape retries a 5xx on GET with backoff', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ match: '/api/scrapes/ses_3', replies: [{ status: 503, body: {} }, { body: { status: 'done', turns: 1 } }] }]);
    try {
      const out = await sieve.pollScrape('ses_3', { sleep: async () => {}, now: () => 0 });
      assert.equal(out.ok, true);
      assert.equal(out.state, 'done');
      assert.equal(stub.calls.length, 2);
    } finally { stub.restore(); }
  });
});

/* ── follow-up message and files ──────────────────────────────────────── */

test('sendMessage maps 409 to a retryable turn-in-flight error', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ method: 'POST', match: '/api/scrapes/ses_4/messages', reply: { status: 409, body: { error: 'turn in flight' } } }]);
    try {
      const out = await sieve.sendMessage('ses_4', { instruction: 'next page' });
      assert.equal(out.ok, false);
      assert.equal(out.kind, 'turn_in_flight');
      assert.equal(out.retryable, true);
    } finally { stub.restore(); }
  });
});

test('fetchFile prefixes the base url and sends the Bearer key', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ match: '/files/quotes.csv', reply: { status: 200, bytes: 'quote,author', content_type: 'text/csv' } }]);
    try {
      const out = await sieve.fetchFile({ name: 'quotes.csv', url: '/files/quotes.csv' });
      assert.equal(out.ok, true);
      assert.equal(out.name, 'quotes.csv');
      assert.equal(Buffer.isBuffer(out.bytes), true);
      assert.equal(stub.calls[0].url, BASE + '/files/quotes.csv');
      assert.equal(stub.calls[0].headers.Authorization, 'Bearer dc_sk_test');
    } finally { stub.restore(); }
  });
});

test('getCredits reads /api/me/credits', async () => {
  await withEnv({ SIEVE_BASE_URL: BASE, SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    const stub = mockFetch([{ match: '/api/me/credits', reply: { plan: 'free', limit: 100, used: 3, remaining: 97 } }]);
    try {
      const out = await sieve.getCredits();
      assert.equal(out.ok, true);
      assert.equal(out.credits.remaining, 97);
    } finally { stub.restore(); }
  });
});

/* ── configuration is inert when the key is absent ───────────────────── */

test('sieveConfigured is false without SIEVE_API_KEY and true with it', async () => {
  await withEnv({ SIEVE_API_KEY: undefined }, async () => {
    assert.equal(sieve.sieveConfigured(), false);
  });
  await withEnv({ SIEVE_API_KEY: 'dc_sk_test' }, async () => {
    assert.equal(sieve.sieveConfigured(), true);
  });
});

/* ── API handler ──────────────────────────────────────────────────────── */

function runHandler(req0) {
  const req = Object.assign({ method: 'GET', headers: {}, query: {}, body: null, adminUser: null }, req0);
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.bodyText = JSON.stringify(obj); resolve(this); return this; },
      send(data) { if (data !== undefined) this.bodyText = String(data); resolve(this); return this; },
      end(data) { if (data !== undefined) this.bodyText = String(data); resolve(this); return this; },
    };
    Promise.resolve(handler(req, res)).then(() => resolve(res), reject);
  });
}

const ADMIN = { id: 'admin-1', email: 'owner@example.com' };

test('handler refuses anonymous callers', async () => {
  const res = await runHandler({ url: '/api/sieve?action=status' });
  assert.equal(res.statusCode, 401);
});

test('handler is inert when SIEVE_API_KEY is unset', async () => {
  await withEnv({ SIEVE_API_KEY: undefined, SIEVE_BASE_URL: undefined }, async () => {
    const status = await runHandler({ url: '/api/sieve?action=status', adminUser: ADMIN });
    const body = JSON.parse(status.bodyText);
    assert.equal(status.statusCode, 200);
    assert.equal(body.configured, false);

    const start = await runHandler({ method: 'POST', url: '/api/sieve?action=start', adminUser: ADMIN, body: { instruction: 'x' } });
    assert.equal(start.statusCode, 503, start.bodyText);
  });
});

test('handler persists the session BEFORE POST /api/scrapes and never retries a timeout', async () => {
  await withEnv({
    SIEVE_API_KEY: 'dc_sk_test',
    SIEVE_BASE_URL: BASE,
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }, async () => {
    const stub = mockFetch([
      { method: 'GET', match: 'client_request_id=eq.', reply: [] },
      { method: 'POST', match: 'mock.supabase.co/rest/v1/sieve_sessions', reply: { status: 201, body: [{ id: 'row-1', client_request_id: 'cid-1', status: 'starting' }] } },
      { method: 'PATCH', match: 'mock.supabase.co/rest/v1/sieve_sessions', reply: [{ id: 'row-1', status: 'start_unknown' }] },
      { method: 'POST', match: '/api/scrapes', throw: 'network down' },
    ]);
    try {
      const res = await runHandler({
        method: 'POST', url: '/api/sieve?action=start', adminUser: ADMIN,
        body: { instruction: 'Extract quotes', client_request_id: 'cid-1' },
      });
      const body = JSON.parse(res.bodyText);
      assert.equal(res.statusCode, 502, res.bodyText);
      assert.equal(body.ambiguous, true);

      const sievePosts = stub.calls.filter((c) => c.method === 'POST' && c.url.includes('/api/scrapes'));
      assert.equal(sievePosts.length, 1, 'start must be attempted exactly once');
      const insertIdx = stub.calls.findIndex((c) => c.method === 'POST' && c.url.includes('rest/v1/sieve_sessions'));
      const sieveIdx = stub.calls.findIndex((c) => c.method === 'POST' && c.url.includes('/api/scrapes'));
      assert.ok(insertIdx !== -1, 'the durable row must be written');
      assert.ok(insertIdx < sieveIdx, 'the row must be persisted before the network call');
    } finally { stub.restore(); }
  });
});
