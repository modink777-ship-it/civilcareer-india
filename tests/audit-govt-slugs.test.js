/* scripts/audit-govt-slugs.js — the slug crawl audit.
   The script itself drives live HTTP when run; here we verify the parts
   that must be provably correct before it ever goes near the network:
   RFC-4180 parsing of the slug_export CSV, and the failure reporting
   contract (network errors look like status 0, real codes pass through). */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
assert.ok(require('fs').existsSync(path.join(root, 'scripts', 'audit-govt-slugs.js')),
  'scripts/audit-govt-slugs.js must exist');
const { parseCsv, checkUrl } = require(path.join(root, 'scripts', 'audit-govt-slugs.js'))._internal;

test('audit-govt-slugs: parses the slug_export CSV RFC-4180-tight', () => {
  const csv = 'id,slug,public_url,title,organization,state,source_status,published_at\r\n'
    + '"job-a","rrb-je-civil-2026","https://site.test/government-jobs/job/rrb-je-civil-2026","JE (Civil), ""Shift"" 2","RRB","All India","official","2026-09-01T00:00:00Z"\r\n'
    + '"job-b","nhai-deputy-manager","https://site.test/government-jobs/job/nhai-deputy-manager","Deputy Manager","NHAI","Delhi","unverified","2026-09-02T00:00:00Z"\r\n';
  const { header, rows } = parseCsv(csv);
  assert.strictEqual(header.length, 8);
  assert.strictEqual(header[0], 'id');
  /* A title with a comma and doubled quotes must not split its row. */
  assert.strictEqual(rows[0].title, 'JE (Civil), "Shift" 2');
  assert.strictEqual(rows[0].public_url, 'https://site.test/government-jobs/job/rrb-je-civil-2026');
  assert.strictEqual(rows[1].slug, 'nhai-deputy-manager');
});

test('audit-govt-slugs: a network failure reports as status 0 + not ok, HTTP codes pass through', async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async () => { throw new Error('boom'); };
    const net = await checkUrl('https://unreachable.test/x', 3000);
    assert.strictEqual(net.ok, false);
    assert.strictEqual(net.status, 0);
    assert.ok(net.error, 'the error reason must be captured');

    global.fetch = async () => ({ status: 404 });
    const gone = await checkUrl('https://site.test/government-jobs/job/gone', 3000);
    assert.strictEqual(gone.ok, false);
    assert.strictEqual(gone.status, 404);

    global.fetch = async () => ({ status: 200 });
    const live = await checkUrl('https://site.test/government-jobs/job/live', 3000);
    assert.strictEqual(live.ok, true);
    assert.strictEqual(live.status, 200);
  } finally { global.fetch = realFetch; }
});
