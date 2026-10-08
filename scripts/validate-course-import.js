#!/usr/bin/env node
/**
 * CivilCareer — validate a course seed / bulk-import JSON file BEFORE it is
 * pasted into admin → Courses (or POST /api/course-discovery?action=import).
 *
 * It runs the file through the SAME code the API uses — importItem() for the
 * per-item validation and directoryScope() for the directory's two rules
 * (provider must be Udemy/Coursera, text must classify as Civil Engineering)
 * — so a row that validates here is exactly a row the import will accept, and
 * a row rejected here is refused for the API's own reason, not a re-guess of it.
 *
 * Nothing is written anywhere: no database, no network, no admin session.
 *
 * Usage:
 *   node scripts/validate-course-import.js config/courses-seed.json
 *   node scripts/validate-course-import.js <file> --strict   # warnings fail too
 *
 * Exit codes: 0 = every item importable, 1 = a file error or a rejected row
 * (with --strict, a warning fails as well).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  importItem,
  directoryScope,
  normalizeUrl,
} = require(path.join(__dirname, '..', '_api', 'course-discovery.js'))._internal;
const { SUPPORTED_PROVIDERS, PROVIDER_ACCESS_NOTICE } = require(path.join(
  __dirname, '..', 'lib', 'course-civil.js'
));

/* Provider domains a course_url may legitimately point at. The API checks
   the provider LABEL only; a seed that says "Udemy" but links to another
   host would import fine and send students to the wrong place, so the
   pre-import check closes that gap. */
const HOST_RULES = [
  { provider: 'Udemy', host: /(^|\.)udemy\.com$/i },
  { provider: 'Coursera', host: /(^|\.)coursera\.org$/i },
];

/* Every field importItem() knows how to read. Anything else in the file is
   silently ignored by the API — reported here so a typo like `courseUrl`
   is caught before 50 rows land without links. */
const KNOWN_FIELDS = new Set([
  'title', 'provider', 'course_url', 'affiliate_url', 'description',
  'specialization', 'instructor', 'category', 'target_roles', 'career_stage',
  'price_inr', 'original_price_inr', 'rating', 'enrollment_count',
  'duration_hours', 'language', 'thumbnail_url', 'external_id', 'source',
  'is_free', 'is_published', 'civil_verified', 'is_featured', 'admin_notes',
]);

const API_MAX_ITEMS = 200; /* the import endpoint's per-call limit */

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (_) { return null; }
}

function matchesProviderHost(provider, url) {
  const rule = HOST_RULES.find((r) => r.provider === provider);
  const host = hostOf(url);
  return Boolean(rule && host && rule.host.test(host));
}

/**
 * Validate a parsed seed document.
 *
 * @param {unknown} doc  either `{ items: [...] }` (the API's exact body shape)
 *                       or a bare array of items.
 * @returns {{fatal: string[], items: number, importable: Array, rejected:
 *            Array, warnings: Array, specializations: Object}}
 */
