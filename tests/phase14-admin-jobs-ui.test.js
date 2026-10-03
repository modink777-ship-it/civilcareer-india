const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jobs = fs.readFileSync(path.join(root, '_api', 'jobs.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// auth=1 is an admin list request from the dashboard. It must not short-circuit
// with {authenticated:true}; the dashboard needs the actual paginated jobs.
assert(jobs.includes("String(req.query?.auth || '') === '1'"));
assert(!jobs.includes("return res.status(200).json({ ok: true, authenticated: true });"));
assert(admin.includes("/api/jobs?page=${page}&limit=50&auth=1"));

// Employer profiles are not part of the admin jobs workflow anymore.
assert(!admin.includes('Employer verification'));
assert(!admin.includes('No employer profiles yet'));

// Candidate-facing job cards should use listing verification, not an employer-profile badge.
assert(!app.includes('Employer verified'));
assert(!app.includes('employerVerified'));

// Jobs tab exposes the requested lifecycle filters. Drafts belong to the
// Discovery → Review Jobs queue: the Jobs tab lists the live list only, so it
// has no Draft option and filters unpublished rows out before rendering.
assert(admin.includes('id="adminJobStatusFilter"'));
assert(!admin.includes('value="draft"'));
assert(admin.includes('isDraftRow'));
assert(admin.includes('value="published"'));
assert(admin.includes('value="deleted"'));
assert(admin.includes('value="needs_edit"'));
assert(jobs.includes("status: 'Deleted'"));
assert(jobs.includes("review_state: 'Deleted'"));

// Bulk delete from the Jobs tab posts { ids: [...] } and the API must accept
// the array form (single-id requests keep working).
assert(admin.includes('method:\'DELETE\',key:adminKey,body:JSON.stringify({ids})'));
assert(jobs.includes('Array.isArray(ids)'));
assert(jobs.includes('id=in.('));

console.log('Phase 14 admin jobs/employer UI tests passed');
