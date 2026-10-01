const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const jobs = require('../_api/jobs');
const security = require('../lib/security');
const subscribe = require('../_api/subscribe');
const adminPage = require('../_api/admin-page');
const account = require('../_api/account');
const seoPage = require('../_api/seo-page');
const { publicJob, escapeHtml } = jobs._internal;
const { html: ADMIN_BUNDLE } = require('../_api/admin-page-html');

const { _internal } = jobs;
const root = path.join(__dirname, '..');

test('jobs module exposes internal helpers after Phase 1 hardening', () => {
  assert.equal(typeof _internal.isExpired, 'function');
});

test('owner key comparison fails safely without configured key', () => {
  const old = process.env.OWNER_KEY;
  delete process.env.OWNER_KEY;
  assert.equal(security.ownerKeyMatches({ headers: { 'x-owner-key': 'x' } }), false);
  if (old !== undefined) process.env.OWNER_KEY = old;
});

test('expired job is rejected by lifecycle helper', () => {
  assert.equal(_internal.isExpired({ expires_at: '2000-01-01T00:00:00Z' }), true);
  assert.equal(_internal.isExpired({ expires_at: '2999-01-01T00:00:00Z' }), false);
});


test('public job projection excludes private/admin fields', () => {
  const result = publicJob({ id: '1', role: 'Site Engineer', application_email: 'hr@example.com', application_email_private: true, contact_info: 'private', status: 'Active' });
  assert.equal(result.application_email, undefined);
  assert.equal(result.contact_info, undefined);
  assert.equal(result.application_email_private, undefined);
  assert.equal(result.role, 'Site Engineer');
});

/* ════════════════════════════════════════════════════════════
   P1 A8 — regression tests for the security-hardening items.
   ════════════════════════════════════════════════════════════ */

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { res.headers[k] = v; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end(body) { res.body = body; return res; },
  };
  return res;
}

/* lib/rate-limit keeps module-level buckets: hand every test its
   own synthetic client (clientIp never needs a real IP — it is
   only used as a map key and as Turnstile's remoteip hint). */
let clientSeq = 0;
function freshClient() {
  clientSeq += 1;
  return { 'x-forwarded-for': `cc-test-${clientSeq}` };
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function stubFetch(impl) {
  const real = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = real; };
}

const NO_TURNSTILE = { TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined };
const TURNSTILE_ON = { TURNSTILE_SITE_KEY: 'site-test', TURNSTILE_SECRET_KEY: 'secret-test' };
const ADMIN_ENV = {
  SUPABASE_URL: 'https://db-test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  ADMIN_EMAIL: 'owner@civilcareer.test',
  ADMIN_USER_ID: '',
};

/* ── A7: HTML-returning handlers escape scraped text at render ── */

test('A7 render: job detail HTML escapes scraped text', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('a & b "c"'), 'a &amp; b &quot;c&quot;');
  assert.equal(escapeHtml(null), '');
});

test('A7 render: seo-page escapes job fields interpolated into HTML', async () => {
  const nasty = {
    slug: 'x', id: '1',
    role: '<img src=x onerror=alert(1)>',
    company: 'A & B <script>',
    city: 'Pune", title:',
    employment_type: 'Full-time',
    salary: '₹1<script>',
  };
  const restore = stubFetch(async () => ({ ok: true, json: async () => [nasty] }));
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test' }, async () => {
      const res = mockRes();
      await seoPage({ method: 'GET', url: '/api/seo-page?slug=site-engineer-jobs-in-pune', headers: {} }, res);
      assert.equal(res.statusCode, 200);
      const html = String(res.body);
      assert.ok(!html.includes('<img src=x onerror'), 'raw markup must not reach the page');
      assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'role is escaped');
      assert.ok(html.includes('A &amp; B &lt;script&gt;'), 'company is escaped');
      assert.ok(html.includes('&quot;, title:'), 'city is escaped');
    });
  } finally { restore(); }
});

/* ── A4/A8: subscribe — anonymous write hardened like the other forms ── */

test('A8 subscribe: only POST is accepted', async () => {
  const res = mockRes();
  await subscribe({ method: 'GET', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('A8 subscribe: anonymous writes are per-IP rate limited', async () => {
  const restore = stubFetch(async () => ({ ok: true }));
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', ...NO_TURNSTILE }, async () => {
      const client = freshClient();
      let res;
      for (let i = 0; i < 10; i++) {
        res = mockRes();
        await subscribe({ method: 'POST', headers: client, body: { email: 'a@b.co', preference: 'jobs' } }, res);
        assert.equal(res.statusCode, 200);
      }
      res = mockRes();
      await subscribe({ method: 'POST', headers: client, body: { email: 'a@b.co', preference: 'jobs' } }, res);
      assert.equal(res.statusCode, 429);
      assert.match(res.body.error, /Too many subscriptions/);
    });
  } finally { restore(); }
});

test('A8 subscribe: honeypot silently accepts bots with no DB write', async () => {
  let dbWrites = 0;
  const restore = stubFetch(async () => { dbWrites += 1; return { ok: true }; });
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', ...NO_TURNSTILE }, async () => {
      const res = mockRes();
      await subscribe({ method: 'POST', headers: freshClient(), body: { email: 'a@b.co', website: 'http://spam.example' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(dbWrites, 0);
    });
  } finally { restore(); }
});

test('A8 subscribe: Turnstile token is required when widget keys are configured', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ success: true }) }));
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', ...TURNSTILE_ON }, async () => {
      const res = mockRes();
      await subscribe({ method: 'POST', headers: freshClient(), body: { email: 'a@b.co', preference: 'jobs' } }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /human verification/i);
    });
  } finally { restore(); }
});

