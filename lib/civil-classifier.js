'use strict';

const POSITIVE = [
  /\bcivil(?: engineering| engineer)?\b/i,
  /\bje\s*\(civil\)|\bae\s*\(civil\)|\baee\s*\(civil\)|\bee\s*\(civil\)\b/i,
  /\b(b\.?e\.?|b\.?tech|diploma|iti)\s*(in|\/)?\s*civil\b/i,
  /\bstructural(?: engineer| engineering)?\b/i,
  /\b(highway|road|transportation|geotechnical|hydraulic|water resources|irrigation)\b/i,
  /\b(quantity surveyor|estimator|estimation engineer|draughtsman\s*\(civil\)|draftsman\s*\(civil\))\b/i,
  /\b(overseer|foreman\s*\(civil\)|surveyor|town planner)\b/i,
  /\b(works engineer|site engineer|project engineer|planning engineer|bim engineer|qa\/?qc engineer)\b/i,
  /\b(gate|engineering services examination|ese|ssc\s*je|rrb\s*je|state\s*(ae|je))\b/i,
];

const HARD_NEGATIVES = [
  /* Plurals matter: aggregators write "Civil Servants (Pourakarmika)" and
     "Civil Judges" in their civil sections, and a singular-only pattern let
     those through as engineering posts. */
  /\bcivil judges?\b/i, /\bcivil courts?\b/i, /\bcity civil courts?\b/i,
  /\bcivil services?\b/i, /\bcivil clerks?\b/i, /\bcivil labourers?\b/i, /\bcivil servants?\b/i,
  /\bcivil defence\b/i, /\bcivilian (driver|mts)\b/i,
  /\b(civil surgeon|civil aviation)\b/i,
  /\b(head constable|sub[- ]inspector)\b.*\b(motor mechanic|fire|gd|executive)\b/i,
  /\b(software|it|ai|application|network|server|support|data|cloud|cyber|frontend|backend) engineer\b/i,
  /\b(mechanical|electrical|electronics|chemical|instrumentation|metallurgical|marine) engineer\b/i,
  /\bengineer\s*\((?:mechanical|electrical|electronics|chemical|instrumentation|metallurgical|marine)(?:\/[^)]*)?\)\b/i,
  /\bnon[- ]engineering\b/i,
  /\b(nurse|doctor|teacher|lecturer|clerk|bank|police|constable)\b/i,
];

const UNKNOWN_TITLE = /\b(assistant|executive|superintending|junior|deputy chief) engineer\b|\bmanager\s*\(engineering\)\b/i;
const CIVIL_HEAVY_ORG = /\b(ports?|housing board|urban|water|irrigation|pwd|roads?\s*&?\s*buildings|nhai|rites|metro|railway|institute|iit|nit|aiims|psu|municipal|jal|development authority)\b/i;

function textOf(item) {
  return [item.title, item.role, item.post_name, item.discipline, item.qualification, item.description, item.org_hint, item.organization]
    .filter(Boolean).join(' ');
}

function classifyPost(item) {
  const text = textOf(item);
  const reasons = [];
  /* 'Civil servants', 'civil judge', 'civil court' and the rest of the
     non-engineering uses of the word are NOT_CIVIL per spec §3. classifyCivilLevel
     already enforced that; classifyPost did not, so a discovery source whose
     section text says "Civil Engineers" next to "Civil Servants (Pourakarmika)"
     could still be staged as a civil post. Same guard, both entry points. */
  if (HARD_NEGATIVES.some(re => re.test(text)) || isNonEngineeringCivil(text)) {
    return { outcome: 'not_civil', tier: null, score: 0, reasons: ['hard_negative'] };
  }
  /* A source that files a posting under its own civil section/category is stating
     that a civil engineering degree qualifies for it. That is real evidence, but
     weaker than the post or its qualification naming civil engineering, so it is
     tier B and 'related' rather than a tier-A civil post. */
  if (item.civil_eligible === true) {
    return { outcome: 'civil', tier: 'B', score: 62, reasons: ['source_states_civil_eligible'] };
  }
  const matches = POSITIVE.filter(re => re.test(text));
  for (const re of matches) reasons.push(`matched:${re.source}`);
  if (matches.length) {
    return { outcome: 'civil', tier: 'A', score: Math.min(100, 60 + matches.length * 8), reasons };
  }
  if (/\b(b\.?e\.?|b\.?tech|diploma)\s+(in\s+)?any\s+engineering\s+discipline\b/i.test(text) && CIVIL_HEAVY_ORG.test(text)) {
    return { outcome: 'civil', tier: 'B', score: 70, reasons: ['any_engineering_at_civil_heavy_employer'] };
  }
  if (/\b(architect|urban planning|town planning|land surveyor|estate officer|works officer)\b/i.test(text)) {
    return { outcome: 'civil', tier: 'C', score: 45, reasons: ['adjacent_civil_role'] };
  }
  if (UNKNOWN_TITLE.test(text) && CIVIL_HEAVY_ORG.test(text)) {
    return { outcome: 'discipline_unknown', tier: 'U', score: 35, reasons: ['discipline_unknown_at_civil_heavy_employer'] };
  }
  return { outcome: 'not_civil', tier: null, score: 0, reasons: [] };
}

