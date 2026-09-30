const { test } = require('node:test');
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const crawler = fs.readFileSync(path.join(root, 'scripts', 'crawl-govt-pipeline.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'govt-pipeline.yml'), 'utf8');

test('government crawler persists and sends conditional HTTP validators', () => {
  assert.match(crawler, /If-None-Match/);
  assert.match(crawler, /If-Modified-Since/);
  assert.match(crawler, /etag/);
  assert.match(crawler, /last_modified/);
});

test('government crawler stops on 403/429 and uses bounded exponential backoff', () => {
  assert.match(crawler, /HTTP 403/);
  assert.match(crawler, /HTTP 429/);
  assert.match(crawler, /2000 \* \(2 \*\* \(attempt - 1\)\)/);
});

test('government workflow is scheduled every six hours', () => {
  assert.match(workflow, /cron:\s*'0 \*\/6 \* \* \*'/);
});
