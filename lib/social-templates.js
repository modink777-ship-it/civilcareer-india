/**
 * CivilCareer — Social Content Engine templates (P2, gap report F2)
 *
 * One template per `<entity>.<event>.<discriminator>` key. A
 * template renders ONE source record into the four content
 * surfaces (Telegram text, LinkedIn post, Instagram caption,
 * WhatsApp copy) plus the on-site link the post points to.
 *
 * Entities (v27 social_suggestions.source_type):
 *   exam_tracker — status transitions of an exam row
 *   job          — a freshly published job
 *   govt_job     — a verified government-job post
 *
 * Telegram text is PLAIN TEXT on purpose (no Markdown parse mode):
 * unusual exam names with underscores/asterisks must never break
 * delivery. The same discipline as the pre-engine announcer.
 */

const { SITE_URL } = require('./security');

const HANDLE = '@CivilCareerIndiaJobs';

/* ── helpers ────────────────────────────────────────────────── */

function fmtDay(value) {
  if (!value) return 'TBA';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : '';
}

function joinLines(parts) {
  return parts.filter((p) => p != null && String(p).trim() !== '').join('\n');
}

/* ── source snapshots (Truth Lock inputs) ─────────────────────
   Deterministic subsets of the source row: volatile metadata
   (created_at / updated_at / review bookkeeping) is EXCLUDED so
   a no-op admin touch does not flip a suggestion stale, while
   every content-bearing change does. The API recomputes the
   snapshot from the LIVE row at publish time and compares hashes. */

const SNAPSHOT_FIELDS = {
  exam_tracker: [
    'name', 'short_name', 'authority', 'category', 'status',
    'notification_date', 'application_start', 'application_end',
    'exam_date', 'result_date', 'official_url',
    'eligibility_summary', 'vacancy_count', 'exam_fee',
    'age_limit', 'qualification', 'is_active', 'notes',
  ],
  job: [
    'role', 'company', 'location', 'description', 'employment_type',
    'salary', 'date_posted', 'valid_through', 'deadline', 'source',
    'published', 'slug', 'vacancy_count', 'age_limit',
    'application_fee', 'application_start', 'status',
    'application_email', 'qualification',
  ],
  govt_job: [
    'title', 'slug', 'organization', 'org_type', 'scope', 'state',
    'department_category', 'job_type', 'notification_no',
    'total_posts_in_notification', 'civil_posts_count', 'civil_status',
    'tier', 'dates', 'deadline_kind', 'deadline_text', 'apply_end',
    'previous_apply_end', 'age_limit_by_category', 'age_as_on',
    'fee_by_category', 'payment_mode', 'required_documents',
    'how_to_apply', 'language_required', 'local_cadre_or_domicile',
    'reservation_notes', 'official_notice_url', 'official_apply_url',
    'official_site_url', 'summary', 'status', 'closes_at',
    'civil_posts',
  ],
};

function buildSnapshot(sourceType, row) {
  const fields = SNAPSHOT_FIELDS[sourceType] || [];
  const snapshot = {};
  for (const f of fields) {
    if (row == null || row[f] === undefined) continue;
    snapshot[f] = row[f];
  }
  return snapshot;
}

/* ── link URLs (host must match SITE_URL — enforced in core) ── */

function entityLink(sourceType, row, siteUrl) {
  const base = String(siteUrl || SITE_URL || '').replace(/\/+$/, '');
  const slug = row && row.slug ? `/${encodeURIComponent(String(row.slug))}` : '';
  switch (sourceType) {
    case 'exam_tracker': return `${base}/exam-tracker`;
    case 'govt_job': return `${base}/government-jobs${slug}`;
    case 'job': return `${base}/jobs${slug}`;
    default: return base;
  }
}

/* ── exam tracker events ────────────────────────────────────── */

/* Map an exam_tracker status to its content event. Only these
   transitions produce suggestions — the rest are quiet states. */
const EXAM_EVENTS = {
  application_open: 'application_open',
  notification_out: 'notification_out',
  admit_card: 'admit_card',
  exam_scheduled: 'exam_scheduled',
  result_out: 'result_out',
};

function examEventFromStatus(status) {
  return EXAM_EVENTS[String(status || '').toLowerCase()] || null;
}

