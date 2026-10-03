/* v30: AI Job Collector + Admin Job Inbox.
 *
 * Two layers are covered here:
 *   1. the deterministic core (splitting, extraction, relevance, dedupe) —
 *      plain functions, entirely offline;
 *   2. the admin-only API handler against a mocked Supabase REST API —
 *      batches, processing, edit, approve/reject and the duplicate guard.
 *
 * Fixtures are fictional (ABC Infrastructure, example.com) — no real ads.
 */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const root = path.join(__dirname, '..');
const core = require(path.join(root, 'lib', 'job-collector-core.js'));
const collector = require(path.join(root, '_api', 'job-collector.js'));

const POSTER = [
  'ABC Infrastructure Pvt Ltd',
  'Hiring for Bangalore Project',
  '',
  'Site Engineer - 4-6 LPA',
  'Experience: 3-5 years',
  'Qualification: B.E Civil',
  'Skills: AutoCAD, Staad Pro, Site Execution',
  'Contact: hr@abcinfra.example / 9876543210',
  '',
  'Project Manager - 12-15 LPA',
  'Experience: 8+ years',
  'Location: Hyderabad',
  'Skills: Primavera, MS Project, Billing',
  'Email: careers@abcinfra.example',
  'Last date: 15/11/2026',
].join('\n');

/* ── 1. deterministic core ─────────────────────────────────────────────── */

test('core splits one poster into two separate jobs', () => {
  const jobs = core.extractFromText(POSTER);
  assert.strictEqual(jobs.length, 2, 'two roles expected');
  assert.strictEqual(jobs[0].title, 'Site Engineer');
  assert.strictEqual(jobs[1].title, 'Project Manager');
});

test('core reads company, city, state, salary, experience, contact and expiry', () => {
  const jobs = core.extractFromText(POSTER);
  const site = jobs[0];
  const pm = jobs[1];
  assert.strictEqual(site.company, 'ABC Infrastructure Pvt Ltd');
  assert.strictEqual(site.city, 'Bangalore');
  assert.strictEqual(site.state, 'Karnataka');
  assert.strictEqual(site.salary_min, 400000);
  assert.strictEqual(site.salary_max, 600000);
  assert.strictEqual(site.salary_currency, 'INR');
  assert.strictEqual(site.salary_period, 'year');
  assert.strictEqual(site.experience_min, 3);
  assert.strictEqual(site.experience_max, 5);
  assert.strictEqual(site.application_email, 'hr@abcinfra.example');
  assert.strictEqual(site.application_phone, '9876543210');
  assert.strictEqual(site.expiry, null);
  assert.strictEqual(pm.city, 'Hyderabad');
  assert.strictEqual(pm.state, 'Telangana');
  assert.strictEqual(pm.salary_min, 1200000);
  assert.strictEqual(pm.expiry, '2026-11-15');
});

test('core never invents a field that the source does not state', () => {
  const jobs = core.extractFromText('Site Engineer required\nApply with the link below.');
  assert.strictEqual(jobs.length, 1);
  const job = jobs[0];
  assert.strictEqual(job.company, null, 'no company in the source → null');
  assert.strictEqual(job.city, null, 'no city in the source → null');
  assert.strictEqual(job.salary_min, null);
  assert.strictEqual(job.salary_currency, null);
  assert.strictEqual(job.application_email, null);
  assert.strictEqual(job.expiry, null);
  assert.strictEqual(job.experience_min, null);
});

test('core sends a non-civil ad to non_relevant and junk to uncertain', () => {
  const sales = core.extractFromText('Urgent requirement — Telecaller / Sales Executive\nContact: 9876500000');
  assert.ok(sales.length >= 1);
  assert.strictEqual(sales[0].relevance_category, 'non_relevant');
  const junk = core.extractFromText('Welcome to our website. Contact us for details.');
  assert.ok(junk.length >= 1);
  assert.strictEqual(junk[0].relevance_category, 'uncertain');
});

test('core scores a title-first civil category', () => {
  const jobs = core.extractFromText('Site Engineer (Civil)\nLocation: Pune\nSkills: AutoCAD');
  assert.strictEqual(jobs[0].relevance_category, 'construction');
});

