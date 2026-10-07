#!/usr/bin/env node
/**
 * CivilCareer — which admin tabs actually work, measured without a browser.
 *
 * Why this exists
 * ---------------
 * The dashboard shows a tab, the tab shows "Loading…", and nothing says whether
 * the table is empty, the query is wrong, or the route refused the credential.
 * This script asks each tab's own read endpoint and prints what came back, so
 * the question "does this tab have real data?" is answered by a measurement.
 *
 * It is READ-ONLY BY CONSTRUCTION. Only GETs are ever sent, from a fixed list.
 * Every mutating action the dashboard offers — approve, publish, delete,
 * import, run discovery, send Telegram, start the scraper — is listed at the
 * end as skipped with the reason, so the omission is visible rather than
 * implied. Nothing in this file can change production data.
 *
 * Two credential classes, and the script reports which route needs which
 * instead of assuming:
 *
 *   owner    — ADMIN_RULES resolves to false once hasValidOwnerKey() sees
 *              x-owner-key, so the handler runs with that header and applies its
 *              own owner check.
 *   session  — ADMIN_RULES resolves to true regardless (e.g. '/api/govt-review':
 *              req => true, or any route with ?auth=1), so the dispatcher calls
 *              verifyAdminToken and demands a Supabase Bearer token. The owner
 *              key is NOT honoured there, however valid it is.
 *   public   — the route answers with no credential at all. The tab is real, but
 *              its data is not admin data; only its writes are gated.
 *
 * Usage
 *   SITE_URL=https://… OWNER_KEY=… node scripts/smoke-admin-endpoints.js
 *   SITE_URL=https://… OWNER_KEY=… ADMIN_ACCESS_TOKEN=<supabase access token> \
 *     node scripts/smoke-admin-endpoints.js        # also covers the session tabs
 *   AGENT_REACH_INGEST_KEY=… node …                # covers the Agent Reach inbox
 *
 * Flags
 *   --only=<tab>   probe one tab
 *   --json         machine-readable output
 *
 * Exit code is 1 only when something is actually broken: a 5xx, an
 * unparseable 2xx, or a tab the installed credential should have opened and did
 * not. A route that reports "needs a session" while no token was supplied is a
 * reported fact, not a failure.
 */

'use strict';

const SITE_URL = String(process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');
const OWNER_KEY = String(process.env.OWNER_KEY || '').trim();
const SESSION = String(process.env.ADMIN_ACCESS_TOKEN || '').trim();
const AGENT_KEY = String(process.env.AGENT_REACH_INGEST_KEY || '').trim();

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);

/* ── the dashboard's read endpoints ─────────────────────────────────────
   Every entry mirrors a call admin.html makes when it loads that tab. `expect`
   is the credential the dispatcher's own rules say the route needs; the probe
   measures it, and the result is reported whichever way it comes out. */
const PROBES = [
  { tab: 'analytics', path: '/api/analytics', expect: 'session', why: 'GET /api/analytics is in the allowlist as req.method === "GET"' },
  { tab: 'jobs', path: '/api/jobs?page=1&limit=50&auth=1', expect: 'session', why: '?auth=1 makes the route admin, and the handler reads the summary with the service key' },
  /* /api/admin-jobs is not in the dispatcher allowlist; its own isOwner() compares
     x-owner-key or ?key= against OWNER_KEY verbatim. Its only caller left is the
     hidden Reviews panel, which passes the Supabase session token as ?key= —
     measured here so the fact is on record if that panel is ever restored. */
  { tab: 'reviews*', path: '/api/admin-jobs?tab=review&page=1&per_page=20', expect: 'owner', why: 'owner key verbatim via x-owner-key or ?key=; the hidden panel sends a session token, which this route compares against OWNER_KEY and refuses' },
  { tab: 'govt', path: '/api/govt-review?action=health', expect: 'session', why: 'ADMIN_RULES is req => true for every method on this route' },
  { tab: 'govt', path: '/api/govt-review?action=organizations', expect: 'session', why: 'same route; organizations reads the govt_jobs facet table' },
  { tab: 'govt', path: '/api/govt-review?status=pending', expect: 'session', why: 'the review queue itself' },
  { tab: 'discovery', path: '/api/govt-review?action=conflicts', expect: 'session', why: 'the dashboard reads the source-conflict list through this route' },
  { tab: 'exams', path: '/api/exams?auth=1', expect: 'session', why: '?auth=1 elevates, same shape as /api/jobs' },
  { tab: 'exam-tracker', path: '/api/exam-tracker', expect: 'public', why: 'GET is answered before requireOwner runs, so the list is public and only PUT/POST/DELETE need the owner key' },
  { tab: 'salary', path: '/api/salary?admin=1', expect: 'owner', why: 'rule skips elevation when hasValidOwnerKey is true' },
  { tab: 'walkins', path: '/api/walkin?admin=all', expect: 'owner', why: 'same shape as salary' },
  { tab: 'subscribers', path: '/api/whatsapp-subscribe', expect: 'owner', why: 'rule is req => GET && !hasValidOwnerKey' },
  { tab: 'blog', path: '/api/blog', expect: 'owner', why: 'sending x-owner-key clears the rule before the handler runs' },
  { tab: 'interview', path: '/api/interview?status=pending', expect: 'owner', why: 'status=pending elevates only when the owner key is absent' },
  { tab: 'materials', path: '/api/materials?auth=1', expect: 'session', why: '?auth=1 elevates' },
  { tab: 'courses', path: '/api/courses?admin=1', expect: 'session', why: 'GET with ?admin is elevated in the rule' },
  { tab: 'submissions', path: '/api/employer-submissions', expect: 'session', why: 'rule is req.method !== "POST" — every read is admin' },
  { tab: 'submissions', path: '/api/resource-submissions', expect: 'session', why: 'the tab renders employer and resource submissions together' },
  { tab: 'reviews*', path: '/api/companies?status=pending', expect: 'session', why: 'status=pending elevates only when the owner key is absent; the Reviews tab is hidden' },
  { tab: 'reports', path: '/api/reports', expect: 'session', why: 'rule is req.method !== "POST"' },
  { tab: 'contact', path: '/api/contact', expect: 'session', why: 'rule is req.method !== "POST"' },
  { tab: 'collector', path: '/api/job-collector?action=metrics', expect: 'session', why: 'rule is () => true for every method' },
  { tab: 'collector', path: '/api/job-collector?action=diagnostics', expect: 'session', why: 'same route, diagnostics view' },
  { tab: 'collector', path: '/api/job-collector?action=inbox&limit=50', expect: 'session', why: 'same route, the lead inbox' },
  { tab: 'social', path: '/api/social?op=settings', expect: 'owner', why: 'rule is !hasValidOwnerKey; the Social tab is hidden but its endpoints are live' },
  { tab: 'social', path: '/api/social?op=connections', expect: 'owner', why: 'same route' },
  { tab: 'inbox', path: '/api/agent-reach-ingest?status=1', expect: 'agent-reach', why: 'the ingest endpoint authenticates with its own shared secret, not the owner key' },
];

