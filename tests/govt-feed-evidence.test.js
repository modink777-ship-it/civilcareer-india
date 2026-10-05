'use strict';
/**
 * What the six aggregator feeds publish, versus what the review queue showed.
 *
 * The queue displayed this against a real lead:
 *
 *     Deadline —   Notification no. —   Qualification —   Posts found —
 *     Official notice  https://allgovernmentjobs.in/cochin-port-trust-recruitment-2026-.../44433
 *
 * Two separate faults produced it:
 *   1. the Vercel cron (the only writer actually running, because the GitHub Actions
 *      minutes were exhausted) staged six fields while the GitHub crawler staged the
 *      whole evidence set — qualification, vacancies, deadline, advt no, section,
 *      and how the posting qualified;
 *   2. it wrote `official_notice_url = candidate.source_url`, so the aggregator's own
 *      article URL was presented as the official notice, and the publish gate then
 *      refused every row (an aggregator URL can never be an official notice).
 *
 * These tests drive the real cron handler with Supabase and the network stubbed, so
 * they assert what is actually written to govt_job_staging — not what a comment says.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-key';
/* One posting page per source keeps the test quick: each fetch is paced. */
process.env.GOVT_MAX_DETAIL_FETCHES = '1';

const { buildPayload, isOfficialHost } = require('../lib/govt-lead-payload');
const { formatPipelineWarning } = require('../lib/govt-alert');

const GOVTJOBGURU = {
  id: 'src-gjg',
  name: 'govtjobguru Engineering Jobs',
  type: 'aggregator_lead',
  url: 'https://govtjobguru.in/jobs-by-post/engineering-jobs/',
  kind: 'html',
  org: 'govtjobguru.in',
  category: 'Other',
  state: null,
  enabled: true,
  robots_ok: true,
  last_run_at: null,
  last_status: null,
};

const LISTING = read('tests/fixtures/govt-aggregators/govtjobguru-engineering-table.html');
/* The posting's own page, carrying the real notification link a reviewer would need. */
const DETAIL = '<html><body><h1>Junior Engineer (Civil)</h1>'
  + '<a href="https://sssb.punjab.gov.in/wp-content/uploads/2026/09/Advt.-No.-13-of-2026.pdf">Download the advertisement (PDF)</a>'
  + '<p>Last date to apply: 21/10/2026. Qualification: Diploma in Civil Engineering.</p></body></html>';

let listingStatus = 200;
let detailStatus = 200;
/* Rows already in the queue for this source, returned by the pre-read the writer makes
   before it upserts. Empty on a first crawl. */
let existingRows = [];
const pageHits = [];
const restCalls = [];

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const target = String(url);
  const method = String(opts.method || 'GET').toUpperCase();
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = null; }
  restCalls.push({ target, method, body });

  if (target.includes('/rest/v1/govt_sources') && method === 'GET') return jsonResponse(200, [GOVTJOBGURU]);
  if (target.includes('/rest/v1/govt_job_leads')) return jsonResponse(200, [{ id: 'lead-1' }]);
  if (target.includes('/rest/v1/govt_job_staging') && method === 'POST') return jsonResponse(201, []);
  if (target.includes('/rest/v1/govt_job_staging') && target.includes('payload->>source_name')) {
    return jsonResponse(200, existingRows);
  }
  if (target.includes('/rest/v1/govt_job_staging')) return jsonResponse(200, []);
  return jsonResponse(200, []);
};

const realGet = https.get;
https.get = (url, opts, cb) => {
  const req = new EventEmitter();
  const u = String(url);
  if (!u.endsWith('/robots.txt')) pageHits.push(u);

  setImmediate(() => {
    const res = new EventEmitter();
    const isRobots = u.endsWith('/robots.txt');
    res.statusCode = isRobots ? 200 : (u.includes('engineering-jobs') ? listingStatus : detailStatus);
    res.headers = {};
    cb(res);
    const payload = isRobots ? 'User-agent: *\nAllow: /\n' : (u.includes('engineering-jobs') ? LISTING : DETAIL);
    setImmediate(() => {
      if (res.statusCode === 200) res.emit('data', Buffer.from(payload));
      res.emit('end');
    });
  });

  return req;
};

const handler = require('../_api/govt-discovery.js');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = JSON.stringify(o); return this; },
    end() { return this; },
  };
}

async function runScan() {
  restCalls.length = 0;
  pageHits.length = 0;
  const res = makeRes();
  await handler({ method: 'POST', url: '/api/govt-discovery', headers: {}, query: {}, isCron: true }, res);
  return { res, payload: JSON.parse(res.body) };
}

function stagedPayloads() {
  return restCalls
    .filter(c => c.method === 'POST' && c.target.includes('/govt_job_staging'))
    .map(c => c.body && c.body.payload)
    .filter(Boolean);
}

