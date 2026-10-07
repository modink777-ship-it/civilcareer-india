/**
 * CivilCareer — prove the government publish/delete flow end to end.
 *
 * Why this exists: the review queue's endpoints accept ONLY a verified Supabase
 * admin session (ADMIN_RULES for /api/govt-review is `req => true`, and the
 * handler's requireAdmin reads req.adminUser, which the dispatcher sets only
 * after verifyAdminToken succeeds on a Bearer token). The owner key is not
 * honoured on this route. So the honest way to prove publishing works in
 * production is for the owner to run this script with their own credentials,
 * locally — nothing has to be pasted into a chat or into source control.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     node scripts/verify-govt-publish.js            # dry run: shows the plan
 *   ... node scripts/verify-govt-publish.js --apply  # performs it, then undoes it
 *
 * Useful flags:
 *   --id <staging-id>  pick a specific queue row instead of the first eligible one
 *   --keep             publish but do NOT delete afterwards
 *   --status <value>   pass a status filter through to the queue read
 *
 * What it does, in order:
 *   1. signs in to Supabase Auth to get an admin access token
 *   2. reads the review queue and picks a row that can legally publish
 *   3. POSTs action=approve and checks the API says ok
 *   4. confirms the job is visible on the PUBLIC endpoints (list + detail)
 *   5. POSTs action=delete_permanent and checks it is gone from public view
 *
 * It never fabricates a job: it only publishes a row the crawler already
 * staged, and it refuses to publish one that has no official notice URL,
 * because the review gate exists to stop exactly that.
 *
 * No secrets are printed. Exit code is 1 when any step fails.
 */

const SITE_URL = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/$/, '');
const SUPA = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const TOKEN_IN = process.env.ADMIN_ACCESS_TOKEN;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const KEEP = argv.includes('--keep');
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const WANT_ID = argOf('--id');
const WANT_STATUS = argOf('--status');

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body, text };
}

/** A row may only publish if the reviewer has a real official notice to point at. */
function isPublishable(item) {
  const p = item.payload || {};
  return Boolean((p.title || p.post_name) && String(p.official_notice_url || '').trim());
}

function labelOf(item) {
  const p = item.payload || {};
  return `${String(p.title || p.post_name || '(untitled)').slice(0, 70)} [${item.id}]`;
}

async function signIn() {
  if (TOKEN_IN) return TOKEN_IN;
  const r = await jsonFetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok || !r.body || !r.body.access_token) {
    throw new Error(`Supabase sign-in failed (HTTP ${r.status}): ${(r.body && (r.body.error_description || r.body.msg || r.body.error)) || 'no access_token returned'}`);
  }
  return r.body.access_token;
}

async function main() {
  if (!TOKEN_IN && !(SUPA && ANON && EMAIL && PASSWORD)) {
    console.error([
      'Missing credentials. Set either:',
      '  ADMIN_ACCESS_TOKEN                      (a Supabase access token you already have), or',
      '  SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD  (the script signs in for you)',
      '',
      'Nothing here is written to disk or to the repository.',
    ].join('\n'));
    process.exit(2);
  }

  console.log(`Target: ${SITE_URL}`);
  console.log(APPLY ? 'Mode: APPLY (this will publish, then delete)\n' : 'Mode: DRY RUN (no writes — add --apply to perform it)\n');

  const token = await signIn();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  step('admin sign-in', true, 'access token obtained');

  /* ── 1. find a staged row that is allowed to publish ─────────────────── */
  const queueUrl = `${SITE_URL}/api/govt-review${WANT_STATUS ? `?status=${encodeURIComponent(WANT_STATUS)}` : ''}`;
  const queue = await jsonFetch(queueUrl, { headers: auth });
  if (!queue.ok) {
    step('read review queue', false, `HTTP ${queue.status} ${JSON.stringify(queue.body).slice(0, 200)}`);
    return report();
  }
  const rows = [].concat(queue.body?.items || queue.body?.queue || queue.body?.jobs || []);
  step('read review queue', Array.isArray(rows), `${rows.length} row(s) returned`);

  const eligible = rows.filter(isPublishable);
  const chosen = WANT_ID ? rows.find((r) => String(r.id) === String(WANT_ID)) : eligible[0];

  if (!chosen) {
    step('select a publishable row', false,
      rows.length
        ? `none of ${rows.length} staged row(s) carries an official notice URL — the publish gate refuses those on purpose. Stage a real notice first, or pass --id.`
        : 'the queue is empty, so there is nothing to publish yet');
    return report();
  }
  step('select a publishable row', true, labelOf(chosen));
  if (!isPublishable(chosen)) {
    step('publish gate self-check', false, 'the chosen row has no official notice URL, so approval will be refused');
  }

  if (!APPLY) {
    console.log('\nDry run only — nothing was changed. Re-run with --apply to execute steps 2-4.');
    return report();
  }

  /* ── 2. approve → publish ────────────────────────────────────────────── */
  const approveBody = { id: chosen.id };
  const notice = String((chosen.payload || {}).official_notice_url || '').trim();
  if (notice) approveBody.official_notice_url = notice;
  const approved = await jsonFetch(`${SITE_URL}/api/govt-review?action=approve`, {
    method: 'POST', headers: auth, body: JSON.stringify(approveBody),
  });
  const job = approved.body?.job || null;
  const slug = job?.slug || null;
  step('approve → publish', Boolean(approved.ok && approved.body?.ok && slug),
    approved.ok && approved.body?.ok
      ? `HTTP ${approved.status}, slug=${slug || '(none returned)'}`
      : `HTTP ${approved.status} ${JSON.stringify(approved.body).slice(0, 240)}`);
  if (!slug) return report();

  /* ── 3. confirm it is genuinely public ───────────────────────────────── */
  const detailUrl = `${SITE_URL}/api/govt-jobs?slug=${encodeURIComponent(slug)}`;
  const detail = await jsonFetch(detailUrl);
  const detailText = detail.text || '';
  step('public detail endpoint shows it', detail.ok && detailText.includes(slug),
    `HTTP ${detail.status}, ${detailText.includes(slug) ? 'slug present' : 'slug absent'}`);

  const list = await jsonFetch(`${SITE_URL}/api/govt-jobs`);
  step('public listing shows it', list.ok && (list.text || '').includes(slug),
    `HTTP ${list.status}, ${(list.text || '').includes(slug) ? 'slug listed' : 'slug missing from the list'}`);

  if (KEEP) {
    console.log(`\n--keep given, so ${slug} stays published.`);
    return report();
  }

  /* ── 4. delete → confirm it is gone ──────────────────────────────────── */
  const del = await jsonFetch(`${SITE_URL}/api/govt-review?action=delete_permanent`, {
    method: 'POST', headers: auth, body: JSON.stringify({ id: chosen.id }),
  });
  step('delete', Boolean(del.ok && del.body?.ok),
    `HTTP ${del.status} ${JSON.stringify(del.body).slice(0, 160)}`);

  const after = await jsonFetch(detailUrl);
  step('public detail no longer serves it', !(after.text || '').includes(slug),
    `HTTP ${after.status}`);
  const listAfter = await jsonFetch(`${SITE_URL}/api/govt-jobs`);
  step('public listing no longer serves it', !(listAfter.text || '').includes(slug),
    `HTTP ${listAfter.status}`);

  return report();
}

function report() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.log('NOT PROVEN: ' + failed.map((f) => f.name).join('; '));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`FAIL  unexpected error — ${e && e.message ? e.message : e}`);
  process.exit(1);
});