function validateSeed(doc) {
  const fatal = [];
  let items = null;

  if (Array.isArray(doc)) items = doc;
  else if (doc && typeof doc === 'object' && Array.isArray(doc.items)) items = doc.items;
  else {
    return {
      fatal: ['file must be an array of items, or an object with an "items" array'],
      items: 0, importable: [], rejected: [], warnings: [], specializations: {},
    };
  }

  if (!items.length) fatal.push('items is empty — there is nothing to import.');
  if (items.length > API_MAX_ITEMS) {
    fatal.push(`${items.length} items — the import endpoint accepts at most ${API_MAX_ITEMS} per call. Split the file.`);
  }
  if (fatal.length) return { fatal, items: items.length, importable: [], rejected: [], warnings: [], specializations: {} };

  const importable = [];
  const rejected = [];
  const warnings = [];
  const seenUrls = new Map();
  const seenExtIds = new Map();

  items.forEach((item, index) => {
    const label = (item && item.title ? String(item.title).slice(0, 70) : '(no title)');

    /* Unknown fields: the API would drop them without a word. */
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const key of Object.keys(item)) {
        if (!KNOWN_FIELDS.has(key)) {
          warnings.push({ index, title: label, message: `unknown field "${key}" will be ignored by the import` });
        }
      }
    }

    /* Honesty flags the import overrides anyway — say so up front. */
    if (item && item.is_published === true) {
      warnings.push({ index, title: label, message: 'is_published is forced to false: every import is a draft until an admin publishes it' });
    }
    if (item && item.civil_verified === true) {
      warnings.push({ index, title: label, message: 'civil_verified is forced to false: only an admin can verify civil relevance' });
    }
    if (item && item.affiliate_url) {
      warnings.push({ index, title: label, message: 'affiliate_url is admin-owned — only add a link you are entitled to (Udemy has no affiliate programme anymore)' });
    }

    /* 1. the API's per-item validation */
    const built = importItem(item);
    if (built.error) {
      rejected.push({ index, title: label, reason: built.error });
      return;
    }
    const payload = built.payload;

    /* 2. the directory's scope gate (provider + Civil Engineering) */
    const scope = directoryScope(payload);
    if (scope.error) {
      rejected.push({ index, title: label, reason: scope.error });
      return;
    }
    payload.provider = scope.provider;
    payload.specialization = payload.specialization || scope.specialization;

    /* 3. URL host must belong to the stated provider */
    if (!matchesProviderHost(payload.provider, payload.course_url)) {
      rejected.push({
        index,
        title: label,
        reason: `course_url host does not match provider ${payload.provider} (${hostOf(payload.course_url) || 'unparseable URL'})`,
      });
      return;
    }

    /* 4. duplicates inside the file (the API dedupes against the database,
          not against the rest of the paste) */
    const normUrl = normalizeUrl(payload.course_url) || payload.course_url;
    if (seenUrls.has(normUrl)) {
      rejected.push({ index, title: label, reason: `duplicate of item ${seenUrls.get(normUrl)} (same course URL)` });
      return;
    }
    const extKey = payload.external_id ? `${payload.provider}:${payload.external_id}` : null;
    if (extKey && seenExtIds.has(extKey)) {
      rejected.push({ index, title: label, reason: `duplicate of item ${seenExtIds.get(extKey)} (same provider+external_id)` });
      return;
    }

    seenUrls.set(normUrl, index);
    if (extKey) seenExtIds.set(extKey, index);
    importable.push({ index, title: payload.title, provider: payload.provider, specialization: payload.specialization });
  });

  const specializations = {};
  for (const row of importable) {
    const key = row.specialization || '(unclassified)';
    specializations[key] = (specializations[key] || 0) + 1;
  }

  return { fatal, items: items.length, importable, rejected, warnings, specializations };
}

function printReport(file, report) {
  console.log(`Validating ${file}`);
  console.log(`  provider access: ${PROVIDER_ACCESS_NOTICE}`);
  console.log(`  items         : ${report.items}`);
  console.log(`  importable    : ${report.importable.length}`);
  console.log(`  rejected      : ${report.rejected.length}`);
  console.log(`  warnings      : ${report.warnings.length}`);

  if (report.fatal.length) {
    console.log('\nFile errors:');
    for (const f of report.fatal) console.log(`  ✗ ${f}`);
  }
  if (report.rejected.length) {
    console.log('\nRejected (the API would refuse these with the same reason):');
    for (const r of report.rejected) console.log(`  ✗ [${r.index}] ${r.title}\n      ${r.reason}`);
  }
  if (report.warnings.length) {
    console.log('\nWarnings:');
    for (const w of report.warnings) console.log(`  ! [${w.index}] ${w.title}\n      ${w.message}`);
  }
  const specs = Object.entries(report.specializations).sort((a, b) => b[1] - a[1]);
  if (specs.length) {
    console.log('\nSpecializations after classification:');
    for (const [label, n] of specs) console.log(`  ${String(n).padStart(3)}  ${label}`);
  }
}

function main(argv) {
  const args = argv.filter((a) => a !== '--strict');
  const strict = argv.includes('--strict');
  const file = args[0];
  if (!file) {
    console.error('Usage: node scripts/validate-course-import.js <seed.json> [--strict]');
    return 1;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${file}: ${e.message}`);
    return 1;
  }

  const report = validateSeed(doc);
  printReport(file, report);

  const failed = report.fatal.length > 0
    || report.rejected.length > 0
    || (strict && report.warnings.length > 0);

  console.log(`\nResult: ${failed ? 'FAIL' : 'OK'} — ${report.importable.length}/${report.items} items import as drafts (none are published until you review them in admin).`);
  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { validateSeed, matchesProviderHost, KNOWN_FIELDS, API_MAX_ITEMS };
