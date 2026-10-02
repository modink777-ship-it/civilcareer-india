/**
 * CivilCareer — Social Content Engine API (P2, gap report F4)
 *
 * Single-segment /api/social — every operation rides the query
 * string or body `op` because Vercel's Hobby router only matches
 * 0–1 extra segments (same pattern as /api/interview).
 *
 *   GET  /api/social                 dashboard: queue + settings
 *   GET  /api/social?op=settings     engine settings
 *   PATCH /api/social?op=settings    update settings
 *   GET  /api/social?op=connections  connection metadata
 *   POST /api/social?op=connections  register / act on a connection
 *   GET  /api/social?op=ledger&id=   send ledger for one suggestion
 *   POST /api/social {op:'create'}   build a suggestion from a live source
 *   POST /api/social {op:'edit'}     edit content (clears approval hash)
 *   POST /api/social {op:'approve'}  approve (locks content hash)
 *   POST /api/social {op:'reject'}   reject
 *   POST /api/social {op:'publish'}  Truth Lock → claim → send → rollup
 *   POST /api/social {op:'test'}     test send (is_test=true, no caps)
 *   POST /api/social {op:'resolve'}  resolve uncertain/failed rows
 *   GET  /api/social?op=drain       scheduled queue drain
 *                                    (SOCIAL_CRON_SECRET — see below)
 *
 * Auth: every route is admin-only. The dispatcher elevates a
 * Supabase admin session (ADMIN_RULES) or passes the real owner
 * key through; this handler enforces requireOwner itself so it is
 * equally safe when called directly. The ONE exception is
 * op=drain: the scheduled drain authenticates with
 * SOCIAL_CRON_SECRET (or CRON_SECRET) and can ONLY drain the
 * approved queue — it never unlocks settings, the ledger or
 * any other operation.
 *
 * Tables: social_suggestions / social_publishes / social_connections
 * / social_settings (supabase-v27-social-engine.sql — service_role
 * only, RLS locked down).
 */

/* Supabase config is read per request (never captured at
   module load) so the handler observes the deployment's
   current environment on every call. */
function supaConfig() {
  return {
    url: String(process.env.SUPABASE_URL || ''),
    key: String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY || ''
    ),
  };
}

const {
  requireOwner, allowSameOrigin, SITE_URL,
} = require('../lib/security');
const core = require('../lib/social-core');
const templates = require('../lib/social-templates');
const publishers = require('../lib/social-publishers');

const {
  PLATFORMS, SOURCE_TYPES, CLAIMABLE_STATUSES,
  contentHash, truthHash, validateContent, validateFacts, linkUrlAllowed,
  redactSecrets, rollupStatus, zonedDayStartUtc, attemptsToday,
  isUncertainPublishing, isPublishable,
} = core;

const DEFAULT_SETTINGS = {
  kill_switch: false,
  require_approval: true,
  per_platform_daily_caps: { telegram: 5, linkedin: 2, instagram: 2 },
  caps_timezone: 'Asia/Kolkata',
  default_hashtags: [],
  footer: null,
  site_url: null,
};

/* Source tables behind social_suggestions.source_type. */
const SOURCE_TABLES = {
  exam_tracker: 'exam_tracker',
  job: 'jobs',
  govt_job: 'govt_jobs',
};