test('the feeds\' own evidence reaches the queue, in the feeds\' own columns', async () => {
  listingStatus = 200;
  detailStatus = 200;
  const { res, payload } = await runScan();

  assert.equal(res.statusCode, 200, res.body);
  assert.ok(payload.summary.staged > 0, `expected staged rows, got ${JSON.stringify(payload.summary)}`);

  const rows = stagedPayloads();
  assert.ok(rows.length, 'the sweep must stage through govt_job_staging');

  for (const p of rows) {
    assert.equal(p.source_type, 'aggregator_lead', 'the feed stays a lead source');
    assert.equal(p.source_section, 'Engineering Jobs', 'the section the feed filed it under');
    assert.ok(['qualification', 'role', 'section'].includes(p.civil_evidence),
      `why it qualified must be recorded, got ${JSON.stringify(p.civil_evidence)}`);
    assert.ok(p.source_name === GOVTJOBGURU.name, 'the feed name must travel with the lead');
    assert.ok(p.deadline, 'the deadline shape the publisher reads must be present');
    assert.ok(Array.isArray(p.post_candidates), 'post candidates drive the publish gate');
  }

  /* The feed prints a Qualification cell on most rows and leaves some blank (Cantonment
     Board Pachmarhi genuinely states none). Blank must stay blank — the queue shows "—"
     rather than an invented value — and what the feed does print must come through. */
  const withQual = rows.filter(p => p.qualification);
  assert.ok(withQual.length >= 6, `the Qualification column must reach the queue, got ${withQual.length}/${rows.length}`);
  assert.ok(
    withQual.some(p => /Diploma\/Degree in Civil Engineering/.test(p.qualification)),
    'the PSSSB row prints its own civil qualification and it must survive'
  );
  assert.ok(rows.some(p => !p.qualification), 'a row the feed left blank must stay blank');

  /* The bug the owner hit: the aggregator's own article URL presented as the official
     notice. Whatever is staged there must be a URL the publish gate accepts, and the
     lead URL may only equal it when the feed itself linked straight at the notification
     (govtjobguru sometimes does — see the Goa Housing Board row below). */
  for (const p of rows) {
    if (p.official_notice_url) {
      assert.ok(isOfficialHost(p.official_notice_url),
        `staged notice URLs must be ones the publish gate accepts, got ${p.official_notice_url}`);
      assert.ok(!/govtjobguru\.in/.test(p.official_notice_url),
        'the aggregator host must never be staged as the official notice');
    }
    assert.ok(
      isOfficialHost(p.source_url) || p.official_notice_url !== p.source_url,
      `the lead page must not be passed off as the notice (${p.source_url})`
    );
    assert.equal(p.aggregator_url, p.source_url, 'the lead page stays on record as such');
  }

  /* One posting page was fetched (GOVT_MAX_DETAIL_FETCHES=1) and it carried a real
     notification link — that row must show it. Others already carry one because this
     feed sometimes links straight at the department's own PDF, which must be kept. */
  const notices = rows.map(p => p.official_notice_url).filter(Boolean);
  assert.ok(notices.length >= 1, 'a notice found on the posting page must be staged');
  assert.ok(notices.some(u => /sssb\.punjab\.gov\.in/.test(u)),
    `the notice link found on the posting's own page must be the one staged, got ${JSON.stringify(notices)}`);
  assert.ok(notices.every(isOfficialHost), `every staged notice must be official, got ${JSON.stringify(notices)}`);
  assert.ok(payload.results.some(r => /official_links/.test(JSON.stringify(r)) || r.official_links >= 0),
    'the run must report how many official links it found');
});

test('a notice pasted in the queue survives the next sweep, and a rejected lead stays rejected', async () => {
  listingStatus = 200;
  detailStatus = 200;
  existingRows = [];

  /* First crawl: nothing queued yet. Pick a row the feed gave no notice link for — the
     kind a reviewer has to fix by hand. */
  await runScan();
  const posted = restCalls
    .filter(c => c.method === 'POST' && c.target.includes('/govt_job_staging'))
    .map(c => c.body)
    .filter(b => b && b.payload);
  const blind = posted.find(b => !b.payload.official_notice_url);
  assert.ok(blind, 'expected at least one lead with no official link of its own');
  const key = blind.dedupe_key;
  assert.ok(key, 'every staged row carries its dedupe key');

  /* The reviewer pastes the notification from the department's own site. */
  const PASTED = 'https://goa.gov.in/wp-content/uploads/2026/09/goa-housingboard.pdf';
  existingRows = [{ dedupe_key: key, status: 'needs_info', payload: { official_notice_url: PASTED, official_site_url: 'https://goa.gov.in' } }];
  await runScan();
  const again = restCalls
    .filter(c => c.method === 'POST' && c.target.includes('/govt_job_staging'))
    .map(c => c.body)
    .find(b => b && b.dedupe_key === key);
  assert.ok(again, 'the sweep must still refresh the row it already has');
  assert.equal(again.payload.official_notice_url, PASTED,
    'the notice a human attached must not be wiped by the re-crawl');
  assert.equal(again.status, 'pending', 'and the row becomes reviewable again');

  /* A rejected lead must not come back for review every two hours. */
  existingRows = [{ dedupe_key: key, status: 'rejected', payload: {} }];
  const { payload: after } = await runScan();
  assert.ok(
    !restCalls.some(c => c.method === 'POST' && c.target.includes('/govt_job_staging') && c.body && c.body.dedupe_key === key),
    'a rejected row must not be re-staged'
  );
  assert.ok(
    (after.results || []).some(r => r.skipped_reviewed >= 1),
    `the run must report the rows it left alone, got ${JSON.stringify((after.results || []).map(r => r.skipped_reviewed))}`
  );

  existingRows = [];
});