/* Endpoints the dashboard uses that this script must never call, so their
   absence from the probe list is deliberate and reviewable. */
const SKIPPED = [
  { path: 'POST /api/jobs?discovery=1', why: 'runs a live discovery sweep' },
  { path: 'POST /api/admin-jobs', why: 'publish/delete/republish act on real rows' },
  { path: 'POST /api/govt-review?action=approve|reject|delete_permanent|…', why: 'the review gate itself; prove it with scripts/verify-govt-publish.js' },
  { path: 'POST /api/job-collector?action=approve|process|update|create_batch', why: 'changes lead state' },
  { path: 'POST /api/course-discovery?action=run|import', why: 'spends provider credits and writes rows' },
  { path: 'POST /api/courses', why: 'creates a course' },
  { path: 'DELETE /api/courses?id=…', why: 'deletes a course' },
  { path: 'POST /api/extract', why: 'fetches an arbitrary URL on the server' },
  { path: 'POST /api/telegram', why: 'sends a real Telegram message' },
  { path: 'POST /api/youtube-materials', why: 'imports from YouTube' },
  { path: 'POST /api/civil-scraper', why: 'runs the scraper' },
  { path: 'POST /api/exam-extract', why: 'mutating — and it is not a routed handler at all: admin.html calls it, the dispatcher has no such route, so the exam import panel gets 404' },
  { path: 'POST /api/admin-auth', why: 'creates or rotates an admin session' },
  { path: 'POST /api/govt-discovery', why: 'CRON_SECRET scan; the post-deploy smoke workflow already runs one' },
  { path: '/api/admin-page, /api/admin-session, /api/auth-config', why: 'shell and session surfaces, not tab data' },
];

function credentialFor(expect) {
  if (expect === 'owner') return OWNER_KEY ? { header: 'x-owner-key', value: OWNER_KEY } : null;
  if (expect === 'session') return SESSION ? { header: 'authorization', value: `Bearer ${SESSION}` } : null;
  if (expect === 'agent-reach') return AGENT_KEY ? { header: 'authorization', value: `Bearer ${AGENT_KEY}` } : null;
  if (expect === 'public') return { header: null, value: '' }; /* measured with no credential */
  return null;
}

/* Anything the body itself calls an error is an error, whatever the status. */
function bodyError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  if (body.ok === false) return String(body.error || body.message || 'ok:false');
  return '';
}

function firstRows(body) {
  if (Array.isArray(body)) return { key: '(array)', rows: body };
  if (!body || typeof body !== 'object') return null;
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) return { key, rows: value };
  }
  return null;
}

function classify(status, body, text) {
  if (status === 401 || status === 403) return { verdict: 'refused', detail: 'credential not accepted here' };
  if (status === 405) return { verdict: 'error', detail: 'method not allowed' };
  if (status >= 500) return { verdict: 'error', detail: `server error: ${String(text || '').slice(0, 120)}` };
  if (status < 200 || status >= 300) return { verdict: 'error', detail: `unexpected status ${status}` };
  if (!body) return { verdict: 'error', detail: 'not JSON' };
  const err = bodyError(body);
  if (err) return { verdict: 'error', detail: err.slice(0, 120) };
  const rows = firstRows(body);
  if (rows) {
    return rows.rows.length
      ? { verdict: 'data', detail: `${rows.key}: ${rows.rows.length}` }
      : { verdict: 'empty', detail: `${rows.key}: 0` };
  }
  const keys = Object.keys(body).filter((k) => k !== 'ok');
  return { verdict: 'data', detail: keys.length ? `fields: ${keys.slice(0, 5).join(', ')}` : 'ok' };
}

