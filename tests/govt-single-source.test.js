/**
 * One authoritative government source.
 *
 * The homepage used to advertise government recruitment from three different
 * numbers at once: an inline script in index.html wrote a hardcoded
 * statGovt = "0" (and raced app.js for every other tile), /api/jobs?summary=1
 * counted jobs.sector = 'Government', and /government-jobs listed the
 * human-reviewed govt_jobs pipeline. The first two describe a table that is not
 * a government register at all — the same column that made
 * scripts/fix-mislabeled-sectors.js necessary, where adzuna and staffing ads
 * had been flagged "Government".
 *
 * Live evidence, 8 Oct 2026: the homepage rendered "1" active civil jobs and
 * "0" government jobs above a database of 765 and a reviewed feed of 3 — with
 * the government section simultaneously empty and showing a permanent
 * "recruitment is being added" placeholder underneath.
 *
 * These checks pin the replacement contract: every public government surface
 * reads /api/govt-jobs, the jobs summary cannot publish a rival count, and a
 * failed read is never rendered as an empty database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const indexHtml = read('index.html');
const app = read('app.js');
const intelligence = read('cc-intelligence.js');
const jobsApi = read('_api/jobs.js');
const govtApi = read('_api/govt-jobs.js');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

test('the homepage has exactly one writer for each statistics tile', () => {
  /* One occurrence per id is the markup attribute. A second occurrence means
     an inline script is writing the tile again — the bug this test exists for:
     that writer hardcoded statGovt to "0" and lost or won the race at random. */
  for (const id of ['statJobs', 'statGovt', 'statExams', 'statRes']) {
    const hits = (indexHtml.match(new RegExp(id, 'g')) || []).length;
    assert.equal(hits, 1, `index.html must only contain the markup for ${id}, found ${hits}`);
  }
  assert.ok(!/loadStats/.test(indexHtml), 'index.html must not ship a second statistics loader');
  assert.ok(!/700\+/.test(indexHtml), 'index.html must not fall back to an invented jobs figure');
});

test('the homepage government section and tile come from the reviewed feed', () => {
  assert.match(app, /api\/govt-jobs\?limit=3&page=1'/,
    'loadData() must read the reviewed government feed for the whole site');

  /* One assignment, in loadData(): {ok:true,jobs,total} or {ok:false}. */
  const writes = app.match(/window\.__ccGovtFeed\s*=/g) || [];
  assert.equal(writes.length, 1, 'the government feed must be stored exactly once');

  assert.match(app, /renderHomeGovernment\(\)/, 'the homepage section must render from that feed');
  assert.ok(!app.includes('jobs.filter(j=>isGovJob(j)&&live(j))'),
    'the homepage must not build a government section from the jobs page slice');

  /* Government never comes from the jobs table again. The one place the jobs
     summary's old `government` field may still be read is the deploy-skew
     total, where it is added to `private` exactly as it was before the rename. */
  assert.ok(!/Number\.isFinite\(Number\(summary\.government\)\)\?Number\(summary\.government\)/.test(app),
    'the government count must not be read from the jobs summary');
  assert.ok(!/const govt=[^;]*summary\.government/.test(app),
    'liveCounts() must take the government count from the reviewed feed');
  const totalExpr = app.slice(app.indexOf('const serverTotal='), app.indexOf('const total=serverTotal'));
  assert.ok(totalExpr.length > 0, 'liveCounts() must keep a server total path this test can inspect');
  assert.match(totalExpr, /\?Number\(summary\.private\)\+Number\(summary\.government\):null/,
    'the legacy field is only the pre-rename total, added to private as it was then');
  assert.ok(!/summary\.government/.test(app.replace(totalExpr, '')),
    'no other line of the client may read the jobs summary\'s government field');
  assert.ok(!/liveCounts\(\)[\s\S]{0,400}isGovJob/.test(app),
    'liveCounts() must not fall back to counting sector-flagged jobs');

  /* Which endpoint failed decides which tile degrades. */
  assert.match(app, /statGovt:!!\(g&&!g\.ok\)/,
    'statGovt must become unavailable when the government feed fails, not when jobs fail');

  /* Availability is checked before the value. The other order skips straight
     past a null and leaves a failed read displaying a stale number — which is
     how a zero survived on the tile while the feed was unreachable. */
  assert.match(app, /const setStat=\(id,val\)=>\{if\(statUnavailable\(id\)\)return;if\(val==null\)return;/,
    'setStat must evaluate availability before deciding whether it has a value');
});

test('a failed government read is not rendered as an empty database', () => {
  const fn = app.slice(app.indexOf('function renderHomeGovernment()'), app.indexOf('/* CANONICAL PRIVATE JOBS'));
  assert.ok(fn.includes('Unable to load government jobs'),
    'the failure path must say the request failed');
  assert.ok(/This is a failed request, not an empty list/.test(fn),
    'and must explicitly rule out the empty case');
  assert.match(fn, /feed\.ok/, 'the success and failure paths must be distinguished');
  assert.ok(!/empty\('Recruitment updates are being added'/.test(app),
    'the old placeholder claimed recruitment was "being added" whether or not it existed');
});

test('the jobs summary cannot publish a rival government count', async () => {
  const jobs = require(path.join(root, '_api', 'jobs.js'));
  const realFetch = global.fetch;
  const seen = [];
  /* The three counts are distinguishable by the value they filter on. */
  global.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    const total = u.includes('*private*') ? 762 : u.includes('*government*') ? 3 : 765;
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-range' ? `0-0/${total}` : null) },
      text: async () => '',
      json: async () => [],
    };
  };

  const out = {};
  const res = {
    status(code) { out.code = code; return res; },
    json(body) { out.body = body; return res; },
    setHeader() { return res; },
    end() { return res; },
    send(body) { out.body = body; return res; },
  };
  try {
    await jobs({ method: 'GET', url: '/api/jobs?summary=1', query: { summary: '1' }, headers: {} }, res);
  } finally {
    global.fetch = realFetch;
  }

  assert.equal(out.code, 200, 'the summary must still answer');
  assert.equal(out.body.ok, true);
  assert.equal(out.body.private, 762, 'the private count is unchanged');
  assert.equal(out.body.total, 765, 'the cross-sector total is unchanged');
  assert.ok(!('government' in out.body),
    'no key named "government" may come from the jobs table — /api/govt-jobs owns that number');
  assert.equal(out.body.governmentSector, 3,
    'the per-sector count stays available under an internal name only');
  assert.ok(seen.length >= 3, 'all three counts are still requested');
});

