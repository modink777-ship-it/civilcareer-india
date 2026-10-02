const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Feature 2 page shell contains required tracker UI', () => {
  const html = read('exam-tracker.html');
  assert.match(html, /Track All Civil Engineering Exams/);
  assert.match(html, /Never miss a notification or deadline/);
  for (const label of ['All', 'GATE', 'SSC', 'RRB', 'UPSC', 'State PSC', 'PSU']) assert.ok(html.includes(label));
  assert.match(html, /My Exams/);
  assert.match(html, /data-category=/);
  assert.match(html, /data-save-exam/);
  assert.match(html, /data-alert-exam/);
  assert.match(html, /exam-tracker[.]js/);
  assert.equal((html.match(/<script(?![^>]*src=)/gi) || []).length, 0);
});

test('Feature 2 controller uses localStorage and alert endpoint', () => {
  const js = read('exam-tracker.js');
  assert.match(js, /localStorage/);
  assert.match(js, /cc_exam_tracker_saved_v1/);
  assert.match(js, /cc_exam_tracker_alerted_v1/);
  assert.match(js, /exam-alert-subscribe/);
  assert.match(js, /exam_id: alertExamId/);
  assert.ok(js.includes("replace(/\\D/g, '')"));
  assert.ok(js.includes("return /^[6-9]\\d{9}$/.test(local)"));
  for (const status of ['application_open', 'application_closed', 'result_out']) assert.ok(js.includes(status));
});

test('Feature 2 API protects mutations and returns active exams', () => {
  const js = read('_api/exam-tracker.js');
  assert.match(js, /req[.]method === 'GET'/);
  assert.match(js, /is_active=eq[.]true/);
  assert.match(js, /requireOwner/);
  assert.match(js, /req[.]method === 'PATCH' [|][|] req[.]method === 'PUT'/);
  assert.ok(js.includes('application_open'));
});

test('Feature 2 subscriber API accepts exam_id and rate limits public writes', () => {
  const js = read('_api/exam-alert-subscribe.js');
  assert.match(js, /exam_id/);
  assert.match(js, /exam_alert_subscribers/);
  assert.match(js, /Too many requests/);
  assert.match(js, /Cross-origin request blocked/);
});

test('Feature 2 dispatcher and rewrite are wired', () => {
  const dispatcher = read('api/[[...path]].js');
  assert.ok(dispatcher.includes('/api/exam-tracker'));
  assert.ok(dispatcher.includes('/api/exam-alert-subscribe'));
  const vercel = JSON.parse(read('vercel.json'));
  assert.ok(vercel.rewrites.some((x) => x.source === '/exam-tracker' && x.destination === '/exam-tracker.html'));
  const admin = read('admin.html');
  assert.ok(admin.includes('data-tab="exam-tracker"'));
  assert.ok(admin.includes('id="adminExamTracker"'));
  assert.ok(admin.includes("api('/api/exam-tracker'"));
});