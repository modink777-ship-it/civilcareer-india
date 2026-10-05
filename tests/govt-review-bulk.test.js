'use strict';
/**
 * The government review queue is where six aggregator feeds land their civil
 * leads — dozens after a single crawl. Clearing them one confirm() at a time was
 * the slowest part of publishing, so the queue gained a select-all bar with
 * Publish / Needs Info / Reject for the whole selection.
 *
 * Two behaviours matter and neither is visible from a string match:
 *   1. the renderer must emit the bar AND one checkbox per row, or "select all"
 *      silently selects nothing;
 *   2. a bulk run must CONTINUE past a failure. Publishing an aggregator lead is
 *      refused unless a real official notice URL was found (spec §7), so the
 *      first item of a selection can legitimately fail — aborting there would
 *      leave the rest of the queue untouched while reporting success.
 *
 * admin.html is browser code, so the functions are extracted from the shipped
 * file and driven with stubs — the same approach as the source-health label test.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

function extract(header, endMarker) {
  const start = src.indexOf(header);
  assert.ok(start !== -1, `admin.html must define ${header}`);
  const marker = src.indexOf(endMarker, start);
  assert.ok(marker !== -1, `${header} must keep its ${JSON.stringify(endMarker)} anchor where this test can find it`);
  const end = src.indexOf('\n}', marker) + 2;
  return src.slice(start, end);
}
const escSrc = (src.match(/function govtEsc\(s\)\{[^\n]*\}/) || [])[0];
assert.ok(escSrc, 'admin.html must still define govtEsc');

/* ── the renderer ───────────────────────────────────────────────────────── */

const rendererSrc = extract('function govtRenderReview(){', "}).join('');");
const cache = {
  review: [
    { id: 'aaa', status: 'pending', civil_status: 'civil', tier: 'A', payload: { title: 'PWD Junior Engineer (Civil)', organization: 'PWD', qualification: 'Diploma in Civil Engineering', civil_evidence: 'qualification' } },
    { id: 'bbb', status: 'needs_info', civil_status: 'multi_incl_civil', tier: 'B', payload: { title: 'MPESB Sub Engineer', organization: 'MPESB', civil_evidence: 'section', source_section: 'Civil (23)' } },
  ],
};
let container = { innerHTML: '' };
const $stub = (id) => { assert.strictEqual(id, 'govtListReview'); return container; };
const govtRenderReview = new Function('govtEsc', 'govtCache', '$', `${escSrc}\n${rendererSrc}\nreturn govtRenderReview;`)(null, cache, $stub);
/* govtEsc is only used for escaping in the real page; keep a faithful stub so the
   markup assertions below are about structure, not escaping. */
const govtRenderReviewEsc = new Function('govtEsc', 'govtCache', '$', `${escSrc}\n${rendererSrc}\nreturn govtRenderReview;`)(
  (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  cache, $stub
);
govtRenderReviewEsc();
const html = container.innerHTML;

assert.ok(/admin-jobs-bulkbar/.test(html), 'the review queue must render the bulk bar');
assert.ok(/id="govtBulkAll"[^>]*onchange="govtBulkSelectAll\(this\.checked\)"/.test(html),
  '"select all" must drive govtBulkSelectAll');
assert.ok(/id="govtBulkCount"/.test(html), 'the bar must show a selected count');
for (const action of ['approve', 'needs_info', 'reject']) {
  assert.ok(new RegExp(`govtBulk\\('${action}'\\)`).test(html), `the bar must offer the ${action} action`);
}
const boxes = html.match(/class="admin-job-select govt-bulk-select" value="([^"]+)"/g) || [];
assert.strictEqual(boxes.length, cache.review.length, 'every row needs its own checkbox');
assert.ok(/value="aaa"/.test(html) && /value="bbb"/.test(html), 'each checkbox must carry its staging id');
assert.ok(/govtBulkUpdate\(\)/.test(html), 'changing a checkbox must refresh the count');
assert.ok(html.indexOf('admin-jobs-bulkbar') < html.indexOf('govt-bulk-select'),
  'the bar must come before the rows it controls');