const EXAM_EVENT_LABELS = {
  application_open: 'APPLICATIONS OPEN',
  notification_out: 'NOTIFICATION OUT',
  admit_card: 'ADMIT CARD AVAILABLE',
  exam_scheduled: 'EXAM SCHEDULED',
  result_out: 'RESULT DECLARED',
};

const EXAM_EVENT_LINE = {
  application_open: (row) => `📝 Apply by: ${fmtDay(row.application_end)}`,
  notification_out: (row) => `📢 Notification: ${fmtDay(row.notification_date)}`,
  admit_card: (row) => `🎫 Admit card: ${fmtDay(row.exam_date)}`,
  exam_scheduled: (row) => `🗓️ Exam: ${fmtDay(row.exam_date)}`,
  result_out: (row) => `🏆 Result: ${fmtDay(row.result_date)}`,
};

/* ── default hashtags (Instagram; settings can add more) ────── */

const DEFAULT_HASHTAGS = [
  '#CivilEngineering', '#CivilJobs', '#GovernmentJobs', '#IndiaJobs',
  '#EngineeringCareers', '#CivilService', '#JobAlert', '#Hiring',
];

function hashtagBlock(extra, maxTags) {
  const tags = [...DEFAULT_HASHTAGS];
  for (const t of (Array.isArray(extra) ? extra : [])) {
    const tag = String(t || '').trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, maxTags || 30);
}

/* ── content renderers ──────────────────────────────────────── */

function renderExam(event, row, ctx) {
  const label = EXAM_EVENT_LABELS[event] || 'EXAM UPDATE';
  const name = row.name || 'Civil Engineering Exam';
  const short = row.short_name ? ` (${row.short_name})` : '';
  const link = entityLink('exam_tracker', row, ctx.siteUrl);
  const footer = ctx.footer ? `\n${ctx.footer}` : '';

  const body_telegram = joinLines([
    `🟢 ${label}`,
    `📋 ${name}${short}`,
    row.authority ? `🏛️ ${row.authority}` : '',
    EXAM_EVENT_LINE[event] ? EXAM_EVENT_LINE[event](row) : '',
    row.vacancy_count != null ? `👥 Vacancies: ${fmtInt(row.vacancy_count)}` : '',
    row.eligibility_summary ? `🎓 Eligibility: ${row.eligibility_summary}` : '',
    row.official_url ? `🔗 Official site: ${row.official_url}` : '',
    '',
    `Track all exams: ${link}`,
    `${footer}`,
    `📢 ${HANDLE}`,
  ]);

  const body_linkedin = joinLines([
    `${label.charAt(0) + label.slice(1).toLowerCase()} — ${name}${short}`,
    '',
    row.authority ? `Conducting authority: ${row.authority}` : '',
    EXAM_EVENT_LINE[event] ? EXAM_EVENT_LINE[event](row) : '',
    row.vacancy_count != null ? `Vacancies: ${fmtInt(row.vacancy_count)}` : '',
    row.eligibility_summary ? `Eligibility: ${row.eligibility_summary}` : '',
    row.official_url ? `Official notification: ${row.official_url}` : '',
    '',
    `We track every civil engineering exam in India: ${link}`,
    ctx.footer || '',
  ]);

  const tags = hashtagBlock(ctx.defaultHashtags);
  const caption_instagram = joinLines([
    `🚀 ${label.charAt(0) + label.slice(1).toLowerCase()}: ${name}${short}`,
    '',
    row.authority ? `By ${row.authority}` : '',
    EXAM_EVENT_LINE[event] ? EXAM_EVENT_LINE[event](row) : '',
    '',
    `Details & alerts: ${link}`,
    '',
    tags.join(' '),
  ]);

  const whatsapp_text = joinLines([
    `*${label}*`,
    `${name}${short}`,
    row.authority ? `Authority: ${row.authority}` : '',
    EXAM_EVENT_LINE[event] ? EXAM_EVENT_LINE[event](row) : '',
    `Apply/track: ${link}`,
    ctx.footer || '',
  ]).slice(0, 1000);

  return {
    title: `${name}${short} — ${label.charAt(0) + label.slice(1).toLowerCase()}`,
    body_telegram, body_linkedin, caption_instagram, whatsapp_text,
    link_url: link, media_url: null,
  };
}

