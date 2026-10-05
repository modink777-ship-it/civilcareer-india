'use strict';

/**
 * CivilCareer — ONE builder for the `govt_job_staging` payload.
 *
 * Why this file exists
 * --------------------
 * Two writers stage government leads: the GitHub crawler (scripts/crawl-govt-pipeline.js)
 * and the Vercel cron (_api/govt-discovery.js). They drifted. The crawler carried the
 * aggregator's own evidence — qualification, vacancies, deadline, notification number,
 * source_section, civil_evidence — while the cron wrote six fields and set
 * `official_notice_url` to the AGGREGATOR's own article URL. The review queue therefore
 * showed an allgovernmentjobs lead as:
 *
 *     Deadline —   Notification no. —   Qualification —   Posts found —
 *     Official notice  https://allgovernmentjobs.in/cochin-port-trust-recruitment-2026-.../44433
 *
 * which is both empty and wrong: an aggregator URL is a LEAD, never the official notice
 * (_api/govt-review.js refuses to publish one). Whichever writer runs must stage the same
 * thing, so the payload is built here and nowhere else.
 *
 * The official-notice rule
 * ------------------------
 * `official_notice_url` is only ever a URL that the publish gate would accept
 * (see isOfficialHost below — the exact same host set _api/govt-review.js checks).
 * When no such link was found on the posting's own page, the field is left EMPTY and
 * the reviewer attaches one from the queue ("Paste official notice"). Writing the
 * aggregator link instead is what produced a queue where every row looked publishable
 * and none of them were.
 */

/* The host set the human publish gate accepts for an aggregator lead. Kept in step with
   isOfficialHost() + knownPsuHosts in _api/govt-review.js: a builder that produced a URL
   the gate rejects would stage unpublishable rows. */
const PSU_HOSTS = /(^|\.)(ntpc\.co\.in|bhel\.com|rites\.com|ircon\.org|aai\.aero|nhpcindia\.com|nbccindia\.com|coalindia\.in|indianrailways\.gov\.in|irc\.org\.in|wapcos\.gov\.in)$/;

function isOfficialHost(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.endsWith('.gov.in') || h.endsWith('.nic.in') || h.endsWith('.edu.in')
      || PSU_HOSTS.test(h);
  } catch { return false; }
}

function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(raw) {
  const s = clean(raw);
  if (!s) return null;
  const m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (!m) return null;
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${year}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "Last date 21/10/2026" → { kind, text, date }. Same shapes the publisher reads. */
function extractDeadline(text) {
  const m = String(text || '').match(/(?:last date|last date to apply|closing date|apply on or before|applications? .*? before)[:\s-]*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4})/i);
  if (m) return { kind: 'fixed', text: m[1], date: parseDate(m[1]) };
  /* A bare date in the aggregator's own deadline column counts too. */
  const bare = String(text || '').trim().match(/^([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4})$/);
  if (bare) return { kind: 'fixed', text: bare[1], date: parseDate(bare[1]) };
  const rel = String(text || '').match(/within\s+(\d{1,3})\s+days?/i);
  if (rel) return { kind: 'relative_days', text: `Within ${rel[1]} days`, date: null, relativeDays: Number(rel[1]) };
  if (/update\s+soon/i.test(text)) return { kind: 'update_soon', text: 'Update Soon', date: null };
  if (/notified\s+soon/i.test(text)) return { kind: 'notified_soon', text: 'Notified Soon', date: null };
  return { kind: 'fixed', text: '', date: null };
}

function extractQualification(text) {
  const m = String(text || '').match(/\b(?:B\.?E\.?|B\.?Tech|Diploma|ITI|M\.?E\.?|M\.?Tech)\b[^.]{0,120}/i);
  return m ? clean(m[0]).slice(0, 300) : null;
}

