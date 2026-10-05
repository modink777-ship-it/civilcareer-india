'use strict';
/**
 * The govt staging write path and the govt schema migrations live in different
 * files, and nothing stopped them from drifting: _api/govt-discovery.js wrote
 * `full_payload` / `relevance_tier`, columns that appear in NO migration, so
 * PostgREST answered PGRST204 for every row and /api/govt-discovery returned
 * HTTP 200 while staging 0 leads.
 *
 * This asserts the contract: every column the staging writer sends must be
 * declared by a canonical migration, and the known-phantom columns must not
 * come back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const discoverySrc = fs.readFileSync(
  path.join(root, '_api', 'govt-discovery.js'),
  'utf8'
);
const phase19 = fs.readFileSync(path.join(root, 'phase19-govt-pipeline.sql'), 'utf8');
const v28 = fs.readFileSync(path.join(root, 'govts-civil-section.sql'), 'utf8');

/* Columns declared for public.govt_job_staging by the canonical migrations. */
function stagingColumns(sql) {
  const cols = new Set();

  const create = sql.match(
    /create table if not exists public\.govt_job_staging \(([\s\S]*?)\n\);/
  );
  if (create) {
    for (const line of create[1].split(/\r?\n/)) {
      const m = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+\w/);
      if (m) cols.add(m[1]);
    }
  }

  const re = /alter table public\.govt_job_staging add column if not exists ([a-z_][a-z0-9_]*)/g;
  let m;
  while ((m = re.exec(sql))) cols.add(m[1]);

  return cols;
}

const declared = new Set([...stagingColumns(phase19), ...stagingColumns(v28)]);

/* Top-level keys of the object handed to govt_job_staging in stageCandidate. */
function writtenColumns(src) {
  const start = src.indexOf('async function stageCandidate');
  assert.notEqual(start, -1, 'stageCandidate must exist');
  const fn = src.slice(start, src.indexOf('\n}', start));

  const at = fn.indexOf('const payload = {');
  assert.notEqual(at, -1, 'stageCandidate must build a payload');

  const open = fn.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < fn.length; i += 1) {
    if (fn[i] === '{') depth += 1;
    else if (fn[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, 'payload object literal must be balanced');

  const body = fn.slice(open + 1, end);
  return [...body.matchAll(/^ {4}([a-z_][a-z0-9_]*):/gm)].map(m => m[1]);
}

const written = writtenColumns(discoverySrc);

test('stageCandidate writes at least the canonical staging columns', () => {
  assert.ok(written.length >= 5, `expected a real payload, got: ${written.join(', ')}`);
  for (const required of ['lead_id', 'status', 'dedupe_key', 'payload']) {
    assert.ok(written.includes(required), `staging writer must send ${required}`);
  }
});

test('every column the staging writer sends exists in a migration', () => {
  const phantom = written.filter(c => !declared.has(c));
  assert.deepEqual(
    phantom,
    [],
    `columns written to govt_job_staging but never created by a migration: ${phantom.join(', ')}`
  );
});

test('the phantom full_payload / relevance_tier columns stay gone', () => {
  /* `full_payload` is dead schema: the human publish gate reads item.payload,
     so a row staged there can never be published. */
  assert.deepEqual(
    written.filter(c => c === 'full_payload' || c === 'relevance_tier'),
    [],
    'stage the canonical payload / tier columns, never the phantom ones'
  );
  /* Comments may name the phantom columns when explaining why they are gone;
     only executable code counts. */
  const code = discoverySrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !code.includes('full_payload'),
    'govt-discovery must not write the non-existent full_payload column'
  );
  assert.ok(
    !code.includes('relevance_tier'),
    'govt-discovery must not write the non-existent relevance_tier column'
  );
});

/* The payload itself is built by lib/govt-lead-payload.js now. Asserting on the real
   function beats regexing a source literal: this is the object the publish gate reads. */
const { buildPayload, isOfficialHost } = require('../lib/govt-lead-payload');