test('core flags an already-published job as a duplicate', () => {
  const verdict = core.duplicateScore(
    { title: 'Site Engineer', company: 'ABC Infrastructure Pvt Ltd', city: 'Bangalore' },
    { role: 'Site Engineer', company: 'ABC Infrastructure Pvt Ltd', city: 'Bangalore' }
  );
  assert.ok(verdict.score >= 0.5, 'expected a duplicate score, got ' + verdict.score);
  assert.ok(verdict.reasons.length > 0);
});

/* ── 2. admin-only API handler (mocked Supabase) ───────────────────────── */

function mockSupabase(routes) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const call = { url: u, method, body: opts.body ? String(opts.body) : null };
    calls.push(call);
    for (const route of routes) {
      const hit = (route.method || 'GET') === method && u.indexOf(route.match) !== -1 &&
        (!route.guard || route.guard(call));
      if (hit) {
        const out = typeof route.reply === 'function' ? route.reply(call) : route.reply;
        const status = (out && out.status) || 200;
        const payload = out && 'body' in out ? out.body : out;
        const text = JSON.stringify(payload === undefined ? [] : payload);
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (k) => (String(k).toLowerCase() === 'content-range' ? ((out && out.contentRange) || '0-0/0') : null) },
          text: async () => text,
          json: async () => JSON.parse(text),
        };
      }
    }
    return { ok: true, status: 200, headers: { get: () => '0-0/0' }, text: async () => '[]', json: async () => [] };
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

async function run(req0) {
  const req = Object.assign({ method: 'GET', headers: {}, query: {}, body: null, adminUser: null }, req0);
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.bodyText = JSON.stringify(obj); resolve(this); return this; },
      send(data) { this.bodyText = String(data); resolve(this); return this; },
      end(data) { if (data !== undefined) this.bodyText = String(data); resolve(this); return this; },
    };
    Promise.resolve(collector(req, res)).then(() => resolve(res), reject);
  });
}

const ADMIN = { id: 'admin-1', email: 'owner@example.com' };

test('collector refuses anonymous callers', async () => {
  const res = await run({ url: '/api/job-collector?action=metrics' });
  assert.strictEqual(res.statusCode, 401);
});

test('create_batch stores the submitted text and queues the source', async () => {
  const stub = mockSupabase([
    { method: 'POST', match: '/rest/v1/job_import_batches', reply: { status: 201, body: [{ id: 'b1', status: 'open', source_count: 1 }] } },
    { method: 'POST', match: '/rest/v1/job_import_items', reply: { status: 201, body: [{ id: 'i1', kind: 'text', status: 'pending' }] } },
    { method: 'POST', match: '/rest/v1/job_inbox_events', reply: { status: 201, body: [{}] } },
  ]);
  try {
    const res = await run({
      method: 'POST', url: '/api/job-collector?action=create_batch', adminUser: ADMIN,
      body: { items: [{ kind: 'text', text: 'Site Engineer\nLocation: Pune' }] },
    });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 201, res.bodyText.slice(0, 200));
    assert.strictEqual(body.batch.id, 'b1');
    assert.strictEqual(body.items.length, 1);
    const insItem = stub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/job_import_items'));
    assert.ok(insItem && insItem.body.includes('Site Engineer'), 'source text must be stored');
  } finally { stub.restore(); }
});

