/**
 * CivilCareer — Sieve scrape API client (server-only).
 *
 * Mirrors the project's existing server patterns:
 *   - the API key lives only in the environment (`SIEVE_API_KEY`), never in
 *     the browser bundle, logs or git (same rule as OWNER_KEY and the
 *     Supabase service-role key);
 *   - outbound calls use the platform `fetch` (no second HTTP client);
 *   - the pure rules (request building, status/error mapping, backoff,
 *     follow-up readiness, device-code classification) live in this module
 *     so they can be unit-tested entirely offline.
 *
 * Contract highlights (see docs/PROJECT notes):
 *   - POST /api/scrapes has NO idempotency key and accepted calls spend
 *     credits, so it is attempted exactly once and is NEVER auto-retried
 *     after a timeout or network error. 429/5xx are retry-safe (no run was
 *     created) but the caller decides — this module reports `retryable`.
 *   - GET /api/scrapes/<id> may be retried with exponential backoff
 *     (5s → ~30s). Runs take minutes; there are no short timeouts.
 *
 * Behaviour is unchanged when `SIEVE_API_KEY` is unset: `sieveConfigured()`
 * returns false and callers must not make any request.
 */
'use strict';

const DEFAULT_BASE_URL = 'https://scrape.usesieve.com';
const POLL_START_MS = 5000;
const POLL_MAX_MS = 30000;
const POLL_FACTOR = 1.8;
const OUTPUT_SCHEMA_MAX_BYTES = 32 * 1024;
const COMPLIANCE_MODES = ['conservative', 'regular', 'yolo'];
const TABLE_SHAPES = ['long', 'wide'];

/* ── configuration (read at call time so tests can toggle it) ─────────── */

function baseUrl() {
  return String(process.env.SIEVE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function apiKey() {
  return String(process.env.SIEVE_API_KEY || '').trim();
}

/** True only when a key is present. Callers must no-op otherwise. */
function sieveConfigured() {
  return Boolean(apiKey());
}

/* ── small helpers ────────────────────────────────────────────────────── */

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Public http(s) URL only — same policy as _api/civil-scraper.js. */
function isPublicHttpUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (!host) return false;
    if (/^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/.test(host)) return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/** files[] carry a relative url; prefix the base and keep the Bearer. */
function resolveFileUrl(url) {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  return baseUrl() + (u.startsWith('/') ? u : '/' + u);
}

function parseRetryAfter(headers) {
  try {
    let raw = null;
    if (headers && typeof headers.get === 'function') raw = headers.get('retry-after');
    else if (headers && typeof headers === 'object') raw = headers['retry-after'] || headers['Retry-After'];
    if (raw === undefined || raw === null || raw === '') return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const when = Date.parse(String(raw));
    if (Number.isFinite(when)) return Math.max(0, when - Date.now());
    return null;
  } catch (_) {
    return null;
  }
}

/* ── pure rules ───────────────────────────────────────────────────────── */

/**
 * Validate and normalise a run/message body. Returns { ok, value } or
 * { ok:false, errors }. `compliance_mode` defaults to "regular"; "yolo" is
 * only ever sent when the caller explicitly asked for it.
 */
function buildStartPayload(input = {}) {
  const errors = [];
  const value = {};

  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
  if (!instruction) errors.push('instruction is required (plain language).');
  else value.instruction = instruction;

  if (input.target_urls !== undefined) {
    if (!Array.isArray(input.target_urls)) {
      errors.push('target_urls must be an array of public http(s) URLs.');
    } else {
      const urls = [];
      for (const raw of input.target_urls) {
        if (!isPublicHttpUrl(raw)) errors.push(`target_urls contains an invalid or non-public URL: ${String(raw).slice(0, 120)}`);
        else urls.push(String(raw).trim());
      }
      value.target_urls = urls;
    }
  }

  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields) || input.fields.some((f) => typeof f !== 'string')) {
      errors.push('fields must be an array of strings.');
    } else {
      value.fields = input.fields.map((f) => f.trim()).filter(Boolean);
    }
  }

  if (input.schema !== undefined) {
    if (!isPlainObject(input.schema)) errors.push('schema must be a JSON object.');
    else value.schema = input.schema;
  }

  if (input.output_schema !== undefined) {
    if (!isPlainObject(input.output_schema)) {
      errors.push('output_schema must be a JSON object.');
    } else {
      let bytes = Infinity;
      try { bytes = Buffer.byteLength(JSON.stringify(input.output_schema), 'utf8'); } catch (_) { bytes = Infinity; }
      if (bytes > OUTPUT_SCHEMA_MAX_BYTES) errors.push(`output_schema must be at most 32KB (got ${bytes} bytes).`);
      else value.output_schema = input.output_schema;
    }
  }

  if (input.table_shape !== undefined) {
    if (!TABLE_SHAPES.includes(input.table_shape)) errors.push(`table_shape must be one of ${TABLE_SHAPES.join(', ')}.`);
    else value.table_shape = input.table_shape;
  }

  const mode = input.compliance_mode === undefined ? 'regular' : input.compliance_mode;
  if (!COMPLIANCE_MODES.includes(mode)) errors.push(`compliance_mode must be one of ${COMPLIANCE_MODES.join(', ')}.`);
  else value.compliance_mode = mode;

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/**
 * Map a run status to one of: running | done | refused | unknown.
 * "unknown" is treated as an error by every caller (per the contract).
 */
function classifyRunStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return 'running';
  if (s === 'done') return 'done';
  if (s === 'refused') return 'refused';
  return 'unknown';
}

function isTerminalRunStatus(status) {
  const s = classifyRunStatus(status);
  return s === 'done' || s === 'refused';
}

/**
 * Map an HTTP status + body to a stable, retry-aware error descriptor.
 * `network` (status 0) is deliberately non-retryable: it is used for POSTs
 * too, where the call may have succeeded and must never be retried.
 */
function mapError(status, body, headers) {
  const code = Number(status) || 0;
  const err = isPlainObject(body) ? String(body.error || '').trim() : '';
  const retryAfterMs = parseRetryAfter(headers);

  if (code === 400) return { kind: 'bad_request', retryable: false, status: code, message: err || 'Bad request; fix the request and do not retry.', retryAfterMs: null };
  if (code === 401) return { kind: 'unauthorized', retryable: false, status: code, message: err || 'Sieve API key is missing or revoked.', retryAfterMs: null };
  if (code === 402) return { kind: 'payment_required', retryable: false, status: code, message: err || 'Out of Sieve credits.', retryAfterMs: null };
  if (code === 404) return { kind: 'not_found', retryable: false, status: code, message: err || 'Not found.', retryAfterMs: null };
  if (code === 409) return { kind: 'turn_in_flight', retryable: true, status: code, message: err || 'A turn is already in flight; wait, then resend.', retryAfterMs: null };
  if (code === 429) return { kind: 'rate_limited', retryable: true, status: code, message: err || 'Rate limited; wait before retrying.', retryAfterMs };
  if (code >= 500) return { kind: 'server_error', retryable: true, status: code, message: err || `Sieve server error (${code}).`, retryAfterMs: null };
  if (!code) return { kind: 'network', retryable: false, status: 0, message: err || 'Network error.', retryAfterMs: null };
  return { kind: 'unknown', retryable: false, status: code, message: err || `Unexpected response (${code}).`, retryAfterMs: null };
}

/** Next poll delay: 5s initially, then ×1.8 up to ~30s. */
function nextPollDelay(previousMs) {
  const prev = Number(previousMs) || 0;
  if (prev <= 0) return POLL_START_MS;
  return Math.min(POLL_MAX_MS, Math.round(prev * POLL_FACTOR));
}

