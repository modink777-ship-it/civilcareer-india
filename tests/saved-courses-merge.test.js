/* The sign-in merge: device-only ★ bookmarks must join the account's server
   list exactly once when the visitor signs in (or the page loads with a
   restored session) — without ever deleting server rows. Contract verified
   here by extracting the function from v8.js and running it against an
   api/localStorage shim. */
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const src = require('fs').readFileSync(path.join(root, 'v8.js'), 'utf8');

function extract(fnName) {
  const start = src.indexOf(`async function ${fnName}(`);
  if (start < 0) throw new Error(fnName + ' not found');
  let depth = 0;
  let i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}

function runMerge({ localStorageValue, serverIds, saveResults }) {
  const store = { cc_saved_courses: localStorageValue || '[]' };
  const calls = [];
  const token = { value: 0 };
  const sandbox = {
    api: async (url, opts) => {
      calls.push({ url, opts });
      if (String(url).includes('/api/courses?saved=1')) return { ok: true, saved_ids: serverIds, courses: [] };
      if (String(url).includes('action=save')) {
        const outcomes = saveResults || [];
        return outcomes.length ? outcomes.shift() : { ok: true };
      }
      return { ok: true };
    },
    toast: () => {},
    courseSavedSet() {
      try { return new Set(JSON.parse(store.cc_saved_courses || '[]')); } catch (_) { return new Set(); }
    },
    courseSavedPersist(set) { store.cc_saved_courses = JSON.stringify([...set]); },
  };
  /* ccSavedMergeToken is module-private in v8.js; run its closure here.
     EXTRACT WHOLE FUNCTION — the braces are the function's body, so they
     must reconstitute as `async function(...){...}`, not `return {...}`. */
  const start = src.indexOf('async function mergeSavedCoursesOnSignIn(');
  let depth = 0, end = -1, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  const whole = src.slice(start, end).replace(/\bccSavedMergeToken\b/g, '__token.value');
  const merge = new Function('__token', 'api', 'toast', 'courseSavedSet', 'courseSavedPersist',
    `"use strict"; return ${whole};`)(token, sandbox.api, sandbox.toast, sandbox.courseSavedSet, sandbox.courseSavedPersist);
  return { run: () => merge(), calls, store };
}

test('merge pushes device-only stars to the account and stores the union', async () => {
  const ctx = runMerge({ localStorageValue: '["c1","c2","c3"]', serverIds: ['c2', 'c9'] });
  await ctx.run();
  const savedCalls = ctx.calls.filter(c => String(c.url).includes('action=save'));
  assert.deepStrictEqual(savedCalls.map(c => JSON.parse(c.opts.body).id).sort(), ['c1', 'c3'],
    'exactly the device-only ids are pushed');
  const finalSet = new Set(JSON.parse(ctx.store.cc_saved_courses));
  assert.strictEqual(finalSet.size, 4, 'union of device + server, deduped');
  for (const id of ['c1', 'c2', 'c3', 'c9']) assert.ok(finalSet.has(id), id + ' present after merge');
  /* saved_ids came from the server: no unsave calls ever. */
  assert.strictEqual(ctx.calls.filter(c => String(c.url).includes('action=unsave')).length, 0,
    'a merge never deletes a server bookmark');
});

test('merge with an empty device stores the server list locally without writes', async () => {
  const ctx = runMerge({ localStorageValue: '[]', serverIds: ['c1'] });
  await ctx.run();
  assert.strictEqual(ctx.calls.filter(c => String(c.url).includes('action=save')).length, 0,
    'nothing device-only: no save calls');
  assert.strictEqual(ctx.store.cc_saved_courses, '["c1"]');
});

test('merge tolerates a failed save call without corrupting device state', async () => {
  const ctx = runMerge({ localStorageValue: '["c1"]', serverIds: [], saveResults: [{ ok: false, error: 'Sign in required.' }] });
  await ctx.run();
  assert.deepStrictEqual(JSON.parse(ctx.store.cc_saved_courses), ['c1'],
    'device state stays untouched when the push is refused');
});

test('account.js triggers the merge on sign-in and on a restored session', () => {
  const account = require('fs').readFileSync(path.join(root, 'account.js'), 'utf8');
  assert.match(account, /ccSavedMergeOnSignIn/, 'account.js must reference the merge hook');
  assert.ok(/signIn[\s\S]{0,600}?ccSavedMergeOnSignIn/.test(account), 'sign-in path triggers the merge');
  assert.ok(/DOMContentLoaded[\s\S]{0,500}?ccSavedMergeOnSignIn/.test(account), 'restored-session path triggers the merge');
});