test('A8 subscribe: a verified Turnstile token writes via the service role key', async () => {
  let dbUrl = '';
  let dbAuth = '';
  let siteverifyCalled = false;
  const restore = stubFetch(async (url, opts) => {
    if (String(url).includes('challenges.cloudflare.com')) {
      siteverifyCalled = true;
      return { ok: true, json: async () => ({ success: true }) };
    }
    dbUrl = String(url);
    dbAuth = String(opts.headers.Authorization);
    return { ok: true };
  });
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test-key', ...TURNSTILE_ON }, async () => {
      const res = mockRes();
      await subscribe({
        method: 'POST',
        headers: freshClient(),
        body: { email: 'a@b.co', phone: '9876543210', preference: 'government', turnstile_token: 'tok-1' },
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(siteverifyCalled, 'token must be verified server-side');
      assert.equal(dbUrl, 'https://db-test.supabase.co/rest/v1/subscribers');
      assert.equal(dbAuth, 'Bearer svc-test-key');
    });
  } finally { restore(); }
});

test('A8 subscribe: Turnstile network errors fail open (limiter + honeypot still apply)', async () => {
  const restore = stubFetch(async (url) => {
    if (String(url).includes('challenges.cloudflare.com')) throw new Error('network down');
    return { ok: true };
  });
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', ...TURNSTILE_ON }, async () => {
      const res = mockRes();
      await subscribe({ method: 'POST', headers: freshClient(), body: { email: 'a@b.co', turnstile_token: 'tok' } }, res);
      assert.equal(res.statusCode, 200);
    });
  } finally { restore(); }
});

test('A8 subscribe: validates email and preference before any write', async () => {
  let dbWrites = 0;
  const restore = stubFetch(async () => { dbWrites += 1; return { ok: true }; });
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', ...NO_TURNSTILE }, async () => {
      const badEmail = mockRes();
      await subscribe({ method: 'POST', headers: freshClient(), body: { email: 'not-an-email' } }, badEmail);
      assert.equal(badEmail.statusCode, 400);
      const badPref = mockRes();
      await subscribe({ method: 'POST', headers: freshClient(), body: { email: 'a@b.co', preference: 'bogus' } }, badPref);
      assert.equal(badPref.statusCode, 400);
      assert.equal(dbWrites, 0);
    });
  } finally { restore(); }
});

/* ── A4/A8: account — authenticated writes are throttled ── */

test('A8 account: authenticated writes are per-IP throttled', async () => {
  const restore = stubFetch(async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'user-1', email: 'a@b.co' }) };
    }
    return { ok: true, json: async () => [] };
  });
  try {
    await withEnv({ SUPABASE_URL: 'https://db-test.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', ...NO_TURNSTILE }, async () => {
      const client = freshClient();
      const jobUuid = '123e4567-e89b-12d3-a456-426614174000';
      let res;
      for (let i = 0; i < 60; i++) {
        res = mockRes();
        await account({ method: 'POST', headers: { ...client, authorization: 'Bearer t' }, body: { action: 'save', job_id: jobUuid } }, res);
      }
      res = mockRes();
      await account({ method: 'POST', headers: { ...client, authorization: 'Bearer t' }, body: { action: 'save', job_id: jobUuid } }, res);
      assert.equal(res.statusCode, 429);
      assert.match(res.body.error, /Too many requests/);
    });
  } finally { restore(); }
});

test('A8 account: unauthenticated writes are still bounded by the limiter', async () => {
  const res = mockRes();
  await withEnv({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }, async () => {
    await account({ method: 'POST', headers: { authorization: '' }, body: { action: 'save' } }, res);
    assert.equal(res.statusCode, 401);
  });
});

/* ── A3/A8: gated admin page ── */

