const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// Duplicate direct function must be gone; discovery must be centralized.
assert.ok(!fs.existsSync(path.join(root, 'api', 'govt-discovery.js')), 'duplicate direct govt-discovery function must be removed');
const dispatch = read('api/[[...path]].js');
assert.ok(dispatch.includes("'/api/govt-discovery':"), 'central dispatcher must register govt-discovery');
assert.ok(dispatch.includes('CRON_SECRET'), 'cron authentication must use CRON_SECRET');
assert.ok(!dispatch.includes("/vercel-cron/i.test(req.headers['user-agent']"), 'spoofable cron User-Agent authentication must be removed');
const govt = read('_api/govt-discovery.js');
assert.ok(govt.includes('req.isCron'), 'govt discovery must accept only dispatcher-authorized cron requests');
assert.ok(!govt.includes('user-agent'), 'govt discovery must not authenticate cron by User-Agent');

// Public govt feed must require an official source URL and only exposes approved active govt rows.
const jobs = read('_api/govt-jobs.js');
assert.ok(jobs.includes('function isOfficialGovtUrl'), 'government feed must have explicit official-domain validation');
assert.ok(jobs.includes("verificationStatus:isOfficialGovtUrl(source)?'official-source':'unverified-source'"), 'government feed should expose source verification status');
assert.ok(jobs.includes('govt_jobs?status=eq.active'), 'government feed must read only active approved government rows');
assert.ok(jobs.includes('govt_job_posts'), 'government feed must use civil child-post rows');

// Key landing routes must ship route-specific server HTML metadata.
const expected = {
  '/private-jobs': 'private-jobs.html',
  '/government-jobs': 'government-jobs.html',
  '/exams': 'exams.html',
  '/study-materials': 'study-materials.html',
  '/for-you': 'for-you.html',
  '/career-paths': 'career-paths.html',
};
const vercel = JSON.parse(read('vercel.json'));
for (const [route, file] of Object.entries(expected)) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
  const r = vercel.rewrites.find(x => x.source === route);
  assert.ok(r && r.destination === `/${file}`, `${route} must rewrite to ${file}`);
  const html = read(file);
  assert.ok(/<title>[^<]+<\/title>/.test(html), `${file} needs a title`);
  assert.ok(html.includes(`<link rel="canonical" href="https://civilcareer-india-two.vercel.app${route}">`), `${file} needs a route canonical`);
}

// Stale public file is removed.
assert.ok(!fs.existsSync(path.join(root, 'next-phase.js')), 'stale next-phase.js must be removed');
assert.ok(fs.existsSync(path.join(root, 'scripts', 'scrape-govt-jobs.js')), 'scheduled govt discovery trigger must exist');
const workflow = read('.github/workflows/govt-pipeline.yml');
assert.ok(workflow.includes('scripts/crawl-govt-pipeline.js'), 'GitHub Actions must schedule the dedicated government pipeline');
assert.ok(workflow.includes('SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}'), 'government pipeline must use server-side Supabase secret');


const govtHandler = require(path.join(root, '_api', 'govt-jobs.js'));
assert.strictEqual(govtHandler.isOfficialGovtUrl('https://ssc.gov.in/notice'), true, 'official .gov.in source must be accepted');
assert.strictEqual(govtHandler.isOfficialGovtUrl('https://careers.ntpc.co.in/current-openings'), true, 'allowlisted official PSU source must be accepted');
assert.strictEqual(govtHandler.isOfficialGovtUrl('https://www.naukri.com/job-listing'), false, 'job-board source must be rejected');
assert.strictEqual(govtHandler.isOfficialGovtUrl('http://ssc.gov.in/notice'), false, 'non-HTTPS source must be rejected');

console.log('Phase 13 production integrity tests: PASS');
