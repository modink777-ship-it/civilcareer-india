/* lib/publish-ping.js + _api/indexnow-key.js — the answer to "detail pages get
   crawled days after publish". The ping is best-effort by contract: an unset
   key or a dead network must never fail a human-approved publish, and the key
   endpoint must not become a key oracle. */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pingModule = require(path.join(root, 'lib', 'publish-ping.js'));
const { pingPublished } = pingModule;
const keyHandler = require(path.join(root, '_api', 'indexnow-key.js'));

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) };
}

function makeRes() {
  return {
    statusCode: 0, headers: {}, bodyText: '',
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.bodyText = JSON.stringify(o); return this; },
    send(d) { this.bodyText = String(d); return this; },
    end(d) { if (d !== undefined) this.bodyText = String(d); return this; },
  };
}

async function runKey(keyQuery) {
  const req = { url: `/api/indexnow-key.txt${keyQuery ? '?key=' + keyQuery : ''}`, method: 'GET', headers: {} };
  const res = makeRes();
  await keyHandler(req, res);
  return res;
}

test('indexnow ping is a no-op when INDEXNOW_KEY is unset', async () => {
  delete process.env.INDEXNOW_KEY;
  const out = await pingPublished(['/-government-jobs/job/x'], 'test');
  assert.strictEqual(out.sent, false);
  assert.match(out.reason, /INDEXNOW_KEY not configured/);
});

test('indexnow ping posts one batched request and reports success', async () => {
  const realFetch = global.fetch;
  const calls = [];
  try {
    process.env.INDEXNOW_KEY = 'test-key-1234567890abcdef';
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      return reply(200, '');
    };
    const out = await pingPublished(['/government-jobs/job/a', '/government-jobs/job/b'], 'test');
    assert.strictEqual(out.sent, true);
    assert.strictEqual(out.count, 2);
    assert.strictEqual(calls.length, 1, 'one batched POST, not one per URL');
    assert.match(calls[0].url, /api\.indexnow\.org\/indexnow/);
    const body = JSON.parse(calls[0].opts.body);
    assert.strictEqual(body.host, 'civilcareer-india-two.vercel.app');
    assert.strictEqual(body.key, 'test-key-1234567890abcdef');
    assert.ok(body.keyLocation.endsWith('/test-key-1234567890abcdef.txt'));
    assert.deepStrictEqual(body.urlList.map(u => u.replace('https://civilcareer-india-two.vercel.app', '')),
      ['/government-jobs/job/a', '/government-jobs/job/b']);
  } finally {
    delete process.env.INDEXNOW_KEY;
    global.fetch = realFetch;
  }
});

test('indexnow ping failure never throws — publish must survive it', async () => {
  const realFetch = global.fetch;
  try {
    process.env.INDEXNOW_KEY = 'test-key-1234567890abcdef';
    global.fetch = async () => { throw new Error('network down'); };
    const out = await pingPublished(['/government-jobs/job/a'], 'test');
    assert.strictEqual(out.sent, false);
    assert.strictEqual(out.error, 'network');
  } finally {
    delete process.env.INDEXNOW_KEY;
    global.fetch = realFetch;
  }
});

test('the key endpoint answers the key only with the right ?key= echo', async () => {
  const previous = process.env.INDEXNOW_KEY;
  try {
    delete process.env.INDEXNOW_KEY;
    assert.strictEqual((await runKey('anything')).statusCode, 404, 'unset key: 404, no oracle');

    process.env.INDEXNOW_KEY = 'test-key-1234567890abcdef';
    const wrong = await runKey('nope');
    assert.strictEqual(wrong.statusCode, 404, 'wrong echo: 404');
    assert.strictEqual(wrong.bodyText, '');

    const right = await runKey('test-key-1234567890abcdef');
    assert.strictEqual(right.statusCode, 200);
    assert.strictEqual(right.bodyText, 'test-key-1234567890abcdef');
    assert.match(String(right.headers['Content-Type'] || ''), /text\/plain/);
  } finally {
    if (previous === undefined) delete process.env.INDEXNOW_KEY; else process.env.INDEXNOW_KEY = previous;
  }
});
