/**
 * The admin smoke check must stay read-only and must stay in step with the
 * dashboard.
 *
 * It is the one tool that can be pointed at production and left running while
 * somebody signs in, so the properties that matter are: it can never change
 * anything, it can never probe a route the dispatcher no longer serves, and it
 * can never quietly stop covering an endpoint a tab depends on. A monitoring
 * script that silently narrows its own coverage is worse than none, so the
 * coverage contract is checked against admin.html rather than trusted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const script = read('scripts/smoke-admin-endpoints.js');
const admin = read('admin.html');
const dispatcher = read(path.join('api', '[[...path]].js'));

const routedNames = new Set([...dispatcher.matchAll(/'(?<route>\/api\/[a-z0-9-]+)'\s*:/g)].map((m) => m.groups.route));

test('it only ever sends GET, whatever the dashboard offers', () => {
  const methods = [...script.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(methods)], ['GET'],
    'the smoke check must never send a request that can change data');
  for (const bad of ['method: \'POST\'', 'method: \'PATCH\'', 'method: \'PUT\'', 'method: \'DELETE\'']) {
    assert.ok(!script.includes(bad), `found ${bad} in the smoke check`);
  }
  /* The read actions that only look like reads must be named as skipped. */
  assert.match(script, /POST \/api\/govt-discovery/, 'the discovery scan must be declared skipped, not silently absent');
  assert.match(script, /POST \/api\/jobs\?discovery=1/, 'the dashboard discovery button must be declared skipped');
});

test('every probe points at a route the dispatcher actually serves', () => {
  const paths = [...script.matchAll(/path: '(\/api\/[a-z0-9-]+)/g)].map((m) => m[1]);
  assert.ok(paths.length >= 20, `expected the full tab inventory, found ${paths.length}`);
  for (const p of paths) {
    assert.ok(routedNames.has(p), `${p} is probed but the dispatcher has no such route`);
  }
});

test('every routed endpoint the dashboard calls is covered or deliberately skipped', () => {
  const used = new Set([...admin.matchAll(/(?<route>\/api\/[a-z0-9-]+)/g)].map((m) => m.groups.route));
  assert.ok(used.size >= 20, `expected the dashboard to call many endpoints, found ${used.size}`);
  const ignored = [...used].filter((r) => routedNames.has(r) && !script.includes(r)).sort();
  assert.deepEqual(ignored, [],
    'these endpoints are wired into the dashboard but the smoke check neither probes nor names them');
});

test('the script refuses to guess when it has no credential', () => {
  assert.match(script, /process\.exit\(2\)/, 'an unauthenticated run must stop, not report "refused" as a finding');
  assert.match(script, /Set OWNER_KEY/, 'and must say what to set');
  assert.match(script, /ADMIN_ACCESS_TOKEN/, 'the session-only tabs must have a documented route to verification');
});

test('a refusal is reported by credential, not flattened into one message', () => {
  for (const cred of ['owner', 'session', 'agent-reach']) {
    assert.ok(script.includes(`credential === '${cred}'`) || script.includes(`'${cred}'`),
      `${cred} needs its own explanation so a wrong key is not mistaken for a missing session`);
  }
  assert.match(script, /needs a session instead/, 'the owner-key refusal must name both possible causes');
});
