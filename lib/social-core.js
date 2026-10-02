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
  extractHashtags, validateContent, linkUrlAllowed,
  redactSecrets, rollupStatus, zonedDayStartUtc, attemptsToday,
  isUncertainPublishing, isPublishable,
};
