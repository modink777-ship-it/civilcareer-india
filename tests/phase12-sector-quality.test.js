/* Phase 4 data-quality: sector classification must never label a private
   staffing/consultancy ad as Government, and genuine government signals must
   still classify as Government. Runs under `npm test`. */
const path = require('path');
const assert = require('assert');
const { classifySector } = require(path.join(__dirname, '..', 'lib', 'discovery-core.js'));

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
