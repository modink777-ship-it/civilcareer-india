'use strict';

/**
 * CivilCareer — COURSE directory scope (Udemy + Coursera, Civil Engineering only)
 *
 * The /courses directory is deliberately narrow at this stage:
 *
 *   Udemy + Coursera → Civil Engineering courses only → admin review →
 *   CivilCareer directory → the original provider's page
 *
 * This module is the single source for that scope:
 *
 *   classifyCourse()   — is this course Civil Engineering, and under which
 *                        specialization? Built ON TOP of
 *                        lib/civil-classifier.js (the govt-pipeline engine)
 *                        rather than next to it, so "civil engineering"
 *                        means one thing across the whole product. The
 *                        course-only vocabulary (software, exam
 *                        preparation, the course topics the directory spec
 *                        names) is added here and nothing in the govt
 *                        classifier is modified.
 *   SUPPORTED_PROVIDERS — the two platforms this directory covers today.
 *   PROVIDER_ACCESS_NOTICE / THIRD_PARTY_NOTICE — the exact sentences the
 *                        product must show. They live here so the API and
 *                        the public page cannot drift apart; a test
 *                        compares the page's rendered text to these
 *                        strings.
 *
 * Never invent course data: this module only CLASSIFIES text the provider
 * (or the admin) supplied. It never fills rating, price, instructor,
 * duration, enrolment or reviews.
 */

const {
  classifyCivilLevel,
  classifySpecialization,
} = require('./civil-classifier');

/* ── Provider scope ────────────────────────────────────────────────
   Canonical spellings used everywhere (DB rows, filters, provider
   registry). Matching is case-insensitive so an imported "udemy"
   becomes "Udemy". */
const SUPPORTED_PROVIDERS = ['Udemy', 'Coursera'];

/** Canonical provider name when `value` names a supported provider, else null. */
function canonicalProvider(value) {
  const raw = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!raw) return null;
  return SUPPORTED_PROVIDERS.find((p) => p.toLowerCase() === raw) || null;
}

/** A short factual "description" for a card: provider text only, never invented. */
function isSupportedProvider(value) {
  return canonicalProvider(value) !== null;
}

/* ── Civil Engineering course topics ───────────────────────────────
   Ordered: the first match wins, so specific software and exam
   preparation come before the generic domains and
   'Civil Engineering (general)' sits last.

   Every label here is one of the specializations the directory spec
   lists (software, exams, structural, geotechnical, transportation,
   water, environmental, surveying, materials, management). */

/* Context a topic needs before it counts. 'AutoCAD' and 'MS Project' are
   used by every branch, so on their own they are a weak connection the
   spec tells us to exclude — 'AutoCAD 2025 Complete Guide' is not a
   Civil Engineering course. 'AutoCAD for Site Engineers' is. */
const CIVIL_CONTEXT = /\bcivil\b|\bstructure|\bbuilding|\broad\b|\bhighway|\bbridge|\bmetro\b|\btunnel|\bdrainage|\bwater\b|\bsurvey|\bconstruction|\bsite\b|\bquantity\s+survey|\bgeotech|\bconcrete|\bsoil\b|\bfoundation/i;
const CAD_IN_CIVIL_CONTEXT = /\bauto\s?cad\b/i;

/* A course teaching another branch through the same tools is not ours:
   'Mechanical Engineering: AutoCAD for Machine Design'. The shared
   classifier's hard negatives catch the singular 'X engineer' spelling;
   courses mostly write 'Mechanical Engineering', which is why this
   guard exists here. A real civil marker in the same text overrides it. */
