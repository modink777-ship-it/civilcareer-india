const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('app.js');
const v8 = read('v8.js');
const jobsApi = read('_api/jobs.js');
const health = read('_api/health.js');
const robots = read('robots.txt');
const sw = read('service-worker.js');

assert.ok(health.includes('503'), 'health endpoint must expose a not-ready status');
assert.ok(jobsApi.includes('summary'), 'jobs API must support summary counts');
assert.ok(jobsApi.includes('expires_at'), 'jobs API must enforce expiry-aware filtering');
assert.ok(app.includes('/api/jobs?summary=1'), 'browser must use server-side live summary counts');
assert.ok(v8.includes('fetchExplorerJobs'), 'explorer must use server-side pagination/filtering');
assert.ok(!app.includes('International') || !v8.includes('International'), 'final browser code must not reintroduce International scope');
assert.ok(robots.includes('Disallow: /admin'), 'robots must protect admin paths from crawlers');
assert.ok(robots.includes('Sitemap:'), 'robots must publish a sitemap location');
assert.ok(sw.includes('cache'), 'service worker must retain cache handling');

console.log('Phase 10 launch gate: PASS');
