const assert = require('assert');
const jobs = require('../api/jobs');
const discovery = require('../lib/discovery-core');

assert.strictEqual(jobs._internal.safeSourceUrl('https://example.com/jobs/1'), true);
assert.strictEqual(jobs._internal.safeSourceUrl('http://example.com/jobs/1'), true);
assert.strictEqual(jobs._internal.safeSourceUrl('javascript:alert(1)'), false);
assert.strictEqual(jobs._internal.safeSourceUrl('http://localhost/job'), false);
assert.strictEqual(jobs._internal.safeSourceUrl('http://127.0.0.1/job'), false);
assert.strictEqual(jobs._internal.safeSourceUrl('http://192.168.1.10/job'), false);

const flags = jobs._internal.qualityFlagsForItem(
  { _source: 'hopin', company: '', description: 'Short text' },
  { rawLocation: '', city: '', state: '', country: '' },
  ''
);
assert.ok(flags.includes('missing_company'));
assert.ok(flags.includes('missing_location'));
assert.ok(flags.includes('missing_application_url'));
assert.ok(flags.includes('short_description'));
assert.ok(flags.includes('trusted_source_location_missing'));

const cleanFlags = jobs._internal.qualityFlagsForItem(
  { _source: 'onjob', company: 'Acme', description: 'A sufficiently detailed civil engineering vacancy description that gives candidates useful context about the role and employer.' },
  { rawLocation: 'Bengaluru, Karnataka, India', city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  'https://example.com/apply'
);
assert.deepStrictEqual(cleanFlags, []);

const now = Date.parse('2026-09-25T12:00:00Z');
assert.strictEqual(discovery.classifyFreshness('2026-09-25T11:00:00Z', now).bucket, 'fresh24h');
assert.strictEqual(discovery.classifyFreshness('2026-08-20T12:00:00Z', now).bucket, 'too_old');
assert.strictEqual(discovery.classifyFreshness('2026-09-25T15:00:00Z', now).bucket, 'future');

console.log('Phase 4 data quality tests passed');
