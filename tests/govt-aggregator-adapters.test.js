'use strict';
/**
 * The five engineering aggregators do not publish a feed — they publish a table
 * per discipline or a card per posting. The generic crawler harvested every <a>
 * on those pages, where the anchor text is always "Apply Now" / "View / Apply" /
 * "Detail", so the qualification column that proves a job is civil was thrown
 * away and the whole page text (every other posting's words included) was handed
 * to the classifier. Result: the crawl reported success and staged nothing.
 *
 * lib/govt-aggregators.js reads each site's own structure instead. These tests
 * run it against the REAL markup of each site, frozen in
 * tests/fixtures/govt-aggregators (captured 2026-10-06, source URL in each file's
 * opening comment), and pin the two directions that matter:
 *   - civil postings the site published must come out, and
 *   - postings that are not civil for a civil engineer must not.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../lib/govt-aggregators');

const root = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'fixtures', 'govt-aggregators');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

/* ── routing ──────────────────────────────────────────────────────────────
   Only the configured aggregator feeds may take the structured path; every
   official govt/PSU source must keep the generic anchor harvester. */
const FEEDS = [
  ['https://govtjobguru.in/jobs-by-post/engineering-jobs/', 'govtjobguru-table'],
  ['https://www.karnatakacareers.org/qualification/civil-engineering-jobs/', 'karnatakacareers-cards'],
  ['https://linkingsky.com/government-exams/Engineers_Jobs.html', 'linkingsky-section-table'],
  ['https://allgovernmentjobs.in/civil-engineering-jobs', 'allgovernmentjobs-cards'],
  ['https://www.freejobalert.com/engineering-jobs/', 'freejobalert-qualification-tables'],
  ['https://ka.indgovtjobs.net/qualifications/engineering-government-jobs-karnataka/', 'ka-indgovtjobs-table'],
];
for (const [url, id] of FEEDS) {
  const a = M.adapterFor(url);
  assert.ok(a, `${url} must route to an adapter`);
  assert.strictEqual(a.id, id, `${url} must route to ${id}`);
}
for (const url of [
  'https://www.cpwd.gov.in/recruitment.aspx',
  'https://nhai.gov.in/nhai/taxonomy/term/248?page=0',
  'https://www.bhel.com/recruitment',
]) {
  assert.strictEqual(M.adapterFor(url), null, `${url} is an official source; it must not use an adapter`);
}
assert.strictEqual(M.adapterFor('not-a-url'), null);
assert.strictEqual(M.adapterFor(''), null);

/* ── one post per row, judged on its own words ───────────────────────────── */

/** [fixture, feed url] -> the records the adapter kept, with their verdict. */
function kept(fixture, url) {
  const adapter = M.adapterFor(url);
  const out = [];
  for (const r of adapter.extract(read(fixture), url)) {
    const select = M.selectCivil(r);
    if (!select.keep) continue;
    const verdict = M.classifyRecord(r, select);
    if (verdict.civil_status === 'not_civil' && verdict.posts[0].level === 'not_civil') continue;
    out.push({ record: r, select, level: verdict.posts[0].level, status: verdict.civil_status });
  }
  return out;
}
const titles = (list) => list.map(x => x.record.title);
const has = (list, needle) => titles(list).some(t => t.includes(needle));
const hasQualification = (list, needle) => list.some(x => String(x.record.qualification || '').includes(needle));

/* govtjobguru — one mixed engineering table, so only rows naming civil count. */
{
  const list = kept('govtjobguru-engineering-table.html', FEEDS[0][0]);
  assert.ok(has(list, 'Junior Engineer (Civil) Group C'), 'a "(Civil)" post name must be kept');
  assert.ok(has(list, 'Civil Engineer'), 'a "Civil Engineer" post name must be kept');
  assert.ok(hasQualification(list, 'Diploma/Degree in Civil Engineering'),
    'a row whose Qualification column names civil engineering must be kept');
  assert.ok(has(list, 'Foreman (Civil)'), 'civil in a multi-post list must be kept');
  assert.ok(list.length >= 6 && list.length <= 12,
    `the mixed engineering table should yield a handful of civil rows, got ${list.length}`);
  /* The negative direction: 59 of 67 rows are other branches and must not reach
     the review queue. "Assistant Electrical Engineer" is the sharp case — it is
     an engineer post that a civil graduate cannot hold. */
  assert.ok(!has(list, 'Assistant Electrical Engineer'), 'an electrical-only post must be dropped');
  assert.ok(!has(list, 'Test Engineer, Senior Research Fellow'), 'a non-civil post must be dropped');
  assert.ok(!has(list, 'RPCAU'), 'a non-civil post must be dropped');
}

