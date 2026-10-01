const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'account.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const dispatcher = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
const securityLib = fs.readFileSync(path.join(root, 'lib', 'security.js'), 'utf8');
const adminPageHtml = fs.readFileSync(path.join(root, '_api', 'admin-page-html.js'), 'utf8');

 test('public bundle no longer contains admin dashboard or owner-key UI', () => {
  for (const src of [index, app]) {
    assert.doesNotMatch(src, /owner key/i);
    assert.doesNotMatch(src, /admin dashboard/i);
    assert.doesNotMatch(src, /x-owner-key/i);
  }
});

test('candidate login is password based and not OTP based', () => {
  assert.match(account, /grant_type=password/);
  assert.match(account, /normalizePhone/);
  assert.doesNotMatch(account, /signInWithOtp/);
});

test('admin page uses password login and server allowlist configuration', () => {
  assert.match(admin, /adminEmail/);
  assert.match(admin, /adminPassword/);
  assert.doesNotMatch(admin, /owner key/i);
  /* The allowlist itself lives in lib/security.js (verifyAdminToken)
     so the dispatcher and the gated admin page enforce the identical
     rule; the dispatcher delegates to it via requireAdmin. */
  assert.match(securityLib, /ADMIN_EMAIL/);
  assert.match(securityLib, /ADMIN_USER_ID/);
  assert.match(securityLib, /auth\/v1\/user/);
  assert.match(dispatcher, /verifyAdminToken/);
});

test('resource form does not contain a PDF upload', () => {
  assert.doesNotMatch(index, /name="pdf_file"/i);
});

test('admin bundle is generated from admin.html and carries the session-cookie gate wiring', () => {
  assert.match(adminPageHtml, /setAdminSessionCookie/);
  assert.match(adminPageHtml, /cc_admin_session/);
});

test('clean contact route exists and no personal Gmail remains', () => {
  assert.match(index, /data-page="contact"/);
  assert.doesNotMatch(index, /modin7174@gmail\.com/i);
});