/* An empty queue must not render a bar that selects nothing. */
const empty = { innerHTML: '' };
const renderEmpty = new Function('govtEsc', 'govtCache', '$', `${escSrc}\n${rendererSrc}\nreturn govtRenderReview;`)(
  (s) => String(s), { review: [] }, () => empty
);
renderEmpty();
assert.ok(!/govtBulkAll/.test(empty.innerHTML), 'an empty queue must not render the bulk bar');

/* ── the bulk runner ────────────────────────────────────────────────────── */

const bulkSrc = extract('async function govtBulk(action){', 'govtLoad(govtActiveTab);');
const selectedSrc = extract('function govtBulkSelected(){', 'querySelectorAll');

function runBulk(action, ids, postImpl) {
  const calls = [];
  const toasts = [];
  const selectors = [];
  const govtPost = async (route, body) => { calls.push({ route, body }); return postImpl(route, body); };
  const toast = (m) => toasts.push(m);
  const govtLoad = (tab) => { selectors.push(tab); };
  const documentStub = {
    querySelectorAll(sel) {
      if (sel === '.govt-bulk-select:checked') return ids.map(id => ({ value: id }));
      return [];
    },
  };
  const fn = new Function('document', 'govtPost', 'toast', 'govtLoad', 'govtActiveTab', 'confirm',
    `${selectedSrc}\n${bulkSrc}\nreturn govtBulk;`)(
    documentStub, govtPost, toast, govtLoad, 'review', () => true);
  return fn(action).then(() => ({ calls, toasts, selectors }));
}

(async () => {
  let r = await runBulk('approve', ['a1', 'a2', 'a3'], async () => ({ ok: true }));
  assert.deepStrictEqual(r.calls.map(c => c.route), ['approve', 'approve', 'approve']);
  assert.deepStrictEqual(r.calls.map(c => c.body.id), ['a1', 'a2', 'a3']);
  assert.deepStrictEqual(r.selectors, ['review'], 'the queue must refresh once, after the run');
  assert.ok(/3 of 3 published/.test(r.toasts.join(' ')), `success must be reported, got ${JSON.stringify(r.toasts)}`);

  /* The first item fails (aggregator lead with no official notice URL) — the
     remaining two must still be attempted, and the failure must be reported. */
  r = await runBulk('approve', ['bad', 'good1', 'good2'], async (route, body) => {
    if (body.id === 'bad') throw new Error('Official notice URL must be an official government/PSU domain');
    return { ok: true };
  });
  assert.strictEqual(r.calls.length, 3, 'a rejected item must not abort the rest of the selection');
  assert.ok(/2 of 3 published/.test(r.toasts.join(' ')), `partial success must be reported, got ${JSON.stringify(r.toasts)}`);
  assert.ok(/failed/.test(r.toasts.join(' ')), 'the failure must be surfaced, not swallowed');

  r = await runBulk('reject', ['x1'], async () => ({ ok: true }));
  assert.strictEqual(r.calls[0].route, 'reject');
  assert.ok(r.calls[0].body.reason, 'a bulk reject must record why');
  r = await runBulk('needs_info', ['x1'], async () => ({ ok: true }));
  assert.strictEqual(r.calls[0].route, 'needs_info');
  assert.ok(r.calls[0].body.notes, 'a bulk needs-info must record why');
  /* A selection action must never be guessed from user text. */
  assert.ok(!/eval\(|new Function/.test(bulkSrc), 'govtBulk must not evaluate dynamic code');

  /* Nothing selected: explain, do not fire a request. */
  r = await runBulk('approve', [], async () => ({ ok: true }));
  assert.strictEqual(r.calls.length, 0, 'an empty selection must not call the API');
  assert.ok(/Select at least one/.test(r.toasts.join(' ')), 'an empty selection must say so');

  console.log('Government review bulk-action tests: PASS');
})().catch(e => { console.error(e); process.exit(1); });
