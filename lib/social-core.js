/**
 * CivilCareer — Social Content Engine core (P2, gap report F1)
 *
 * Pure logic, no I/O: every rule the v27 schema cannot enforce in
 * the database lives here so the API layer (_api/social.js) and the
 * publishers (lib/social-publishers.js) share one implementation.
 *
 * Rules implemented (see supabase-v27-social-engine.sql header):
 *   * approved_content_hash = sha256 of the 7 content fields
 *     (title, body_telegram, body_linkedin, caption_instagram,
 *     whatsapp_text, link_url, media_url), nulls as empty strings,
 *     joined by the ASCII unit separator 0x1F. Edits clear it.
 *   * truth_hash = sha256 of the canonical JSON of the source
 *     snapshot. At publish time it is recomputed from the LIVE
 *     source row — the stored truth_state alone is never trusted.
 *   * A 'publishing' ledger row older than 2 minutes is 'uncertain'.
 *   * Test sends (is_test=true) never count toward caps, rollup or
 *     the "already published" check.
 *   * Daily caps count ledger rows by last_attempt_at on the day
 *     boundary of social_settings.caps_timezone; 'uncertain' counts.
 *   * last_error / response_snapshot are redacted before storage.
 *   * Rollup of REAL ledger rows into social_suggestions.status.
 */

const crypto = require('crypto');

const PLATFORMS = ['telegram', 'linkedin', 'instagram'];
const SOURCE_TYPES = ['exam_tracker', 'job', 'govt_job'];

/* The 7 hashed content fields, in hash order (the v27 header order). */
const CONTENT_FIELDS = [
  'title', 'body_telegram', 'body_linkedin', 'caption_instagram',
  'whatsapp_text', 'link_url', 'media_url',
];

const FIELD_LIMITS = {
  body_telegram: 4096,
  body_linkedin: 3000,
  caption_instagram: 2200,
  whatsapp_text: 1000,
};

const MAX_INSTAGRAM_HASHTAGS = 30;
const UNIT_SEPARATOR = '';

/* Ledger rows in these statuses may be (re)claimed for a send. */
const CLAIMABLE_STATUSES = ['pending', 'failed', 'expired', 'cancelled'];

/* A 'publishing' row older than this is treated as 'uncertain'. */
const UNCERTAIN_AFTER_MS = 2 * 60 * 1000;

const SUGGESTION_STATUSES = [
  'pending', 'approved', 'publishing', 'published',
  'partial', 'rejected', 'archived',
];
const LEDGER_STATUSES = [
  'pending', 'publishing', 'sent', 'failed', 'uncertain',
  'cancelled', 'needs_second_step', 'expired',
];

/* ── hashes ─────────────────────────────────────────────────── */

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * approved_content_hash: sha256 of the 7 content fields, nulls as
 * empty strings, joined by the ASCII unit separator (0x1F).
 */
function contentHash(fields) {
  const payload = CONTENT_FIELDS
    .map((f) => (fields == null || fields[f] == null ? '' : String(fields[f])))
    .join(UNIT_SEPARATOR);
  return sha256(payload);
}

/** Stable JSON: object keys sorted recursively so snapshots hash
 *  identically no matter the key order the source returned. */
function canonicalJson(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * truth_hash: sha256 of the canonical JSON of the source snapshot.
 * Recomputed from the LIVE source row at publish time (Truth Lock).
 */
function truthHash(snapshot) {
  return sha256(canonicalJson(snapshot == null ? {} : snapshot));
}

/* Normalize a fact for conservative equality checks. */
function normalizeFact(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[₹$€£]/g, '')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[“”"'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Extract explicit URLs from generated text after HTML escaping is removed. */
function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
}

/* Extract decimal/integer numbers from non-URL content. */
function extractNumbers(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s<>"')\]]+/gi, ' ');
  const matches = withoutUrls.match(/(?<![A-Za-z])\d+(?:[,.]\d+)*(?![A-Za-z])/g) || [];
  return matches.map((raw) => {
    const cleaned = raw.replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }).filter((n) => n != null);
}

/* Recursively collect numbers that are actually present in the source record.
   Dates contribute year/month/day components so normal date formatting is safe. */
function sourceNumbers(value, out = new Set()) {
  if (value == null) return out;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(Math.trunc(value));
    return out;
  }
  if (typeof value === 'string') {
    const nums = value.match(/\d+(?:[,.]\d+)?/g) || [];
    for (const raw of nums) {
      const n = Number(raw.replace(/,/g, ''));
      if (Number.isFinite(n)) out.add(n);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) sourceNumbers(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) sourceNumbers(item, out);
  }
  return out;
}

