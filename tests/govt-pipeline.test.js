const assert = require('assert');
const { classifyPost, classifyNotification } = require('../lib/civil-classifier');

const positives = [
  ['JE (Civil)', 'Diploma in Civil Engineering'],
  ['RITES Engineering Professional', 'B.E Civil Engineering'],
  ['DGM (Structural/Buildings)', 'B.E/B.Tech Civil'],
  ['Works Engineer/Civil', 'B.E Civil'],
  ['Engineering Executive Trainee', 'Civil through GATE'],
];
for (const [title, qualification] of positives) {
  const x = classifyPost({ title, qualification, organization: 'Civil-heavy organization' });
  assert.strictEqual(x.outcome, 'civil', `${title} should be civil`);
  assert.ok(['A','B','C'].includes(x.tier), `${title} needs a tier`);
}

const negatives = [
  'Civil Judge',
  'City Civil Court Driver',
  'Civil Clerk',
  'Civil Labourer',
  'Civil Defence MTS',
  'IT Engineer',
  'Software Engineer',
  'AI Engineer',
  'Engineer (Electronics/Electrical)',
  'Marine Engineer',
  'Non-Engineering Intern',
  'Nurse',
  'Teacher',
];
for (const title of negatives) {
  const x = classifyPost({ title, qualification: 'Diploma in Engineering' });
  assert.strictEqual(x.outcome, 'not_civil', `${title} must not reach civil queue`);
}

const unknown = classifyPost({ title: 'Assistant Engineer', organization: 'Mumbai Port Authority', qualification: 'B.E/B.Tech Engineering' });
assert.strictEqual(unknown.outcome, 'discipline_unknown');
assert.strictEqual(unknown.tier, 'U');

const mixed = classifyNotification([
  { post_name: 'JE (Civil)', qualification: 'Diploma Civil' },
  { post_name: 'JE (Electrical)', qualification: 'Diploma Electrical' },
]);
assert.strictEqual(mixed.civil_status, 'multi_incl_civil');
assert.strictEqual(mixed.posts.filter(x => x.outcome === 'civil').length, 1);

console.log('Government civil classifier tests: PASS');

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase-v19-govt-pipeline.sql'), 'utf8');
assert.ok(sql.includes('govt_sources'), 'govt_sources migration must exist');
assert.ok(sql.includes('govt_job_leads'), 'govt_job_leads migration must exist');
assert.ok(sql.includes('govt_job_staging'), 'govt_job_staging migration must exist');
assert.ok(sql.includes('govt_jobs'), 'govt_jobs migration must exist');
assert.ok(sql.includes('govt_job_posts'), 'govt_job_posts migration must exist');
assert.ok(sql.includes('revoke all on table public.%I from anon, authenticated'), 'government migration must lock public table grants');
assert.ok(sql.includes('enable row level security'), 'government migration must enable RLS');

const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert.ok(!vercel.crons.some(x => x.path === '/api/govt-discovery'), 'government pipeline must not rely on a sub-daily Vercel Hobby cron');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/govt-pipeline.yml'), 'utf8');
assert.ok(workflow.includes('scripts/crawl-govt-pipeline.js'), 'GitHub Actions must run the dedicated government crawler');
