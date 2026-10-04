/**
 * CivilCareer — Sieve scrape API integration (admin-only).
 *
 *   GET  ?action=status                 → config + recent sessions (no secrets)
 *   GET  ?action=credits                → GET /api/me/credits
 *   GET  ?action=poll&id=<id>           → poll a run (bounded), persist it
 *   GET  ?action=resume                 → poll every non-terminal session
 *   GET  ?action=file&id=<id>&name=<f>  → stream a delivered file with the Bearer
 *   POST ?action=start   {instruction,…} → start a run (persisted FIRST)
 *   POST ?action=message {instruction,…} → record a turn, then poll for it
 *
 * Security and safety:
 *   - every action is admin-gated by the dispatcher (ADMIN_RULES);
 *   - the API key is read from the environment only and never returned;
 *   - POST /api/scrapes is attempted exactly once — a timeout is reported as
 *     ambiguous and NOT retried (a duplicate run costs credits);
 *   - when SIEVE_API_KEY is unset the endpoint answers 503 and changes nothing.
 *
 * Server-side only: the key, the Supabase service role and the requests never
 * reach the browser, logs or analytics.
 */
'use strict';

const sieve = require('../lib/sieve');
const store = require('../lib/sieve-store');

const DEFAULT_POLL_BUDGET_MS = 45000;
const DUPLICATE_STATUSES = new Set(['starting', 'queued', 'running']);

function send(res, status, obj) { return res.status(status).json(obj); }

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

