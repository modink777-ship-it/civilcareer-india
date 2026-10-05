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

test('the staged payload carries what the publish gate reads', () => {
  /* _api/govt-review.js approve() derives the published job from item.payload:
     without an official notice URL it refuses to publish. */
  const payloadSrc = discoverySrc.slice(
    discoverySrc.indexOf('payload: {', discoverySrc.indexOf('async function stageCandidate'))
  );
  for (const field of ['title', 'organization', 'official_notice_url', 'source_type']) {
    assert.ok(
      payloadSrc.slice(0, 900).includes(`${field}:`),
      `staged payload must include ${field} for approve()`
    );
  }
});

console.log('Govt staging column contract tests: PASS');
