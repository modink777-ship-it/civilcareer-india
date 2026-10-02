/**
 * CivilCareer — Social Engine Phase 2 Deadline Radar (P3)
 *
 * Pure helpers only. No network/database access.
 *
 * The radar never invents a deadline. It accepts a fixed date only when
 * the source explicitly provides a parseable fixed date. Relative/unknown
 * deadlines ("Within 21 days", "Update Soon", "Notified Soon") are skipped.
 */

const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_TYPES = [
  'newly_announced',
  'application_open',
  '7_days',
  '3_days',
  '24_hours',
  'closing_today',
  'closed',
];

const JOB_FIELDS = [
  'deadline', 'valid_through', 'application_start', 'application_url',
  'apply_url', 'vacancy_count', 'qualification', 'age_limit', 'salary',
  'location', 'company', 'role', 'status',
];

const GOVT_FIELDS = [
  'apply_end', 'deadline_text', 'application_start', 'civil_posts_count',
  'official_apply_url', 'official_notice_url', 'official_site_url',
  'dates', 'status', 'tier', 'civil_status', 'previous_apply_end',
  'age_limit_by_category', 'fee_by_category', 'scope', 'state',
  'department_category', 'job_type',
];

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function parseDateToken(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let m = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  m = raw.match(/^(\\d{2})[\\/-](\\d{2})[\\/-](\\d{2}|\\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), 23, 59, 59, 999));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  m = raw.match(/^(\\d{1,2})\\s+([A-Za-z]{3,9})\\s+(\\d{4})$/);
  if (m) {
    const months = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11,
    };
    const month = months[m[2].toLowerCase()];
    if (month == null) return null;
    const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1]), 23, 59, 59, 999));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /* ISO timestamps and date strings are accepted only when Date parses them
     unambiguously. Unknown prose is rejected below by the fixed-deadline gate. */
  if (/^\\d{4}-\\d{2}-\\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseJsonObject(value) {
  if (value == null || typeof value === 'object') return value || {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function dateOnlyInZone(now, timeZone = 'Asia/Kolkata') {
  const d = new Date(now == null ? Date.now() : now);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

function hourPartsInZone(now, timeZone = 'Asia/Kolkata') {
  const d = new Date(now == null ? Date.now() : now);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return Object.fromEntries(fmt.formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
}

function localDateAsUtc(dateString, timeZone = 'Asia/Kolkata') {
  const [y, m, d] = String(dateString).split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  const naive = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(naive));
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'));
  return naive - (asUtc - naive);
}

function normalizeFact(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    return JSON.stringify(value, Object.keys(value).sort());
  }
  return String(value)
    .toLowerCase()
    .replace(/[₹$€£]/g, '')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\\s+/g, ' ')
    .trim();
}

function safeDateKey(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  if (raw.length >= 10 && raw[4] === '-' && raw[7] === '-') return raw.slice(0, 10);
  const p = raw.replaceAll('/', '-').split('-');
  if (p.length === 3 && p[0].length === 2 && p[1].length === 2 &&
      (p[2].length === 2 || p[2].length === 4)) {
    const y = p[2].length === 2 ? 2000 + Number(p[2]) : Number(p[2]);
    return Number.isFinite(y) ? String(y).padStart(4, '0') + '-' + p[1] + '-' + p[0] : null;
  }
  return null;
}

function sourceDeadline(sourceType, row) {
  const r = row || {};
  if (sourceType === 'govt_job') {
    const kind = String(r.deadline_kind || '').toLowerCase();
    if (kind && kind !== 'fixed') return { fixed: false, reason: kind };

    const dates = parseJsonObject(r.dates);
    const raw = r.apply_end || r.application_end || dates.apply_end ||
      dates.application_end || r.deadline_text;
    const key = safeDateKey(raw);
    if (!key) return { fixed: false, reason: 'deadline not fixed' };
    return { fixed: true, date: new Date(key + 'T23:59:59.999Z'), raw, dateKey: key };
  }

  const raw = r.deadline || r.valid_through;
  const key = safeDateKey(raw);
  return key ? { fixed: true, date: new Date(key + 'T23:59:59.999Z'), raw, dateKey: key } : { fixed: false, reason: 'deadline not fixed' };
}

function sourceApplicationStart(sourceType, row) {
  const r = row || {};
  if (sourceType === 'govt_job') {
    const dates = parseJsonObject(r.dates);
    return parseDateToken(r.application_start || dates.application_start || dates.apply_start || dates.start);
  }
  const key = safeDateKey(r.application_start);
  return key ? { date: new Date(key + 'T00:00:00.000Z'), raw: r.application_start, dateKey: key } : null;
}

function sourcePublishedAt(row) {
  const r = row || {};
  const raw = r.published_at || r.posted_at || r.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSourceActive(sourceType, row) {
  if (!row) return false;
  if (sourceType === 'job') return row.published === true && !/^closed$|^expired$/i.test(String(row.status || ''));
  if (sourceType === 'govt_job') return String(row.status || '').toLowerCase() === 'active';
  return false;
}

function deadlineEvents(sourceType, row, now = Date.now(), timeZone = 'Asia/Kolkata') {
  if (!isSourceActive(sourceType, row)) return [];
  const info = sourceDeadline(sourceType, row);
  if (!info.fixed) return [];

  const events = [];
  const dateString = dateOnlyInZone(now, timeZone);
  const deadlineDate = info.date;
  const deadlineDateString = info.dateKey || dateStringFromUtcDate(deadlineDate, timeZone);
  const todayStart = localDateAsUtc(dateString, timeZone);
  const deadlineStart = localDateAsUtc(deadlineDateString, timeZone);

  if (todayStart == null || deadlineStart == null) return [];
  const diffDays = Math.round((deadlineStart - todayStart) / DAY_MS);
  const hours = (deadlineDate.getTime() - Number(now)) / (60 * 60 * 1000);

  if (diffDays === 7) events.push('7_days');
  if (diffDays === 3) events.push('3_days');
  if (hours > 0 && hours <= 24) events.push('24_hours');
  if (diffDays === 0) events.push('closing_today');
  if (hours < 0 && hours >= -24) events.push('closed');

  return events;
}

function dateStringFromUtcDate(date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function radarEvents(sourceType, row, now = Date.now(), timeZone = 'Asia/Kolkata') {
  if (!isSourceActive(sourceType, row)) return [];

  const events = [];
  const publishedAt = sourcePublishedAt(row);
  if (publishedAt && Number(now) - publishedAt.getTime() >= 0 &&
      Number(now) - publishedAt.getTime() <= DAY_MS) {
    events.push('newly_announced');
  }

  const start = sourceApplicationStart(sourceType, row);
  const end = sourceDeadline(sourceType, row);
  if (start && end.fixed) {
    const startLocal = start.dateKey || dateStringFromUtcDate(start.date, timeZone);
    const today = dateOnlyInZone(now, timeZone);
    if (startLocal === today && Number(now) <= end.date.getTime()) {
      events.push('application_open');
    }
  }

  events.push(...deadlineEvents(sourceType, row, now, timeZone));
  return Array.from(new Set(events));
}

function compareUpdates(sourceType, previousSnapshot, currentRow) {
  const previous = previousSnapshot || {};
  const fields = sourceType === 'govt_job' ? GOVT_FIELDS : JOB_FIELDS;
  const changes = [];

  for (const field of fields) {
    const before = previous[field];
    const after = currentRow ? currentRow[field] : undefined;
    if (normalizeFact(before) === normalizeFact(after)) continue;
    if (before == null && after == null) continue;
    changes.push({ field, before: before ?? null, after: after ?? null });
  }

  if (sourceType === 'govt_job') {
    const previousDeadline = previous.apply_end || previous.deadline_text;
    const currentDeadline = currentRow && (currentRow.apply_end || currentRow.deadline_text);
    if (normalizeFact(previousDeadline) !== normalizeFact(currentDeadline) &&
        !changes.some((x) => x.field === 'apply_end' || x.field === 'deadline_text')) {
      changes.push({ field: 'deadline', before: previousDeadline ?? null, after: currentDeadline ?? null });
    }
    if (currentRow && normalizeFact(currentRow.previous_apply_end) &&
        normalizeFact(currentRow.previous_apply_end) !== normalizeFact(currentRow.apply_end)) {
      if (!changes.some((x) => x.field === 'apply_end')) {
        changes.push({
          field: 'previous_apply_end',
          before: currentRow.previous_apply_end,
          after: currentRow.apply_end || null,
        });
      }
    }
  }

  return changes;
}

function updateFingerprint(changes) {
  const canonical = (Array.isArray(changes) ? changes : []).map((x) => ({
    field: x.field,
    before: normalizeFact(x.before),
    after: normalizeFact(x.after),
  })).sort((a, b) => String(a.field).localeCompare(String(b.field)));
  return sha256(JSON.stringify(canonical));
}

function updateTemplateKey(sourceType, changes) {
  return `${sourceType}.update.${updateFingerprint(changes).slice(0, 16)}`;
}

module.exports = {
  DAY_MS, EVENT_TYPES, JOB_FIELDS, GOVT_FIELDS,
  parseDateToken, parseJsonObject, dateOnlyInZone, localDateAsUtc,
  normalizeFact, sourceDeadline, sourceApplicationStart, sourcePublishedAt,
  isSourceActive, deadlineEvents, radarEvents, compareUpdates,
  updateFingerprint, updateTemplateKey,
};