/* ── Civil Engineering classification levels (production spec §3) ──────
   DIRECT   — the post IS a civil engineering post
   RELATED  — not a civil post per se, but explicitly accepts civil
              engineering graduates (construction/infrastructure roles)
   POSSIBLE — civil eligibility requires human review (technical officer,
              unqualified 'Engineer' at a civil-heavy organisation)
   NOT_CIVIL — civil servants, civil judges, civil administration and
              every other unrelated use of the word 'civil'            */

const DIRECT_PATTERNS = [
  /\bcivil\s+(?:engineer|engineering)\b/i,
  /\b(?:je|ae|aee|ee|se|addl\s*ce|chief\s*engineer)\s*[(\- ]\s*civil/i,
  /\b(?:junior|assistant|executive|superintending|deputy|chief)?\s*engineer\s*[(\- ]\s*civil/i,
  /\b(b\.?e\.?|b\.?tech|diploma|iti)\s*(in|\/)?\s*civil\b/i,
  /\bstructural(?: engineer| engineering)?\b/i,
  /\b(quantity surveyor|surveyor|estimation engineer|draughtsman\s*[(\- ]\s*civil|draftsman\s*[(\- ]\s*civil|overseer|foreman\s*[(\- ]\s*civil|town planner)\b/i,
];

const RELATED_PATTERNS = [
  /\bconstruction manager\b/i,
  /\bproject engineer\b/i,
  /\binfrastructure engineer\b/i,
  /\b(site|works|planning|qa\/qc|highway)\s+engineer\b/i,
  /\bplanning engineer\b/i,
  /\bqa\/qc engineer\b/i,
  /\bbim (?:engineer|modeller|modeler)\b/i,
  /\b(road|bridge|metro|railway|tunnel|airport|port) engineer\b/i,
];

const POSSIBLE_PATTERNS = [
  /\btechnical officer\b/i,
  /\btechnical assistant\b/i,
  /\bengineering (?:assistant|executive|officer)\b/i,
  /\btrainee (?:engineer|technical)\b/i,
  /\bmanagement trainee\s*[(\- ]\s*(?:technical|engineering)\b/i,
];

/* Specializations from the production spec §3. Ordered: the first match
   wins, so put the most specific domains before the generic ones. */
const SPECIALIZATIONS = [
  ['project-construction-management', /\b(project|construction)\s+(management|manager)\b/i],
  ['quantity-surveying', /\bquantity survey\w*\b/i],
  ['urban-planning', /\b(urban|town)\s+plann\w+\b/i],
  ['urban-infrastructure', /\burban\s+infra\w*\b/i],
  ['water-resources', /\bwater\s+resources\b/i],
  ['irrigation', /\birrigation\b/i],
  ['hydraulics', /\bhydraul\w+\b/i],
  ['remote-sensing', /\bremote sensing\b/i],
  ['gis', /\b(gis|geographic information system)\b/i],
  ['bim', /\bbim\b/i],
  ['estimation', /\bestimat\w+\b/i],
  ['coastal', /\bcoastal\b/i],
  ['bridge', /\bbridge\b/i],
  ['railway', /\brailway|rail\s+way\b/i],
  ['highway', /\bhighway\b/i],
  ['transportation', /\btransportation|transport\s+engineer\w*\b/i],
  ['geotechnical', /\bgeotech\w+\b/i],
  ['environmental', /\benvironmental\b/i],
  ['surveying', /\bsurvey(ing|or)\b/i],
  ['structural', /\bstructural\b/i],
  ['construction', /\bconstruction\b/i],
  ['building', /\bbuilding\b/i],
  ['planning', /\bplanning\b/i],
  ['infrastructure', /\binfrastructure\b/i],
  ['general-civil', /\bcivil\b/i],
];

/** True when the text uses 'civil' in a NON-engineering sense
 *  (civil servants, judges, courts, administration, defence…). */
function isNonEngineeringCivil(text) {
  return /\bcivil\s+(?:judges?|servants?|services?|courts?|administration|supply|defence|surgeons?|aviation|clerks?|labourers?)\b/i.test(text);
}

/** Classification level for ONE post: direct | related | possible | not_civil. */
function classifyCivilLevel(item) {
  const text = textOf(item);
  if (!text) return { level: 'not_civil', reasons: [] };
  if (HARD_NEGATIVES.some(re => re.test(text)) || isNonEngineeringCivil(text)) {
    return { level: 'not_civil', reasons: ['hard_negative'] };
  }
  if (item.civil_eligible === true) {
    return { level: 'related', reasons: ['source_states_civil_eligible'] };
  }
  const direct = DIRECT_PATTERNS.filter(re => re.test(text));
  if (direct.length) return { level: 'direct', reasons: direct.map(r => `direct:${r.source}`) };
  const related = RELATED_PATTERNS.filter(re => re.test(text));
  if (related.length) return { level: 'related', reasons: related.map(r => `related:${r.source}`) };
  const possible = POSSIBLE_PATTERNS.filter(re => re.test(text));
  if (possible.length || (UNKNOWN_TITLE.test(text) && CIVIL_HEAVY_ORG.test(text))) {
    return { level: 'possible', reasons: ['civil_eligibility_needs_human_review'] };
  }
  return { level: 'not_civil', reasons: [] };
}

/** First matching civil specialization for a post (or null). */
function classifySpecialization(item) {
  const text = textOf(item);
  for (const [slug, re] of SPECIALIZATIONS) if (re.test(text)) return slug;
  return null;
}

/* Notification-level rollup that ALSO carries the per-post level
   (direct/related/possible) and specialization, so the staging payload
   keeps full evidence for the human reviewer. */
function classifyNotificationDetailed(posts, context = {}) {
  const results = (Array.isArray(posts) ? posts : []).map(p => {
    const x = { ...context, ...p };
    return { post: p, ...classifyPost(x), level: classifyCivilLevel(x).level, specialization: classifySpecialization(x) };
  });
  const civil = results.filter(x => x.outcome === 'civil');
  const unknown = results.filter(x => x.outcome === 'discipline_unknown');
  let civil_status = 'not_civil';
  if (civil.length && unknown.length) civil_status = 'multi_incl_civil';
  else if (civil.length) civil_status = civil.length === results.length ? 'civil' : 'multi_incl_civil';
  else if (unknown.length) civil_status = 'discipline_unknown';
  const levels = results.map(x => x.level).filter(l => l !== 'not_civil');
  const civil_discipline = levels.includes('direct') ? 'direct'
    : levels.includes('related') ? 'related'
    : levels.includes('possible') ? 'possible' : 'not_civil';
  const specialization = (results.map(x => x.specialization).find(Boolean)) || null;
  return { civil_status, civil_discipline, specialization, posts: results };
}

function classifyNotification(posts, context = {}) {
  const results = (Array.isArray(posts) ? posts : []).map(p => ({ post: p, ...classifyPost({ ...context, ...p }) }));
  const civil = results.filter(x => x.outcome === 'civil');
  const unknown = results.filter(x => x.outcome === 'discipline_unknown');
  let civil_status = 'not_civil';
  if (civil.length && unknown.length) civil_status = 'multi_incl_civil';
  else if (civil.length) civil_status = civil.length === results.length ? 'civil' : 'multi_incl_civil';
  else if (unknown.length) civil_status = 'discipline_unknown';
  return { civil_status, posts: results };
}

module.exports = { classifyPost, classifyNotification, POSITIVE, HARD_NEGATIVES, classifyCivilLevel, classifySpecialization, classifyNotificationDetailed, DIRECT_PATTERNS, RELATED_PATTERNS, POSSIBLE_PATTERNS, SPECIALIZATIONS };
