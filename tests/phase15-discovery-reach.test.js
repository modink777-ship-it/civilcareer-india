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

test('Agent Reach, Social Engine and Reviews are hidden from the admin panel', () => {
  /* The owner asked for a simpler dashboard. The three tabs are gone from the
     tab bar while their panels and JS stay in place, so restoring any of them
     is a one-line change and the endpoints keep working meanwhile. */
  for (const tab of ['agent-reach', 'social', 'reviews']) {
    assert.doesNotMatch(admin, new RegExp('data-tab="' + tab + '"'), tab + ' is still in the admin tab bar');
  }
  for (const panel of ['panel-agent-reach', 'panel-social', 'panel-reviews']) {
    assert.match(admin, new RegExp('id="' + panel + '"'), panel + ' markup must survive so the tab can be restored');
  }

  /* The Exam Alerts Scanner was removed outright, together with its workflow. */
  assert.doesNotMatch(admin, /arExamScanBtn|arRunExamScan|Exam Alerts Scanner/);
  assert.ok(!fs.existsSync(path.join(root, '.github', 'workflows', 'govt-agent-reach.yml')),
    'govt-agent-reach.yml must be removed alongside the scanner');
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
  /* The Exam Alerts Scanner went with the Agent Reach tab, so it must not creep
     back in either the source or the served bundle. */
  assert.doesNotMatch(admin, /arExamScanBtn|arRunExamScan/);
  assert.doesNotMatch(bundle, /arExamScanBtn|arRunExamScan/);
});
