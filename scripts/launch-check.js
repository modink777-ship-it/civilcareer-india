#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }

for (const file of ['package.json', 'vercel.json']) {
  try { JSON.parse(read(file)); } catch (e) { fail(`${file} is not valid JSON: ${e.message}`); }
}

const pkg = JSON.parse(read('package.json'));
for (const script of ['check:syntax', 'check:launch', 'test']) {
  if (!pkg.scripts || !pkg.scripts[script]) fail(`package.json is missing ${script}`);
}

const vercel = JSON.parse(read('vercel.json'));
if (!Array.isArray(vercel.headers) || !vercel.headers.length) fail('vercel.json has no security headers');
if (!Array.isArray(vercel.rewrites) || !vercel.rewrites.some((r) => r.source === '/sitemap.xml')) fail('sitemap rewrite is missing');
if (!Array.isArray(vercel.crons) || !vercel.crons.some((c) => c.path === '/api/jobs?discovery=cron')) warn('discovery cron is not declared in vercel.json');

const requiredFiles = ['api/jobs.js', 'api/account.js', 'api/health.js', 'api/sitemap.js', 'lib/security.js', 'service-worker.js'];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) fail(`required launch file missing: ${file}`);

const apiDir = path.join(root, 'api');
const jsFiles = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith('.js')) jsFiles.push(full);
  }
}
walk(apiDir);
walk(path.join(root, 'lib'));
walk(path.join(root, 'scripts'));
walk(path.join(root, 'tests'));

if (process.argv.includes('--syntax')) {
  for (const file of jsFiles) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
    catch { fail(`JavaScript syntax error: ${path.relative(root, file)}`); }
  }
}

const publicCode = [
  'index.html', 'app.js', 'v8.js', 'account.js', 'discovery-v9.js', 'cc-intelligence.js',
  'portal-v16.js', 'next-phase.js'
].filter((f) => fs.existsSync(path.join(root, f))).map(read).join('\n');
if (/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY/.test(publicCode)) fail('service-role key name appears in browser-facing code');

const envExample = read('.env.example');
for (const name of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','OWNER_KEY','SITE_URL']) {
  if (!envExample.includes(name + '=')) fail(`.env.example missing ${name}`);
}

const siteUrl = process.env.SITE_URL || '';
if (siteUrl && !/^https:\/\//i.test(siteUrl)) warn('SITE_URL should use HTTPS in production');
if (!siteUrl) warn('SITE_URL is not set in the local environment; configure it in Vercel before launch');

const robots = read('robots.txt');
if (!/Sitemap:\s*https?:\/\//i.test(robots)) fail('robots.txt does not declare an absolute sitemap URL');

const sw = read('service-worker.js');
if (!/CACHE_NAME\s*=|cache/i.test(sw)) warn('service-worker.js cache version marker was not detected');

console.log(`Launch checks: ${errors.length} error(s), ${warnings.length} warning(s)`);
for (const e of errors) console.error('ERROR:', e);
for (const w of warnings) console.warn('WARN:', w);
process.exitCode = errors.length ? 1 : 0;
