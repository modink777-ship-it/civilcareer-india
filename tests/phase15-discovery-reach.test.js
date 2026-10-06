const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const jobsSource = fs.readFileSync(path.join(root, '_api', 'jobs.js'), 'utf8');

const jobs = require(path.join(root, '_api', 'jobs.js'));

test('free discovery sources are wired into the canonical discovery pipeline', () => {
  assert.match(jobsSource, /discoveryFetchDevGlobal/);
  assert.match(jobsSource, /discoveryFetchHimalayas/);
  assert.match(jobsSource, /\['devglobal'/);
  assert.match(jobsSource, /\['himalayas'/);
  assert.equal(typeof jobs._internal.discoveryFetchDevGlobal, 'function');
  assert.equal(typeof jobs._internal.discoveryFetchHimalayas, 'function');
});

test('Exam Alerts Scanner is present in admin', () => {
  assert.match(admin, /id="arExamScanBtn"/);
  assert.match(admin, /function arRunExamScan\(\)/);
  assert.match(admin, /Exam Alerts Scanner/);
});

test('Discovery setup no longer tells the owner a paid API key is required', () => {
  assert.match(admin, /Free-first discovery is enabled/);
  assert.match(admin, /No paid API required/);
  assert.doesNotMatch(admin, /Connect a job source to get results/);
  assert.doesNotMatch(admin, /Adzuna.*Recommended.*Vercel.*Environment Variables/s);
});