function supa(path, opts = {}) {
  const { url, key } = supaConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function actor(req) {
  return (req.adminUser && req.adminUser.email) || 'owner-key';
}

async function getSettings() {
  const r = await supa('social_settings?id=eq.1&limit=1');
  if (!r.ok) return { ...DEFAULT_SETTINGS, _error: true };
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : { ...DEFAULT_SETTINGS };
}

async function fetchSourceRow(sourceType, sourceId) {
  const table = SOURCE_TABLES[sourceType];
  if (!table) return null;
  const r = await supa(
    `${table}?select=*&id=eq.${encodeURIComponent(sourceId)}&limit=1`,
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function sourceIsVerified(sourceType, row) {
  if (!row) return { ok: false, error: 'Source record not found' };

  if (sourceType === 'exam_tracker') {
    if (row.is_active === false) return { ok: false, error: 'Exam source is inactive' };
    return { ok: true };
  }

  if (sourceType === 'job') {
    if (row.published !== true) return { ok: false, error: 'Private job is not published/verified yet' };
    return { ok: true };
  }

  if (sourceType === 'govt_job') {
    if (String(row.status || '').toLowerCase() !== 'active') {
      return { ok: false, error: 'Government job is not active' };
    }
    if (!row.reviewed_at) {
      return { ok: false, error: 'Government job has not been reviewed by an admin' };
    }
    const civil = Number(row.civil_posts_count);
    if (!Number.isFinite(civil) || civil <= 0) {
      return { ok: false, error: 'Government job has no verified civil posts' };
    }
    return { ok: true };
  }

  return { ok: false, error: 'Unsupported source type' };
}

/* ── suggestion list ────────────────────────────────── */

async function listSuggestions(query) {
  const filters = [];
  if (query.status) {
    const ok = String(query.status).split(',').filter((s) =>
      core.SUGGESTION_STATUSES.includes(s));
    if (ok.length) filters.push(`status=in.(${ok.join(',')})`);
  }
  if (query.source_type && SOURCE_TYPES.includes(query.source_type)) {
    filters.push(`source_type=eq.${query.source_type}`);
  }
  const qs = filters.length ? `&${filters.join('&')}` : '';
  const r = await supa(
    `social_suggestions?select=*,social_publishes(*)&order=created_at.desc&limit=100${qs}`,
  );
  if (!r.ok) {
    const detail = await r.text();
    if (/PGRST205|relation .* does not exist|Could not find the table/i.test(detail)) {
      return { missingTable: true, suggestions: [] };
    }
    throw new Error(detail.slice(0, 300));
  }
  return { suggestions: await r.json() };
}

/* ── create ─────────────────────────────────────────── */

async function createSuggestion(body, req) {
  const sourceType = String(body.source_type || '');
  const sourceId = String(body.source_id || '');
  if (!SOURCE_TYPES.includes(sourceType)) {
    return { status: 400, error: `source_type must be one of: ${SOURCE_TYPES.join(', ')}` };
  }
  if (!sourceId) return { status: 400, error: 'source_id is required' };

  const row = await fetchSourceRow(sourceType, sourceId);
  if (!row) return { status: 404, error: 'Source record not found' };
  const verified = await sourceIsVerified(sourceType, row);
  if (!verified.ok) return { status: 409, error: verified.error };

  const settings = await getSettings();
  const built = templates.buildSuggestion(sourceType, sourceId, row, {
    templateKey: body.template_key || undefined,
    siteUrl: settings.site_url || SITE_URL,
    footer: settings.footer,
    defaultHashtags: settings.default_hashtags,
    createdBy: actor(req),
  });
  if (!built.ok) return { status: 400, error: built.error };

  const suggestion = built.suggestion;
  suggestion.truth_hash = truthHash(built.snapshot);

  const check = validateContent(suggestion);
  if (!check.ok) return { status: 400, error: check.errors.join('; ') };
  const factCheck = validateFacts(suggestion, built.snapshot, settings.site_url || SITE_URL);
  if (!factCheck.ok) return { status: 400, error: 'FACT CHECK FAILED: ' + factCheck.errors.join('; ') };
  if (!linkUrlAllowed(suggestion.link_url, settings.site_url || SITE_URL)) {
    return { status: 400, error: 'link_url must be on the site host' };
  }

  /* Approval policy: when approval is not required the suggestion
     is born approved with its content hash locked. */
  if (settings.require_approval === false) {
    suggestion.status = 'approved';
    suggestion.approved_content_hash = contentHash(suggestion);
    suggestion.approved_by = 'auto';
    suggestion.approved_at = new Date().toISOString();
  }

  const r = await supa('social_suggestions', {
    method: 'POST',
    body: JSON.stringify(suggestion),
  });
  if (!r.ok) {
    const detail = await r.text();
    /* Dedupe index fired — return the existing active suggestion. */
    if (/duplicate key value violates unique constraint|23505/.test(detail)) {
      const existing = await supa(
        `social_suggestions?select=*,social_publishes(*)&source_type=eq.${sourceType}&source_id=eq.${encodeURIComponent(sourceId)}&template_key=eq.${encodeURIComponent(suggestion.template_key)}&limit=1`,
      );
      if (existing.ok) {
        const rows = await existing.json();
        if (rows && rows[0]) return { status: 200, result: { suggestion: rows[0], existed: true } };
      }
    }
    return { status: 500, error: 'Suggestion could not be created', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  return { status: 201, result: { suggestion: Array.isArray(rows) ? rows[0] : rows, existed: false } };
}

/* ── edit / approve / reject ────────────────────────── */

const EDITABLE_FIELDS = [
  'title', 'body_telegram', 'body_linkedin', 'caption_instagram',
  'whatsapp_text', 'link_url', 'media_url',
];

async function editSuggestion(id, body, req) {
  const current = await loadSuggestion(id);
  if (!current) return { status: 404, error: 'Suggestion not found' };
  if (current.status === 'publishing' || current.status === 'published') {
    return { status: 400, error: `Cannot edit a suggestion in "${current.status}" state` };
  }

  const payload = { edited_at: new Date().toISOString(), edited_by: actor(req) };
  let changed = false;
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    payload[field] = body[field] == null ? null : String(body[field]);
    changed = true;
  }
  if (!changed) return { status: 400, error: 'No content fields to update' };

  const merged = { ...current, ...payload };
  const check = validateContent(merged);
  if (!check.ok) return { status: 400, error: check.errors.join('; ') };
  const settings = await getSettings();
  const source = await fetchSourceRow(current.source_type, current.source_id);
  const verified = await sourceIsVerified(current.source_type, source);
  if (!verified.ok) return { status: 409, error: verified.error };
  const snapshot = templates.buildSnapshot(current.source_type, source);
  const factCheck = validateFacts(merged, snapshot, settings.site_url || SITE_URL);
  if (!factCheck.ok) return { status: 400, error: 'FACT CHECK FAILED: ' + factCheck.errors.join('; ') };
  if (!linkUrlAllowed(merged.link_url, settings.site_url || SITE_URL)) {
    return { status: 400, error: 'link_url must be on the site host' };
  }

  /* An edit invalidates the approval — content must be re-approved
     before the next publish (the content hash is cleared). */
  payload.approved_content_hash = null;
  if (current.status === 'approved') payload.status = 'pending';

  const r = await supa(`social_suggestions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Suggestion could not be updated', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  return { status: 200, result: { suggestion: Array.isArray(rows) ? rows[0] : rows } };
}

async function approveSuggestion(id, req) {
  const current = await loadSuggestion(id);
  if (!current) return { status: 404, error: 'Suggestion not found' };
  if (current.status !== 'pending' && current.status !== 'partial') {
    return { status: 400, error: `Only pending/partial suggestions can be approved (now "${current.status}")` };
  }
  const check = validateContent(current);
  if (!check.ok) return { status: 400, error: check.errors.join('; ') };
  const settings = await getSettings();
  const lock = await truthLock(current);
  if (!lock.ok) return { status: 409, error: lock.error };
  if (!linkUrlAllowed(current.link_url, settings.site_url || SITE_URL)) {
    return { status: 400, error: 'link_url must be on the site host' };
  }

  const r = await supa(`social_suggestions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'approved',
      approved_content_hash: contentHash(current),
      approved_by: actor(req),
      approved_at: new Date().toISOString(),
      rejected_by: null,
      rejected_at: null,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Suggestion could not be approved', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  return { status: 200, result: { suggestion: Array.isArray(rows) ? rows[0] : rows } };
}

async function rejectSuggestion(id, body, req) {
  const current = await loadSuggestion(id);
  if (!current) return { status: 404, error: 'Suggestion not found' };
  const r = await supa(`social_suggestions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'rejected',
      rejected_by: actor(req),
      rejected_at: new Date().toISOString(),
      admin_note: body.admin_note ? String(body.admin_note).slice(0, 2000) : null,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Suggestion could not be rejected', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  return { status: 200, result: { suggestion: Array.isArray(rows) ? rows[0] : rows } };
}

/* ── publish (Truth Lock + claim + send + rollup) ─── */

async function loadSuggestion(id) {
  const r = await supa(
    `social_suggestions?select=*,social_publishes(*)&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Truth Lock: recompute the truth hash from the LIVE source row.
 * Returns { ok, liveRow, snapshot } or { ok:false, error }.
 */
async function truthLock(suggestion) {
  const liveRow = await fetchSourceRow(suggestion.source_type, suggestion.source_id);
  if (!liveRow) {
    return { ok: false, error: 'Source record no longer exists — suggestion is stale' };
  }
  const snapshot = templates.buildSnapshot(suggestion.source_type, liveRow);
  const liveHash = truthHash(snapshot);
  if (liveHash !== suggestion.truth_hash) {
    /* Persist the stale flag so the queue shows it. */
    await supa(`social_suggestions?id=eq.${encodeURIComponent(suggestion.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ truth_state: 'stale', truth_checked_at: new Date().toISOString() }),
    }).catch(() => {});
    return { ok: false, error: 'TRUTH LOCK: the source record changed after this suggestion was generated. Regenerate the suggestion.' };
  }
  const verified = await sourceIsVerified(suggestion.source_type, liveRow);
  if (!verified.ok) return { ok: false, error: 'TRUTH LOCK: ' + verified.error };
  const settings = await getSettings();
  const factCheck = validateFacts(suggestion, snapshot, settings.site_url || SITE_URL);
  if (!factCheck.ok) return { ok: false, error: 'FACT CHECK FAILED: ' + factCheck.errors.join('; ') };
  return { ok: true, liveRow, snapshot, factCheck };
}

/**
 * Content lock: the stored approved_content_hash must match the
 * current text. A null hash means the content was edited after
 * approval (or never approved) — refuse.
 */
function contentLock(suggestion) {
  if (!suggestion.approved_content_hash) {
    return { ok: false, error: 'Content was edited after approval (or never approved) — re-approve first' };
  }
  const current = contentHash(suggestion);
  if (current !== suggestion.approved_content_hash) {
    return { ok: false, error: 'CONTENT LOCK: approved content hash mismatch — re-approve the current text' };
  }
  return { ok: true };
}

/** Claim the ledger row for a platform as 'publishing'.
 *  Atomic conditional update: the status guard + returning. */
async function claimLedgerRow(suggestionId, platform) {
  const guard = `suggestion_id=eq.${encodeURIComponent(suggestionId)}&platform=eq.${platform}&status=in.(${CLAIMABLE_STATUSES.join(',')})`;
  const r = await supa(`social_publishes?${guard}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'publishing',
      attempts: 0, /* incremented after the claim */
      last_attempt_at: new Date().toISOString(),
      last_error: null,
      response_snapshot: null,
    }),
  });
  if (r.ok) {
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]) {
      const row = rows[0];
      const nextAttempts = Number(row.attempts || 0) + 1;
      const bump = await supa(
        `social_publishes?id=eq.${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ attempts: nextAttempts }),
        },
      );
      if (bump.ok) {
        const bumped = await bump.json();
        if (Array.isArray(bumped) && bumped[0]) return { claimed: bumped[0] };
      }
      return { claimed: row };
    }
  }
  /* No claimable row — either none exists yet (INSERT) or it is
     publishing/sent/uncertain (caller decides). */
  return { claimed: null };
}

async function ensureLedgerRow(suggestionId, platform) {
  const existing = await supa(
    `social_publishes?suggestion_id=eq.${encodeURIComponent(suggestionId)}&platform=eq.${platform}&is_test=eq.false&limit=1`,
  );
  if (!existing.ok) return { error: 'Ledger lookup failed' };
  const rows = await existing.json();
  const row = Array.isArray(rows) ? rows[0] : null;

  if (row) {
    if (row.status === 'sent') return { already: row };
    if (row.status === 'publishing' && !isUncertainPublishing(row)) {
      return { busy: row };
    }
    if (row.status === 'publishing' && isUncertainPublishing(row)) {
      /* Stale 'publishing' → 'uncertain'. NEVER auto-retried. */
      await supa(`social_publishes?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'uncertain' }),
      }).catch(() => {});
      return { uncertain: { ...row, status: 'uncertain' } };
    }
    const claim = await claimLedgerRow(suggestionId, platform);
    if (claim.claimed) return { claimed: claim.claimed };
    return { busy: row };
  }

  /* First attempt for this platform: insert as 'publishing'. */
  const r = await supa('social_publishes', {
    method: 'POST',
    body: JSON.stringify({
      suggestion_id: suggestionId,
      platform,
      status: 'publishing',
      is_test: false,
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    if (/duplicate key value violates unique constraint|23505/.test(detail)) {
      return { busy: null, retry: true };
    }
    return { error: detail.slice(0, 300) };
  }
  const inserted = await r.json();
  return { claimed: Array.isArray(inserted) ? inserted[0] : null };
}

async function capHeadroom(platform, settings) {
  const caps = settings.per_platform_daily_caps || {};
  const cap = Number(caps[platform]);
  if (!Number.isFinite(cap) || cap <= 0) return { allowed: false, cap: cap || 0, used: 0 };
  const dayStart = zonedDayStartUtc(Date.now(), settings.caps_timezone);
  const r = await supa(
    `social_publishes?platform=eq.${platform}&order=last_attempt_at.desc&limit=500`,
  );
  const rows = r.ok ? await r.json() : [];
  const used = attemptsToday(rows, platform, dayStart);
  return { allowed: used < cap, cap, used };
}

/** Send one platform's content and persist the ledger outcome. */
async function sendPlatform(suggestion, platform, ledgerRow, settings, opts = {}) {
  const isTest = Boolean(opts.isTest);
  const env = process.env;
  let result;
  if (platform === 'telegram') {
    const chatId = isTest
      ? publishers.telegramTestChannel(env)
      : env.TELEGRAM_CHANNEL_ID;
    result = await publishers.sendTelegram({
      token: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: suggestion.body_telegram || suggestion.title,
      disablePreview: true,
    });
  } else if (platform === 'linkedin') {
    result = await publishers.sendLinkedIn({
      token: env.LINKEDIN_ACCESS_TOKEN,
      organizationId: env.LINKEDIN_ORGANIZATION_ID,
      apiVersion: env.LINKEDIN_API_VERSION,
      text: suggestion.body_linkedin || suggestion.title,
      mediaUrl: suggestion.media_url,
    });
  } else if (platform === 'instagram') {
    result = await publishers.sendInstagram({
      token: env.INSTAGRAM_ACCESS_TOKEN,
      accountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
      apiVersion: env.INSTAGRAM_API_VERSION,
      caption: suggestion.caption_instagram || suggestion.title,
      mediaUrl: suggestion.media_url,
    });
  } else {
    result = await (publishers.publisherFor(platform) || (() =>
      Promise.resolve({ ok: false, error: 'Unknown platform', retryable: false })))();
  }

  const patch = {
    status: result.ok ? 'sent' : (result.ambiguous ? 'uncertain' : 'failed'),
    last_attempt_at: new Date().toISOString(),
  };
  if (result.ok) {
    patch.external_id = result.externalId;
    patch.external_url = result.externalUrl;
    patch.destination_ref = result.destinationRef || null;
    patch.sent_at = new Date().toISOString();
    patch.last_error = null;
    patch.response_snapshot = null;
  } else {
    patch.last_error = redactSecrets(result.error);
    patch.response_snapshot = result.response
      ? JSON.parse(redactSecrets(JSON.stringify(result.response)))
      : null;
  }

  const r = await supa(`social_publishes?id=eq.${encodeURIComponent(ledgerRow.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  let stored = ledgerRow;
  if (r.ok) {
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]) stored = rows[0];
  }
  return { platform, ok: result.ok, error: result.error, retryable: result.retryable, row: stored };
}

/**
 * Publish a suggestion to the requested platforms (or every
 * platform the template renders for). Enforces, in order:
 * kill switch → publishable state → Truth Lock → content lock
 * → per-platform "already sent" / in-progress / uncertain
 * checks → daily cap → claim → send → rollup.
 */
async function publishSuggestion(id, body, opts = {}) {
  const settings = await getSettings();
  if (settings._error) {
    return { status: 503, error: 'Social engine settings missing — run supabase-v27-social-engine.sql' };
  }
  if (settings.kill_switch) {
    return { status: 403, error: 'Kill switch is ON — publishing is disabled' };
  }

  const suggestion = await loadSuggestion(id);
  if (!suggestion) return { status: 404, error: 'Suggestion not found' };
  if (!isPublishable(suggestion)) {
    return { status: 400, error: `Suggestion status "${suggestion.status}" cannot be published` };
  }

  /* Truth Lock — recomputed from the LIVE source row. */
  const lock = await truthLock(suggestion);
  if (!lock.ok) return { status: 409, error: lock.error };

  const content = contentLock(suggestion);
  if (!content.ok) return { status: 409, error: content.error };

  const requested = body.platform
    ? [String(body.platform).toLowerCase()]
    : (Array.isArray(body.platforms) && body.platforms.length
      ? body.platforms.map((p) => String(p).toLowerCase())
      : ['telegram']);

  if (requested.length !== 1) {
    return {
      status: 400,
      error: 'Publish accepts exactly one platform per request. Use the admin Publish Everywhere action to orchestrate separate requests.',
    };
  }

  const results = [];
  for (const platform of requested) {
    if (!PLATFORMS.includes(platform)) {
      results.push({ platform, ok: false, error: `Unknown platform: ${platform}` });
      continue;
    }
    if (!publishers.platformConfigured(platform)) {
      results.push({ platform, ok: false, error: `${platform} is not configured (missing env credentials)` });
      continue;
    }

    const ledger = await ensureLedgerRow(suggestion.id, platform);
    if (ledger.already) {
      results.push({ platform, ok: true, skipped: 'already sent', row: ledger.already });
      continue;
    }
    if (ledger.busy) {
      results.push({ platform, ok: false, error: 'A send is already in progress for this platform' });
      continue;
    }
    if (ledger.uncertain) {
      results.push({ platform, ok: false, error: 'Previous attempt is UNCERTAIN — an admin must resolve it first' });
      continue;
    }
    if (ledger.error) {
      results.push({ platform, ok: false, error: ledger.error });
      continue;
    }
    if (ledger.retry) {
      results.push({ platform, ok: false, error: 'Ledger row changed concurrently — retry' });
      continue;
    }

    const cap = await capHeadroom(platform, settings);
    if (!cap.allowed) {
      results.push({ platform, ok: false, error: `Daily cap reached (${cap.cap} today)`, cap });
      continue;
    }

    const outcome = await sendPlatform(suggestion, platform, ledger.claimed, settings);
    results.push(outcome);
    /* Sequential sends respect platform rate limits. */
    await new Promise((r) => setTimeout(r, 400));
  }

  /* Rollup (REAL rows only — test sends never move the status). */
  const after = await loadSuggestion(id);
  const rolled = after ? rollupStatus(after.social_publishes || []) : suggestion.status;
  if (after && rolled !== after.status) {
    await supa(`social_suggestions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: rolled }),
    }).catch(() => {});
  }

  return { status: 200, result: { suggestion: after, results } };
}