async function probe(entry) {
  const cred = credentialFor(entry.expect);
  if (!cred) return { probed: false, reason: entry.expect === 'session' ? 'no ADMIN_ACCESS_TOKEN' : entry.expect === 'agent-reach' ? 'no AGENT_REACH_INGEST_KEY' : 'no OWNER_KEY' };
  const started = Date.now();
  try {
    const res = await fetch(`${SITE_URL}${entry.path}`, {
      method: 'GET',
      headers: { ...(cred.header ? { [cred.header]: cred.value } : {}), accept: 'application/json' },
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
    const out = classify(res.status, body, text);
    return { probed: true, status: res.status, ms: Date.now() - started, credential: entry.expect, ...out };
  } catch (err) {
    return { probed: true, status: 0, ms: Date.now() - started, credential: entry.expect, verdict: 'error', detail: `request failed: ${err.message}` };
  }
}

const MARK = { data: 'data ', empty: 'empty', refused: 'refused', error: 'ERROR' };

(async () => {
  if (!OWNER_KEY && !SESSION) {
    console.error('Set OWNER_KEY (and optionally ADMIN_ACCESS_TOKEN) before running.');
    console.error('Nothing is probed without a credential: an anonymous run would only prove the gate exists.');
    process.exit(2);
  }

  const list = ONLY ? PROBES.filter((p) => p.tab === ONLY) : PROBES;
  if (!list.length) {
    console.error(`No probes for tab "${ONLY}". Known tabs: ${[...new Set(PROBES.map((p) => p.tab))].join(', ')}`);
    process.exit(2);
  }

  const rows = [];
  for (const entry of list) rows.push({ ...entry, ...(await probe(entry)) });

  if (AS_JSON) {
    console.log(JSON.stringify({ origin: SITE_URL, credentials: { owner: Boolean(OWNER_KEY), session: Boolean(SESSION), agentReach: Boolean(AGENT_KEY) }, probes: rows, skipped: SKIPPED }, null, 2));
  } else {
    console.log(`\nCivilCareer admin endpoint smoke check — ${SITE_URL}`);
    console.log(`credentials: owner key ${OWNER_KEY ? 'present' : 'absent'} · admin session ${SESSION ? 'present' : 'absent'} · agent reach key ${AGENT_KEY ? 'present' : 'absent'}\n`);
    const tabW = Math.max(11, ...rows.map((r) => r.tab.length));
    for (const r of rows) {
      const left = `${r.tab.padEnd(tabW)}  ${r.path}`.padEnd(tabW + 56);
      const right = r.probed
        ? `${MARK[r.verdict] || r.verdict}  ${r.status}  ${r.detail}`.trim()
        : `not probed — ${r.reason}`;
      console.log(`${left} ${right}`);
    }
    console.log('');
    const measured = rows.filter((r) => r.probed);
    const real = measured.filter((r) => r.verdict === 'data');
    const empty = measured.filter((r) => r.verdict === 'empty');
    const refused = measured.filter((r) => r.verdict === 'refused');
    const failed = measured.filter((r) => r.verdict === 'error');
    console.log(`measured ${measured.length}/${rows.length} reads · ${real.length} returned rows · ${empty.length} returned none (tab shows its empty state) · ${refused.length} refused the credential supplied`);
    for (const cred of ['owner', 'session', 'agent-reach']) {
      const n = refused.filter((r) => r.credential === cred).length;
      if (!n) continue;
      const label = cred === 'owner' ? 'the owner key' : cred === 'session' ? 'the admin session' : 'the agent-reach key';
      const hint = cred === 'owner'
        ? 'either OWNER_KEY is wrong, or the route is in the dispatcher allowlist and needs a session instead'
        : cred === 'session'
          ? 'the token is wrong, expired, or the account is not on the admin allowlist'
          : 'check AGENT_REACH_INGEST_KEY';
      console.log(`${n} route(s) refused ${label} — ${hint}`);
    }
    const unprobed = rows.filter((r) => !r.probed);
    if (unprobed.length) console.log(`not probed: ${unprobed.length} (${[...new Set(unprobed.map((r) => r.reason))].join('; ')})`);
    console.log(`never probed by design (mutating or credential-spending): ${SKIPPED.length} endpoints — see the list in this file`);
  }

  const broken = rows.filter((r) => r.probed && r.verdict === 'error');
  if (broken.length) {
    console.error(`\n${broken.length} endpoint(s) returned an error:`);
    for (const r of broken) console.error(`  ${r.path} → ${r.status} ${r.detail}`);
    process.exit(1);
  }
  process.exit(0);
})();
