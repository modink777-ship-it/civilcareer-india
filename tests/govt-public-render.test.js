'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const oldEnv = { ...process.env };
const oldFetch = global.fetch;
process.env.SUPABASE_URL = 'https://govt-render.test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
process.env.SITE_URL = 'https://civilcareer.test';
delete require.cache[require.resolve('../_api/govt-public')];
const handler = require('../_api/govt-public');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };
}

const notification = {
  id: 'govt-1',
  title: 'Junior Engineer Civil Recruitment',
  slug: 'je-civil-recruitment',
  organization: 'State Public Works Department',
  scope: 'state',
  state: 'Karnataka',
  department_category: 'PWD',
  civil_posts_count: 10,
  total_posts_in_notification: 20,
  deadline_kind: 'fixed',
  apply_end: '2026-12-31',
  official_notice_url: 'https://karnataka.gov.in/notice/1',
  official_apply_url: 'https://karnataka.gov.in/apply/1',
  reviewed_at: '2026-10-01T10:00:00Z',
  summary: 'Civil engineering recruitment notice.',
};

test('public Government Jobs page only lists official-source rows and shows domain/review date', async () => {
  global.fetch = async (url) => {
    assert.match(String(url), /govt_jobs\?/);
    return {
      ok: true,
      status: 200,
      headers: { get: () => '0-1/2' },
      json: async () => [
        notification,
        { ...notification, id: 'bad-source', slug: 'aggregator-listing', official_notice_url: 'https://jobs.example.com/notice' },
      ],
    };
  };

  const res = response();
  await handler({ method: 'GET', url: '/api/govt-public', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Government Civil Jobs in India/);
  assert.match(res.body, /karnataka\.gov\.in/);
  assert.match(res.body, /Last reviewed:/);
  assert.doesNotMatch(res.body, /aggregator-listing/);
  assert.doesNotMatch(res.body, /Verified public-sector/);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
});

test('dispatcher sends the original clean Government Jobs path to the SSR module', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '0-0/1' },
    json: async () => [notification],
  });
  const dispatcher = require('../api/[[...path]].js');
  const res = response();
  await dispatcher({ method: 'GET', url: '/government-jobs', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Government Civil Jobs in India/);
  assert.match(res.body, /Junior Engineer Civil Recruitment/);
});

test('dispatcher keeps government detail and central routes inside the government SSR module', async () => {
  const dispatcher = require('../api/[[...path]].js');
  global.fetch = async (url) => {
    if (String(url).includes('govt_job_posts?')) {
      return { ok: true, status: 200, headers: { get: () => '*/0' }, json: async () => [] };
    }
    if (String(url).includes('slug=eq.je-civil-recruitment')) {
      return { ok: true, status: 200, json: async () => [notification] };
    }
    assert.equal(new URL(String(url)).searchParams.get('scope'), 'eq.central');
    return { ok: true, status: 200, headers: { get: () => '*/0' }, json: async () => [] };
  };

  const detail = response();
  await dispatcher({ method: 'GET', url: '/government-jobs/je-civil-recruitment', headers: {} }, detail);
  assert.equal(detail.statusCode, 200);
  assert.match(detail.body, /Junior Engineer Civil Recruitment/);

  const central = response();
  await dispatcher({ method: 'GET', url: '/government-jobs/central', headers: {} }, central);
  assert.equal(central.statusCode, 200);
  assert.match(central.body, /Central Government Jobs/);
});

test('government listing filters and page bounds are applied at the database', async () => {
  global.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    const query = parsed.searchParams;
    assert.equal(options.headers.Prefer, 'count=exact');
    assert.equal(query.get('limit'), '2');
    assert.equal(query.get('offset'), '2');
    assert.equal(query.get('state'), 'ilike.*Karnataka*');
    assert.equal(query.get('scope'), 'eq.state');
    assert.equal(query.get('department_category'), 'ilike.*PWD*');
    const and = query.get('and');
    assert.match(and, /official_notice_url\.ilike\.https:\/\/%\.gov\.in\/%/);
    assert.match(and, /title\.ilike\.\*Junior\*/);
    assert.match(and, /organization\.ilike\.\*Junior\*/);
    return {
      ok: true,
      status: 200,
      headers: { get: () => '2-3/4' },
      json: async () => [{ ...notification, id: 'page2' }, { ...notification, id: 'page2b' }],
    };
  };

  const res = response();
  await handler({
    method: 'GET',
    url: '/api/govt-public?q=Junior&state=Karnataka&scope=state&department=PWD&page=2&per_page=2',
    headers: {},
  }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Page 2 of 2/);
  assert.match(res.body, /name="q" value="Junior"/);
  assert.match(res.body, /name="state" value="Karnataka"/);
  assert.match(res.body, /href="\/government-jobs\?[^"]*page=1/);
  assert.match(res.body, /noindex,follow/);
});

test('public Government Jobs page surfaces backend failures instead of an empty success page', async () => {
  global.fetch = async () => ({ ok: false, status: 503, text: async () => 'temporarily unavailable' });
  const res = response();
  await handler({ method: 'GET', url: '/api/govt-public', headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body, /Government page could not be generated/);
});

test('public government detail hides records without an approved official notification URL', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ ...notification, official_notice_url: 'https://jobs.example.com/notice' }] });
  const res = response();
  await handler({ method: 'GET', url: '/api/govt-public?job=je-civil-recruitment', headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /could not be verified/);
  assert.match(res.body, /noindex,follow/);
});

test('public government detail links show notification and only an approved official apply URL', async () => {
  global.fetch = async (url) => {
    if (String(url).includes('govt_job_posts?')) {
      return { ok: true, status: 200, json: async () => [{ post_name: 'Junior Engineer (Civil)', vacancies: 10, qualification: 'Diploma Civil', pay: null, selection_process: 'Written exam' }] };
    }
    return { ok: true, status: 200, json: async () => [notification] };
  };
  const res = response();
  await handler({ method: 'GET', url: '/api/govt-public?job=je-civil-recruitment', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Official source:/);
  assert.match(res.body, /Last reviewed:/);
  assert.match(res.body, /Open Official Notification/);
  assert.match(res.body, /Apply on Official Site/);
  assert.match(res.body, /validThrough/);
});

test.after(() => {
  global.fetch = oldFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in oldEnv)) delete process.env[key];
  }
  Object.assign(process.env, oldEnv);
  delete require.cache[require.resolve('../_api/govt-public')];
});
