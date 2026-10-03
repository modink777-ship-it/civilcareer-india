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
const sql = fs.readFileSync(path.join(root, 'phase19-govt-pipeline.sql'), 'utf8');
assert.ok(sql.includes('govt_sources'), 'govt_sources migration must exist');
assert.ok(sql.includes('govt_job_leads'), 'govt_job_leads migration must exist');
assert.ok(sql.includes('govt_job_staging'), 'govt_job_staging migration must exist');
assert.ok(sql.includes('govt_jobs'), 'govt_jobs migration must exist');
assert.ok(sql.includes('govt_job_posts'), 'govt_job_posts migration must exist');
assert.ok(sql.includes('revoke all on table public.%I from anon, authenticated'), 'government migration must lock public table grants');
assert.ok(sql.includes('enable row level security'), 'government migration must enable RLS');

const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert.ok(!vercel.crons.some(x => x.path === '/api/govt-discovery'), 'government pipeline must not rely on a sub-daily Vercel Hobby cron');
/* The dedicated government crawler runs from GitHub Actions. The workflow
   file was renamed over time (govt-pipeline.yml → govt-discovery-daily.yml
   + govt-agent-reach.yml); accept any CURRENT spelling but require that at
   least one really drives the pipeline. */
const workflowNames = ['govt-pipeline.yml', 'govt-discovery-daily.yml', 'govt-agent-reach.yml'];
const workflows = workflowNames
  .filter(n => fs.existsSync(path.join(root, '.github/workflows', n)))
  .map(n => ({ name: n, body: fs.readFileSync(path.join(root, '.github/workflows', n), 'utf8') }));
assert.ok(workflows.length > 0, 'at least one government pipeline workflow must exist');
assert.ok(
  workflows.some(w => w.body.includes('scripts/crawl-govt-pipeline.js') || w.body.includes('/api/govt-discovery')),
  'GitHub Actions must run the dedicated government crawler'
);

/* ── v28: Government Jobs → Civil Engineering section ─────────────────── */
const v28 = fs.readFileSync(path.join(root, 'govts-civil-section.sql'), 'utf8');
assert.ok(v28.includes('human_reviewed'), 'v28 must add the human_reviewed column');
assert.ok(v28.includes('govt_jobs_publish_gate'), 'v28 must add the database publication gate');
assert.ok(v28.includes("check (status <> 'active' or human_reviewed = true)"), 'publication gate must block active rows without human review');
assert.ok(v28.includes('govt_field_provenance'), 'v28 must add field provenance');
assert.ok(v28.includes('govt_conflicts'), 'v28 must add the conflicts table');
assert.ok(v28.includes('govt_audit_log'), 'v28 must add the audit log');
assert.ok(v28.includes('govt_organizations'), 'v28 must add the organizations registry');
assert.ok(v28.includes('govt_categories'), 'v28 must add the categories registry');
assert.ok(v28.includes('govt_ai_providers'), 'v28 must add AI provider health');
assert.ok(v28.includes("inbox_kind"), 'v28 must add AI inbox kinds');

/* Classifier: direct / related / possible / not-civil levels + specializations */
const { classifyCivilLevel, classifySpecialization } = require('../lib/civil-classifier');
assert.strictEqual(classifyCivilLevel({ title: 'Junior Engineer (Civil)' }).level, 'direct');
assert.strictEqual(classifyCivilLevel({ title: 'Site Engineer', organization: 'NHAI' }).level, 'related');
assert.strictEqual(classifyCivilLevel({ title: 'Technical Officer', organization: 'Water Board' }).level, 'possible');
assert.strictEqual(classifyCivilLevel({ title: 'Civil Judge' }).level, 'not_civil');
assert.strictEqual(classifyCivilLevel({ title: 'Civil Services Prelims' }).level, 'not_civil');
assert.strictEqual(classifySpecialization({ title: 'AE (Civil) Highway Division' }), 'highway');
assert.strictEqual(classifySpecialization({ title: 'JE (Civil), Irrigation Dept' }), 'irrigation');

console.log('Government civil pipeline tests: PASS');
