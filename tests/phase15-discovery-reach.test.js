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

test('the removed Free Civil Job Scan leaves no dead code behind', () => {
  /* The card and its button are gone; a function that still looks the button up
     would be unreachable code, and the served bundle must match the source. */
  const bundle = fs.readFileSync(path.join(root, '_api', 'admin-page-html.js'), 'utf8');
  for (const dead of ['arRunJobScan', 'arJobScanBtn', 'arJobScanStatus', 'Free Civil Job Scan', 'panel-review-jobs']) {
    assert.doesNotMatch(admin, new RegExp(dead), 'admin.html still carries ' + dead);
    assert.doesNotMatch(bundle, new RegExp(dead), 'the served admin bundle still carries ' + dead);
  }
  /* The scanners that were KEPT must still be wired end to end. */
  assert.match(admin, /id="arExamScanBtn"/);
  assert.match(admin, /function arRunExamScan\(\)/);
  assert.match(bundle, /arExamScanBtn/);
});