test('the reviewed feed keeps the publish gate that makes it authoritative', () => {
  assert.match(govtApi, /const BASE_FILTERS = 'status=eq.active&human_reviewed=eq.true'/,
    'the government feed must list only active, human-reviewed rows');
  assert.match(govtApi, /totals: \{ notifications: total/, 'and must report the count it actually lists');
  assert.match(govtApi, /verificationStatus === 'official'/,
    'rows without an official source on record must not reach the public list');
});

test('a dynamic link is only swallowed when this document can render it', () => {
  const v8 = read('v8.js');
  const govtPage = read('government-jobs.html');

  /* The homepage government card links to /government-jobs/job/<slug>. That
     screen lives in government-jobs.html; index.html has no container for it,
     and intercepting the click there changed the URL and rendered nothing. */
  assert.ok(!/id="govtDetailPage"/.test(indexHtml),
    'the homepage has no government detail screen, so its links must navigate');
  assert.ok(/id="govtDetailPage"/.test(govtPage),
    'government-jobs.html is the document that renders a government notification');

  assert.match(v8, /function dynamicRouteHost\(path\)/, 'the router must know which screen a path needs');
  assert.match(v8, /if\(host&&!document\.getElementById\(host\)\)return;/,
    'a link whose screen is missing must be left to the browser');

  const handler = v8.slice(v8.indexOf("document.addEventListener('click'"), v8.indexOf('onpopstate = routeV8'));
  assert.ok(handler.indexOf('dynamicRouteHost') < handler.indexOf('e.preventDefault()'),
    'the screen must be checked before the default navigation is cancelled');
});

test('the career radar reports the same government count', () => {
  const fn = intelligence.slice(intelligence.indexOf('function radarData'), intelligence.indexOf('function jobBrief'));
  assert.match(fn, /window\.__ccGovtFeed/, 'the radar must use the shared reviewed count');
  assert.match(fn, /govt: govtCount/, 'the radar cell must render that count');
  assert.ok(!/govt: govt\.length/.test(fn),
    'counting the forty-row page slice reported a near-zero government figure');
});
