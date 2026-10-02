'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const dispatchSource = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) {
      if (body) this.body = JSON.parse(body);
    },
  };
}

function requestWithBody(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/admin-jobs';
  req.headers = { 'x-owner-key': 'test-owner-key' };
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

test('Review Jobs uses allowlisted session auth, correct paging, and exposes every status queue', () => {
  const clickHandler = adminHtml.match(/b\.onclick=\(\)=>\{[\s\S]*?if\(b\.dataset\.tab==='review-jobs'\)\{[\s\S]*?\}/);
  assert.ok(clickHandler, 'opening Review Jobs should load the selected queue');
  assert.match(adminHtml, /data-rjtab="rejected"/);
  assert.match(adminHtml, /per_page:String\(rjLimit\)/);
  assert.match(adminHtml, /authedApi\('\/api\/admin-jobs\?/);
  assert.match(adminHtml, /authedApi\('\/api\/civil-scraper'/);
  assert.doesNotMatch(adminHtml, /\/api\/admin-jobs[^'"\n]*[?&]key=/);
  assert.doesNotMatch(adminHtml, /body:JSON\.stringify\(\{key:adminKey/);
  assert.match(adminHtml, /data\.updated/);
  assert.match(adminHtml, /data\.added/);
  assert.match(adminHtml, /data-rj-action="unpublish"/);
});

test('admin muted text has AA contrast and the PDF importer stays browser-local', () => {
  assert.match(adminHtml, /id="admin-muted-text-contrast"/);
  assert.match(adminHtml, /color:#9fb0c6!important/);
  assert.match(adminHtml, /input::placeholder/);
  assert.doesNotMatch(adminHtml, /\/api\/exam-extract/);
  assert.match(adminHtml, /No AI or paid service was used/);

  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const foreground = luminance('#9fb0c6');
  for (const background of ['#0f2847', '#071828']) {
    const darker = Math.min(foreground, luminance(background));
    const lighter = Math.max(foreground, luminance(background));
    assert.ok((lighter + 0.05) / (darker + 0.05) >= 4.5, `muted text must meet AA on ${background}`);
  }
});

test('dispatcher elevates Review Jobs and scraper requests through the admin allowlist', () => {
  assert.match(dispatchSource, /'\/api\/admin-jobs':\s*req\s*=>\s*!hasValidOwnerKey\(req\)/);
  assert.match(dispatchSource, /'\/api\/civil-scraper':\s*req\s*=>\s*!hasValidOwnerKey\(req\)/);
  assert.match(dispatchSource, /'\/api\/social-graphics-v4':\s*req\s*=>\s*!hasValidOwnerKey\(req\)/);
  assert.match(dispatchSource, /SOCIAL_CRON_SECRET/);
});

test('dispatcher accepts only an allowlisted admin session for Review Jobs', async () => {
  const savedEnv = { ...process.env };
  const oldFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
  process.env.ADMIN_EMAIL = 'owner@example.test';
  process.env.ADMIN_USER_ID = '';
  delete process.env.OWNER_KEY;
  const dispatcher = require('../api/[[...path]].js');
  let authCalls = 0;
  let jobsCalls = 0;

  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      authCalls += 1;
      return {
        ok: true,
        json: async () => ({ id: 'owner-id', email: 'owner@example.test' }),
      };
    }
    jobsCalls += 1;
    const isCount = String(url).includes('select=id&');
    return {
      ok: true,
      headers: { get: () => '0-0/1' },
      json: async () => isCount ? [] : [{ id: 'job-1', role: 'Site Engineer' }],
    };
  };

  try {
    const denied = mockRes();
    await dispatcher({ method: 'GET', url: '/api/admin-jobs?tab=review', headers: {} }, denied);
    assert.equal(denied.statusCode, 401);
    assert.equal(jobsCalls, 0, 'unauthenticated request must not reach the jobs store');

    const allowed = mockRes();
    await dispatcher({
      method: 'GET',
      url: '/api/admin-jobs?tab=review',
      headers: { authorization: 'Bearer allowlisted-session' },
    }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.jobs[0].role, 'Site Engineer');
    assert.equal(authCalls, 1);
  } finally {
    global.fetch = oldFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    delete require.cache[require.resolve('../_api/admin-jobs')];
  }
});

test('admin-jobs rejected queue is filtered and unsupported tabs are rejected', async () => {
  const savedEnv = { ...process.env };
  const oldFetch = global.fetch;
  process.env.OWNER_KEY = 'test-owner-key';
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
  delete require.cache[require.resolve('../_api/admin-jobs')];
  const handler = require('../_api/admin-jobs');
  const requestedUrls = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    const isCount = String(url).includes('select=id&');
    return {
      ok: true,
      headers: { get: () => '0-0/1' },
      json: async () => isCount ? [] : [{ id: 'rejected-1', review_state: 'Rejected' }],
    };
  };

  try {
    const res = mockRes();
    await handler({ method: 'GET', url: '/api/admin-jobs?tab=rejected&per_page=7', headers: { 'x-owner-key': 'test-owner-key' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.jobs[0].review_state, 'Rejected');
    assert.ok(requestedUrls.some((url) => new URL(url).searchParams.get('review_state') === 'ilike.*rejected*'));

    const invalid = mockRes();
    await handler({ method: 'GET', url: '/api/admin-jobs?tab=hidden', headers: { 'x-owner-key': 'test-owner-key' } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(requestedUrls.length, 2, 'invalid tab must not issue Supabase queries');
  } finally {
    global.fetch = oldFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    delete require.cache[require.resolve('../_api/admin-jobs')];
  }
});

test('admin-jobs reports actual mutation counts', async () => {
  const savedEnv = { ...process.env };
  const oldFetch = global.fetch;
  process.env.OWNER_KEY = 'test-owner-key';
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
  delete require.cache[require.resolve('../_api/admin-jobs')];
  const handler = require('../_api/admin-jobs');
  let patchHeaders;

  global.fetch = async (_url, options = {}) => {
    patchHeaders = options.headers;
    return { ok: true, json: async () => [{ id: 'job-1' }] };
  };

  try {
    const res = mockRes();
    await handler(requestWithBody({ action: 'reject', ids: ['job-1'] }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: 'reject', updated: 1, requested: 1 });
    assert.equal(patchHeaders.Prefer, 'return=representation');

    global.fetch = async () => ({ ok: false, status: 503 });
    const failed = mockRes();
    await handler(requestWithBody({ action: 'reject', ids: ['job-1'] }), failed);
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.body.updated, 0);
    assert.match(failed.body.error, /updates failed/);
  } finally {
    global.fetch = oldFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    delete require.cache[require.resolve('../_api/admin-jobs')];
  }
});