function baseUrlWithoutUtm(url) {
  try {
    const u = new URL(String(url));
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    return u.toString().replace(/[?&]$/, '');
  } catch (_) {
    return '';
  }
}

/* Generated content may only contain:
   - CivilCareer/site links
   - URLs that already exist in the verified source snapshot
   - the same URLs with the three approved UTM parameters */
function contentUrlsAllowed(content, snapshot, siteUrl) {
  const fields = CONTENT_FIELDS.map((f) => content && content[f]).filter(Boolean);
  const urls = fields.flatMap(extractUrls);
  if (!urls.length) return { ok: true, errors: [] };

  const allowedExact = new Set();
  const sourceUrlKeys = [
    'official_url', 'official_apply_url', 'official_site_url',
    'apply_url', 'source_url', 'official_notice_url',
  ];
  for (const key of sourceUrlKeys) {
    if (snapshot && snapshot[key]) {
      const base = baseUrlWithoutUtm(snapshot[key]);
      if (base) allowedExact.add(base);
    }
  }

  let siteHost = '';
  try { siteHost = new URL(String(siteUrl || '')).host.toLowerCase(); } catch (_) {}

  const errors = [];
  for (const found of urls) {
    const base = baseUrlWithoutUtm(found);
    let host = '';
    try { host = new URL(found).host.toLowerCase(); } catch (_) {
      errors.push(`invalid URL in generated content: ${found}`);
      continue;
    }
    if ((siteHost && host === siteHost) || (base && allowedExact.has(base))) continue;
    errors.push(`URL not present in verified source/site allowlist: ${found}`);
  }
  return { ok: errors.length === 0, errors };
}

/* Fact-level Truth Lock. This catches invented numbers/dates/URLs and
   prevents a total-notification vacancy from being presented as civil vacancies. */