/* karnatakacareers — the site's civil-qualification category, with a per-card
   Qualification row. The card often lists the branches it accepts. */
{
  const list = kept('karnatakacareers-job-cards.html', FEEDS[1][0]);
  assert.ok(has(list, 'EIL Recruitment'), 'a card whose qualification lists Civil must be kept');
  assert.ok(has(list, 'JNCASR Recruitment'), '"BE/ B.Tech in Civil Engineering" must be kept');
  assert.ok(has(list, 'SSC Recruitment'),
    'SSC JE must be kept: the site files it under civil even though the card omits the branch');
  const ssc = list.find(x => x.record.title === 'SSC Recruitment');
  assert.strictEqual(ssc.select.eligible, true, 'a category-only match must be marked as eligibility, not a civil post');
  assert.strictEqual(ssc.level, 'related', 'a category-only match is related, never direct');
  /* The override: the site tags BEL as civil, but its own qualification says
     "CSE/ ECE/ Mechanical Engineering" — the text wins over the tag. */
  assert.ok(!has(list, 'BEL Recruitment'),
    'a card that enumerates branches without civil must be dropped even inside a civil category');
}

/* linkingsky — one page, a table per discipline. Only the Civil section counts. */
{
  const adapter = M.adapterFor(FEEDS[2][0]);
  const records = adapter.extract(read('linkingsky-sections.html'), FEEDS[2][0]);
  assert.strictEqual(records.length, 23, 'the Civil (23) section has 23 rows');
  for (const r of records) assert.strictEqual(r.discipline, 'Civil');
  /* The fixture contains three sections. Chemical and CS/IT rows must not leak in. */
  const all = kept('linkingsky-sections.html', FEEDS[2][0]);
  assert.ok(has(all, 'Junior Engineer (Goa Housing Board)'), 'a Civil-section row must be kept');
  assert.ok(has(all, '1700 Group 3 Sub Engineer'), 'a Civil-section row must be kept');
  assert.ok(all.length >= 20, `the Civil section should mostly survive, got ${all.length}`);
  assert.ok(all.every(x => x.record.discipline === 'Civil'), 'no other discipline section may leak in');
  for (const leaked of ['Chemical', 'CS/IT', 'Electronics', 'Mechanical']) {
    assert.ok(!records.some(r => r.section === leaked), `${leaked} section rows must not be read from the Civil table`);
  }
}

/* allgovernmentjobs — the site's own civil category, one card per posting. */
{
  const list = kept('allgovernmentjobs-cards.html', FEEDS[3][0]);
  assert.ok(has(list, 'Junior Engineer Posts'), 'a civil-category card must be kept');
  assert.ok(has(list, 'Draftsman, Surveyor'), 'a civil-category card must be kept');
  assert.ok(!has(list, 'Bank of India'),
    'the classifier must still reject a bank even inside a civil category');
  for (const x of list) {
    assert.ok(['related', 'direct'].includes(x.level), `section-scoped records must not be graded not_civil (got ${x.level})`);
  }
}

/* freejobalert — per-state tables on an all-branch page. A row qualifies on its
   own words, or on a post name whose notification carries civil posts. */
{
  const list = kept('freejobalert-qualification-tables.html', FEEDS[4][0]);
  assert.ok(has(list, 'Junior Engineer (Civil)'), 'a row whose post names civil must be kept');
  const direct = list.find(x => x.record.title.includes('Junior Engineer (Civil)'));
  assert.strictEqual(direct.select.evidence, 'qualification');
  assert.strictEqual(direct.level, 'direct');
  assert.ok(has(list, 'Junior Engineer / Avar Abhiyanta'), 'a Junior Engineer row must be kept');
  assert.ok(!has(list, 'ISRO LPSC'), 'a Scientist/Engineer row with no civil signal must be dropped');
  assert.ok(!has(list, 'Project Engineer'), 'a software "Project Engineer" row must be dropped');
  /* The same posting repeats under several states; it must appear once. */
  const urls = list.map(x => x.record.url);
  assert.strictEqual(new Set(urls).size, urls.length, 'records must be deduped by URL');
}