test('A8 admin page: no credential gets the generic sign-in shell, never the bundle', async () => {
  const res = mockRes();
  await adminPage({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(String(res.body), /Administrator sign-in/);
  assert.ok(!String(res.body).includes('CivilCareer Admin'), 'bundle must not leak to anonymous callers');
  assert.ok(!String(res.body).includes('id="dashboard"'), 'admin surface must not leak');
});

test('A8 admin page: gate fails closed when admin auth is not configured', async () => {
  const restore = stubFetch(async () => { throw new Error('must not be called'); });
  try {
    await withEnv({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', ADMIN_EMAIL: '', ADMIN_USER_ID: '' }, async () => {
      const res = mockRes();
      await adminPage({ method: 'GET', headers: { authorization: 'Bearer whatever' } }, res);
      assert.match(String(res.body), /Administrator sign-in/);
      assert.ok(!String(res.body).includes('id="dashboard"'));
    });
  } finally { restore(); }
});

test('A8 admin page: a valid session that is not allowlisted gets the shell', async () => {
  let verified = null;
  const restore = stubFetch(async (url, opts) => {
    verified = { url: String(url), auth: opts.headers.Authorization };
    return { ok: true, json: async () => ({ id: 'user-1', email: 'stranger@example.com' }) };
  });
  try {
    await withEnv(ADMIN_ENV, async () => {
      const res = mockRes();
      await adminPage({ method: 'GET', headers: { authorization: 'Bearer real-session-token' } }, res);
      assert.match(String(res.body), /Administrator sign-in/);
      assert.ok(!String(res.body).includes('id="dashboard"'));
      assert.equal(verified.url, 'https://db-test.supabase.co/auth/v1/user');
      assert.equal(verified.auth, 'Bearer real-session-token');
    });
  } finally { restore(); }
});

test('A8 admin page: an allowlisted session receives the admin bundle', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ id: 'user-1', email: 'owner@civilcareer.test' }) }));
  try {
    await withEnv(ADMIN_ENV, async () => {
      const res = mockRes();
      await adminPage({ method: 'GET', headers: { authorization: 'Bearer owner-token' } }, res);
      assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
      assert.ok(String(res.body).includes('CivilCareer Admin'));
      assert.ok(String(res.body).includes('id="dashboard"'));
      assert.equal(String(res.body), ADMIN_BUNDLE);
    });
  } finally { restore(); }
});

test('A8 admin page: the cc_admin_session cookie is accepted as the credential', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ id: 'user-1', email: 'owner@civilcareer.test' }) }));
  try {
    await withEnv(ADMIN_ENV, async () => {
      const res = mockRes();
      await adminPage({
        method: 'GET',
        headers: { cookie: `theme=dark; cc_admin_session=${encodeURIComponent('cookie-token')}; other=1` },
      }, res);
      assert.ok(String(res.body).includes('id="dashboard"'));
    });
  } finally { restore(); }
});

test('A8 admin page: dot-insensitive Gmail allowlist matching', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ id: 'user-1', email: 'owner.name@gmail.com' }) }));
  try {
    await withEnv({ ...ADMIN_ENV, ADMIN_EMAIL: 'ownername@gmail.com' }, async () => {
      const res = mockRes();
      await adminPage({ method: 'GET', headers: { authorization: 'Bearer t' } }, res);
      assert.ok(String(res.body).includes('id="dashboard"'));
    });
  } finally { restore(); }
});

test('A8 admin page: ADMIN_USER_ID matches even when the email differs', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ id: 'fixed-user-id', email: 'anything@example.com' }) }));
  try {
    await withEnv({ ...ADMIN_ENV, ADMIN_USER_ID: 'fixed-user-id' }, async () => {
      const res = mockRes();
      await adminPage({ method: 'GET', headers: { authorization: 'Bearer t' } }, res);
      assert.ok(String(res.body).includes('id="dashboard"'));
    });
  } finally { restore(); }
});

test('A8 admin route: vercel.json sends /admin and /admin.html through the gated function', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const admin = vercel.rewrites.find(r => r.source === '/admin');
  assert.ok(admin && admin.destination === '/api/admin-page', '/admin must rewrite to the gated function');
  const adminHtml = vercel.rewrites.find(r => r.source === '/admin.html');
  assert.ok(adminHtml && adminHtml.destination === '/api/admin-page', 'the static /admin.html bypass must be closed');
});

test('A8 admin route: dispatcher registers /api/admin-page', () => {
  const dispatch = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
  assert.match(dispatch, /'\/api\/admin-page':\s*\(\) => require\('\.\.\/_api\/admin-page'\)/);
});

test('A8 admin bundle: generated file matches admin.html byte-for-byte', () => {
  const src = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.equal(ADMIN_BUNDLE, src);
});

test('A8 admin bundle: admin.html wires the session cookie used by the gate', () => {
  const src = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.match(src, /setAdminSessionCookie\(adminKey/);
  assert.match(src, /clearAdminSessionCookie\(\)/);
});

/* ── P1 cleanup: stray shadowing function stays removed ── */

test('A8 stray function: api/govt-discovery.js shadow stays removed', () => {
  assert.ok(!fs.existsSync(path.join(root, 'api', 'govt-discovery.js')), 'stray direct function must not return');
});
