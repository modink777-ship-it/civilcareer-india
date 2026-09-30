/* Phase 12 (overhaul): admin allowlist must deny valid sessions that are not
   on the ADMIN_EMAIL / ADMIN_USER_ID allowlist. Runs under `npm test`. */
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const dispatchSource = require('fs').readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
const dispatcher = require(path.join(root, 'api', '[[...path]].js'));

/* The dispatcher must verify the Supabase session server-side and compare it
   against the allowlist before touching any handler. */
assert(dispatchSource.includes('ADMIN_EMAIL'), 'allowlist must support ADMIN_EMAIL');
assert(dispatchSource.includes('ADMIN_USER_ID'), 'allowlist must support ADMIN_USER_ID');
assert(dispatchSource.includes('/auth/v1/user'), 'admin check must verify the session against Supabase Auth');

/* Simulated request to an admin-gated endpoint. global.fetch is stubbed to act
   as Supabase Auth: a VALID token resolves to the throwaway user (valid
   session, NOT on the allowlist); anything else is an invalid session. */
const THROWAWAY = {
  id: 'eab63ec6-a8c6-4b02-8407-dfdd11c6af96',
  email: 'cc-throwaway-30sep@example.com',
};
const VALID_TOKEN = 'valid-but-not-allowlisted-token';

async function probe(requestToken) {
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes('/auth/v1/user')) {
      const auth = String((opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '');
      if (!auth.endsWith(`Bearer ${requestToken}`) || requestToken !== VALID_TOKEN) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: THROWAWAY.id, email: THROWAWAY.email, aud: 'authenticated', role: 'authenticated' }),
      };
    }
    return realFetch(url);
  };
  try {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return { json: () => {} }; },
      end() {},
    };
    const req = {
      method: 'GET',
      url: '/api/analytics',
      headers: { authorization: `Bearer ${requestToken}` },
    };
    await dispatcher(req, res);
    return res.statusCode;
  } finally {
    global.fetch = realFetch;
  }
}


/* The scheduler credential must not bypass an unrelated admin endpoint. */
async function probeCronBypass() {
  const prev = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  process.env.ADMIN_EMAIL = 'owner@civilcareer.test';
  process.env.ADMIN_USER_ID = '';
  process.env.CRON_SECRET = 'cron-secret-for-test';
  delete process.env.OWNER_KEY;

  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return realFetch(url);
  };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end() {},
  };
  const req = {
    method: 'GET',
    url: '/api/analytics',
    headers: { authorization: 'Bearer cron-secret-for-test' },
  };
  try {
    await dispatcher(req, res);
  } finally {
    global.fetch = realFetch;
  }
  Object.assign(process.env, prev);
  return res.statusCode;
}

(async () => {
  const prev = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  process.env.ADMIN_EMAIL = 'owner@civilcareer.test';
  process.env.ADMIN_USER_ID = '';
  delete process.env.OWNER_KEY;

  /* A VALID session whose email is not allowlisted: the dispatcher must answer
     403 Administrator access denied — logged-in is not enough. */
  const code = await probe(VALID_TOKEN);
  assert.strictEqual(code, 403, `non-allowlisted valid session must get 403, got ${code}`);

  /* An invalid session must be rejected outright with 401. */
  const unauth = await probe('no-such-token');
  assert.strictEqual(unauth, 401, `invalid session must get 401, got ${unauth}`);

  const cronBypass = await probeCronBypass();
  assert.strictEqual(cronBypass, 401, `CRON_SECRET must not bypass unrelated admin routes, got ${cronBypass}`);

  Object.assign(process.env, prev);
  console.log('Phase 12 admin allowlist tests: PASS');
})().catch(e => { console.error(e); process.exit(1); });