function newClientRequestId() {
  return `sieve-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Never expose a key or any server-only value from a stored row. */
function publicSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_request_id: row.client_request_id,
    session_id: row.session_id || null,
    instruction: row.instruction || null,
    status: row.status || null,
    turns: row.turns || 0,
    files: Array.isArray(row.files) ? row.files : [],
    summary: row.summary || null,
    schema_conformance: row.schema_conformance || null,
    refusal: row.refusal || null,
    result: row.result !== undefined ? row.result : null,
    error: row.error || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    completed_at: row.completed_at || null,
  };
}

function clampBudget(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_POLL_BUDGET_MS;
  return Math.min(55000, Math.max(1000, Math.round(n)));
}

function safeFilename(name) {
  return String(name || 'download').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'download';
}

/** Map a mapped sieve error to an HTTP status for our caller. */
function httpStatusFor(err) {
  const status = Number(err && err.status) || 0;
  if (status === 402) return 402;
  if (status === 429) return 429;
  if (status === 401) return 401;
  if (status === 404) return 404;
  if (status === 400) return 400;
  if (status === 409) return 409;
  return 502;
}

module.exports = async function handler(req, res) {
  try {
    if (!req.adminUser) return send(res, 401, { ok: false, error: 'Administrator authentication required.' });

    const requestUrl = new URL(req.url, 'http://localhost');
    const action = String(requestUrl.searchParams.get('action') || 'status').trim();
    const configured = sieve.sieveConfigured();

    if (action === 'status') {
      const storeOk = store.storeConfigured();
      const listed = storeOk ? await store.listSessions(50) : { ok: false, sessions: [] };
      return send(res, 200, {
        ok: true,
        configured,
        base_url: sieve.baseUrl(),
        store_configured: storeOk,
        sessions: (listed.sessions || []).map(publicSession),
        note: configured ? 'Sieve integration is configured.' : 'SIEVE_API_KEY is not set; the endpoint is inert.',
      });
    }

    /* Everything below needs a key. When it is absent the endpoint does
       nothing and other features are unaffected. */
    if (!configured) {
      return send(res, 503, { ok: false, configured: false, error: 'Sieve is not configured. Set SIEVE_API_KEY to enable it.' });
    }

    if (req.method === 'GET') {
      if (action === 'credits') {
        const out = await sieve.getCredits({});
        if (!out.ok) return send(res, out.kind === 'network' ? 502 : httpStatusFor(out), { ok: false, ...out });
        return send(res, 200, { ok: true, credits: out.credits });
      }

      if (action === 'poll') {
        const id = String(requestUrl.searchParams.get('id') || '').trim();
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const found = store.storeConfigured() ? await store.getSession(id) : { ok: false, error: 'store_not_configured' };
        const session = found.ok ? found.session : null;
        const sessionId = (session && session.session_id) || id;
        const budget = clampBudget(requestUrl.searchParams.get('budget_ms'));

        const out = await sieve.pollScrape(sessionId, { budgetMs: budget });
        let persisted = null;
        if (out.ok && store.storeConfigured() && session && session.id) {
          const applied = await store.applyRun(session.id, out.run);
          if (applied.ok) persisted = publicSession(applied.session);
        }
        const status = out.ok ? 200 : (out.kind === 'budget' ? 202 : httpStatusFor(out));
        return send(res, status, {
          ok: out.ok,
          state: out.state || null,
          run: out.run || null,
          persisted,
          message: out.message || null,
        });
      }

      if (action === 'resume') {
        if (!store.storeConfigured()) return send(res, 503, { ok: false, error: 'Supabase server configuration is missing.' });
        const active = await store.listActive();
        if (!active.ok) return send(res, 502, { ok: false, error: active.error });
        const results = [];
        for (const session of active.sessions || []) {
          if (!session.session_id) { results.push({ id: session.id, skipped: 'no_session_id' }); continue; }
          const out = await sieve.pollScrape(session.session_id, { startDelayMs: 0, budgetMs: clampBudget(requestUrl.searchParams.get('budget_ms')) });
          if (out.ok) await store.applyRun(session.id, out.run);
          results.push({ id: session.id, session_id: session.session_id, ok: out.ok, state: out.state || null, message: out.message || null });
        }
        return send(res, 200, { ok: true, resumed: results.length, results });
      }

      if (action === 'file') {
        const id = String(requestUrl.searchParams.get('id') || '').trim();
        const name = String(requestUrl.searchParams.get('name') || '').trim();
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const found = store.storeConfigured() ? await store.getSession(id) : { ok: false, error: 'store_not_configured' };
        if (!found.ok || !found.session) return send(res, 404, { ok: false, error: 'Session not found.' });
        const files = Array.isArray(found.session.files) ? found.session.files : [];
        const file = name
          ? files.find((f) => f && String(f.name) === name)
          : files[0];
        if (!file) return send(res, 404, { ok: false, error: 'File not found on this session.' });
        const dl = await sieve.fetchFile(file, {});
        if (!dl.ok) return send(res, 502, { ok: false, error: dl.message });
        res.setHeader('Content-Type', dl.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(dl.name)}"`);
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        return res.status(200).send(dl.bytes);
      }

      return send(res, 400, { ok: false, error: 'Unsupported action.' });
    }

    if (req.method === 'POST') {
      const body = bodyOf(req);

      if (action === 'start') {
        const clientRequestId = String(body.client_request_id || '').trim() || newClientRequestId();

        /* Duplicate guard: never start a second run while one is in flight. */
        if (store.storeConfigured()) {
          const existing = await store.findByClientRequestId(clientRequestId);
          if (existing.ok && existing.session && DUPLICATE_STATUSES.has(String(existing.session.status))) {
            return send(res, 409, {
              ok: false,
              error: 'A run with this client_request_id is already in flight; poll it instead of starting a duplicate.',
              session: publicSession(existing.session),
            });
          }
        }

        /* Durably persist BEFORE the network call: a crash now resumes
           polling instead of starting a duplicate run. */
        let local = null;
        if (store.storeConfigured()) {
          const created = await store.createSession({
            client_request_id: clientRequestId,
            instruction: body.instruction || null,
            request: body,
            status: 'starting',
            turns: 0,
          });
          if (created.ok) local = created.session;
        }

        const out = await sieve.startScrape(body, {});
        if (out.ok) {
          if (local) await store.attachRun(local.id, { session_id: out.session_id, status: 'queued' });
          return send(res, 202, { ok: true, session_id: out.session_id, poll: out.poll, local_id: local ? local.id : null });
        }

        if (out.kind === 'network') {
          /* The first call may have succeeded: mark it and do NOT retry. */
          if (local) await store.updateSession(local.id, { status: 'start_unknown', error: out.message });
          return send(res, 502, {
            ok: false,
            ambiguous: true,
            error: 'Sieve did not confirm the run (timeout or network failure). The run may still have started, so it is NOT retried automatically. Check /api/sieve?action=status before starting again.',
            local_id: local ? local.id : null,
          });
        }

        if (local) await store.updateSession(local.id, { status: 'failed', error: out.message });
        return send(res, httpStatusFor(out), { ok: false, kind: out.kind, error: out.message, local_id: local ? local.id : null });
      }

      if (action === 'message') {
        const id = String(body.id || requestUrl.searchParams.get('id') || '').trim();
        if (!id) return send(res, 400, { ok: false, error: 'id is required.' });
        const found = store.storeConfigured() ? await store.getSession(id) : { ok: false, error: 'store_not_configured' };
        const session = found.ok ? found.session : null;
        const sessionId = (session && session.session_id) || id;
        const turnsBefore = Number(session && session.turns) || 0;

        /* Record the turn FIRST, then poll until the counter advances. */
        if (session && session.id) await store.recordTurn(session.id, turnsBefore + 1, body);

        const payload = { ...body };
        delete payload.id;
        delete payload.client_request_id;
        const sent = await sieve.sendMessage(sessionId, payload, {});
        if (!sent.ok) {
          if (sent.kind === 'turn_in_flight') return send(res, 409, { ok: false, error: 'A turn is already in flight; wait, then resend.', retryable: true });
          return send(res, httpStatusFor(sent), { ok: false, kind: sent.kind, error: sent.message });
        }

        const budget = clampBudget(body.budget_ms || requestUrl.searchParams.get('budget_ms'));
        const out = await sieve.pollForFollowUp(sessionId, turnsBefore, { budgetMs: budget });
        let persisted = null;
        if (out.ok && session && session.id) {
          const applied = await store.applyRun(session.id, out.run);
          if (applied.ok) persisted = publicSession(applied.session);
        }
        const status = out.ok ? 200 : (out.kind === 'budget' ? 202 : httpStatusFor(out));
        return send(res, status, { ok: out.ok, state: out.state || null, run: out.run || null, persisted, message: out.message || null });
      }

      return send(res, 400, { ok: false, error: 'Unsupported action.' });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (err) {
    return send(res, 500, { ok: false, error: String((err && err.message) || 'Sieve integration failed.').slice(0, 400) });
  }
};

module.exports._internal = { publicSession, newClientRequestId, safeFilename, httpStatusFor, clampBudget };