/* ka.indgovtjobs.net — a mixed Karnataka board. Its latest-jobs table is read
   exactly, and the source contributes only postings that name civil engineering
   or a civil-carrying engineering role; today's ten rows are court, forest,
   agricultural and apprentice posts, so none may be staged. */
{
  const url = FEEDS[5][0];
  const records = M.adapterFor(url).extract(read('ka-indgovtjobs-jobs-table.html'), url);
  assert.strictEqual(records.length, 10, 'the latest-jobs table has ten rows');
  assert.ok(records.every(r => r.url.startsWith('https://ka.indgovtjobs.net/')),
    'every record must keep the link it was published with');
  assert.deepStrictEqual(kept('ka-indgovtjobs-jobs-table.html', url), [],
    'a mixed Karnataka board must stage nothing until a civil posting appears');
  /* …and it must pick one up the moment the site publishes it. */
  const synth = M.selectCivil({
    title: 'PWD Karnataka Junior Engineer (Civil) Recruitment 2026',
    postName: 'PWD Karnataka Junior Engineer (Civil) Recruitment 2026',
    scope: 'explicit', allowRole: true,
  });
  assert.strictEqual(synth.keep, true, 'a civil posting on this board must be staged');
  assert.strictEqual(synth.evidence, 'qualification');
}

/* ── the two rules that keep the queue precise ───────────────────────────── */

/* A branch list that omits civil overrides the source's own civil tagging. */
assert.strictEqual(M.branchListExcludesCivil('BE/ B.Tech in CSE/ ECE/ Mechanical Engineering'), true);
assert.strictEqual(M.branchListExcludesCivil('Diploma, BE/ B.Tech, Diploma'), false, 'no branches named is not an exclusion');
assert.strictEqual(M.branchListExcludesCivil('BE/ B.Tech in Civil/ Mechanical Engineering'), false);
assert.strictEqual(M.branchListExcludesCivil('B.Tech/B.E, M.Pharma, M.Sc'), false);

/* "A civil engineering degree qualifies" is kept as RELATED evidence — never as a
   claim that the post itself is a civil post, and never as tier A. */
{
  const eligible = M.classifyRecord(
    { title: 'MPESB - Sub Engineer', postName: 'Sub Engineer', section: 'civil engineering jobs', discipline: 'Civil' },
    { eligible: true }
  );
  assert.strictEqual(eligible.civil_status, 'civil');
  assert.strictEqual(eligible.posts[0].level, 'related');
  assert.strictEqual(eligible.posts[0].tier, 'B');
  assert.deepStrictEqual(eligible.posts[0].reasons, ['source_states_civil_eligible']);
}

/* ── the classifier guards the new path depends on ───────────────────────── */

const { classifyPost, classifyNotificationDetailed } = require('../lib/civil-classifier');
/* "civil" in a non-engineering sense is NOT_CIVIL. The aggregators' section text
   and headings are now fed to classifyPost, so this guard has to hold there too,
   not only in classifyCivilLevel. */
for (const title of ['Civil Servants (Pourakarmika)', 'Civil Judge', 'Civil Court Assistant', 'Civil Aviation Officer']) {
  const x = classifyPost({ post_name: title, qualification: 'Diploma in Engineering' });
  assert.strictEqual(x.outcome, 'not_civil', `${title} must never be staged as a civil engineering post`);
}
{
  const detail = classifyNotificationDetailed(
    [{ post_name: 'Civil Servants (Pourakarmika)', discipline: 'Civil', civil_eligible: true }],
    { title: 'DUDC Koppal Recruitment', organization: 'DUDC Koppal', description: 'Civil Servants (Pourakarmika) 48 posts' }
  );
  assert.strictEqual(detail.civil_status, 'not_civil',
    'aggregator section wording must not smuggle non-engineering "civil" roles into the queue');
}

/* ── official notice discovery ───────────────────────────────────────────── */

