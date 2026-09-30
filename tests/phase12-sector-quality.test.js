/* Phase 4 data-quality: sector classification must never label a private
   staffing/consultancy ad as Government, and genuine government signals must
   still classify as Government. Runs under `npm test`. */
const path = require('path');
const assert = require('assert');
const { classifySector, classifyJobSector } = require(path.join(__dirname, '..', 'lib', 'discovery-core.js'));

/* The 30 Sep live-data failure: these adzuna-sourced private ads were stored
   with sector='Government' and surfaced on the government page. */
const privateAds = [
  'Project Site Supervisor - Aeroteck Manpower India Private Limited Karnataka',
  'Site Coordinator / Project Coordinator at Jeena Sikho Lifecare Limited',
  'Specification Executive - Building & construction materials Live Connections Bengaluru',
  'Bid & Cost Estimation Lead Adani',
  'Land Surveyor - ACE Money Transfer',
  'BIM Manager J&F Solutions Private Limited',
];
for (const t of privateAds) {
  assert.strictEqual(classifySector(t), 'Private', 'must stay Private: ' + t);
}

/* Genuine government signals must still classify as Government. */
const govtAds = [
  'SSC JE 2026 recruitment for Junior Engineer Civil, Government of India',
  'UP PWD Junior Engineer recruitment 2026, Public Works Department',
  'NHAI Deputy Manager (Technical) recruitment',
  'Railway RRB JE Civil vacancy notice',
  'Irrigation Department, Government of Maharashtra, Assistant Engineer',
  'Karnataka Examination Authority, Public Works Department recruitment',
];
for (const t of govtAds) {
  assert.strictEqual(classifySector(t), 'Government', 'must be Government: ' + t);
}

/* Ambiguous private-company text without govt signals stays Private. */
assert.strictEqual(classifySite('Site Engineer at a construction company in Pune'), 'Private');
function classifySite(t) { return classifySector(t); }

console.log('Phase 4 sector classification tests: PASS');

/* FIX 30 Sep: private JDs use "Department: Projects / Estimation" as a section
   header, and the old classifier matched the bare token 'department'. These are
   the exact live rows that re-accumulated in Government after the first reclass. */
const headerCases = [
  ['Project Site Supervisor', 'Objective Oversee day-to-day operations. Department: Fire Protection Projects. Location: Karnataka', 'Aeroteck Manpower India Private Limited'],
  ['Lead – Design & Estimation Engineer', 'Department: Project Estimation / Design. Reporting To: Project Manager / Design Head', 'Aeroteck Manpower India Private Limited'],
  ['Site Coordinator / Project Coordinator', 'Department: Projects / Estimation. Reporting To: Project Manager / Director. Experience: 2–5 Years', 'Jeena Sikho Lifecare Limited'],
  ['Manager', 'Phoenix Mills retail estate development role in Kolkata', 'Phoenix Mills'],
  ['Land Surveyor', 'Survey and layout work for money transfer agent locations', 'ACE Money Transfer'],
  ['Senior Level', 'SJ Group engineering consultancy role', 'SJ Group'],
];
for (const [title, desc, company] of headerCases) {
  assert.strictEqual(classifyJobSector(title, desc, company), 'Private',
    'JD section-header "Department:" must stay Private: ' + company);
}

/* Employer name alone must carry the decision when it is decisive. */
assert.strictEqual(classifyJobSector('Junior Engineer', 'Applications open until further notice', 'Public Works Department, Government of Karnataka'), 'Government');
assert.strictEqual(classifyJobSector('Junior Engineer', 'Applications open until further notice', 'L&T Construction'), 'Private');

console.log('Sector JD-header regression tests: PASS');