test('a 403 that survives the retry is reported as a throttled feed, not a dead one', async () => {
  listingStatus = 403;
  detailStatus = 403;
  const { payload } = await runScan();
  listingStatus = 200;
  detailStatus = 200;

  const result = payload.results.find(r => r.source === GOVTJOBGURU.name);
  assert.ok(result, 'the source must still be reported');
  assert.ok(
    (result.errors || []).some(e => /^transient:http-403/.test(e)),
    `a throttled feed must be reported as transient, got ${JSON.stringify(result.errors)}`
  );
  assert.ok(
    pageHits.filter(u => u.includes('engineering-jobs')).length >= 2,
    `the sweep must have retried before giving up, hits: ${JSON.stringify(pageHits)}`
  );

  const patches = restCalls.filter(c => c.method === 'PATCH' && c.target.includes('/govt_sources')).map(c => c.body);
  const status = patches.map(p => String(p && p.last_status)).find(s => /^transient:http-403/.test(s));
  assert.ok(status, `the source row must record the transient block, got ${JSON.stringify(patches.map(p => p.last_status))}`);
});

test('a sweep that produces nothing at all warns the owner instead of passing silently', async () => {
  /* The way the pipeline froze before: a run answers 200 with sources: 0 or with every
     source clean and nothing parsed, and every per-source health row still reads fine. */
  assert.match(read('_api/govt-discovery.js'), /sendPipelineWarning/);
  const body = formatPipelineWarning('The sweep seeded 0 sources — the govt_sources table is empty.', {
    siteUrl: 'https://example.test',
  });
  assert.match(body, /frozen/i, 'the warning must say what happened');
  assert.match(body, /0 sources/, 'it must name the reason it was sent');
  assert.match(body, /https:\/\/example\.test\/admin/, 'it must link somewhere the owner can act');

  const src = read('_api/govt-discovery.js');
  assert.match(src, /const stalled = !seed\.seeded/, 'seeding nothing is a freeze');
  assert.match(src, /summary\.candidates === 0 && summary\.errors === 0/,
    'parsing nothing while reporting no errors is a freeze');
  assert.match(src, /stalled,\r?\n\s*warning,/, 'both signals must reach the response');
});

test('the health roll-up can go red when nothing is arriving', () => {
  const src = read('_api/govt-review.js');
  const start = src.indexOf('const STALE_RUN_HOURS');
  const end = src.indexOf('/* ── Social engine bridge');
  assert.ok(start !== -1 && end > start, 'pipelineState must stay where this test can find it');
  const { pipelineState } = new Function(`${src.slice(start, end)}\nreturn { pipelineState };`)();

  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const src1 = { enabled: true, last_run_at: hoursAgo(0.2), last_status: 'ok; candidates=5; staged=5', items_staged: 5 };

  const healthy = pipelineState([src1], { created_at: hoursAgo(0.1) });
  assert.equal(healthy.stalled, false, 'a fresh run with a fresh lead is not a freeze');
  assert.equal(healthy.staged_total, 5);

  assert.equal(pipelineState([], null).stalled, true, 'no enabled sources cannot fill the queue');
  assert.match(pipelineState([], null).reason, /No enabled sources/);

  const stale = pipelineState([{ ...src1, last_run_at: hoursAgo(9) }], { created_at: hoursAgo(0.1) });
  assert.equal(stale.stalled, true, 'a sweep that stopped firing is a freeze');
  assert.match(stale.reason, /No sweep in 9 h/);

  const noLeads = pipelineState([src1], { created_at: hoursAgo(20) });
  assert.equal(noLeads.stalled, true, 'running cleanly while producing nothing is a freeze');
  assert.match(noLeads.reason, /No new lead staged in 20 h/);

  /* And the panel must actually show it. */
  const admin = read('admin.html');
  assert.match(admin, /function govtPipelineBanner\(\)/, 'the sources panel needs a liveness banner');
  assert.match(admin, /Silent freeze/, 'the banner must say what it is');
  assert.match(admin, /govtCache\.pipeline=d\.pipeline/, 'the health response must reach the banner');
});