function turnsOf(run) {
  const raw = run && (run.turns !== undefined ? run.turns : run.turn);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * After a follow-up message, only read the answer once the run is done AND
 * the turn counter has advanced — otherwise the previous answer is returned.
 */
function isFollowUpReady(run, turnsBefore) {
  if (!run || classifyRunStatus(run.status) !== 'done') return false;
  return turnsOf(run) > (Number(turnsBefore) || 0);
}

/** Classify a device-token poll response (see the device login contract). */
function classifyDevicePoll(status, body) {
  if (Number(status) === 200) {
    const key = isPlainObject(body) ? String(body.api_key || '') : '';
    if (key) return { state: 'success', apiKey: key, keyName: (body && body.key_name) || null };
    return { state: 'error', message: 'device token response is missing api_key.' };
  }
  if (Number(status) === 400) {
    const err = isPlainObject(body) ? String(body.error || '').toLowerCase() : '';
    if (err === 'authorization_pending') return { state: 'pending' };
    if (err === 'slow_down') return { state: 'slow_down' };
    if (err === 'access_denied') return { state: 'denied' };
    if (err === 'expired_token') return { state: 'expired' };
  }
  const err = isPlainObject(body) ? String(body.error || '') : '';
  return { state: 'error', status: Number(status) || 0, message: err || `unexpected response (${status})` };
}

/* ── HTTP boundary (fetch is injectable for tests) ────────────────────── */

async function readJson(res) {
  try {
    if (res && typeof res.json === 'function') return await res.json();
  } catch (_) { /* fall through */ }
  try {
    if (res && typeof res.text === 'function') return JSON.parse(await res.text());
  } catch (_) { /* fall through */ }
  return {};
}

async function request(path, opts = {}) {
  const f = opts.fetchImpl || fetch;
  const key = opts.apiKey !== undefined ? opts.apiKey : apiKey();
  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const init = {
    method: opts.method || 'GET',
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs || 30000),
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await f(resolveFileUrl(path), init);
  const body = await readJson(res);
  return { res, status: res && res.status, body };
}

/* ── device login ─────────────────────────────────────────────────────── */

/** POST /api/auth/device/code */
async function startDeviceAuth(clientName, opts = {}) {
  let out;
  try {
    out = await request('/api/auth/device/code', {
      method: 'POST',
      apiKey: '',
      body: { client_name: String(clientName || 'CivilCareer').slice(0, 80) },
      timeoutMs: opts.timeoutMs || 15000,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return { ok: false, kind: 'network', message: String((err && err.message) || 'network error').slice(0, 300) };
  }
  if (out.status >= 200 && out.status < 300 && out.body && out.body.device_code) {
    return { ok: true, ...out.body };
  }
  return { ok: false, ...mapError(out.status, out.body, out.res && out.res.headers) };
}

/**
 * Poll POST /api/auth/device/token until success, denial, expiry or error.
 * Sleep/now are injectable so tests never actually wait.
 */
async function pollDeviceToken(deviceCode, opts = {}) {
  const code = String(deviceCode || '').trim();
  if (!code) return { ok: false, state: 'error', message: 'device_code is required.' };
  const sleep = opts.sleep || defaultSleep;
  const now = opts.now || Date.now;
  const expiresInMs = Math.max(60, Number(opts.expiresInMs) || 600) * 1000;
  const startedAt = now();
  let intervalMs = Math.max(1000, Number(opts.intervalMs) || 5) * 1000;
  let polls = 0;

  for (;;) {
    await sleep(intervalMs);
    polls += 1;
    if (typeof opts.onTick === 'function') { try { opts.onTick({ polls, intervalMs }); } catch (_) { /* ignore */ } }
    if (now() - startedAt > expiresInMs) return { ok: false, state: 'expired', message: 'The device code expired; start over.' };
    if (opts.maxPolls && polls > opts.maxPolls) return { ok: false, state: 'timeout', message: 'Stopped before approval.' };

    let out;
    try {
      out = await request('/api/auth/device/token', {
        method: 'POST',
        apiKey: '',
        body: { device_code: code },
        timeoutMs: opts.timeoutMs || 15000,
        fetchImpl: opts.fetchImpl,
      });
    } catch (err) {
      return { ok: false, state: 'error', message: String((err && err.message) || 'network error').slice(0, 300) };
    }
    const verdict = classifyDevicePoll(out.status, out.body);
    if (verdict.state === 'pending') continue;
    if (verdict.state === 'slow_down') { intervalMs += 5000; continue; }
    if (verdict.state === 'success') return { ok: true, apiKey: verdict.apiKey, keyName: verdict.keyName, polls };
    if (verdict.state === 'expired') return { ok: false, state: 'expired', message: 'The device code expired; start over.' };
    if (verdict.state === 'denied') return { ok: false, state: 'denied', message: 'The user declined the request.' };
    return { ok: false, state: 'error', message: verdict.message };
  }
}

/* ── runs ─────────────────────────────────────────────────────────────── */

/**
 * POST /api/scrapes — attempted EXACTLY ONCE.
 * On timeout/network failure the run may still have started, so the result
 * carries `ambiguous:true` and `retryable:false`; callers must not retry.
 */
async function startScrape(input, opts = {}) {
  const valid = buildStartPayload(input);
  if (!valid.ok) return { ok: false, kind: 'invalid_input', retryable: false, errors: valid.errors, message: valid.errors[0] };

  let out;
  try {
    out = await request('/api/scrapes', {
      method: 'POST',
      body: valid.value,
      timeoutMs: opts.timeoutMs || 30000,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return {
      ok: false, kind: 'network', ambiguous: true, retryable: false, status: 0,
      message: String((err && err.message) || 'network error').slice(0, 300),
    };
  }

  if (out.status === 202 && out.body && out.body.status === 'queued' && out.body.session_id) {
    return { ok: true, session_id: out.body.session_id, poll: out.body.poll || `/api/scrapes/${out.body.session_id}`, raw: out.body };
  }
  const mapped = mapError(out.status, out.body, out.res && out.res.headers);
  return { ok: false, ...mapped, body: out.body };
}

/** GET /api/scrapes/<session_id> — a single attempt; the caller backs off. */
async function getScrape(sessionId, opts = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return { ok: false, kind: 'invalid_input', retryable: false, message: 'session_id is required.' };
  let out;
  try {
    out = await request(`/api/scrapes/${encodeURIComponent(id)}`, {
      method: 'GET',
      timeoutMs: opts.timeoutMs || 30000,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return { ok: false, kind: 'network', retryable: true, status: 0, message: String((err && err.message) || 'network error').slice(0, 300) };
  }
  if (out.status >= 200 && out.status < 300) return { ok: true, run: out.body };
  const mapped = mapError(out.status, out.body, out.res && out.res.headers);
  return { ok: false, ...mapped, body: out.body };
}

/** POST /api/scrapes/<id>/messages — 409 means a turn is in flight. */
async function sendMessage(sessionId, input, opts = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return { ok: false, kind: 'invalid_input', retryable: false, message: 'session_id is required.' };
  const valid = buildStartPayload(input);
  if (!valid.ok) return { ok: false, kind: 'invalid_input', retryable: false, errors: valid.errors, message: valid.errors[0] };

  let out;
  try {
    out = await request(`/api/scrapes/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: valid.value,
      timeoutMs: opts.timeoutMs || 30000,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return {
      ok: false, kind: 'network', ambiguous: true, retryable: false, status: 0,
      message: String((err && err.message) || 'network error').slice(0, 300),
    };
  }
  if (out.status >= 200 && out.status < 300) return { ok: true, body: out.body };
  const mapped = mapError(out.status, out.body, out.res && out.res.headers);
  return { ok: false, ...mapped, body: out.body };
}

/**
 * Poll a run to a terminal state, backing off 5s → ~30s. Only GET-safe
 * errors (network/5xx/429) are retried. A bounded `budgetMs` lets a
 * serverless invocation return early and be resumed.
 */
async function pollScrape(sessionId, opts = {}) {
  const sleep = opts.sleep || defaultSleep;
  const now = opts.now || Date.now;
  const budgetMs = Number(opts.budgetMs || 0);
  const startedAt = now();
  let delay = Number(opts.startDelayMs) > 0 ? Number(opts.startDelayMs) : POLL_START_MS;
  let last = null;

  for (;;) {
    await sleep(delay);
    if (budgetMs > 0 && now() - startedAt > budgetMs) {
      return { ok: false, kind: 'budget', retryable: true, message: 'Polling budget elapsed; call again to continue.', last };
    }
    const out = await getScrape(sessionId, opts);
    if (!out.ok) {
      if (out.kind === 'network' || out.kind === 'server_error' || out.kind === 'rate_limited') {
        delay = out.retryAfterMs || nextPollDelay(delay);
        last = out;
        continue;
      }
      return out;
    }
    const run = out.run;
    const state = classifyRunStatus(run && run.status);
    if (typeof opts.onUpdate === 'function') { try { opts.onUpdate(run); } catch (_) { /* ignore */ } }
    if (state === 'done' || state === 'refused') return { ok: true, state, run };
    if (state === 'unknown') {
      return { ok: false, kind: 'unknown_status', retryable: false, message: `Sieve returned an unexpected status: ${String(run && run.status)}`, run };
    }
    delay = nextPollDelay(delay);
    last = run;
  }
}

/**
 * After recording a turn, poll until the run is done AND the turn counter
 * has advanced. A "done" run that has not advanced is still the previous
 * answer.
 */
async function pollForFollowUp(sessionId, turnsBefore, opts = {}) {
  const sleep = opts.sleep || defaultSleep;
  const now = opts.now || Date.now;
  const budgetMs = Number(opts.budgetMs || 0);
  const startedAt = now();
  let delay = Number(opts.startDelayMs) > 0 ? Number(opts.startDelayMs) : POLL_START_MS;

  for (;;) {
    await sleep(delay);
    if (budgetMs > 0 && now() - startedAt > budgetMs) {
      return { ok: false, kind: 'budget', retryable: true, message: 'The follow-up turn did not finish within the budget; call again.' };
    }
    const out = await getScrape(sessionId, opts);
    if (!out.ok) {
      if (out.kind === 'network' || out.kind === 'server_error' || out.kind === 'rate_limited') {
        delay = out.retryAfterMs || nextPollDelay(delay);
        continue;
      }
      return out;
    }
    const run = out.run;
    if (typeof opts.onUpdate === 'function') { try { opts.onUpdate(run); } catch (_) { /* ignore */ } }
    if (classifyRunStatus(run && run.status) === 'refused') return { ok: true, state: 'refused', run };
    if (classifyRunStatus(run && run.status) === 'unknown') {
      return { ok: false, kind: 'unknown_status', retryable: false, message: `Sieve returned an unexpected status: ${String(run && run.status)}`, run };
    }
    if (isFollowUpReady(run, turnsBefore)) return { ok: true, state: 'done', run };
    delay = nextPollDelay(delay);
  }
}

/* ── files and credits ────────────────────────────────────────────────── */

/** Download a delivered file (relative url → base + Bearer). */
async function fetchFile(file, opts = {}) {
  const f = opts.fetchImpl || fetch;
  const url = resolveFileUrl(file && (file.url || file));
  const headers = {};
  const key = opts.apiKey !== undefined ? opts.apiKey : apiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  let res;
  try {
    res = await f(url, { method: 'GET', headers, signal: AbortSignal.timeout(opts.timeoutMs || 60000) });
  } catch (err) {
    return { ok: false, kind: 'network', message: String((err && err.message) || 'network error').slice(0, 300) };
  }
  if (!res || !res.ok) return { ok: false, kind: 'http_error', status: (res && res.status) || 0, message: `file download failed (${(res && res.status) || 0})` };
  let bytes;
  try {
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, kind: 'network', message: String((err && err.message) || 'could not read the file body').slice(0, 300) };
  }
  let name = file && file.name;
  if (!name) {
    try { name = decodeURIComponent(String(url).split('/').pop() || 'download'); } catch (_) { name = 'download'; }
  }
  let contentType = 'application/octet-stream';
  try {
    if (res.headers && typeof res.headers.get === 'function') contentType = res.headers.get('content-type') || contentType;
  } catch (_) { /* keep default */ }
  return { ok: true, name, contentType, bytes };
}

/** GET /api/me/credits — plan, limit, used, remaining. */
async function getCredits(opts = {}) {
  let out;
  try {
    out = await request('/api/me/credits', { method: 'GET', timeoutMs: opts.timeoutMs || 15000, fetchImpl: opts.fetchImpl });
  } catch (err) {
    return { ok: false, kind: 'network', message: String((err && err.message) || 'network error').slice(0, 300) };
  }
  if (out.status >= 200 && out.status < 300) return { ok: true, credits: out.body };
  return { ok: false, ...mapError(out.status, out.body, out.res && out.res.headers) };
}

module.exports = {
  DEFAULT_BASE_URL,
  POLL_START_MS,
  POLL_MAX_MS,
  OUTPUT_SCHEMA_MAX_BYTES,
  COMPLIANCE_MODES,
  TABLE_SHAPES,
  baseUrl,
  apiKey,
  sieveConfigured,
  isPublicHttpUrl,
  resolveFileUrl,
  buildStartPayload,
  classifyRunStatus,
  isTerminalRunStatus,
  mapError,
  nextPollDelay,
  turnsOf,
  isFollowUpReady,
  classifyDevicePoll,
  startDeviceAuth,
  pollDeviceToken,
  startScrape,
  getScrape,
  sendMessage,
  pollScrape,
  pollForFollowUp,
  fetchFile,
  getCredits,
};
