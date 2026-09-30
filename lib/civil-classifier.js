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
  /\bcivil judge\b/i, /\bcivil court\b/i, /\bcity civil court\b/i,
  /\bcivil services\b/i, /\bcivil clerk\b/i, /\bcivil labourer\b/i,
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
  if (HARD_NEGATIVES.some(re => re.test(text))) {
    return { outcome: 'not_civil', tier: null, score: 0, reasons: ['hard_negative'] };
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

module.exports = { classifyPost, classifyNotification, POSITIVE, HARD_NEGATIVES };