const isOfficial = (u) => {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return false;
    const h = x.hostname.toLowerCase().replace(/^www\./, '');
    return h.endsWith('.gov.in') || h.endsWith('.nic.in') || /(^|\.)(bhel\.com|ntpc\.co\.in|rites\.com|ircon\.org|aai\.aero)$/.test(h);
  } catch { return false; }
};
{
  const html = `<a href="https://twitter.com/x">Share</a>
    <a href="https://ssc.gov.in/login">Click Here</a>
    <a href="https://cdn.example.in/mirror-notification.pdf">Download</a>
    <a href="https://ssc.gov.in/notices/je-2026-notification.pdf">Download Notification PDF</a>`;
  const links = M.officialNoticeLinks(html, 'https://example.org/', isOfficial);
  assert.ok(links.length === 2, 'only official-host links are candidates');
  assert.ok(/notification\.pdf$/.test(links[0]),
    `the notification PDF is the best candidate, got ${links[0]}`);
  assert.deepStrictEqual(M.officialNoticeLinks('<p>no links</p>', 'https://example.org/', isOfficial), []);
}

/* ── the crawler must actually use this path ─────────────────────────────── */

const crawler = fs.readFileSync(path.join(root, 'scripts', 'crawl-govt-pipeline.js'), 'utf8');
assert.ok(/require\('\.\.\/lib\/govt-aggregators'\)/.test(crawler),
  'crawl-govt-pipeline.js must use the aggregator adapters');
assert.ok(/adapterFor\(source\.url\)/.test(crawler),
  'the crawler must route aggregator sources through their adapter');
assert.ok(/MAX_DETAIL_FETCHES/.test(crawler),
  'per-record detail fetches must be bounded so one feed cannot exhaust the workflow timeout');
/* The bug this replaces: a scoped record must never fall back to the LISTING
   page text, which mixes every other posting's qualification into the evidence. */
assert.ok(/structured: true/.test(crawler), 'adapter records must be marked structured');
assert.ok(/candidate\.qualification \? '' : pageText/.test(crawler),
  'the listing page must only be used for a scoped record when the adapter has no qualification');

/* ── the enabled source set IS the adapter set ────────────────────────────
   The crawl is aggregator-only: every source that is switched on must be one of
   these six feeds, must be lead-only, and must have an adapter. A seventh
   enabled source would silently take the OLD whole-page-text path, which is the
   bug this file exists to close. */
{
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config', 'govt-sources.json'), 'utf8'));
  const enabled = cfg.sources.filter(s => s.enabled);
  assert.deepStrictEqual(
    enabled.map(s => s.url).sort(),
    FEEDS.map(([url]) => url).sort(),
    'the enabled sources must be exactly the six aggregator feeds'
  );
  for (const s of enabled) {
    assert.strictEqual(s.type, 'aggregator_lead', `${s.name} must stay lead-only`);
    assert.ok(M.adapterFor(s.url), `${s.url} is enabled but has no adapter — it would use the whole-page-text path`);
  }
  /* The retired sources are gone from the config entirely — not merely switched
     off. Leaving one behind would let the seeder re-insert it on the next run,
     which would silently undo the phase 29 delete. */
  assert.strictEqual(cfg.sources.length, FEEDS.length, 'config/govt-sources.json lists only the six aggregator feeds');
  /* The database half: phase 29 must name all six and delete the rest, and it
     must not depend on the retired rows still being enabled (phase 28 disabled
     some of them, and an `and enabled` guard would leave those behind). */
  const sql = fs.readFileSync(path.join(root, 'phase29-aggregator-only-sources.sql'), 'utf8');
  for (const [url] of FEEDS) assert.ok(sql.includes(url), `phase 29 must spare ${url}`);
  assert.ok(/delete from public\.govt_sources/.test(sql), 'phase 29 must delete the retired sources');
  assert.ok(/where url not in/.test(sql), 'phase 29 must keep exactly the six feeds');
  assert.ok(!/and enabled\b/.test(sql), 'phase 29 must not skip rows that are already disabled');
  /* govt_job_leads.source_id cascades, so the raw discovery log goes with the
     source. Staging rows must survive, or the review queue would be wiped. */
  assert.ok(/set source_id = null/.test(sql), 'phase 29 must detach provenance before deleting a source');
}

console.log('Government aggregator adapter tests: PASS');
