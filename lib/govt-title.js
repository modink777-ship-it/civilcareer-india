'use strict';

/**
 * CivilCareer — title hygiene for government postings
 *
 * Aggregator listings hand back whatever text their anchor carried: "Click here to view
 * the advertisement/apply", "Read more about …", "Traffic Survey Result". Four records
 * published on 2026-10-03 went out with exactly those titles, and the public government
 * jobs page showed them as the post name. The listing's link text is not a post name.
 *
 * This module is the single place that decides:
 *   titleVerdict(title)   → is this usable as a published title, and why not
 *   cleanTitle(title)     → the same title with the notice boilerplate stripped
 *   deriveTitle(fields)   → the best title the record's own fields support, or null
 *
 * "not_recruitment" is deliberately separate from "junk": a result / admit-card /
 * answer-key page is a real page with a real title, it just is not a vacancy, so it must
 * not be published as one and no amount of rewording fixes it.
 */

const MAX_TITLE = 140;

/* Link text and page furniture — never a post name. */
const JUNK = [
  /^click here\b/i,
  /^read more\b/i,
  /^view (the )?(advertisement|notification|details|more)\b/i,
  /^(download|apply) (here|now|online)\b/i,
  /^(show|hide) &?mdash;/i,
  /skip to main content/i,
  /^(advertisement|notification|notice|advt\.?|vacancy|recruitment)$/i,
  /^(untitled|n\/?a|none|nil)$/i,
  /^[-–—\s.]+$/,
];

/* A real page, but not a vacancy: results, keys, lists, calendars. A recruitment title
   never contains the word "result", so this is safe to match anywhere in the string. */
const NOT_RECRUITMENT = [
  /\bresults?\b/i,
  /\banswer keys?\b/i,
  /\badmit cards?\b/i,
  /\bhall tickets?\b/i,
  /^(?:cut ?off|merit list|waiting list|selection list|panel list)\b/i,
  /^syllabus\b/i,
  /^previous (?:year )?(?:paper|question)/i,
  /^(?:exam|academic) calendar\b/i,
  /^(?:corrigendum|addendum)\b/i,
];

/* A post is named by one of these. A title naming none of them is not necessarily wrong
   (an organisation-only headline is common), so it is "weak" — worth the reviewer's eye,
   never a refusal. */
const JOB_WORD = /\b(engineer|draftsman|draughtsman|surveyor|overseer|foreman|manager|officer|assistant|clerk|apprentice|trainee|technician|supervisor|inspector|director|executive|operator|designer|architect|planner|estimator|consultant|scientist|analyst|programmer|attendant|mason|fitter|welder|electrician|posts?|vacanc(?:y|ies)|recruitments?|jobs?|cadre|grade)\b/i;

/* Sentence wrappers a notice headline is padded with. Only the connectors that
   unambiguously introduce the post are peeled — "Recruitment of Apprentice (Civil)" is
   already a title and must survive untouched. */
const LEADING_WRAPPER = [
  /^(?:advertisement|notification|notice|advt\.?|press release)\s+(?:for|to|regarding)?\s*(?:the\s+)?(?:posts?|vacanc(?:y|ies))\s+of\b[\s:–—-]*/i,
  /^(?:advertisement|notification|notice|advt\.?)\s*[:\-–—]\s*/i,
  /^(?:for|to)\s+(?:the\s+)?posts?\s+of\b[\s:–—-]*/i,
];
/* "… on Direct Recruitment basis." — a mode clause, not part of the post name. */
const TRAILING_BASIS = /\s(?:on|through|via|under)\s+(?:the\s+)?[\w\s]{0,40}?\b(?:recruitment|basis|mode)\b[\s.]*$/i;

function norm(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function matches(patterns, text) {
  return patterns.some(re => re.test(text));
}

/** Strip the notice's own padding without inventing anything. */
function cleanTitle(title) {
  let t = norm(title);
  if (!t) return '';
  /* A title pasted from a notice headline can carry the wrapper twice
     ("Advertisement for the post of …") — peel it while it is still there. */
  for (let i = 0; i < 3; i += 1) {
    const before = t;
    for (const re of LEADING_WRAPPER) t = t.replace(re, '').trim();
    if (t === before) break;
  }
  /* Drop the mode clause only when a real post name is left standing. */
  for (let i = 0; i < 2; i += 1) {
    const stripped = t.replace(TRAILING_BASIS, '').trim();
    if (stripped === t || stripped.split(' ').length < 2) break;
    t = stripped;
  }
  t = t.replace(/[\s,;:–—-]+$/, '').trim();
  /* A single trailing full stop is sentence punctuation, not part of a post name —
     but never touch "B.E." / "M.Tech." style abbreviations. */
  if (/[^.\s]\.$/.test(t) && !/\b[A-Z]\.$/.test(t) && t.split(' ').length > 2) {
    t = t.slice(0, -1).trim();
  }
  if (t.length > MAX_TITLE) {
    const cut = t.slice(0, MAX_TITLE);
    const at = cut.lastIndexOf(' ');
    t = (at > 40 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, '');
  }
  return t;
}

/**
 * What is this title worth?
 * @returns {{verdict:'ok'|'weak'|'junk'|'not_recruitment', reason:string, cleaned:string}}
 */
function titleVerdict(title) {
  const raw = norm(title);
  const cleaned = cleanTitle(raw);
  if (!raw) return { verdict: 'junk', reason: 'the record has no title at all', cleaned: '' };
  if (matches(JUNK, raw) || matches(JUNK, cleaned)) {
    return { verdict: 'junk', reason: "the source's link text, not the post name", cleaned: '' };
  }
  if (matches(NOT_RECRUITMENT, raw) || matches(NOT_RECRUITMENT, cleaned)) {
    return { verdict: 'not_recruitment', reason: 'a result / key / list page, not a vacancy', cleaned };
  }
  if (cleaned.length < 8 || !/[A-Za-z]{4}/.test(cleaned)) {
    return { verdict: 'junk', reason: 'too short to name a post', cleaned };
  }
  if (cleaned.length > MAX_TITLE) {
    return { verdict: 'weak', reason: `longer than ${MAX_TITLE} characters — trim it`, cleaned };
  }
  /* Only the problems cleaning could NOT remove are worth the reviewer's eye: a title
     that merely lost its notice wrapper is now simply the post name. */
  if (cleaned.length > 100 || /\b(?:invites? applications|on the basis of|is pleased to)\b/i.test(cleaned)) {
    return { verdict: 'weak', reason: 'the notice headline — trim it to the post name', cleaned };
  }
  if (!JOB_WORD.test(cleaned)) {
    return { verdict: 'weak', reason: 'names no post — check it is the vacancy, not the page', cleaned };
  }
  return { verdict: 'ok', reason: '', cleaned };
}

/**
 * The best title the record's own fields support, without inventing one.
 * @returns {{title:string, from:string}|null}
 */
function deriveTitle(fields) {
  const f = fields || {};
  const tried = [];
  const post = norm(f.post_name);
  if (post) tried.push({ title: post, from: 'post_name' });
  const title = norm(f.title);
  if (title) tried.push({ title: cleanTitle(title), from: 'title' });

  for (const t of tried) {
    if (!t.title) continue;
    const v = titleVerdict(t.title);
    if (v.verdict === 'ok' || v.verdict === 'weak') return { title: v.cleaned, from: t.from };
  }
  return null;
}

module.exports = { titleVerdict, cleanTitle, deriveTitle, MAX_TITLE };