const OTHER_BRANCH = /\b(?:mechanical|electrical|electronics|chemical|instrumentation|metallurgical|marine|automobile|automotive|aerospace|aeronautical|computer\s+science|information\s+technology|mining|petroleum|agricultural)\s+(?:engineering|engineer|branch)/i;
const STRONG_CIVIL = /\bcivil\b|\brcc\b|\bis\s?456\b|\bstaad\b|\betabs\b|\bprimavera\b|\bhighway|\broad\s+design|\bgeotech|\bsoil\s+mechanic|\bfoundation|\bpile\s+design|\bhydraul|\bwater\s+resources|\bsurvey|\bquantity\s+survey|\bconstruction|\bconcrete|\bstructural\b|\brevit\b|\bbim\b/i;
const COURSE_TOPICS = [
  ['AutoCAD & Civil 3D', /\bcivil\s*3d\b/i],
  ['AutoCAD & Civil 3D', CAD_IN_CIVIL_CONTEXT],
  ['STAAD.Pro', /\bstaad(?:\.?\s?pro)?\b/i],
  ['ETABS', /\betabs\b/i],
  ['Revit & BIM', /\brevit\b|\bbim\b|building\s+information\s+modell?ing/i],
  ['Primavera P6 & MS Project', /\bprimavera\b/i],
  ['Quantity Surveying', /\bquantity\s+survey\w*|\bqs\b|bill\s+of\s+quantit\w*|\bbbs\b|bar\s+bending\s+schedule/i],
  ['Estimation & Costing', /\bestimat\w+|\bcosting\b|rate\s+analysis|take[-\s]?off|\bcost\s+manage\w*/i],
  ['RCC Design', /\brcc\b|reinforced\s+concrete|\bis\s?456\b|\bprestressed\b|\bconcrete\s+design\b/i],
  ['Steel Design', /\bsteel\s+(design|structure|connection|detailing|member)\w*|\bsteel\s+design\b|\blimit\s+state\s+design\b/i],
  ['Foundation Engineering', /\bfoundation\w*|\bpile\s+(design|foundation)\b|\braft\s+foundation\b|\bfooting\s+design\b|\bbearing\s+capacity\b/i],
  ['Soil Mechanics', /\bsoil\s+(mechanic|test|investigation|stabilis|stabiliz|classificat)\w*|\bslope\s+stability\b|\bearths?works?\b/i],
  ['Geotechnical Engineering', /\bgeotech\w*/i],
  ['Concrete Technology', /\bconcrete\s+(technolog|mix|design|testing|repair|admixture)\w*|\bready\s*mix\s+concrete\b/i],
  ['Building Materials', /\b(building|construction)\s+materials?\b|\bmaterial\s+testing\b/i],
  ['Construction Technology', /\bconstruction\s+(technolog|technique|practice|method|process|equipment|safety|quality|survey)\w*|\bbuilding\s+construction\b|\bsite\s+(engineer|supervision|management)\b/i],
  ['Construction Management', /\bconstruction\s+(manage\w*|contract\w*)\b/i],
  ['Project Planning', /\bproject\s+(plann\w*|schedul\w*|control\w*)\b|\bscheduling\b|\bwbs\b/i],
  ['Surveying', /\bsurvey(?:ing|or|s)?\b|\blevel{1,2}ing\b|\btheodolit\w*|\btotal\s+station\b|\bcontouring\b/i],
  ['Surveying & GIS', /\bgis\b|\bremote\s+sensing\b|geographic\s+information/i],
  ['Highway Engineering', /\bhighway\w*|\broad\s+(design|construction|estimating|engineer)\w*|\bpavement\w*|\bexpressway\b|\bbitumen\b|\basphalt\b|\bgeometric\s+design\b/i],
  ['Transportation & Traffic Engineering', /\btransport(?:ation)?\s+(engineer|plann|manage)\w*|\btraffic\s+(engineer|analys|plann|management)\w*|\btransportation\b/i],
  ['Hydraulics & Water Resources', /\bhydraul\w*|\bwater\s+resources?\b|\bfluid\s+mechanic\w*|\birrigation\b|\bstorm\s?water\b|\bdrainage\s+design\b|\bsewer\w*|\bwater\s+supply\b/i],
  ['Environmental Engineering', /\benvironmental\s+engineer\w*|\bwater\s+treatment\b|\bwaste\s?water\b|\bsolid\s+waste\b|\bair\s+pollution\b|\beia\b/i],
  ['Structural Engineering', /\bstructural\s+(engineer|analys|design|dynamic|software|system)\w*|\bstructures?\b|\bframe\s+analys\w*|\bseismic\b|\bearthquake\s+engineer\w*/i],
  ['Urban & Town Planning', /\b(urban|town|regional)\s+plann\w*/i],
];

/* Exam preparation: named civil-engineering examinations. The civil
   marker is required next to the acronym, because SSC/RRB/State AE-JE
   recruit for every branch — "SSC JE Mechanical" is not our course. */
