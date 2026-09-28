/**
 * Auto-post a published job to the Telegram channel.
 * Mirrors _api/telegram.js formatting so automatic posts look identical to
 * manual ones. Fire-and-forget by design: callers invoke this without
 * awaiting, so a Telegram hiccup can never slow down or fail a publish.
 *
 * DUPLICATE-PROOF BY CONSTRUCTION (claim-then-send):
 *   1. ATOMIC CLAIM — a single conditional PATCH
 *        PATCH /rest/v1/jobs?id=eq.<id>&telegram_posted=eq.false
 *        body  { telegram_posted: true, telegram_posted_at: now }
 *      Only ONE concurrent caller can flip telegram_posted false → true;
 *      the database itself serializes them. Callers whose PATCH matches
 *      0 rows lost the race and skip sending.
 *   2. SEND — only the winner calls Telegram.
 *   3. ROLLBACK — if Telegram hard-fails (and it was not a transient parse
 *      error), the claim is reverted so a retry can still send.
 */

const https = require('https');
/* Site domain comes from SITE_URL (falls back to the live Vercel host). It used
   to be hardcoded to civilcareer.in, which does not resolve — so every
   auto-posted Telegram job linked to a dead domain. */
const { SITE_URL } = require('./security');
const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

function supa(path, opts) {
  return fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      ...(opts && opts.headers ? opts.headers : {}),
    },
    ...opts,
  });
}

function tgApi(method, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, raw: data }); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false, error: 'network' }));
    req.write(body);
    req.end();
  });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatJob(job) {
  const emoji = {
    government: '🏛️', psu: '🔷', private: '🏢', mnc: '🌐',
    infrastructure: '🏗️', construction: '🏗️', consulting: '📐',
  }[String(job.sector || '').toLowerCase()] || '💼';
  const sector = job.sector
    ? job.sector.charAt(0).toUpperCase() + job.sector.slice(1)
    : '';
  const exp = job.experience_level || (job.experience_min != null ? `${job.experience_min}+ yrs` : '');
  const salary = job.salary || (job.salary_min ? `₹${job.salary_min}–${job.salary_max || ''}` : '');
  const deadline = job.deadline
    ? new Date(job.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const applyUrl =
    job.apply_url || job.application_url || job.source_url ||
    (job.slug ? `${SITE_URL}/jobs/${encodeURIComponent(job.slug)}` : SITE_URL);

  const lines = [`${emoji} *${esc(job.role || 'Job Opening')}*`];
  if (job.company) lines.push(`🏗️ *Company:* ${esc(job.company)}`);
  if (sector) lines.push(`🏷️ *Sector:* ${esc(sector)}`);
  if (job.location || job.city) lines.push(`📍 *Location:* ${esc(job.location || job.city)}`);
  if (exp) lines.push(`🎓 *Experience:* ${esc(exp)}`);
  if (salary) lines.push(`💰 *Salary:* ${esc(salary)}`);
  if (deadline) lines.push(`⏰ *Last Date:* ${esc(deadline)}`);
  lines.push('');
  lines.push(`🔗 [View & Apply](${applyUrl})`);
  lines.push('');
  lines.push('📢 @CivilCareerIndiaJobs');
  return lines.join('\n');
}

/**
 * ATOMIC CLAIM. Attempts to flip telegram_posted false → true with a
 * conditional PostgREST PATCH. Returns:
 *   { claimed: true }                     — this caller won and must send
 *   { claimed: false, reason: 'taken' }   — someone else claimed/already sent
 *   { claimed: false, reason: 'error' }   — infrastructure failure; don't send
 * Note: if the row already has telegram_posted=true the PATCH also matches
 * 0 rows, which is exactly the "already sent" case — no extra lookup needed.
 */
async function claimPost(jobId) {
  try {
    const r = await supa(
      `jobs?id=eq.${encodeURIComponent(jobId)}&telegram_posted=eq.false`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          telegram_posted: true,
          telegram_posted_at: new Date().toISOString(),
        }),
      }
    );
    if (!r.ok) return { claimed: false, reason: 'error' };
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return { claimed: true, job: rows[0] };
    return { claimed: false, reason: 'taken' };
  } catch {
    return { claimed: false, reason: 'error' };
  }
}

/** Best-effort rollback of a claim after a hard Telegram failure. */
async function releaseClaim(jobId) {
  try {
    await supa(`jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ telegram_posted: false, telegram_posted_at: null }),
    });
  } catch { /* non-fatal */ }
}

/**
 * Fire-and-forget auto-post. Never throws. Returns a promise the caller may
 * ignore; internally all errors resolve to { ok:false }.
 */
async function autoPostToTelegram(job) {
  try {
    if (!BOT_TOKEN || !CHANNEL_ID) return { ok: false, error: 'Telegram not configured' };
    if (!job || !job.id) return { ok: false, error: 'no job' };

    /* STEP 1 — atomically claim the right to post this job. Concurrent
       triggers (double-click, bulk loop + PATCH hook, duplicate invokes)
       all reach this line; the database lets exactly one PATCH win. */
    const claim = await claimPost(job.id);
    if (!claim.claimed) {
      return { ok: false, skipped: true, reason: claim.reason };
    }
    const currentJob = claim.job || job;

    /* STEP 2 — only the winner sends. */
    const text = formatJob(currentJob);
    const result = await tgApi('sendMessage', {
      chat_id: CHANNEL_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });

    if (result && result.ok) {
      return { ok: true };
    }

    /* Markdown parse errors are the most common Telegram failure — retry once
       with parse_mode stripped so the message still goes out. */
    if (result && /can't parse entities/i.test(String(result.description || ''))) {
      const retry = await tgApi('sendMessage', {
        chat_id: CHANNEL_ID,
        text: text.replace(/[*_`\[]/g, ''),
        disable_web_page_preview: false,
      });
      if (retry && retry.ok) return { ok: true, retried: true };
      result = retry || result;
    }

    /* STEP 3 — hard failure: release the claim so a later publish/retry can
       still post the job. (Telegram was NOT sent, so the flag must not stay
       true — that would silently swallow the announcement forever.) */
    await releaseClaim(job.id);
    return { ok: false, error: (result && result.description) || 'telegram failed' };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { autoPostToTelegram };
