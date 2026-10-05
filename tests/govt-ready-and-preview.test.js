'use strict';
/**
 * Three requests, one file:
 *
 * 1. "…and it's not fetching data properly" ended with hundreds of queued leads every
 *    reviewer had to clear by hand. publish_ready publishes the ones that need no
 *    judgement — the posting's OWN words name civil engineering, a real official notice
 *    link is on record, and the deadline has not passed — while everything else stays for
 *    a human with the reason it stayed.
 *
 * 2. The pre-crawl preview must predict the queue exactly, so the dedupe key it uses has
 *    to be the writer's key (not a second copy of the formula), and it must never write.
 *
 * 3. The public Government Civil Jobs page is the human-reviewed pipeline, not the generic
 *    explorer's sector=Government filter (which filled it from the private jobs table).
 *
 * No network: global.fetch is stubbed. The review handler is driven through its real
 * module, with the admin identity on the request, exactly as the other publish tests do.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const govtReview = require('../_api/govt-review.js');
const { verdictFor } = require('../scripts/govt-queue-preview.js');

const ADMIN = { id: 'admin-1', email: 'admin@example.com' };

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

async function run(handler, { url, method = 'GET', query = {}, body = null, adminUser = null }) {
  const req = { url, method, query, body, headers: {}, adminUser };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, bodyText: '',
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.bodyText = JSON.stringify(obj); resolve(this); return this; },
      send(data) { this.bodyText = String(data); resolve(this); return this; },
      end(data) { if (data !== undefined) this.bodyText = String(data); resolve(this); },
    };
    Promise.resolve(handler(req, res)).then(() => resolve(res), reject);
  });
}

const READY = {
  id: 'stage-ready', status: 'pending', civil_status: 'civil',
  payload: {
    title: 'Goa Housing Board - Junior Engineer (Civil)', organization: 'Goa Housing Board',
    source_type: 'aggregator_lead', civil_evidence: 'qualification',
    official_notice_url: 'https://goa.gov.in/wp-content/uploads/2026/09/goa-housingboard.pdf',
    notification_no: 'GHB/2026/13',
    post_candidates: [{ post_name: 'Junior Engineer (Civil)', outcome: 'civil', level: 'civil', vacancy: 1 }],
    deadline: { kind: 'fixed', text: '21/10/2026', date: '2026-10-21' },
  },
};
const SECTION_ONLY = {
  id: 'stage-section', status: 'pending', civil_status: 'civil',
  payload: {
    title: 'Cochin Port Trust Recruitment 2026 - 20 Apprentice Posts', organization: 'Cochin Port Trust',
    source_type: 'aggregator_lead', civil_evidence: 'section',
    official_notice_url: 'https://cochinport.gov.in/advt.pdf',
    post_candidates: [{ post_name: 'Apprentice', outcome: 'civil', level: 'related' }],
  },
};
const NO_NOTICE = {
  id: 'stage-nonotice', status: 'needs_info', civil_status: 'civil',
  payload: {
    title: 'Linking Sky - 195 Apprentices', organization: 'Linking Sky',
    source_type: 'aggregator_lead', civil_evidence: 'qualification',
    official_notice_url: '', post_candidates: [],
  },
};
const EXPIRED = {
  id: 'stage-expired', status: 'pending', civil_status: 'civil',
  payload: {
    title: 'Old Recruitment 2019', organization: 'Some Board',
    source_type: 'aggregator_lead', civil_evidence: 'qualification',
    official_notice_url: 'https://someboard.gov.in/old.pdf',
    deadline: { kind: 'fixed', text: '01/01/2020', date: '2020-01-01' },
    post_candidates: [{ post_name: 'JE (Civil)', outcome: 'civil', level: 'civil' }],
  },
};

function stubSupabase(rows) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
    calls.push({ url: target, method, body });

    if (target.includes('/rest/v1/govt_job_staging') && method === 'GET') return reply(200, rows);
    if (target.includes('/rest/v1/govt_jobs') && method === 'POST') {
      return reply(201, [Object.assign({}, body, { id: 'job-1', slug: body && body.slug })]);
    }
    return reply(200, []);
  };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

test('publish_ready publishes the complete leads and names why it left the rest', async () => {
  const stub = stubSupabase([READY, SECTION_ONLY, NO_NOTICE, EXPIRED]);
  try {
    const res = await run(govtReview, {
      url: '/api/govt-review?action=publish_ready', method: 'POST', body: { limit: 20 }, adminUser: ADMIN,
    });
    const out = JSON.parse(res.bodyText);
    assert.equal(res.statusCode, 200, res.bodyText.slice(0, 300));
    assert.equal(out.ok, true);
    assert.equal(out.published, 1, `exactly one lead is complete, got ${JSON.stringify(out)}`);

    /* Each refusal names a reason a reviewer can act on. */
    const reasons = Object.fromEntries((out.skipped || []).map(s => [s.id, s.because]));
    assert.match(reasons['stage-section'], /section/i, 'a feed-section-only match is not a civil post');
    assert.match(reasons['stage-nonotice'], /notice/i, 'no official notice link → not publishable');
    assert.match(reasons['stage-expired'], /deadline/i, 'an expired recruitment must not go out');
    assert.equal(Object.keys(reasons).length, 3);

    /* The published row still satisfies the gate: a human triggered it, and the official
       notice — not the aggregator page — is what the job carries. */
    const insert = stub.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/govt_jobs'));
    assert.ok(insert, 'the ready lead must be published');
    assert.equal(insert.body.human_reviewed, true, 'the human gate must stay satisfied by the authorised action');
    assert.equal(insert.body.official_notice_url, READY.payload.official_notice_url);
    assert.equal(insert.body.status, 'active');
    assert.equal(insert.body.title, READY.payload.title);

    const patched = stub.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/govt_job_staging'));
    assert.ok(patched && /stage-ready/.test(patched.url), 'the published staging row must be marked approved');
    assert.equal(patched.body.status, 'approved');

    const audited = stub.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/govt_audit_log'));
    assert.ok(audited.length, 'publishing in bulk is still an audited act');
  } finally { stub.restore(); }
});

