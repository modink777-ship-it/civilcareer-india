'use strict';
/**
 * Aggregator listing pages label every result with the same boilerplate
 * ("Apply Now", "View / Apply", "Read More") and put the real title in the URL
 * slug. stageLead classifies on the TITLE, so a page whose anchors all say
 * "Apply Now" produced no discipline signal and every civil post on it was
 * dropped as not_civil — with the crawler still reporting success.
 *
 * These helpers live inside scripts/crawl-govt-pipeline.js, which runs main()
 * on load, so they are extracted from the shipped source rather than required.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'scripts', 'crawl-govt-pipeline.js'), 'utf8');
const a = src.indexOf('function clean(s)');
const b = src.indexOf('async function fetchText');
assert.ok(a !== -1 && b > a, 'crawl-govt-pipeline.js must keep its helper block where this test can extract it');
const { candidateTitle, titleFromSlug } = new Function(
  src.slice(a, b) + '\nreturn { candidateTitle, titleFromSlug };'
)();

/* A generic anchor must yield the slug, which is where aggregators put the
   actual post name and therefore the only civil signal available. */
const CASES = [
  // [anchor text, url, expected title]
  ['Apply Now', 'https://www.karnatakacareers.org/ssc-recruitment-2026-apply-online-for-1748-junior-engineer-posts/',
    'ssc recruitment 2026 apply online for 1748 junior engineer posts'],
  ['View / Apply', 'https://allgovernmentjobs.in/goa-recruitment-2026-apply-offline-for-various-junior-engineer-posts/44605',
    'goa recruitment 2026 apply offline for various junior engineer posts'],
  ['Read More', 'https://example.org/rites-notification-2026-assistant-engineer-civil-posts/',
    'rites notification 2026 assistant engineer civil posts'],
];
for (const [anchor, url, expected] of CASES) {
  const got = candidateTitle(anchor, url);
  assert.strictEqual(got, expected, `"${anchor}" should resolve to the slug title, got "${got}"`);
  assert.ok(/engineer|civil/i.test(got), 'the recovered title must carry the discipline signal');
}

/* A trailing numeric id must not become the title. */
assert.ok(
  /junior engineer/.test(titleFromSlug('https://allgovernmentjobs.in/goa-recruitment-2026-apply-offline-for-various-junior-engineer-posts/44605')),
  'a numeric trailing segment must fall back to the preceding slug segment'
);

/* Real anchor titles must pass through untouched. Rewriting a genuine title
   would damage official sources, whose anchors are already correct. */
const KEEP = [
  ['MECON', 'https://govtjobguru.in/jobs/mecon-engineer-recruitment-2026/'],
  ['UPSSSC 134 JE Online Form 2026', 'https://www.freejobalert.com/articles/upsssc-je-recruitment-2026-apply-online-for-134-junior-engineer-avar-abhiyanta-posts-3063119'],
  ['Addl. Engineer (Civil)', 'https://example.gov.in/advt/1234.pdf'],
  ['SSC Junior Engineer 2026', 'https://ssc.gov.in/notice/je-2026'],
];
for (const [title, url] of KEEP) {
  assert.strictEqual(candidateTitle(title, url), title,
    `a real title ("${title}") must not be replaced by its slug`);
}

/* A slug too short to be a title must not be invented; keep the anchor text. */
assert.strictEqual(titleFromSlug('https://example.org/a/b/44605'), '');
assert.strictEqual(candidateTitle('Apply Now', 'https://example.org/x/7'), 'Apply Now');

/* Malformed input must never throw — this runs across every crawled page. */
for (const bad of ['', 'not-a-url', 'http://', 'https://example.org/']) {
  assert.doesNotThrow(() => titleFromSlug(bad), `titleFromSlug must not throw on ${JSON.stringify(bad)}`);
  assert.doesNotThrow(() => candidateTitle('Apply Now', bad));
}

console.log('Government crawler title tests: PASS');
