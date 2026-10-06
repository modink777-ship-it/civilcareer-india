'use strict';
/**
 * The admin source-health panel used to print whatever string the crawler
 * happened to store, so the owner read "source:http-404", "robots:unreachable"
 * and "error" as if they were labels — and had to know that "error" with an
 * HTTP 403 in last_error actually means the site is blocking the bot.
 *
 * govtSourceState() lives inside admin.html (browser code, not requireable),
 * so it is extracted here from the shipped file. That is deliberate: the labels
 * are only useful if they match the tokens the two writers actually store, and
 * those come from _api/govt-discovery.js (cron) and
 * scripts/crawl-govt-pipeline.js (GitHub crawler) — two different vocabularies.
 *
 * The whole point of the panel is that a dead source is visible. A status that
 * falls through to its raw token is not visible, it is a puzzle.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

const esc = src.match(/function govtEsc\(s\)\{[^\n]*\}/);
assert.ok(esc, 'admin.html must still define govtEsc');
const start = src.indexOf('function govtSourceState(s){');
assert.ok(start !== -1, 'admin.html must define govtSourceState');
const end = src.indexOf('\n}\r\n', start) + 3;
const { govtSourceState } = new Function(
  `${esc[0]}\n${src.slice(start, end)}\nreturn { govtSourceState };`
)();
assert.strictEqual(typeof govtSourceState, 'function');

/* Every token the two writers can store. Cron: _api/govt-discovery.js.
   Crawler: scripts/crawl-govt-pipeline.js. Keep this list in step with both. */
const TOKENS = [
  ['ok', 'sh-ok'],
  ['ok; candidates=4; staged=4', 'sh-ok'],
  ['ok; candidates=0; staged=0; errors=1', 'sh-ok'],
  ['not_modified', 'sh-nc'],                      // crawler: HTTP 304, a healthy no-op
  ['source:http-404', 'sh-error'],
  ['source:http-404; stopped', 'sh-error'],
  ['source:http-403', 'sh-error'],
  ['source:http-500', 'sh-error'],
  ['robots:disallowed', 'sh-error'],
  ['robots:invalid-source-url', 'sh-error'],
  ['robots_blocked', 'sh-error'],                 // crawler spelling
  ['robots:unreachable', 'sh-warn'],
  ['robots:unreachable-http-403', 'sh-warn'],
  ['robots:unavailable-4xx-403; crawl_allowed', 'sh-warn'],
  ['robots:unverified-http-500', 'sh-warn'],
  ['error', 'sh-error'],
  ['dead: HTTP 404 (retired path)', 'sh-nc'],     // phase28 repair annotation
  ['blocked: HTTP 403 to declared bot user agent', 'sh-nc'],
  // Crawler (scripts/crawl-govt-pipeline.js) now stores a transient-style token for
  // 403/429 after its own retries, matching the cron's vocabulary, so a Cloudflare-
  // protected aggregator such as ka.indgovtjobs.net shows amber ("throttled") rather
  // than red ("blocked") when it is intermittently unreachable.
  ['transient:http-403; throttled; retried; stopped', 'sh-warn'],
  ['transient:http-429; throttled; retried; stopped', 'sh-warn'],
];

for (const [token, cls] of TOKENS) {
  const st = govtSourceState({ last_status: token, last_error: null });
  assert.strictEqual(st.cls, cls, `"${token}" should render as ${cls}`);
  assert.notStrictEqual(st.label, token,
    `"${token}" leaked to the UI as a raw machine token — map it to a label`);
  assert.ok(st.label.trim().length > 0, `"${token}" must have a label`);
}

/* A source that has never run is not a failure — it is simply not run yet. */
assert.strictEqual(govtSourceState({}).label, 'not run yet');
assert.strictEqual(govtSourceState({ last_status: null }).cls, 'sh-nc');

/* The crawler stores last_status "error" and the reason separately, so the
   label has to read last_error to tell a blocked source from a broken fetch.
   Without this, UPSC showed as a generic "error" while being 403-blocked. */
const blocked = govtSourceState({
  last_status: 'error',
  last_error: 'HTTP 403 (crawl stopped for this source)',
});
assert.strictEqual(blocked.cls, 'sh-error');
assert.ok(/403/.test(blocked.label), `a 403 should be reported as blocked, got "${blocked.label}"`);
assert.ok(/blocked/i.test(blocked.label), `a 403 should say blocked, got "${blocked.label}"`);

const gone = govtSourceState({ last_status: 'error', last_error: 'HTTP 404 (crawl stopped for this source)' });
assert.ok(/gone/i.test(gone.label), `a 404 should read as gone, got "${gone.label}"`);

/* The crawler's new transient token is a throttle, not a hard block, so it should be
   amber — and a legacy row that still carries the old "error" + "HTTP 403 (...)"
   message must keep rendering red until the next successful crawl rewrites it. */
const throttled = govtSourceState({
  last_status: 'transient:http-403; throttled; retried; stopped',
  last_error: null,
});
assert.strictEqual(throttled.cls, 'sh-warn', 'the crawler transient token must render amber');
assert.ok(/throttled/i.test(throttled.label), `the crawler transient token should say throttled, got "${throttled.label}"`);
assert.ok(!/blocked/i.test(throttled.label), `the crawler transient token must not say blocked, got "${throttled.label}"`);

/* Class must always be a real bucket: an unknown class silently loses colour
   in the panel (sh-ok/sh-error/sh-warn/sh-nc are the only defined styles). */
for (const [token] of TOKENS) {
  assert.ok(['sh-ok', 'sh-error', 'sh-warn', 'sh-nc'].includes(govtSourceState({ last_status: token }).cls),
    `"${token}" produced a class the stylesheet does not define`);
}

console.log('Government source-health label tests: PASS');
