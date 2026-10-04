/**
 * CivilCareer — durable store for Sieve runs.
 *
 * Reuses the project's existing persistence pattern (Supabase REST with the
 * service-role key, as in _api/job-collector.js and _api/govt-discovery.js).
 * Only the server ever sees the service key; the browser never touches this
 * table.
 *
 * The row is written BEFORE POST /api/scrapes so a crash between the request
 * and the response leaves a durable trace ("start_unknown") instead of a
 * silent duplicate run.
 */
'use strict';

const TABLE = 'sieve_sessions';
const TERMINAL = new Set(['done', 'refused', 'failed', 'start_unknown']);

function url() {
  return String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function key() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
}

function storeConfigured() {
  return Boolean(url() && key());
}

function nowIso() {
  return new Date().toISOString();
}

function db(path, opts = {}) {
  return fetch(`${url()}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

async function readError(r) {
  try { return (await r.text()).slice(0, 300); } catch (_) { return `HTTP ${r && r.status}`; }
}

/** Insert the local row before the network call. */
async function createSession(fields) {
  if (!storeConfigured()) return { ok: false, error: 'store_not_configured' };
  try {
    const r = await db(TABLE, {
      method: 'POST',
      body: JSON.stringify({
        client_request_id: fields.client_request_id,
        instruction: fields.instruction || null,
        request: fields.request || {},
        status: fields.status || 'starting',
        turns: fields.turns || 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
    if (!r.ok) return { ok: false, error: await readError(r) };
    const rows = await r.json();
    return { ok: true, session: rows && rows[0] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || 'store error').slice(0, 300) };
  }
}

async function updateSession(id, patch) {
  if (!storeConfigured() || !id) return { ok: false, error: 'store_not_configured' };
  try {
    const r = await db(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, updated_at: nowIso() }),
    });
    if (!r.ok) return { ok: false, error: await readError(r) };
    const rows = await r.json();
    return { ok: true, session: rows && rows[0] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || 'store error').slice(0, 300) };
  }
}

/** Attach the server session_id once POST /api/scrapes returns 202. */
function attachRun(id, { session_id, status }) {
  return updateSession(id, { session_id: session_id || null, status: status || 'queued', error: null });
}

/** Record a follow-up turn BEFORE sending it, so the turn count is durable. */
function recordTurn(id, turn, request) {
  return updateSession(id, {
    turns: Number(turn) || 0,
    last_request: request || {},
    status: 'running',
    error: null,
  });
}

/** Copy a terminal run's fields onto the durable row. */
function applyRun(id, run) {
  if (!run || typeof run !== 'object') return Promise.resolve({ ok: false, error: 'no_run' });
  const patch = {
    status: String(run.status || 'unknown'),
    turns: Number(run.turns !== undefined ? run.turns : run.turn) || 0,
    summary: run.summary || null,
    result: run.result !== undefined ? run.result : null,
    files: Array.isArray(run.files) ? run.files : [],
    schema_conformance: run.schema_conformance || null,
    refusal: run.refusal || null,
    error: null,
  };
  if (TERMINAL.has(patch.status)) patch.completed_at = nowIso();
  return updateSession(id, patch);
}

async function getSession(idOrSessionId) {
  if (!storeConfigured()) return { ok: false, error: 'store_not_configured' };
  const v = String(idOrSessionId || '').trim();
  if (!v) return { ok: false, error: 'id_required' };
  try {
    const filter = `or=(id.eq.${encodeURIComponent(v)},session_id.eq.${encodeURIComponent(v)})`;
    const r = await db(`${TABLE}?${filter}&select=*&limit=1`);
    if (!r.ok) return { ok: false, error: await readError(r) };
    const rows = await r.json();
    if (!rows || !rows.length) return { ok: false, error: 'not_found' };
    return { ok: true, session: rows[0] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || 'store error').slice(0, 300) };
  }
}

async function findByClientRequestId(clientRequestId) {
  if (!storeConfigured()) return { ok: false, error: 'store_not_configured' };
  const v = String(clientRequestId || '').trim();
  if (!v) return { ok: false, error: 'id_required' };
  try {
    const r = await db(`${TABLE}?client_request_id=eq.${encodeURIComponent(v)}&select=*&limit=1`);
    if (!r.ok) return { ok: false, error: await readError(r) };
    const rows = await r.json();
    return { ok: true, session: (rows && rows[0]) || null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || 'store error').slice(0, 300) };
  }
}

/** Non-terminal rows, for resuming polling after a crash. */
async function listActive() {
  if (!storeConfigured()) return { ok: false, error: 'store_not_configured' };
  try {
    const r = await db(`${TABLE}?status=in.(starting,queued,running)&select=*&order=created_at.asc&limit=50`);
    if (!r.ok) return { ok: false, error: await readError(r) };
    return { ok: true, sessions: await r.json() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || 'store error').slice(0, 300) };
  }
}

async function listSessions(limit = 50) {
  if (!storeConfigured()) return { ok: false, error: 'store_not_configured' };
  try {
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    const r = await db(`${TABLE}?select=*&order=created_at.desc&limit=${n}`);
    if (!r.ok) return { ok: false, error: await readError(r) };
    return { ok: true, sessions: await r.json() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || 'store error').slice(0, 300) };
  }
}

module.exports = {
  TABLE,
  TERMINAL,
  storeConfigured,
  createSession,
  updateSession,
  attachRun,
  recordTurn,
  applyRun,
  getSession,
  findByClientRequestId,
  listActive,
  listSessions,
};
