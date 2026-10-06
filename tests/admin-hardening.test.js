/* Admin session hardening tests.
 *
 * The owner's dashboard credential was exposed in chat, so the session
 * is now bounded server-side (ADMIN_SESSION_TTL_SECONDS), every gate
 * decision is appended to admin_audit (v33), sessions can be revoked
 * globally, and a revoked/expired/stale session must never reach the
 * dashboard. These tests pin that behaviour — no network: global.fetch
 * is stubbed to act as Supabase Auth + PostgREST.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { test } = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test-key';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@civilcareer.test';
delete process.env.ADMIN_USER_ID;

const root = path.join(__dirname, '..');
const security = require(path.join(root, 'lib', 'security.js'));
const adminPage = require(path.join(root, '_api', 'admin-page.js'));
const adminSession = require(path.join(root, '_api', 'admin-session.js'));
const dispatcher = require(path.join(root, 'api', '[[...path]].js'));

/* A JWT-shaped token so the age cap has a real `iat` to read. */
function fakeJwt(secondsAgo) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
  const iat = Math.floor(Date.now() / 1000) - secondsAgo;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'owner-id', email: 'owner@civilcareer.test', iat, exp: iat + 3600 })}.sig`;
}

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k in headers ? headers[k] : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/* Stubs Supabase: /auth/v1/user answers per `userFor`, everything else
   records and answers 200/{}. */
function stub(handler) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
    calls.push({ url: target, method, body, headers: opts.headers || {} });
    if (handler) {
      const custom = handler(target, method, body, opts);
      if (custom !== undefined) return custom;
    }
    if (target.includes('/auth/v1/user')) {
      return reply(200, { id: 'owner-id', email: 'owner@civilcareer.test' });
    }
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = real; } };
}

function run(handler, { url, method = 'GET', query = {}, body = null, adminUser = null, headers = {} }) {
  const req = { url, method, query, body, headers, adminUser };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.bodyText = JSON.stringify(obj); resolve(this); return this; },
      send(d) { this.bodyText = String(d); resolve(this); return this; },
      end(d) { if (d !== undefined) this.bodyText = String(d); resolve(this); },
    };
    Promise.resolve(handler(req, res)).then(() => resolve(res), reject);
  });
}

/* ── the age cap ─────────────────────────────────────────────────── */

test('a session older than the TTL is refused, even though Supabase still accepts the token', async () => {
  const fresh = fakeJwt(60);        /* 1 minute old */
  const stale = fakeJwt(3600);      /* 1 hour old */
  assert.strictEqual(security.adminSessionFresh(fresh), true);
  assert.strictEqual(security.adminSessionFresh(stale), false);
  assert.strictEqual(security.ADMIN_SESSION_TTL_SECONDS, 1800, 'TTL must stay at 30 minutes');

  const stubby = stub();
  try {
    const ok = await security.verifyAdminToken(fresh);
    assert.strictEqual(ok.ok, true, 'fresh session accepted');

    const old = await security.verifyAdminToken(stale);
    assert.strictEqual(old.ok, false, 'stale session must be refused');
    assert.strictEqual(old.status, 401);
    assert.ok(/expired/i.test(old.error), 'the refusal must say the session expired: ' + old.error);
  } finally { stubby.restore(); }
});

test('an opaque token without an iat claim is not locked out', () => {
  assert.strictEqual(security.adminSessionFresh('not-a-jwt'), true);
  assert.strictEqual(security.adminSessionAgeSeconds('not-a-jwt'), null);
});

test('verifyAdminToken still fails closed when the allowlist is unconfigured', async () => {
  const prev = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = '';
  delete process.env.ADMIN_USER_ID;
  const stubby = stub();
  try {
    const r = await security.verifyAdminToken(fakeJwt(10));
    assert.strictEqual(r.ok, false, 'unconfigured allowlist must never authenticate');
    assert.strictEqual(r.status, 503);
  } finally {
    stubby.restore();
    process.env.ADMIN_EMAIL = prev;
  }
});

test('verifyAdminToken fails closed when Supabase verification errors', async () => {
  const stubby = stub((url) => {
    if (url.includes('/auth/v1/user')) throw new Error('network down');
    return undefined;
  });
  try {
    const r = await security.verifyAdminToken(fakeJwt(10));
    assert.strictEqual(r.ok, false, 'a network failure must not authenticate anyone');
    assert.strictEqual(r.status, 503);
  } finally { stubby.restore(); }
});

/* ── the gate + audit trail ──────────────────────────────────────── */

test('the /admin gate serves the dashboard for a fresh session and audits the allow', async () => {
  const stubby = stub();
  try {
    const res = await run(adminPage, {
      url: '/api/admin-page', headers: { authorization: `Bearer ${fakeJwt(30)}`, 'user-agent': 'test-agent' },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.bodyText.includes('CivilCareer'), 'dashboard HTML expected');
    const audit = stubby.calls.find(c => c.url.includes('/rest/v1/admin_audit'));
    assert.ok(audit, 'gate_allow must be audited');
    assert.strictEqual(audit.body.event, 'gate_allow');
    assert.strictEqual(audit.body.email, 'owner@civilcareer.test');
    assert.ok(!JSON.stringify(audit.body).includes('eyJ'), 'the token must never be written to the audit row');
  } finally { stubby.restore(); }
});

test('the /admin gate returns the sign-in shell and audits the refusal for a stale session', async () => {
  const stubby = stub();
  try {
    const res = await run(adminPage, { url: '/api/admin-page', headers: { authorization: `Bearer ${fakeJwt(7200)}` } });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(!res.bodyText.includes('CivilCareer Overview'), 'the dashboard bundle must not be served to a stale session');
    assert.ok(res.bodyText.includes('Administrator sign-in'), 'sign-in shell expected');
    const audit = stubby.calls.find(c => c.url.includes('/rest/v1/admin_audit'));
    assert.ok(audit, 'gate_deny must be audited');
    assert.strictEqual(audit.body.event, 'gate_deny');
  } finally { stubby.restore(); }
});

test('an unauthenticated /admin hit is not audited (no flooding) but still gets the shell', async () => {
  const stubby = stub();
  try {
    const res = await run(adminPage, { url: '/api/admin-page', headers: {} });
    assert.ok(res.bodyText.includes('Administrator sign-in'));
    assert.strictEqual(stubby.calls.filter(c => c.url.includes('admin_audit')).length, 0,
      'anonymous probes must not write audit rows');
  } finally { stubby.restore(); }
});

test('audit writes never throw and never block the response when Supabase is unreachable', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = '';
  try {
    const ok = await security.recordAdminEvent('gate_allow', { headers: {} }, {});
    assert.strictEqual(ok, false, 'a missing configuration reports false, it does not throw');
  } finally { process.env.SUPABASE_URL = prevUrl; }
});

test('the dispatcher audits a denied admin attempt that presented a credential', async () => {
  const stubby = stub((url) => {
    if (url.includes('/auth/v1/user')) return reply(401, { msg: 'invalid' });
    return undefined;
  });
  try {
    await run(dispatcher, { url: '/api/analytics', headers: { authorization: 'Bearer bogus-token' } });
    const audit = stubby.calls.find(c => c.url.includes('/rest/v1/admin_audit'));
    assert.ok(audit, 'a rejected admin token must leave an audit row');
    assert.strictEqual(audit.body.event, 'admin_denied');
    assert.ok(audit.body.detail && audit.body.detail.status === 401);
  } finally { stubby.restore(); }
});

/* ── global revoke ───────────────────────────────────────────────── */

test('/api/admin-session is admin-only', async () => {
  const stubby = stub();
  try {
    for (const method of ['GET', 'POST']) {
      const res = await run(dispatcher, { url: '/api/admin-session', method, query: {}, body: {} });
      assert.strictEqual(res.statusCode, 401, method + ' must be gated, got ' + res.statusCode);
    }
  } finally { stubby.restore(); }
});

test('revoke-sessions asks Supabase to sign the account out everywhere and audits it', async () => {
  const stubby = stub((url, method) => {
    if (url.includes('/auth/v1/logout') && method === 'POST') return reply(204, '');
    return undefined;
  });
  try {
    const res = await run(adminSession, {
      url: '/api/admin-session', method: 'POST', query: {}, body: { action: 'revoke-sessions' },
      adminUser: { id: 'owner-id', email: 'owner@civilcareer.test' },
      headers: { authorization: `Bearer ${fakeJwt(10)}` },
    });
    assert.strictEqual(res.statusCode, 200, res.bodyText);
    assert.strictEqual(JSON.parse(res.bodyText).scope, 'global');
    const logout = stubby.calls.find(c => c.url.includes('/auth/v1/logout'));
    assert.ok(logout, 'expected Supabase global logout');
    assert.ok(logout.url.includes('scope=global'), 'global scope is required to kill refresh tokens');
    const audit = stubby.calls.find(c => c.url.includes('admin_audit'));
    assert.strictEqual(audit.body.event, 'sessions_revoked');
  } finally { stubby.restore(); }
});

test('a failed revoke is reported honestly with the rotation fallback', async () => {
  const stubby = stub((url) => {
    if (url.includes('/auth/v1/logout')) return reply(401, { msg: 'invalid token' });
    return undefined;
  });
  try {
    const res = await run(adminSession, {
      url: '/api/admin-session', method: 'POST', query: {}, body: { action: 'revoke-sessions' },
      adminUser: { id: 'owner-id', email: 'owner@civilcareer.test' },
      headers: { authorization: `Bearer ${fakeJwt(10)}` },
    });
    assert.strictEqual(res.statusCode, 502, res.bodyText);
    assert.ok(/password/i.test(res.bodyText), 'must tell the owner the fallback');
    const audit = stubby.calls.find(c => c.url.includes('admin_audit'));
    assert.strictEqual(audit.body.event, 'sessions_revoke_failed');
  } finally { stubby.restore(); }
});

test('unknown actions on /api/admin-session are rejected', async () => {
  const stubby = stub();
  try {
    const res = await run(adminSession, {
      url: '/api/admin-session', method: 'POST', query: {}, body: { action: 'please-delete-everything' },
      adminUser: { id: 'owner-id', email: 'owner@civilcareer.test' },
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { stubby.restore(); }
});

test('the GET policy endpoint reports the enforced TTL without leaking anything', async () => {
  const stubby = stub();
  try {
    const res = await run(adminSession, {
      url: '/api/admin-session', query: {}, adminUser: { id: 'owner-id', email: 'owner@civilcareer.test' },
    });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(body.session_ttl_seconds, security.ADMIN_SESSION_TTL_SECONDS);
    /* Prose may say the word "token"; what must never appear is credential
       MATERIAL — a JWT, a key value, or an auth header echo. */
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(res.bodyText), 'no JWT may be echoed');
    assert.ok(!res.bodyText.includes(process.env.SUPABASE_ANON_KEY), 'no anon key may be echoed');
    assert.ok(!res.bodyText.includes(process.env.SUPABASE_SERVICE_ROLE_KEY), 'no service-role key may be echoed');
    assert.ok(!/apikey|Bearer\s+\S/i.test(res.bodyText), 'no auth header material may be echoed');
  } finally { stubby.restore(); }
});

/* ── client (admin.html) side ────────────────────────────────────── */

test('admin.html caps its session at the same TTL and uses a strict cookie', () => {
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.ok(/CC_SESSION_TTL_SECONDS\s*=\s*1800/.test(html), 'client TTL constant missing');
  assert.ok(html.includes('same-site=strict'), 'gate cookie must be SameSite=Strict');
  assert.ok(!html.includes('same-site=lax'), 'no SameSite=Lax cookie may remain');
  assert.ok(/function adminSessionExpired\s*\(/.test(html), 'stale-session guard missing');
  assert.ok(/adminSessionExpired\(\)/.test(html), 'the guard must actually run on restore');
  assert.ok(/function adminRevokeAllSessions\s*\(/.test(html), 'sign-out-everywhere action missing');
  assert.ok(html.includes("action:'revoke-sessions'"), 'the revoke action must call the endpoint');
  /* The client cap and the server cap must agree, or one silently wins. */
  const securitySrc = fs.readFileSync(path.join(root, 'lib', 'security.js'), 'utf8');
  const serverTtl = Number((securitySrc.match(/ADMIN_SESSION_TTL_SECONDS\s*=\s*(\d+)/) || [])[1]);
  const clientTtl = Number((html.match(/CC_SESSION_TTL_SECONDS\s*=\s*(\d+)/) || [])[1]);
  assert.ok(serverTtl > 0 && clientTtl > 0, 'both TTLs must be numeric');
  assert.strictEqual(clientTtl, serverTtl, 'client and server TTLs must match');
});

test('the audit migration keeps the trail private', () => {
  const sql = fs.readFileSync(path.join(root, 'v33-admin-audit.sql'), 'utf8');
  assert.ok(/create table.*\badmin_audit\b/i.test(sql), 'admin_audit table missing');
  assert.ok(/enable row level security/i.test(sql), 'RLS required');
  const policies = sql.match(/create policy[\s\S]*?;/gi) || [];
  assert.strictEqual(policies.length, 0, 'admin_audit must have no policies at all');
  assert.ok(!/access_token|refresh_token/i.test(sql), 'the audit table must not store tokens');
});
