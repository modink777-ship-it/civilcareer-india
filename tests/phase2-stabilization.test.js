const test = require('node:test');
const assert = require('node:assert/strict');

const jobs = require('../api/jobs.js')._internal;

test('job list query is paginated and bounded', () => {
  const q = jobs.buildJobListQuery({ page: 3, limit: 100, sector: 'Private', state: 'Karnataka', sort: 'new' });
  assert.equal(q.page, 3);
  assert.equal(q.limit, 100);
  assert.equal(q.offset, 200);
  assert.match(q.path, /limit=100/);
  assert.match(q.path, /offset=200/);
  assert.match(q.path, /published=eq.true/);
});

test('admin job query supports server-side status and search filters', () => {
  const q = jobs.buildJobListQuery({ page: 1, limit: 50, q: 'Planning Engineer', status: 'Active', published: 'true' }, { admin: true });
  assert.match(q.path, /status=eq.Active/);
  assert.match(q.path, /published=eq.true/);
  assert.match(q.path, /role\.ilike/);
});

test('public job filters include lifecycle expiry protection', () => {
  const filters = jobs.buildJobFilters({ sector: 'Government', city: 'Bengaluru' });
  assert.ok(filters.some(x => x === 'published=eq.true'));
  assert.ok(filters.some(x => x.startsWith('or=(expires_at.gte.')));
  assert.ok(filters.some(x => x.startsWith('city=ilike.')));
});

test('JobPosting omits salary when the unit is not supported by source data', () => {
  const schema = jobs.buildJobPosting({ role: 'Civil Engineer', company: 'Example', salary_min: 500000, salary_max: 700000 }, 'https://example.com/jobs/x');
  assert.equal(schema.baseSalary, undefined);
});

test('JobPosting marks explicit annual salary as YEAR', () => {
  const schema = jobs.buildJobPosting({ role: 'Civil Engineer', company: 'Example', salary: '₹5-7 LPA', salary_min: 5, salary_max: 7 }, 'https://example.com/jobs/x');
  assert.equal(schema.baseSalary.value.unitText, 'YEAR');
  assert.equal(schema.baseSalary.value.minValue, 500000);
  assert.equal(schema.baseSalary.value.maxValue, 700000);
});
