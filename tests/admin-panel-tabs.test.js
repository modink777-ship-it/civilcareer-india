/**
 * The admin dashboard is switched by data-tab attributes, so a tab button that
 * names a panel which does not exist renders an empty screen and nothing
 * complains — the failure is invisible in tests and obvious only to whoever
 * clicks it. These two checks pin both directions of that contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

/* Only button markup DEFINES a tab. The dashboard also looks tabs up by
   selector — document.querySelector('#tabs button[data-tab="collector"]') — so
   a bare data-tab match would count those lookups as extra tabs. */
const tabNames = () => [...admin.matchAll(/<button[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
const panelNames = () => [...admin.matchAll(/id="panel-([^"]+)"/g)].map((m) => m[1]);

test('every admin tab button resolves to a panel that exists', () => {
  const tabs = tabNames();
  assert.ok(tabs.length > 0, 'the admin dashboard must have at least one tab');
  assert.equal(new Set(tabs).size, tabs.length, 'two tabs share a name, so one of them is unreachable');
  for (const tab of tabs) {
    assert.match(admin, new RegExp('id="panel-' + tab + '"'),
      'tab "' + tab + '" has no panel, so clicking it shows an empty dashboard');
  }
});

test('only the deliberately hidden panels lack a tab button', () => {
  /* Agent Reach, Social Engine and Reviews were removed from the tab bar on
     request while their panels stayed, so the change is reversible. Any OTHER
     orphan panel is a mistake: either wire the tab or delete the markup. */
  const tabs = new Set(tabNames());
  const orphans = panelNames().filter((p) => !tabs.has(p)).sort();
  assert.deepEqual(orphans, ['agent-reach', 'reviews', 'social'],
    'unexpected panel without a tab button: add the tab, or remove the panel');
});