test('process extracts a job and stages it in the inbox', async () => {
  const stub = mockSupabase([
    { match: '/rest/v1/job_import_batches?id=eq.b1', reply: [{ id: 'b1', status: 'open' }] },
    {
      match: '/rest/v1/job_import_items?batch_id=eq.b1&status=in.(pending,needs_text)',
      reply: [{ id: 'i1', kind: 'text', raw_text: 'Site Engineer - 4-6 LPA\nExperience: 3-5 years\nLocation: Pune\nContact: hr@abcinfra.example', status: 'pending' }],
    },
    { method: 'PATCH', match: '/rest/v1/job_import_items?id=eq.i1', reply: [{}] },
    { match: '/rest/v1/jobs?', reply: [] },
    { method: 'POST', match: '/rest/v1/job_inbox', reply: { status: 201, body: [{ id: 'in1', duplicate_of: null, duplicate_score: null }] } },
    { method: 'POST', match: '/rest/v1/job_inbox_events', reply: { status: 201, body: [{}] } },
    { method: 'PATCH', match: '/rest/v1/job_import_batches?id=eq.b1', reply: [{}] },
    { match: '/rest/v1/job_import_items?batch_id=eq.b1&status=in.(pending,needs_text)&select=id', reply: [] },
    { match: '/rest/v1/job_import_items?batch_id=eq.b1&select=status', reply: [{ status: 'processed' }] },
    { match: '/rest/v1/job_inbox?batch_id=eq.b1&select=id', reply: [{ id: 'in1' }] },
  ]);
  try {
    const res = await run({ method: 'POST', url: '/api/job-collector?action=process', adminUser: ADMIN, body: { batch_id: 'b1' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 300));
    assert.strictEqual(body.processed, 1);
    assert.strictEqual(body.jobs_detected, 1);
    const ins = stub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/job_inbox'));
    assert.ok(ins && /"title":"Site Engineer"/.test(ins.body), 'inbox row must carry the extracted title: ' + (ins && ins.body));
  } finally { stub.restore(); }
});

test('approve publishes into the existing jobs table with admin provenance', async () => {
  const stub = mockSupabase([
    { match: '/rest/v1/job_inbox?id=eq.in1&select=*&limit=1', reply: [{ id: 'in1', status: 'pending', title: 'Site Engineer', company: 'ABC Infrastructure Pvt Ltd', city: 'Pune', application_email: 'hr@abcinfra.example' }] },
    { method: 'POST', match: '/rest/v1/jobs', reply: { status: 201, body: [{ id: 'j9', slug: 'site-engineer-abc' }] } },
    { method: 'PATCH', match: '/rest/v1/job_inbox?id=eq.in1', reply: [{}] },
    { method: 'POST', match: '/rest/v1/job_inbox_events', reply: { status: 201, body: [{}] } },
  ]);
  try {
    const res = await run({ method: 'POST', url: '/api/job-collector?action=approve', adminUser: ADMIN, body: { id: 'in1' } });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 300));
    assert.strictEqual(body.job.id, 'j9');
    const ins = stub.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/jobs'));
    assert.ok(ins, 'a jobs insert is required');
    assert.ok(/"published":true/.test(ins.body), 'approved jobs must be published');
    assert.ok(/"source":"Job Collector"/.test(ins.body), 'source must be traceable');
    const patch = stub.calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/job_inbox?id=eq.in1'));
    assert.ok(patch && /"status":"approved"/.test(patch.body), 'inbox row must be marked approved');
  } finally { stub.restore(); }
});

test('approve refuses an item with no title or contact', async () => {
  const stub = mockSupabase([
    { match: '/rest/v1/job_inbox?id=eq.in2&select=*&limit=1', reply: [{ id: 'in2', status: 'pending', title: null, company: null }] },
  ]);
  try {
    const res = await run({ method: 'POST', url: '/api/job-collector?action=approve', adminUser: ADMIN, body: { id: 'in2' } });
    assert.strictEqual(res.statusCode, 422);
  } finally { stub.restore(); }
});

test('approve blocks a likely duplicate until the admin confirms', async () => {
  const row = { id: 'in3', status: 'pending', title: 'Site Engineer', company: 'ABC Infrastructure Pvt Ltd', duplicate_of: 'j7', duplicate_score: 0.9, duplicate_reasons: ['same company', 'similar title'] };
  const stub = mockSupabase([
    { match: '/rest/v1/job_inbox?id=eq.in3&select=*&limit=1', reply: [row] },
    { method: 'POST', match: '/rest/v1/jobs', reply: { status: 201, body: [{ id: 'j10' }] } },
    { method: 'PATCH', match: '/rest/v1/job_inbox?id=eq.in3', reply: [{}] },
    { method: 'POST', match: '/rest/v1/job_inbox_events', reply: { status: 201, body: [{}] } },
  ]);
  try {
    const blocked = await run({ method: 'POST', url: '/api/job-collector?action=approve', adminUser: ADMIN, body: { id: 'in3' } });
    assert.strictEqual(blocked.statusCode, 409);
    assert.ok(JSON.parse(blocked.bodyText).needs_confirmation);
    const forced = await run({ method: 'POST', url: '/api/job-collector?action=approve', adminUser: ADMIN, body: { id: 'in3', confirm_duplicate: true } });
    assert.strictEqual(forced.statusCode, 200, forced.bodyText.slice(0, 200));
  } finally { stub.restore(); }
});

