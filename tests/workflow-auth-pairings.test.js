'use strict';
/**
 * Guards the pairing between a scheduled workflow and the API route it calls.
 *
 * The failures that motivated this file were purely mismatches between the
 * credential a workflow sent and the credential the dispatcher actually
 * accepts — a Bearer OWNER_KEY sent to a CRON_ROUTE, and a JSON body key sent
 * to a route that only reads the x-owner-key header. Static checks here catch
 * that class of breakage before a run goes red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowsDir = path.join(root, '.github', 'workflows');
const dispatcher = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');

/* Comment lines describe routes and credentials too, so drop them before
   scanning: a mention in a comment is documentation, not a request. */
const stripComments = src => src.replace(/^[\t ]*#.*$/gm, '');

const workflows = fs
  .readdirSync(workflowsDir)
  .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map(f => ({ file: f, body: fs.readFileSync(path.join(workflowsDir, f), 'utf8') }))
  .map(w => ({ ...w, code: stripComments(w.body) }));

/* Routes the dispatcher unlocks ONLY with the CRON_SECRET bearer token
   (CRON_ROUTES + the ADMIN_RULES that gate them). A Supabase admin session is
   the sole alternative, which a scheduled workflow cannot hold — so these must
   be called with `Authorization: Bearer ${CRON_SECRET}`. */
const CRON_ONLY_ROUTES = ['/api/govt-discovery', '/api/exam-alerts'];

/* Routes that authenticate with the owner key as a request header. The handler
   reads `x-owner-key` (or `?key=`), never the JSON body. */
const OWNER_HEADER_ROUTES = ['/api/civil-scraper'];

test('workflow names are unique so the Actions tab is unambiguous', () => {
  const names = workflows
    .map(({ code }) => (code.match(/^name:\s*(.+)$/m) || [])[1])
    .filter(Boolean)
    .map(n => n.trim());
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(duplicates, [], `duplicate workflow names: ${duplicates.join(', ')}`);
});

test('cron-only routes are triggered with the CRON_SECRET bearer token', () => {
  for (const { file, code } of workflows) {
    const routes = CRON_ONLY_ROUTES.filter(r => code.includes(r));
    if (!routes.length) continue;
    assert.ok(
      /secrets\.CRON_SECRET/.test(code),
      `${file} calls ${routes.join(', ')} but never references secrets.CRON_SECRET`
    );
    assert.ok(
      /Authorization:\s*Bearer/.test(code),
      `${file} must send an "Authorization: Bearer" header to ${routes.join(', ')}`
    );
    assert.doesNotMatch(
      code,
      /Authorization:\s*Bearer[^\n]*OWNER_KEY/,
      `${file} must not use the owner key as the bearer token on ${routes.join(', ')} ` +
      '(requireAdmin only accepts a Supabase admin session, so it returns 401)'
    );
  }
});

test('owner-key routes authenticate with the x-owner-key header, not a body key', () => {
  for (const { file, code } of workflows) {
    const routes = OWNER_HEADER_ROUTES.filter(r => code.includes(r));
    if (!routes.length) continue;
    assert.match(
      code,
      /x-owner-key:\s*[^\n]*secrets\.OWNER_KEY/,
      `${file} must send the owner key as the x-owner-key header to ${routes.join(', ')}`
    );
  }
});

test('every endpoint a workflow calls is routed by the dispatcher', () => {
  const called = new Set();
  for (const { code } of workflows) {
    for (const m of code.matchAll(/\/api\/[a-z0-9-]+/g)) called.add(m[0]);
  }
  for (const route of called) {
    assert.ok(
      dispatcher.includes(`'${route}'`),
      `a workflow calls ${route}, but the dispatcher does not route it`
    );
  }
});
