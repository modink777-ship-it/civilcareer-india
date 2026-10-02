'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const oldEnv = { ...process.env };
const oldFetch = global.fetch;
process.env.SUPABASE_URL = 'https://govt-review.test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
delete require.cache[require.resolve('../_api/govt-review')];
const reviewHandler = require('../_api/govt-review');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() {},
  };
}

test('approval refuses aggregator notification and application URLs before publishing', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => [{
        id: 'staging-1',
        title: 'Junior Engineer Civil',
        civil_status: 'civil',
        tier: 'A',
        payload: {},
      }],
    };
  };

  const badNotice = response();
  await reviewHandler({
    method: 'POST',
    url: '/api/govt-review?action=approve',
    headers: {},
    adminUser: { id: 'admin-1' },
    body: { id: 'staging-1', payload: { official_notice_url: 'https://jobs.example.com/notice' } },
  }, badNotice);
  assert.equal(badNotice.statusCode, 400);
  assert.match(badNotice.body.error, /government or approved PSU domain/);
  assert.equal(calls.length, 1, 'invalid notice source must fail before any publish query');

  calls.length = 0;
  const badApply = response();
  await reviewHandler({
    method: 'POST',
    url: '/api/govt-review?action=approve',
    headers: {},
    adminUser: { id: 'admin-1' },
    body: {
      id: 'staging-1',
      payload: {
        official_notice_url: 'https://ssc.gov.in/notice',
        official_apply_url: 'https://jobs.example.com/apply',
      },
    },
  }, badApply);
  assert.equal(badApply.statusCode, 400);
  assert.match(badApply.body.error, /Application URL must use/);
  assert.equal(calls.length, 1, 'invalid application URL must fail before publish');
});

test.after(() => {
  global.fetch = oldFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in oldEnv)) delete process.env[key];
  }
  Object.assign(process.env, oldEnv);
  delete require.cache[require.resolve('../_api/govt-review')];
});