function notificationNoFromText(text) {
  const m = String(text || '').match(/\b(?:advertisement|advt\.?|notification|cen|ref(?:erence)?)[\s.#:/-]*([A-Z0-9][A-Z0-9./_-]{1,24})\b/i);
  return m ? m[1] : null;
}

/**
 * Build the `payload` JSON stored on a govt_job_staging row.
 *
 * @param {object}   input
 * @param {object}   input.source        govt_sources row (name/type/url/org/category/state)
 * @param {object}   input.record        adapter record (title/url/org/postName/qualification/
 *                                       vacancies/deadlineText/section/discipline/postedOn)
 * @param {object}   [input.select]      selectCivil() verdict ({ keep, evidence, eligible })
 * @param {object}   [input.verdict]     classifyRecord() verdict ({ civil_status, posts, ... })
 * @param {string}   [input.officialNotice] real official notice URL found on the detail page
 * @param {string}   [input.detailText]  text of the posting's own page, when one was fetched
 * @param {string}   [input.leadUrl]     the aggregator article URL (the LEAD)
 * @param {object}   [input.deadline]    a deadline the caller already parsed (used as-is)
 * @returns {object} payload
 */
function buildPayload(input = {}) {
  const source = input.source || {};
  const record = input.record || {};
  const select = input.select || {};
  const verdict = input.verdict || {};
  const leadUrl = String(input.leadUrl || record.url || '').trim();
  const detailText = String(input.detailText || '').slice(0, 12000);

  const own = [record.postName, record.qualification, record.excerpt, record.section, detailText]
    .filter(Boolean).join('\n');
  const evidenceText = `${record.title || ''}\n${own}`;

  const deadlineSource = record.deadlineText
    ? `${record.deadlineText}\n${detailText}`
    : detailText || record.deadlineText || '';
  /* A caller that already parsed the deadline (and used it for its own expiry check)
     passes it in, so both places can never disagree about the same posting. */
  const deadline = input.deadline || extractDeadline(deadlineSource);

  const qualification = clean(record.qualification || '') || extractQualification(evidenceText) || null;
  const posts = Array.isArray(verdict.posts) ? verdict.posts : [];
  const top = posts[0] || {};

  /* THE RULE: never the aggregator's own article URL. Empty means "the reviewer must
     attach one", and the queue offers exactly that. */
  const officialNotice = isOfficialHost(input.officialNotice)
    ? String(input.officialNotice).trim()
    : '';

  return {
    title: clean(record.title || '').slice(0, 500),
    organization: clean(record.org || source.org || source.name || 'Government organization'),
    organization_hint: clean(record.org || source.org || source.name || ''),
    source_name: source.name || null,
    source_type: source.type || null,
    source_category: source.category || null,
    source_state: source.state || null,
    /* The aggregator article: where the LEAD was seen. */
    source_url: leadUrl,
    /* The posting as the aggregator published it, kept separate from the official link. */
    aggregator_url: leadUrl,
    official_notification_url: leadUrl || null,
    /* Only a link the publish gate would accept. */
    official_notice_url: officialNotice,
    official_site_url: officialNotice ? new URL(officialNotice).origin : (source.url || ''),
    notification_no: clean(record.advtNo || '') || notificationNoFromText(evidenceText) || null,
    qualification,
    vacancies: clean(record.vacancies || '') || null,
    source_section: record.section || null,
    civil_evidence: select.evidence || null,
    civil_eligible: Boolean(select.eligible) || Boolean(record.civilEligible),
    civil_status: verdict.civil_status || null,
    civil_discipline: verdict.civil_discipline || null,
    civil_specialization: verdict.specialization || null,
    deadline,
    posted_on: record.postedOn || null,
    post_candidates: posts.map((x) => ({
      post_name: (x.post && x.post.post_name) || record.postName || record.title,
      discipline: (x.post && x.post.discipline) || record.discipline || record.section || null,
      qualification: (x.post && x.post.qualification) || qualification,
      outcome: x.outcome, tier: x.tier, score: x.score, level: x.level, specialization: x.specialization,
    })),
    evidence_tier: top.tier || null,
    excerpt: clean(evidenceText).slice(0, 3500),
    discovered_at: new Date().toISOString(),
  };
}

module.exports = {
  buildPayload,
  isOfficialHost,
  extractDeadline,
  extractQualification,
  notificationNoFromText,
  parseDate,
  clean,
};
