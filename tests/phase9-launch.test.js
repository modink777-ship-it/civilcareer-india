const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

test('launch preflight passes', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/launch-check.js')], { encoding: 'utf8' });
  assert.match(out, /Launch checks: 0 error\(s\)/);
});

test('health endpoint never exposes secret values', () => {
  const code = fs.readFileSync(path.join(root, 'api/health.js'), 'utf8');
  assert.ok(code.includes('checks'));
  assert.ok(!code.includes('SUPABASE_SERVICE_ROLE_KEY: process.env'));
  assert.ok(!code.includes('OWNER_KEY: process.env'));
});

test('subscription endpoint validates input and does not leak upstream errors', () => {
  const code = fs.readFileSync(path.join(root, 'api/subscribe.js'), 'utf8');
  assert.match(code, /valid email address/i);
  assert.match(code, /Invalid alert preference/i);
  assert.match(code, /Unable to save your subscription right now/i);
  assert.doesNotMatch(code, /json\(\{ error: text \}\)/);
});

test('auth configuration is not cached', () => {
  const code = fs.readFileSync(path.join(root, 'api/auth-config.js'), 'utf8');
  assert.match(code, /Cache-Control/);
  assert.match(code, /no-store/);
});