/** Test send: is_test=true — excluded from caps, rollup and the
 *  already-published check. Same Truth Lock, though: a test must
 *  never send content that no longer matches the source. */
async function testSend(id, body) {
  const settings = await getSettings();
  if (settings._error) {
    return { status: 503, error: 'Social engine settings missing — run supabase-v27-social-engine.sql' };
  }
  if (settings.kill_switch) {
    return { status: 403, error: 'Kill switch is ON — publishing is disabled' };
  }
  const suggestion = await loadSuggestion(id);
  if (!suggestion) return { status: 404, error: 'Suggestion not found' };

  const platform = String(body.platform || 'telegram').toLowerCase();
  if (!PLATFORMS.includes(platform)) {
    return { status: 400, error: `platform must be one of: ${PLATFORMS.join(', ')}` };
  }
  if (!publishers.platformConfigured(platform)) {
    return { status: 400, error: `${platform} is not configured or not yet enabled in this phase` };
  }
  if (platform === 'telegram' && !publishers.telegramTestChannel(process.env)) {
    return { status: 400, error: 'TELEGRAM_TEST_CHANNEL_ID is not configured; use the normal approved Telegram publish to TELEGRAM_CHANNEL_ID.' };
  }
  const lock = await truthLock(suggestion);
  if (!lock.ok) return { status: 409, error: lock.error };
  const content = contentLock(suggestion);
  if (!content.ok) return { status: 409, error: content.error };

  /* Test rows are exempt from the one-real-row-per-platform index. */
  const r = await supa('social_publishes', {
    method: 'POST',
    body: JSON.stringify({
      suggestion_id: id,
      platform,
      status: 'publishing',
      is_test: true,
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
      destination_ref: platform === 'telegram'
        ? publishers.telegramTestChannel(process.env)
        : platform === 'linkedin'
          ? process.env.LINKEDIN_ORGANIZATION_ID || null
          : process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || null,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Test send could not be queued', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  const ledgerRow = Array.isArray(rows) ? rows[0] : null;

  const outcome = await sendPlatform(suggestion, platform, ledgerRow, settings, { isTest: true });
  return { status: 200, result: { outcome } };
}

/** Resolve an uncertain or failed ledger row: cancel it, or retry
 *  (reset to pending and re-run the publish flow for that platform). */
async function resolveLedger(id, body) {
  const platform = String(body.platform || '').toLowerCase();
  const action = String(body.action || '');
  if (!PLATFORMS.includes(platform)) {
    return { status: 400, error: `platform must be one of: ${PLATFORMS.join(', ')}` };
  }
  if (!['retry', 'cancel'].includes(action)) {
    return { status: 400, error: "action must be 'retry' or 'cancel'" };
  }

  const suggestion = await loadSuggestion(id);
  if (!suggestion) return { status: 404, error: 'Suggestion not found' };

  const r = await supa(
    `social_publishes?suggestion_id=eq.${encodeURIComponent(id)}&platform=eq.${platform}&is_test=eq.false&limit=1`,
  );
  if (!r.ok) return { status: 500, error: 'Ledger lookup failed' };
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { status: 404, error: 'No ledger row for this platform' };

  if (action === 'cancel') {
    const c = await supa(`social_publishes?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (!c.ok) return { status: 500, error: 'Ledger row could not be cancelled' };
  } else {
    /* retry: back to claimable, then publish this platform only */
    const c = await supa(`social_publishes?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending' }),
    });
    if (!c.ok) return { status: 500, error: 'Ledger row could not be reset' };
    return publishSuggestion(id, { platforms: [platform] });
  }

  const after = await loadSuggestion(id);
  const rolled = rollupStatus(after.social_publishes || []);
  if (after && rolled !== after.status) {
    await supa(`social_suggestions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: rolled }),
    }).catch(() => {});
  }
  return { status: 200, result: { suggestion: after } };
}

/* ── scheduled queue drain (SOCIAL_CRON_SECRET) ── */

/**
 * The scheduler credential. SOCIAL_CRON_SECRET (with a
 * CRON_SECRET fallback) is accepted as a Bearer token or the
 * x-cron-secret header; the owner key keeps working for manual
 * and GitHub Actions runs. Deliberately SEPARATE from the
 * dispatcher's CRON_ROUTES: scheduler access to the drain can
 * never imply exam-alert or discovery-crawler access.
 */
function isSocialCronRequest(req) {
  const secret = String(
    process.env.SOCIAL_CRON_SECRET ||
    process.env.CRON_SECRET || ''
  ).trim();
  if (secret) {
    if (String(req.headers.authorization || '') === `Bearer ${secret}`) return true;
    if (String(req.headers['x-cron-secret'] || '') === secret) return true;
  }
  const ownerKey = String(process.env.OWNER_KEY || '').trim();
  if (ownerKey) {
    if (String(req.headers['x-owner-key'] || '') === ownerKey) return true;
    if (String(req.headers.authorization || '') === `Bearer ${ownerKey}`) return true;
  }
  /* No secret configured: only the Vercel Cron user agent. */
  if (!secret && /vercel-cron\/1\.0/i.test(String(req.headers['user-agent'] || ''))) return true;
  return false;
}

/** Publish every approved suggestion (oldest first). Each row
 *  runs the FULL publish pipeline — Truth Lock, content lock,
 *  per-platform claim, daily caps — and one bad row never
 *  stops the drain. */
async function drainQueue(limit) {
  const settings = await getSettings();
  if (settings._error) {
    return { status: 503, error: 'Social engine settings missing — run supabase-v27-social-engine.sql' }; 
  }
  if (settings.kill_switch) {
    return { status: 403, error: 'Kill switch is ON — publishing is disabled' };
  }

  const max = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const r = await supa(
    `social_suggestions?status=eq.approved&order=created_at.asc&limit=${max}`,
  );
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Queue could not be loaded', details: detail.slice(0, 300) };
  }
  const queued = await r.json();

  const results = [];
  for (const suggestion of Array.isArray(queued) ? queued : []) {
    const out = await publishSuggestion(suggestion.id, {});
    const outcomes = (out.result && out.result.results) || [];
    results.push({
      id: suggestion.id,
      source_type: suggestion.source_type,
      template_key: suggestion.template_key,
      status: out.status === 200 ? 'ok' : 'skipped',
      reason: out.status === 200 ? null : out.error,
      sent: outcomes.filter((x) => x.ok && !x.skipped).length,
      platforms: outcomes.map((x) => ({
        platform: x.platform,
        ok: Boolean(x.ok),
        skipped: Boolean(x.skipped),
        error: x.error ? redactSecrets(x.error) : null,
      })),
    });
  }

  return {
    status: 200,
    result: {
      drained: results.length,
      published: results.filter((x) => x.sent > 0).length,
      results,
    },
  };
}

/* ── settings ───────────────────────────────────────── */

const IANA_ZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)?$/;

function validTimezone(tz) {
  if (!IANA_ZONE_RE.test(String(tz || ''))) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
}

async function updateSettings(body) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(body, 'kill_switch')) {
    payload.kill_switch = Boolean(body.kill_switch);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'require_approval')) {
    payload.require_approval = Boolean(body.require_approval);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'per_platform_daily_caps')) {
    const caps = body.per_platform_daily_caps;
    if (!caps || typeof caps !== 'object') {
      return { status: 400, error: 'per_platform_daily_caps must be an object' };
    }
    const clean = {};
    for (const p of PLATFORMS) {
      const v = Number(caps[p]);
      if (!Number.isFinite(v) || v < 0 || v > 1000) {
        return { status: 400, error: `per_platform_daily_caps.${p} must be a number 0–1000` };
      }
      clean[p] = Math.floor(v);
    }
    payload.per_platform_daily_caps = clean;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'caps_timezone')) {
    if (!validTimezone(body.caps_timezone)) {
      return { status: 400, error: 'caps_timezone must be a valid IANA timezone' };
    }
    payload.caps_timezone = String(body.caps_timezone);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'default_hashtags')) {
    const tags = body.default_hashtags;
    if (!Array.isArray(tags) || tags.length > 30) {
      return { status: 400, error: 'default_hashtags must be an array of at most 30 tags' };
    }
    payload.default_hashtags = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'footer')) {
    payload.footer = body.footer == null ? null : String(body.footer).slice(0, 200);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'site_url')) {
    payload.site_url = body.site_url == null ? null : String(body.site_url).slice(0, 500);
  }

  const r = await supa('social_settings?id=eq.1', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Settings could not be saved', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  return { status: 200, result: { settings: Array.isArray(rows) ? rows[0] : rows } };
}

/* ── connections (NON-secret metadata only) ─────────── */

const CONNECTION_ROUTES = [
  'telegram_bot', 'linkedin_member', 'linkedin_organization',
  'instagram_login', 'facebook_login',
];

async function listConnections() {
  const r = await supa('social_connections?select=*&order=platform,created_at.desc');
  if (!r.ok) {
    const detail = await r.text();
    if (/PGRST205|relation .* does not exist|Could not find the table/i.test(detail)) {
      return { missingTable: true, connections: [] };
    }
    return { error: detail.slice(0, 300) };
  }
  return { connections: await r.json() };
}

async function createConnection(body, req) {
  const platform = String(body.platform || '');
  if (!PLATFORMS.includes(platform)) {
    return { status: 400, error: `platform must be one of: ${PLATFORMS.join(', ')}` };
  }
  const route = String(body.route || '');
  if (route && !CONNECTION_ROUTES.includes(route)) {
    return { status: 400, error: `route must be one of: ${CONNECTION_ROUTES.join(', ')}` };
  }
  const externalId = String(body.external_id || '').trim();
  if (!externalId) return { status: 400, error: 'external_id is required (the account id — never a token)' };

  const payload = {
    platform,
    route: route || null,
    external_id: externalId,
    display_name: body.display_name ? String(body.display_name).slice(0, 200) : null,
    facebook_page_id: body.facebook_page_id ? String(body.facebook_page_id).slice(0, 100) : null,
    scope: body.scope ? String(body.scope).slice(0, 500) : null,
    token_expires_at: body.token_expires_at || null,
    is_primary: Boolean(body.is_primary),
  };
  if (payload.is_primary) {
    /* unique index allows only one primary per platform */
    await supa(`social_connections?platform=eq.${platform}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_primary: false }),
    }).catch(() => {});
  }

  const r = await supa('social_connections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { status: 500, error: 'Connection could not be saved', details: detail.slice(0, 300) };
  }
  const rows = await r.json();
  return { status: 201, result: { connection: Array.isArray(rows) ? rows[0] : rows, actor: actor(req) } };
}