function validateFacts(content, snapshot, siteUrl) {
  const errors = [];
  if (!content || !snapshot) return { ok: false, errors: ['Truth Lock source snapshot is missing'] };

  const allowedNumbers = sourceNumbers(snapshot);
  /* 0 is not a useful recruitment fact, but keep it if the source contains it. */
  const numbers = CONTENT_FIELDS.flatMap((f) => extractNumbers(content[f]));
  for (const n of numbers) {
    if (!allowedNumbers.has(n)) {
      errors.push(`unsupported number in ${numbers.length ? 'generated content' : 'content'}: ${n}`);
    }
  }

  const civilCount = Number(snapshot.civil_posts_count);
  if (Number.isFinite(civilCount)) {
    const civilContexts = CONTENT_FIELDS
      .map((f) => String(content[f] || ''))
      .join('\n')
      .match(/(?:civil|civil engineering|civil posts)[^0-9\n]{0,60}(\d[\d,]*)/gi) || [];
    for (const phrase of civilContexts) {
      const m = String(phrase).match(/(\d[\d,]*)/);
      if (!m) continue;
      const value = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value !== civilCount) {
        errors.push(\`civil vacancy number \${value} does not match verified civil_posts_count \${civilCount}\`);
      }
    }
  }

  const urls = contentUrlsAllowed(content, snapshot, siteUrl);
  errors.push(...urls.errors);

  return { ok: errors.length === 0, errors };
}

/* ── content validation ─────────────────────────────────────── */

/** Extract hashtags (#word) from an Instagram caption. */
function extractHashtags(text) {
  if (!text) return [];
  const matches = String(text).match(/#[\w\u0900-\u097F\u00C0-\u024F]+/g) || [];
  return matches;
}

/**
 * Validate suggestion content against the per-platform limits the
 * API must enforce (the DB has no CHECK for length).
 * Returns { ok, errors: string[] }.
 */
function validateContent(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return { ok: false, errors: ['No content'] };
  if (!String(row.title || '').trim()) errors.push('title is required');

  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = row[field];
    if (value == null) continue;
    if (typeof value !== 'string') { errors.push(`${field} must be text`); continue; }
    if (value.length > limit) errors.push(`${field} exceeds ${limit} characters`);
  }

  const caption = row.caption_instagram;
  if (caption != null) {
    const tags = extractHashtags(caption);
    if (tags.length > MAX_INSTAGRAM_HASHTAGS) {
      errors.push(`caption_instagram has ${tags.length} hashtags (max ${MAX_INSTAGRAM_HASHTAGS})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * link_url must live on the SITE_URL host so suggestions can never
 * be used as a phishing redirect. Empty is allowed (text-only post).
 */
function linkUrlAllowed(url, siteUrl) {
  if (url == null || String(url).trim() === '') return true;
  const base = String(siteUrl || '');
  let baseHost = '';
  try { baseHost = new URL(base).host.toLowerCase(); } catch (_) { return false; }
  let host = '';
  try { host = new URL(String(url)).host.toLowerCase(); } catch (_) { return false; }
  return host === baseHost;
}

/* ── secret redaction ───────────────────────────────────────── */

/**
 * Redact tokens before storing last_error / response_snapshot:
 * strips query-string tokens (access_token, api_key, token, key,
 * secret), Bearer headers, and the bot token inside Telegram
 * api.telegram.org/bot<token>/... URLs.
 */
function redactSecrets(text) {
  if (text == null) return '';
  return String(text)
    .replace(/([?&])(access_token|api_key|apikey|token|secret|password|client_secret)=([^&"'\s]*)/gi,
      '$1$2=[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
    /* Scheme optional: Telegram error text may carry the
       relative /bot<token>/ path as well as the full URL. */
    .replace(/(https?:\/\/[^\s"']*?\/bot|\/bot)[A-Za-z0-9:_\-]+/gi, '$1[REDACTED]');
}

/* ── ledger rollup ──────────────────────────────────────────── */

/**
 * Rollup of REAL (is_test=false) ledger rows into the suggestion
 * status, exactly as the v27 header specifies:
 *   any 'publishing' or 'needs_second_step'            -> 'publishing'
 *   >= 1 row and every row 'sent'                       -> 'published'
 *   >= 1 'sent', the rest failed/uncertain/expired/...  -> 'partial'
 *   no rows, or only 'pending'/'cancelled'/'failed'     -> 'approved'
 */
function rollupStatus(rows) {
  const real = (Array.isArray(rows) ? rows : []).filter((r) => r && !r.is_test);
  if (real.some((r) => r.status === 'publishing' || r.status === 'needs_second_step')) {
    return 'publishing';
  }
  if (real.length > 0 && real.every((r) => r.status === 'sent')) return 'published';
  if (real.some((r) => r.status === 'sent')) return 'partial';
  return 'approved';
}

/* ── daily caps (caps_timezone day boundary) ────────────────── */

/**
 * UTC instant of the start of the day that contains `now` in the
 * IANA timezone `tz` (e.g. 'Asia/Kolkata'). Uses only the built-in
 * Intl API — no dependency. The result is what `last_attempt_at >=`
 * must be compared against when counting the day's attempts.
 */
function zonedDayStartUtc(now, tz) {
  const date = new Date(now == null ? Date.now() : now);
  let zone = String(tz || 'Asia/Kolkata');
  /* Intl throws on an unknown zone — fall back to the default. */
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(date);
  } catch (_) {
    zone = 'Asia/Kolkata';
  }

  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const [y, m, d] = ymd.split('-').map(Number);
  /* Naive UTC instant of local midnight... */
  const naive = Date.UTC(y, m - 1, d);
  /* ...minus the zone's offset at that instant. */
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(naive));
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'));
  return naive - (asUtc - naive);
}

/**
 * Count the day's REAL attempts for a platform: ledger rows with
 * is_test=false and last_attempt_at on/after the day start.
 * 'uncertain' rows count (v27 header); test rows never do.
 */
function attemptsToday(rows, platform, dayStartUtc) {
  return (Array.isArray(rows) ? rows : []).filter((r) =>
    r && !r.is_test && r.platform === platform &&
    r.last_attempt_at && new Date(r.last_attempt_at).getTime() >= dayStartUtc
  ).length;
}

/* ── ledger claim guards ────────────────────────────────────── */

/** A 'publishing' ledger row older than 2 minutes is 'uncertain'. */
function isUncertainPublishing(row, now) {
  if (!row || row.status !== 'publishing') return false;
  const since = row.updated_at || row.last_attempt_at || row.created_at;
  if (!since) return false;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return false;
  return (now == null ? Date.now() : now) - t > UNCERTAIN_AFTER_MS;
}

/** Suggestion statuses the publish endpoint may act on. */
function isPublishable(suggestion) {
  return suggestion &&
    (suggestion.status === 'approved' || suggestion.status === 'partial');
}

module.exports = {
  PLATFORMS, SOURCE_TYPES, CONTENT_FIELDS, FIELD_LIMITS,
  MAX_INSTAGRAM_HASHTAGS, CLAIMABLE_STATUSES, UNCERTAIN_AFTER_MS,
  SUGGESTION_STATUSES, LEDGER_STATUSES,
  sha256, contentHash, canonicalJson, truthHash,
  normalizeFact, extractUrls, extractNumbers, sourceNumbers, contentUrlsAllowed,
  validateFacts, extractHashtags, validateContent, linkUrlAllowed,
  redactSecrets, rollupStatus, zonedDayStartUtc, attemptsToday,
  isUncertainPublishing, isPublishable,
};