test('a feed URL is never shown as an official notice, in the queue or the modal', () => {
  const admin = read('admin.html');
  assert.match(admin, /function govtIsOfficialUrl\(u\)/, 'one host rule for the whole admin');
  assert.match(admin, /function govtNoticeAttachHtml\(id,p,inputId\)/, 'a row without a notice offers the paste control');
  assert.match(admin, /govtPost\('attach_notice',\{id,official_notice_url:v\}\)/,
    'the paste control must call the audited backend action');
  assert.match(admin, /govtIsOfficialUrl\(v\)\)\{toast\('That is not an official/,
    'the URL must be checked before it is sent');

  const review = read('_api/govt-review.js');
  assert.match(review, /if \(action === 'attach_notice'\)/, 'the backend must implement attach_notice');
  assert.match(review, /if \(!isOfficialHost\(notice\)\)/, 'the backend must apply the publish gate\'s host rule');
  assert.match(review, /audit\('govt_job_staging', id, 'attach_notice'/, 'attaching a notice is an audited act');
  assert.ok(
    !/official_notice_url:\s*notice,\s*\r?\n\s*official_notice_url:\s*row\.payload/.test(review),
    'the stored payload must not be overwritten by an unchecked URL'
  );
});

test('the six feeds are admin-only: the admin labels them, the public page never names them', () => {
  const config = JSON.parse(read('config/govt-sources.json'));
  const hosts = config.sources.map(s => new URL(s.url).hostname.replace(/^www\./, ''));
  assert.equal(hosts.length, 6, 'exactly the six aggregator feeds are configured');

  /* Where a lead came from is internal provenance: it belongs in the review queue, so the
     owner can judge a row, and nowhere a visitor can see it. */
  const admin = read('admin.html');
  for (const h of hosts) {
    assert.ok(admin.includes(`['${h}',`), `admin.html must label a lead that came from ${h}`);
  }

  for (const p of ['v8.js', 'app.js', 'government-jobs.html', 'govt-jobs.html', 'index.html']) {
    const src = read(p);
    for (const s of config.sources) {
      assert.ok(!src.includes(s.url), `${p} must not disclose the aggregator feed ${s.url}`);
    }
    for (const h of hosts) {
      const bare = h.replace(/^ka\./, '');
      assert.ok(!src.includes(h) && !src.includes(`'${bare}'`) && !src.includes(bare),
        `${p} must not name the aggregator ${h}`);
    }
  }
  assert.ok(!/gov-feed-strip|govtFeedSources|govtFeedChip|GOVT_FEEDS/.test(read('v8.js')),
    'the public government page must not render a feed strip or feed attribution');
  assert.ok(!/gov-feed/.test(read('styles.css')), 'the public stylesheet must not carry feed-strip styling');
});

test('the payload builder refuses anything the publish gate would reject', () => {
  const base = {
    source: { name: 'FreeJobAlert Engineering Jobs', type: 'aggregator_lead', url: 'https://www.freejobalert.com/engineering-jobs/' },
    record: { title: 'Goa Housing Board - Junior Engineer (Civil)', url: 'https://www.freejobalert.com/goa-housing-board-je/', org: 'Goa Housing Board', qualification: 'Diploma in Civil Engineering' },
    select: { keep: true, evidence: 'qualification', eligible: false },
    verdict: { civil_status: 'civil', posts: [{ post: { post_name: 'Junior Engineer (Civil)' }, outcome: 'civil', tier: 'A', score: 80, level: 'civil' }] },
  };
  assert.equal(buildPayload(base).official_notice_url, '');
  assert.equal(buildPayload({ ...base, officialNotice: 'http://goa.gov.in/advt.pdf' }).official_notice_url, '',
    'a plain-http link is not an acceptable notice');
  assert.equal(
    buildPayload({ ...base, officialNotice: 'https://www.goa.gov.in/wp-content/uploads/2026/09/goa-housingboard.pdf' }).official_notice_url,
    'https://www.goa.gov.in/wp-content/uploads/2026/09/goa-housingboard.pdf'
  );
  /* The aggregator's own domain, however official it sounds, is not an official notice. */
  assert.equal(buildPayload({ ...base, officialNotice: 'https://www.freejobalert.com/notice.pdf' }).official_notice_url, '');
});

after(() => {
  global.fetch = realFetch;
  https.get = realGet;
  delete process.env.GOVT_MAX_DETAIL_FETCHES;
});