async function connectionAction(id, action) {
  const r = await supa(`social_connections?id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!r.ok) return { status: 500, error: 'Connection lookup failed' };
  const rows = await r.json();
  const connection = Array.isArray(rows) ? rows[0] : null;
  if (!connection) return { status: 404, error: 'Connection not found' };

  if (action === 'disable' || action === 'enable') {
    const c = await supa(`social_connections?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: action === 'disable' ? 'disabled' : 'active' }),
    });
    if (!c.ok) return { status: 500, error: 'Connection could not be updated' };
    const updated = await c.json();
    return { status: 200, result: { connection: Array.isArray(updated) ? updated[0] : updated } };
  }

  if (action === 'primary') {
    await supa(`social_connections?platform=eq.${connection.platform}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_primary: false }),
    }).catch(() => {});
    const c = await supa(`social_connections?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_primary: true }),
    });
    if (!c.ok) return { status: 500, error: 'Connection could not be updated' };
    const updated = await c.json();
    return { status: 200, result: { connection: Array.isArray(updated) ? updated[0] : updated } };
  }

  if (action === 'verify') {
    /* Telegram: the bot token lives in env — validate it with getMe.
       LinkedIn/Instagram verification lands with their publishers. */
    if (connection.platform !== 'telegram') {
      return { status: 400, error: `Verification is implemented for Telegram — a ${connection.platform} connection is verified by its first real publish` };
    }
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return { status: 400, error: 'TELEGRAM_BOT_TOKEN not set' };
    }
    const me = await publishers.sendTelegram({
      token: process.env.TELEGRAM_BOT_TOKEN,
      chatId: connection.external_id,
      text: ' ',
    }).catch(() => ({ ok: false, error: 'Verification request failed' }));
    /* getMe is a GET; reuse the send plumbing minimally: a send
       with a single space is a harmless, honest connectivity probe. */
    const c = await supa(`social_connections?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        last_verified_at: new Date().toISOString(),
        status: me.ok ? 'active' : connection.status,
      }),
    });
    if (!c.ok) return { status: 500, error: 'Connection could not be updated' };
    const updated = await c.json();
    return {
      status: 200,
      result: {
        connection: Array.isArray(updated) ? updated[0] : updated,
        verified: Boolean(me.ok),
        error: me.ok ? null : me.error,
      },
    };
  }

  return { status: 400, error: "action must be 'disable', 'enable', 'primary' or 'verify'" };
}

/* ── handler ═══════════════════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowSameOrigin(req, res);
    return res.status(204).end();
  }

  const query = Object.assign(
    {},
    (() => { try { return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams); } catch (_) { return {}; } })(),
  );
  const body = parseBody(req);
  const op = String(query.op || body.op || '');
  const isDrain = op === 'drain' && (req.method === 'GET' || req.method === 'POST');

  /* The scheduled drain authenticates with SOCIAL_CRON_SECRET
     BEFORE requireOwner — the scheduler credential is never
     conflated with admin access, and a missing credential is a
     401 rather than a Supabase configuration disclosure. */
  if (isDrain && !isSocialCronRequest(req)) {
    return sendJson(res, 401, { error: 'SOCIAL_CRON_SECRET required' });
  }

  /* Every other route is admin-only (dispatcher elevates the
     session or passes the owner key through; enforce here as
     well so the handler is safe when mounted directly). Auth
     runs BEFORE any configuration check so an unauthenticated
     caller never learns whether Supabase is wired up. */
  if (!isDrain && !requireOwner(req, res)) return;

  const { url, key } = supaConfig();
  if (!url || !key) {
    return sendJson(res, 500, { error: 'Supabase server configuration is missing' });
  }

  if (isDrain) {
    const limit = Number(query.limit || body.limit) || undefined;
    const out = await drainQueue(limit);
    return sendJson(res, out.status, out.result || { error: out.error, details: out.details });
  }

  try {
    /* ── GET ── */
    if (req.method === 'GET') {
      if (!op || op === 'list') {
        const list = await listSuggestions(query);
        if (list.missingTable) {
          return sendJson(res, 503, {
            error: 'Social engine tables missing — run supabase-v27-social-engine.sql in Supabase',
          });
        }
        const settings = await getSettings();
        const connections = await listConnections();
        return sendJson(res, 200, {
          suggestions: list.suggestions,
          settings: settings._error ? DEFAULT_SETTINGS : settings,
          connections: connections.connections || [],
        });
      }
      if (op === 'settings') {
        const settings = await getSettings();
        if (settings._error) {
          return sendJson(res, 503, { error: 'Social engine settings missing — run supabase-v27-social-engine.sql' });
        }
        return sendJson(res, 200, { settings });
      }
      if (op === 'connections') {
        const connections = await listConnections();
        if (connections.error) {
          return sendJson(res, 500, { error: 'Connections could not be loaded', details: connections.error });
        }
        return sendJson(res, 200, { connections: connections.connections });
      }
      if (op === 'ledger') {
        const id = String(query.id || '');
        if (!id) return sendJson(res, 400, { error: 'Missing id' });
        const r = await supa(
          `social_publishes?suggestion_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`,
        );
        if (!r.ok) return sendJson(res, 500, { error: 'Ledger could not be loaded' });
        return sendJson(res, 200, { ledger: await r.json() });
      }
      return sendJson(res, 400, { error: `Unknown op: ${op}` });
    }

    /* ── PATCH (settings) ── */
    if (req.method === 'PATCH') {
      if (op === 'settings') {
        const out = await updateSettings(body);
        return sendJson(res, out.status, out.result || { error: out.error, details: out.details });
      }
      return sendJson(res, 400, { error: 'PATCH supports only op=settings' });
    }

    /* ── POST (mutations) ── */
    if (req.method === 'POST') {
      let out;
      switch (op) {
        case 'create': out = await createSuggestion(body, req); break;
        case 'edit': out = await editSuggestion(body.id, body, req); break;
        case 'approve': out = await approveSuggestion(body.id, req); break;
        case 'reject': out = await rejectSuggestion(body.id, body, req); break;
        case 'publish': out = await publishSuggestion(body.id, body); break;
        case 'test': out = await testSend(body.id, body); break;
        case 'resolve': out = await resolveLedger(body.id, body); break;
        case 'connections': {
          if (body.id && body.action) out = await connectionAction(body.id, body.action);
          else out = await createConnection(body, req);
          break;
        }
        case 'archive': {
          const id = String(body.id || '');
          if (!id) { out = { status: 400, error: 'Missing id' }; break; }
          const r = await supa(`social_suggestions?id=eq.${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'archived' }),
          });
          out = r.ok
            ? { status: 200, result: { archived: true } }
            : { status: 500, error: 'Suggestion could not be archived' };
          break;
        }
        default:
          out = { status: 400, error: `Unknown op: ${op}` };
      }
      return sendJson(res, out.status, out.result || { error: out.error, details: out.details });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Social engine request failed', details: err.message });
  }
};

/* Test seam: pure helpers stay reachable without a network. */
module.exports._internal = {
  truthLock, contentLock, claimLedgerRow, ensureLedgerRow,
  capHeadroom, sendPlatform, updateSettings, validTimezone,
  isSocialCronRequest, drainQueue,
  DEFAULT_SETTINGS, SOURCE_TABLES,
};