function renderJobPublished(row, ctx) {
  const role = row.role || 'Civil Engineering Opportunity';
  const company = row.company || 'Organization';
  const link = entityLink('job', row, ctx.siteUrl);
  const footer = ctx.footer ? `\n${ctx.footer}` : '';

  const deadlineLine = row.deadline || row.valid_through
    ? `⏰ Deadline: ${fmtDay(row.deadline || row.valid_through)}`
    : '';

  const body_telegram = joinLines([
    '🆕 New Job Alert — CivilCareer',
    '',
    `💼 ${role}`,
    `🏢 ${company}`,
    row.location ? `📍 ${row.location}` : '',
    row.salary ? `💰 ${row.salary}` : '',
    row.qualification
      ? `🎓 ${row.qualification}`
      : '',
    deadlineLine,
    '',
    `🔗 ${link}`,
    '',
    '⚠️ Never pay for a job. Always verify the official notification.',
    `${footer}`,
    `📢 ${HANDLE}`,
  ]);

  const body_linkedin = joinLines([
    `New civil engineering opening: ${role}`,
    '',
    `🏢 ${company}`,
    row.location ? `📍 ${row.location}` : '',
    row.salary ? `💰 ${row.salary}` : '',
    row.employment_type ? `📋 ${row.employment_type}` : '',
    deadlineLine,
    '',
    `Apply and verify the official notification here: ${link}`,
    ctx.footer || '',
  ]);

  const tags = hashtagBlock(ctx.defaultHashtags);
  const caption_instagram = joinLines([
    `💼 New job: ${role}`,
    '',
    `🏢 ${company}${row.location ? ` • 📍 ${row.location}` : ''}`,
    deadlineLine,
    '',
    `Apply: ${link}`,
    '',
    tags.join(' '),
  ]);

  const whatsapp_text = joinLines([
    `*New Job Alert*`,
    `${role}`,
    `🏢 ${company}${row.location ? ` • 📍 ${row.location}` : ''}`,
    deadlineLine,
    `Apply: ${link}`,
    ctx.footer || '',
  ]).slice(0, 1000);

  return {
    title: `${role} at ${company}`,
    body_telegram, body_linkedin, caption_instagram, whatsapp_text,
    link_url: link, media_url: null,
  };
}

function renderGovtJobPublished(row, ctx) {
  const title = row.title || 'Government Job';
  const org = row.organization || 'Government Organization';
  const link = entityLink('govt_job', row, ctx.siteUrl);
  const footer = ctx.footer ? `\n${ctx.footer}` : '';
  const scope = row.scope === 'state' && row.state && row.state !== 'All India'
    ? `${row.state} state` : (row.scope === 'central' ? 'Central Govt' : 'Government');

  const civilLine = row.civil_posts_count != null
    ? `👥 Civil posts: ${fmtInt(row.civil_posts_count)}${row.total_posts_in_notification ? ` of ${fmtInt(row.total_posts_in_notification)} total` : ''}`
    : '';
  const deadlineLine = row.deadline_text
    ? `⏰ Apply by: ${row.deadline_text}`
    : (row.apply_end ? `⏰ Apply by: ${fmtDay(row.apply_end)}` : '');

  const body_telegram = joinLines([
    '🏛️ Government Job — CivilCareer',
    '',
    `💼 ${title}`,
    `🏢 ${org} (${scope})`,
    civilLine,
    deadlineLine,
    row.tier ? `📊 Tier: ${row.tier}` : '',
    '',
    `🔗 ${link}`,
    row.official_notice_url ? `📄 Notification: ${row.official_notice_url}` : '',
    '',
    '⚠️ Never pay for a job. Always verify the official notification.',
    `${footer}`,
    `📢 ${HANDLE}`,
  ]);

  const body_linkedin = joinLines([
    `Verified government vacancy: ${title}`,
    '',
    `🏢 ${org} — ${scope}`,
    civilLine,
    deadlineLine,
    row.summary ? `\n${row.summary}` : '',
    '',
    `Full specification and official links: ${link}`,
    ctx.footer || '',
  ]);

  const tags = hashtagBlock(ctx.defaultHashtags);
  const caption_instagram = joinLines([
    `🏛️ Govt job: ${title}`,
    '',
    `${org}${row.state ? ` • ${row.state}` : ''}`,
    civilLine,
    deadlineLine,
    '',
    `Details: ${link}`,
    '',
    tags.join(' '),
  ]);

  const whatsapp_text = joinLines([
    `*Government Job*`,
    title,
    `${org}${row.state ? ` • ${row.state}` : ''}`,
    deadlineLine,
    `Details: ${link}`,
    ctx.footer || '',
  ]).slice(0, 1000);

  return {
    title: `${title} — ${org}`,
    body_telegram, body_linkedin, caption_instagram, whatsapp_text,
    link_url: link, media_url: null,
  };
}