const CIVIL_NEAR = (a, b) => new RegExp(`${a}[^.]{0,40}${b}|${b}[^.]{0,40}${a}`, 'i');
const EXAM_TOPICS = [
  ['GATE Civil Engineering', CIVIL_NEAR('\\bgate\\b', '\\bcivil\\b')],
  ['SSC JE Civil', CIVIL_NEAR('\\bssc\\s*[- ]?\\s*je\\b', '\\bcivil\\b')],
  ['RRB JE Civil', CIVIL_NEAR('\\brrb\\s*[- ]?\\s*je\\b', '\\bcivil\\b')],
  ['State AE/JE Civil', /\bstate\s+(ae|je)\b|\b(ae|je)\s*\(?\s*civil\s*\)?|\bjunior\s+engineer\s*\(?\s*civil|\bassistant\s+engineer\s*\(?\s*civil/i],
];

/* The last rule: the word 'civil' itself, once the hard negatives in
   lib/civil-classifier.js have removed 'civil servants', 'civil judge',
   'civil services' and friends. */
const GENERAL_CIVIL = ['Civil Engineering (general)', /\bcivil\b/i];

/* Slugs from the govt classifier's specialization vocabulary mapped to
   the directory's course labels, so a course classified by the shared
   engine lands in a filter the student can actually read. */
const SLUG_LABELS = {
  'project-construction-management': 'Construction Management',
  'quantity-surveying': 'Quantity Surveying',
  estimation: 'Estimation & Costing',
  bim: 'Revit & BIM',
  structural: 'Structural Engineering',
  bridge: 'Structural Engineering',
  highway: 'Highway Engineering',
  transportation: 'Transportation & Traffic Engineering',
  railway: 'Transportation & Traffic Engineering',
  geotechnical: 'Geotechnical Engineering',
  environmental: 'Environmental Engineering',
  surveying: 'Surveying',
  gis: 'Surveying & GIS',
  'remote-sensing': 'Surveying & GIS',
  hydraulics: 'Hydraulics & Water Resources',
  'water-resources': 'Hydraulics & Water Resources',
  irrigation: 'Hydraulics & Water Resources',
  coastal: 'Hydraulics & Water Resources',
  building: 'Building Materials',
  construction: 'Construction Technology',
  planning: 'Project Planning',
  infrastructure: 'Civil Engineering (general)',
  'urban-planning': 'Urban & Town Planning',
  'urban-infrastructure': 'Civil Engineering (general)',
  'general-civil': 'Civil Engineering (general)',
};

/** Every specialization the directory filter offers, in display order. */
const COURSE_SPECIALIZATIONS = [
  ...COURSE_TOPICS.map(([label]) => label),
  ...EXAM_TOPICS.map(([label]) => label),
  ...new Set(Object.values(SLUG_LABELS)),
  GENERAL_CIVIL[0],
].filter((label, i, all) => all.indexOf(label) === i);

function clean(value, max = 2000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** True when `value` is one of the directory's specialization labels. */
function normalizeSpecialization(value) {
  const raw = clean(value, 80).toLowerCase();
  if (!raw) return null;
  return COURSE_SPECIALIZATIONS.find((s) => s.toLowerCase() === raw) || null;
}

function haystack(row) {
  return [row && row.title, row && row.description, row && row.category]
    .filter(Boolean).join(' ');
}

/**
 * Classify one course row.
 *
 *   { civil, specialization, level, reasons }
 *
 * `civil` is the directory's gate: only true when the text (or an
 * explicit admin classification) shows a Civil Engineering topic.
 * Anything unrecognised is NOT civil — the spec forbids listing courses
 * with only a weak or indirect connection, and a wrong listing is worse
 * than a missing one. The admin can always classify a course by hand in
 * the Courses tab, which is exactly what `civil_verified` records.
 */
function classifyCourse(row) {
  const given = normalizeSpecialization(row && row.specialization);
  if (given) {
    return { civil: true, specialization: given, level: 'direct', reasons: ['admin_classification'] };
  }

  const text = haystack(row);
  if (!text) {
    return { civil: false, specialization: null, level: 'not_civil', reasons: ['no_text_to_classify'] };
  }

  /* The shared engine's hard negatives: other engineering branches,
     software/data roles, and the non-engineering uses of 'civil'
     (servants, judges, courts). A course that trips one of those is not
     directory material, however appealing 'AutoCAD' looks. */
  const engine = classifyCivilLevel({ title: row && row.title, description: row && row.description, category: row && row.category });
  if (engine.level === 'not_civil' && engine.reasons.includes('hard_negative')) {
    return { civil: false, specialization: null, level: 'not_civil', reasons: ['hard_negative'] };
  }
  if (OTHER_BRANCH.test(text) && !STRONG_CIVIL.test(text)) {
    return { civil: false, specialization: null, level: 'not_civil', reasons: ['other_engineering_branch'] };
  }

  for (const [label, re] of COURSE_TOPICS) {
    if (!re.test(text)) continue;
    /* AutoCAD and MS Project only count when the same text says what the
       tool is being used for. */
    if (label === 'AutoCAD & Civil 3D' && re === CAD_IN_CIVIL_CONTEXT && !CIVIL_CONTEXT.test(text)) continue;
    return { civil: true, specialization: label, level: engine.level, reasons: [`topic:${label}`] };
  }
  for (const [label, re] of EXAM_TOPICS) {
    if (re.test(text)) return { civil: true, specialization: label, level: engine.level, reasons: [`exam:${label}`] };
  }
  if (engine.level === 'direct' || engine.level === 'related') {
    const slug = classifySpecialization({ title: row && row.title, description: row && row.description, category: row && row.category });
    return {
      civil: true,
      specialization: SLUG_LABELS[slug] || GENERAL_CIVIL[0],
      level: engine.level,
      reasons: [`classifier:${engine.level}`],
    };
  }
  if (GENERAL_CIVIL[1].test(text)) {
    return { civil: true, specialization: GENERAL_CIVIL[0], level: engine.level, reasons: ['topic:civil'] };
  }
  return {
    civil: false,
    specialization: null,
    level: engine.level || 'not_civil',
    reasons: engine.level === 'possible'
      ? ['indirect_connection_needs_manual_classification']
      : ['no_civil_engineering_topic'],
  };
}

/* ── URL slugs for the per-specialization landing pages ───────────
   /courses/structural-engineering, /courses/gate-civil-engineering …
   Each label maps to exactly one slug and back, so a page can never
   serve the wrong specialization. A test asserts the mapping stays a
   bijection — adding two labels that slugify the same way would send
   both pages to one URL. */
function slugify(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SPECIALIZATION_BY_SLUG = new Map();
for (const label of COURSE_SPECIALIZATIONS) {
  const slug = slugify(label);
  if (slug && !SPECIALIZATION_BY_SLUG.has(slug)) SPECIALIZATION_BY_SLUG.set(slug, label);
}

/** Slug for a specialization label ('' when the label is unknown). */
function specializationSlug(value) {
  const label = normalizeSpecialization(value);
  return label ? slugify(label) : '';
}

/** The specialization a landing-page slug refers to, or null. */
function specializationFromSlug(slug) {
  const key = slugify(slug);
  return key ? (SPECIALIZATION_BY_SLUG.get(key) || null) : null;
}

/* ── The exact sentences the product must show ──────────────────── */

/** Shown wherever automatic discovery is discussed, while no authorized
    provider credential is configured. The directory spec's wording. */
const PROVIDER_ACCESS_NOTICE =
  'Automatic provider API access not configured; manual/bulk Civil Engineering course import remains available.';

/** Public-page notice. courses.html renders this text verbatim; a test
    compares the two so they cannot drift. */
const THIRD_PARTY_NOTICE =
  'Courses are provided by third-party platforms. CivilCareer does not sell these courses. '
  + "Verify course details and pricing on the provider's website.";

module.exports = {
  SUPPORTED_PROVIDERS,
  COURSE_SPECIALIZATIONS,
  PROVIDER_ACCESS_NOTICE,
  THIRD_PARTY_NOTICE,
  canonicalProvider,
  isSupportedProvider,
  normalizeSpecialization,
  classifyCourse,
  SLUG_LABELS,
  slugify,
  specializationSlug,
  specializationFromSlug,
};