test('publish_ready is inert when the queue has nothing complete', async () => {
  const stub = stubSupabase([SECTION_ONLY, NO_NOTICE]);
  try {
    const res = await run(govtReview, {
      url: '/api/govt-review?action=publish_ready', method: 'POST', body: {}, adminUser: ADMIN,
    });
    const out = JSON.parse(res.bodyText);
    assert.equal(out.published, 0);
    assert.equal(stub.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/govt_jobs')).length, 0,
      'nothing may be published when nothing qualifies');
  } finally { stub.restore(); }
});

test('the queue preview reads the writer\u2019s own dedupe key and never writes', () => {
  const src = read('scripts/govt-queue-preview.js');
  assert.match(src, /require\('\.\.\/lib\/govt-lead-payload'\)/, 'the preview must use the shared payload module');
  assert.match(src, /dedupeKey\(/, 'the preview must build keys with the writer\u2019s function');
  assert.ok(!/createHash/.test(src), 'no second copy of the key formula');
  assert.ok(!/method:\s*'(POST|PATCH|DELETE|PUT)'/.test(src), 'the preview must never write');
  assert.match(src, /Nothing was written: this script only reads\./, 'and it must say so');

  /* The writer itself must use the same module, or "already queued" here would be a guess. */
  assert.match(read('_api/govt-discovery.js'), /dedupeKey,\r?\n\s*hash,/,
    'the cron must take the key formula from the shared module');
});

test('the preview translates a queue row into exactly what the sweep will do', () => {
  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const queue = new Map([
    ['k-queued', { status: 'pending', payload: {} }],
    ['k-needs', { status: 'needs_info', payload: {} }],
    ['k-approved', { status: 'approved', payload: { official_notice_url: 'https://goa.gov.in/a.pdf' } }],
    ['k-rejected', { status: 'rejected', payload: {} }],
    ['k-badnotice', { status: 'pending', payload: { official_notice_url: 'https://allgovernmentjobs.in/x' } }],
  ]);

  assert.equal(verdictFor('k-new', queue, true).state, 'NEW');
  assert.equal(verdictFor('k-queued', queue, true).state, 'QUEUED');
  assert.equal(verdictFor('k-needs', queue, true).state, 'NEEDS INFO');
  assert.equal(verdictFor('k-approved', queue, true).state, 'APPROVED');
  assert.equal(verdictFor('k-rejected', queue, true).state, 'REJECTED');
  /* An aggregator URL is not an official notice here either. */
  assert.equal(verdictFor('k-badnotice', queue, true).notice, false);
  assert.equal(verdictFor('k-approved', queue, true).notice, true);
  /* Without credentials the preview says "unknown" rather than inventing a verdict. */
  const blind = verdictFor('k-queued', new Map(), false);
  assert.equal(blind.state, 'unknown');
  assert.equal(blind.notice, null);
  assert.ok(hoursAgo(1));
});

test('the public government page reads the reviewed pipeline, not the private jobs table', () => {
  const v8 = read('v8.js');
  const start = v8.indexOf('async function renderGovernment');
  const end = v8.indexOf('function clearPrivate');
  assert.ok(start !== -1 && end > start, 'renderGovernment must stay where this test can find it');
  const fn = v8.slice(start, end);

  assert.match(fn, /api\/govt-jobs\?/, 'the page must read the reviewed government jobs API');
  assert.ok(!/fetchExplorerJobs\('government'/.test(fn), 'the explorer sector filter must be gone from this page');
  assert.ok(!/jobCard\(x,true\)/.test(fn), 'private-shape cards must not be rendered here');
  assert.match(fn, /list\.map\(govtCard\)/, 'the reviewed shape has its own card');
  assert.match(fn, /human-reviewed government notification/, 'the count must say what it counts');

  /* Only parameters /api/govt-jobs actually supports. */
  const params = v8.slice(v8.indexOf('function govtListingParams'), v8.indexOf('function sortGovtJobs'));
  for (const bad of ['work_mode', 'employment_type', 'posted_days', 'experience']) {
    assert.ok(!params.includes(bad), `govt-jobs does not filter on ${bad}`);
  }
  for (const good of ['scope', 'role', 'state', 'qualification', 'q']) {
    assert.ok(params.includes(`'${good}'`), `the government filters must still send ${good}`);
  }

  /* The table view renders the same reviewed rows, and links to the dedicated page. */
  const table = v8.slice(v8.indexOf('function govTableRows'), v8.indexOf('function ensureGovTableSkeleton'));
  assert.match(table, /govtDetailPath\(j\)/, 'the table must link to the notification page');
  assert.match(table, /Human-reviewed/, 'the table must label the review state');
  assert.ok(!/recruitment_authority/.test(table), 'table cells must not come from the private shape');
});

test('every lead gets enriched over successive sweeps, not just the first few', () => {
  const cron = read('_api/govt-discovery.js');

  /* Rows that already have a notice, or were read recently, are skipped so the rest are
     reached at last. */
  assert.match(cron, /noticeCheckedRecently\(prev\)/, 'a recently checked row must not be re-read every sweep');
  assert.match(cron, /pending\.sort\(/, 'the pending rows must be ordered so nothing starves');
  assert.match(cron, /created_at \? Date\.parse\(a\.previous\.created_at\)/, 'oldest waiting first');
  assert.match(cron, /candidate\.noticeCheckedAt = new Date\(\)\.toISOString\(\)/, 'a read page must be recorded');
  assert.match(read('lib/govt-lead-payload.js'), /notice_checked_at: input\.noticeCheckedAt/,
    'the stamp must be part of the staged payload');
  assert.match(read('lib/govt-lead-payload.js'),
    /notice_checked_at\) payload\.notice_checked_at = before\.notice_checked_at/,
    'and it must survive the upsert');

  /* The crawler, when the workflow runs again, rotates its detail budget instead of
     always spending it on the same first rows. */
  const crawler = read('scripts/crawl-govt-pipeline.js');
  assert.match(crawler, /const rotate = kept\.length > MAX_DETAIL_FETCHES/, 'the crawler must rotate its window');
  assert.match(crawler, /for \(const \{ r, select \} of ordered\)/, 'and walk the rotated list');
});