/* ── template registry ──────────────────────────────────────── */

const TEMPLATES = {
  'exam_tracker.application_open.default': {
    key: 'exam_tracker.application_open.default',
    label: 'Exam — applications open',
    entity: 'exam_tracker', event: 'application_open',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: (row, ctx) => renderExam('application_open', row, ctx),
  },
  'exam_tracker.notification_out.default': {
    key: 'exam_tracker.notification_out.default',
    label: 'Exam — notification out',
    entity: 'exam_tracker', event: 'notification_out',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: (row, ctx) => renderExam('notification_out', row, ctx),
  },
  'exam_tracker.admit_card.default': {
    key: 'exam_tracker.admit_card.default',
    label: 'Exam — admit card',
    entity: 'exam_tracker', event: 'admit_card',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: (row, ctx) => renderExam('admit_card', row, ctx),
  },
  'exam_tracker.exam_scheduled.default': {
    key: 'exam_tracker.exam_scheduled.default',
    label: 'Exam — exam scheduled',
    entity: 'exam_tracker', event: 'exam_scheduled',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: (row, ctx) => renderExam('exam_scheduled', row, ctx),
  },
  'exam_tracker.result_out.default': {
    key: 'exam_tracker.result_out.default',
    label: 'Exam — result out',
    entity: 'exam_tracker', event: 'result_out',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: (row, ctx) => renderExam('result_out', row, ctx),
  },
  'job.published.default': {
    key: 'job.published.default',
    label: 'Job — published',
    entity: 'job', event: 'published',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: renderJobPublished,
  },
  'govt_job.published.default': {
    key: 'govt_job.published.default',
    label: 'Govt job — verified & published',
    entity: 'govt_job', event: 'published',
    platforms: ['telegram', 'linkedin', 'instagram'],
    build: renderGovtJobPublished,
  },
};

function getTemplate(key) {
  return TEMPLATES[key] || null;
}

/** Derive the template key for a source row (event from state). */
function resolveTemplateKey(sourceType, row) {
  if (sourceType === 'exam_tracker') {
    const event = examEventFromStatus(row && row.status);
    return event ? `exam_tracker.${event}.default` : null;
  }
  if (sourceType === 'job') {
    return row && row.published === false ? null : 'job.published.default';
  }
  if (sourceType === 'govt_job') {
    return row && row.status !== 'active' ? null : 'govt_job.published.default';
  }
  return null;
}

/**
 * Build a social_suggestions payload from a VERIFIED source row.
 * The caller (API) persists it; truth_hash is recomputed from the
 * LIVE row at publish time (Truth Lock, lib/social-core.js).
 */
function buildSuggestion(sourceType, sourceId, row, ctx = {}) {
  const templateKey = ctx.templateKey || resolveTemplateKey(sourceType, row);
  const template = templateKey && getTemplate(templateKey);
  if (!template) {
    return { ok: false, error: `No template for ${sourceType} in this state` };
  }
  const content = template.build(row, {
    siteUrl: ctx.siteUrl,
    footer: ctx.footer,
    defaultHashtags: ctx.defaultHashtags,
  });
  const snapshot = buildSnapshot(sourceType, row);
  return {
    ok: true,
    suggestion: {
      source_type: sourceType,
      source_id: sourceId,
      template_key: templateKey,
      ...content,
      source_snapshot: snapshot,
      truth_hash: null, /* filled by the API after canonical hashing */
      truth_state: 'locked',
      truth_checked_at: new Date().toISOString(),
      created_by: ctx.createdBy || null,
    },
    snapshot,
  };
}

module.exports = {
  TEMPLATES, getTemplate, resolveTemplateKey, buildSuggestion,
  buildSnapshot, entityLink, examEventFromStatus,
  SNAPSHOT_FIELDS, DEFAULT_HASHTAGS, hashtagBlock, fmtDay,
};
