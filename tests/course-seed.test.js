/* The curated course seed (config/courses-seed.json) and the pre-import
 * validator that guards it (scripts/validate-course-import.js).
 *
 * Covers:
 *  1. The committed seed file is fully importable: every item passes the
 *     API's own importItem() + directoryScope(), every URL points at the
 *     provider it claims, and there are no duplicates in the paste.
 *  2. The validator refuses exactly what the API refuses — wrong platform,
 *     non-Civil-Engineering text, a URL host that does not match the stated
 *     provider, a duplicate course URL — with the API's own reason.
 *  3. Honesty overrides are warnings, not silent passes: is_published and
 *     civil_verified in a seed are ignored by the import (and said so), and
 *     an unknown field such as `courseUrl` is reported instead of vanishing.
 *  4. The CLI exits 0 on the committed seed and 1 on a file it would reject.
 *
 * No network, no database: the validator runs the same in-process code the
 * import endpoint uses.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const root = path.join(__dirname, '..');
const { validateSeed } = require(path.join(root, 'scripts', 'validate-course-import.js'));
const validator = path.join(root, 'scripts', 'validate-course-import.js');
const seedFile = path.join(root, 'config', 'courses-seed.json');

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [validator, ...args], { encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || '') + String(e.stderr || '') };
  }
}

test('the committed seed validates clean', () => {
  const doc = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const report = validateSeed(doc);

  assert.deepStrictEqual(report.fatal, [], `file errors: ${report.fatal.join('; ')}`);
  assert.deepStrictEqual(report.rejected, [], 'no seed row may be refused by the import');
  assert.strictEqual(report.importable.length, report.items, 'every item imports');
  assert.ok(report.items >= 40, `seed has ${report.items} items; the catalogue needs at least 40`);

  /* The seed's own metadata tells the owner how it was built. */
  assert.ok(doc._meta && doc._meta.generated, 'seed carries provenance metadata');
  assert.ok(Array.isArray(doc.items));

  /* Classification must actually spread across the directory's filters —
     a seed where everything lands in one specialization would make the
     landing pages pointless. */
  const specs = Object.keys(report.specializations);
  assert.ok(specs.length >= 8, `only ${specs.length} specializations covered: ${specs.join(', ')}`);
});

test('the validator refuses exactly what the API refuses', () => {
  const report = validateSeed({
    items: [
      // not Civil Engineering
      { title: 'Advanced Excel for Marketing Professionals', provider: 'Udemy', course_url: 'https://www.udemy.com/course/excel-for-marketing/' },
      // platform outside the directory's scope
      { title: 'STAAD Pro structural design', provider: 'Pearson', course_url: 'https://www.udemy.com/course/staad-pearson/' },
      // claims Udemy but links to Coursera
      { title: 'STAAD Pro structural design', provider: 'Udemy', course_url: 'https://www.coursera.org/learn/staad-pro-structural-design' },
      // same course twice (campaign parameters differ)
      { title: 'STAAD Pro structural design fundamentals', provider: 'Udemy', course_url: 'https://www.udemy.com/course/staad-fundamentals/' },
      { title: 'STAAD Pro structural design fundamentals (sale)', provider: 'Udemy', course_url: 'https://www.udemy.com/course/staad-fundamentals/?utm_source=newsletter' },
      // missing title
      { title: '', provider: 'Udemy', course_url: 'https://www.udemy.com/course/untitled/' },
    ],
  });

  /* Only the first half of the duplicate pair is a clean row — everything
     else must be refused, and the copy with campaign parameters must be
     refused as a duplicate of it. */
  assert.strictEqual(report.importable.length, 1, `importable: ${JSON.stringify(report.importable, null, 2)}`);
  assert.strictEqual(report.importable[0].index, 3);
  assert.strictEqual(report.rejected.length, 5, `rejections: ${JSON.stringify(report.rejected, null, 2)}`);
  const reasons = report.rejected.map((r) => r.reason).join('\n');
  assert.match(reasons, /not a Civil Engineering course/);
  assert.match(reasons, /provider must be Udemy or Coursera/);
  assert.match(reasons, /course_url host does not match provider Udemy/);
  assert.match(reasons, /duplicate of item 3/);
  assert.match(reasons, /title is required/);
});

test('honesty overrides warn instead of passing silently', () => {
  const report = validateSeed({
    items: [{
      title: 'STAAD Pro structural design for site engineers',
      provider: 'Udemy',
      course_url: 'https://www.udemy.com/course/staad-site-engineers/',
      is_published: true,
      civil_verified: true,
      courseUrl: 'https://typo.example',
    }],
  });

  assert.strictEqual(report.fatal.length, 0);
  assert.strictEqual(report.rejected.length, 0, 'the row itself is importable');
  assert.strictEqual(report.importable.length, 1);
  const messages = report.warnings.map((w) => w.message).join('\n');
  assert.match(messages, /is_published is forced to false/);
  assert.match(messages, /civil_verified is forced to false/);
  assert.match(messages, /unknown field "courseUrl"/);
});

test('the CLI exits 0 on the seed and 1 on a file it would reject', () => {
  const ok = runCli([seedFile]);
  assert.strictEqual(ok.status, 0, `expected clean exit:\n${ok.stdout}`);
  assert.match(ok.stdout, /Result: OK/);

  const badFile = path.join(os.tmpdir(), 'course-seed-bad.json');
  fs.writeFileSync(badFile, JSON.stringify({
    items: [{ title: 'Digital Marketing Masterclass', provider: 'Udemy', course_url: 'https://www.udemy.com/course/marketing-masterclass/' }],
  }));
  try {
    const bad = runCli([badFile]);
    assert.strictEqual(bad.status, 1, 'a refused row must fail the CLI');
    assert.match(bad.stdout, /Result: FAIL/);
  } finally {
    fs.unlinkSync(badFile);
  }
});
