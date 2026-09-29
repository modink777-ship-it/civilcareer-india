/* Regression test: filter bars must not emit duplicate DOM ids.
   Run: node tests/v8-filterbar.test.js  (no dependencies) */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'v8.js'), 'utf8');

/* Extract only the functions under test (file uses top-level consts & DOM). */
function grab(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), depth = 0, end = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

/* Module-scope bindings: eval'd functions close over this scope. */
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CC_ROLES = ['Civil Engineer', 'Site Engineer'];
/* ccSelect now takes the container id as namespace prefix. */
const ccSelect = eval('(' + grab('ccSelect') + ')');
const ccActiveChipCount = eval('(' + grab('ccActiveChipCount') + ')');
const ccCityChoices = () => ['Bengaluru', 'Pune'];
const ccStateChoices = () => ['Karnataka'];
const ccRenderBar = eval('(' + grab('ccRenderBar') + ')');

/* Render twice, as the two pages (private + government) do. */
function makeBar() {
  const bar = { classList: { toggle() { } }, innerHTML: '', _selects: null };
  bar.querySelectorAll = sel => {
    if (sel !== 'select') return [];
    if (!bar._selects) {
      bar._selects = [...bar.innerHTML.matchAll(/<select id="([^"]+)" data-xf="([^"]+)"/g)]
        .map(m => ({ id: m[1], dataset: { xf: m[2] }, value: '' }));
    }
    return bar._selects;
  };
  return bar;
}
const bars = {};
const $ = id => bars[id] || (bars[id] = makeBar());
const bar1 = $('x'), bar2 = $('y');
ccRenderBar('x', {}, bar1);
ccRenderBar('y', { role: 'Site Engineer' }, bar2);
const htmlOut = bar1.innerHTML + bar2.innerHTML;

const ids = [...htmlOut.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.strictEqual(dupes.length, 0, 'duplicate ids in filter bar markup: ' + [...new Set(dupes)].join(', '));
assert.ok(ids.includes('x-role') && ids.includes('y-role'), 'expected per-bar namespaced ids (x-role, y-role), got: ' + ids.join(','));

/* data-xf must keep the logical key (on the select) so state wiring keeps working. */
const xfKeys = [...htmlOut.matchAll(/data-xf="([^"]+)"/g)].map(m => m[1]);
assert.deepStrictEqual(xfKeys.slice(0, 8), ['role', 'location', 'state', 'posted', 'experience', 'work_mode', 'employment_type', 'qualification']);
assert.ok(/<select id="x-role" data-xf="role">/.test(bar1.innerHTML), 'data-xf must sit on the select element');

/* A preset value must land on the namespaced select (state-restore path). */
const roleSel = bar2.querySelectorAll('select').find(s => s.dataset.xf === 'role');
assert.ok(roleSel && roleSel.value === 'Site Engineer', 'preset value not applied to namespaced select');

console.log('PASS v8-filterbar: bar markup has unique ids; logical keys preserved via data-xf');