test('reject keeps the row with a reason instead of deleting it', async () => {
  const stub = mockSupabase([
    { method: 'PATCH', match: '/rest/v1/job_inbox?id=eq.in4', reply: [{}] },
    { method: 'POST', match: '/rest/v1/job_inbox_events', reply: { status: 201, body: [{}] } },
  ]);
  try {
    const res = await run({
      method: 'POST', url: '/api/job-collector?action=reject', adminUser: ADMIN,
      body: { id: 'in4', reason: 'Not a civil engineering job' },
    });
    assert.strictEqual(res.statusCode, 200);
    const patch = stub.calls.find((c) => c.method === 'PATCH');
    assert.ok(/"status":"rejected"/.test(patch.body), 'rejected rows must persist for the audit log');
    assert.ok(/Not a civil engineering job/.test(patch.body));
  } finally { stub.restore(); }
});

test('inbox tab filters: status and duplicates-only produce different queries', async () => {
  const stub = mockSupabase([{ match: '/rest/v1/job_inbox?', reply: [] }]);
  try {
    await run({ url: '/api/job-collector?action=inbox&status=pending', adminUser: ADMIN });
    await run({ url: '/api/job-collector?action=inbox&duplicates=1', adminUser: ADMIN });
    const queries = stub.calls.filter((c) => c.url.includes('/rest/v1/job_inbox?')).map((c) => c.url);
    assert.ok(queries.some((q) => q.includes('status=eq.pending')), 'pending filter expected');
    assert.ok(queries.some((q) => q.includes('duplicate_of=not.is.null')), 'duplicates filter expected');
  } finally { stub.restore(); }
});

test('diagnostics confirms every required table and the storage bucket', async () => {
  const stub = mockSupabase([
    { match: '/rest/v1/job_import_batches?select=id&limit=1', reply: [] },
    { match: '/rest/v1/job_import_items?select=id&limit=1', reply: [] },
    { match: '/rest/v1/job_inbox?select=id&limit=1', reply: [] },
    { match: '/rest/v1/job_inbox_events?select=id&limit=1', reply: [] },
    { match: '/storage/v1/bucket/job-sources', reply: { status: 200, body: { id: 'job-sources', public: false } } },
  ]);
  try {
    const res = await run({ url: '/api/job-collector?action=diagnostics', adminUser: ADMIN });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200, res.bodyText.slice(0, 200));
    assert.strictEqual(body.ok, true, 'all critical checks should pass');
    const names = body.checks.map((c) => c.name);
    for (const t of ['job_import_batches', 'job_import_items', 'job_inbox', 'job_inbox_events']) {
      assert.ok(names.some((n) => n.includes(t)), 'missing check for ' + t);
    }
    assert.ok(names.some((n) => n.includes('job-sources')), 'bucket check expected');
  } finally { stub.restore(); }
});

test('diagnostics names a missing table and marks the run as not ready', async () => {
  const stub = mockSupabase([
    {
      match: '/rest/v1/job_inbox?select=id&limit=1',
      reply: { status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.job_inbox' in the schema cache" } },
    },
    { match: '/storage/v1/bucket/job-sources', reply: { status: 200, body: { id: 'job-sources' } } },
  ]);
  try {
    const res = await run({ url: '/api/job-collector?action=diagnostics', adminUser: ADMIN });
    const body = JSON.parse(res.bodyText);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.ok, false, 'a missing table must fail the check');
    const failed = body.checks.filter((c) => !c.ok && c.critical !== false).map((c) => c.name);
    assert.ok(failed.some((n) => n.includes('job_inbox')), 'failed check must name the table: ' + failed.join(', '));
    const row = body.checks.find((c) => c.name.includes('job_inbox'));
    assert.match(String(row.error), /PGRST205|job_inbox/);
  } finally { stub.restore(); }
});