const SAMPLE = {
  source: { name: 'All Government Jobs Civil Engineering', type: 'aggregator_lead', url: 'https://allgovernmentjobs.in/civil-engineering-jobs', category: 'Other' },
  record: {
    title: 'Cochin Port Trust Recruitment 2026 - Apply Online for 20 Apprentice Posts',
    url: 'https://allgovernmentjobs.in/cochin-port-trust-recruitment-2026-apply-online-for-20-apprentice-posts/44433',
    org: '',
    postName: 'Apprentice',
    qualification: '',
    vacancies: '20',
    deadlineText: '',
    section: 'civil engineering jobs',
  },
  select: { keep: true, evidence: 'section', eligible: true },
  verdict: {
    civil_status: 'civil',
    posts: [{ post: { post_name: 'Apprentice', discipline: 'Civil', qualification: 'Diploma' }, outcome: 'civil', tier: 'B', score: 62, level: 'related' }],
  },
};

test('the staged payload carries what the publish gate reads', () => {
  const payload = buildPayload(SAMPLE);
  for (const field of ['title', 'organization', 'official_notice_url', 'source_type']) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(payload, field),
      `staged payload must include ${field} for approve()`
    );
  }
  assert.equal(payload.title, SAMPLE.record.title);
  assert.equal(payload.source_type, 'aggregator_lead');
  assert.equal(payload.source_url, SAMPLE.record.url, 'the aggregator article stays the LEAD url');
});

test('the aggregator evidence the six feeds publish reaches the queue', () => {
  const payload = buildPayload(SAMPLE);
  assert.equal(payload.source_section, 'civil engineering jobs', 'the section the site filed it under');
  assert.equal(payload.civil_evidence, 'section', 'why it qualified');
  assert.equal(payload.vacancies, '20', 'the Posts column');
  assert.equal(payload.source_name, SAMPLE.source.name);
  assert.ok(Array.isArray(payload.post_candidates) && payload.post_candidates.length, 'post candidates drive the publish gate');
});

test('an aggregator URL is never staged as the official notice', () => {
  /* The bug this guards: the cron wrote official_notice_url = candidate.source_url, so
     every queued row displayed "Official notice https://allgovernmentjobs.in/..." and
     the human publish gate refused all of them. Empty means "the reviewer attaches one". */
  const withoutNotice = buildPayload(SAMPLE);
  assert.equal(withoutNotice.official_notice_url, '', 'no official link found → stage none');
  assert.notEqual(withoutNotice.official_notice_url, withoutNotice.source_url);

  const withNotice = buildPayload({
    ...SAMPLE,
    officialNotice: 'https://cochinport.gov.in/uploads/advt-apprentice-2026.pdf',
  });
  assert.equal(withNotice.official_notice_url, 'https://cochinport.gov.in/uploads/advt-apprentice-2026.pdf');
  assert.equal(withNotice.official_notice_url.startsWith('https://cochinport.gov.in'), true);

  /* Just as important: anything the gate would reject must not be staged as if verified. */
  const rejected = buildPayload({ ...SAMPLE, officialNotice: 'https://allgovernmentjobs.in/jobs/44433' });
  assert.equal(rejected.official_notice_url, '');
  assert.equal(isOfficialHost('https://allgovernmentjobs.in/jobs/44433'), false);
  assert.equal(isOfficialHost('https://rites.com/careers/advt.pdf'), true, 'the gate allows the known PSU hosts');
});

test('both writers stage through the same payload builder', () => {
  const crawlerSrc = fs.readFileSync(path.join(root, 'scripts', 'crawl-govt-pipeline.js'), 'utf8');
  for (const [name, src] of [['_api/govt-discovery.js', discoverySrc], ['scripts/crawl-govt-pipeline.js', crawlerSrc]]) {
    assert.ok(
      /require\(['"]\.\.\/lib\/govt-lead-payload['"]\)/.test(src),
      `${name} must build its staging payload with lib/govt-lead-payload`
    );
  }
});

console.log('Govt staging column contract tests: PASS');
