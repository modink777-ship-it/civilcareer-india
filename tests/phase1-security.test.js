const test = require('node:test');
const assert = require('node:assert/strict');

const jobs = require('../api/jobs');
const security = require('../lib/security');
const { publicJob } = jobs._internal;

const { _internal } = jobs;

test('jobs module exposes internal helpers after Phase 1 hardening', () => {
  assert.equal(typeof _internal.isExpired, 'function');
});

test('owner key comparison fails safely without configured key', () => {
  const old = process.env.OWNER_KEY;
  delete process.env.OWNER_KEY;
  assert.equal(security.ownerKeyMatches({ headers: { 'x-owner-key': 'x' } }), false);
  if (old !== undefined) process.env.OWNER_KEY = old;
});

test('expired job is rejected by lifecycle helper', () => {
  assert.equal(_internal.isExpired({ expires_at: '2000-01-01T00:00:00Z' }), true);
  assert.equal(_internal.isExpired({ expires_at: '2999-01-01T00:00:00Z' }), false);
});


test('public job projection excludes private/admin fields', () => {
  const result = publicJob({ id: '1', role: 'Site Engineer', application_email: 'hr@example.com', application_email_private: true, contact_info: 'private', status: 'Active' });
  assert.equal(result.application_email, undefined);
  assert.equal(result.contact_info, undefined);
  assert.equal(result.application_email_private, undefined);
  assert.equal(result.role, 'Site Engineer');
});
