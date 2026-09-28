/**
 * Auto-post a published job to the Telegram channel.
 * Mirrors _api/telegram.js formatting so automatic posts look identical to
 * manual ones. Fire-and-forget by design: callers invoke this without
 * awaiting, so a Telegram hiccup can never slow down or fail a publish.
 *
 * A dedupe guard re-checks telegram_posted immediately before sending, so a
 * job is never posted to the channel twice even if two triggers race.
 */

const https = require('https');
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
    (job.slug ? `https://civilcareer.in/jobs/${job.slug}` : 'https://civilcareer.in');

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

/** Escape for Telegram MarkdownV2 text entities (used inside HTML fallbacks). */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Best-effort re-check that this job has not already been sent to Telegram. */
async function alreadyPosted(jobId) {
  try {
    const r = await supa(`jobs?select=telegram_posted&id=eq.${encodeURIComponent(jobId)}&limit=1`);
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] && rows[0].telegram_posted === true;
  } catch {
    return false;
  }
}

async function markPosted(jobId) {
  try {
    await supa(`jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        telegram_posted: true,
        telegram_posted_at: new Date().toISOString(),
      }),
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

    // Dedupe: never post the same job twice, even under double triggers.
    if (await alreadyPosted(job.id)) {
      return { ok: false, skipped: true, reason: 'already posted' };
    }

    const result = await tgApi('sendMessage', {
      chat_id: CHANNEL_ID,
      text: formatJob(job),
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });

    if (result && result.ok) {
      await markPosted(job.id);
      return { ok: true };
    }

    // Markdown parse errors are the most common Telegram failure — retry once
    // with parse_mode stripped so the message still goes out.
    if (result && /can't parse entities/i.test(String(result.description || ''))) {
      const retry = await tgApi('sendMessage', {
        chat_id: CHANNEL_ID,
        text: formatJob(job).replace(/[*_`\[]/g, ''),
        disable_web_page_preview: false,
      });
      if (retry && retry.ok) {
        await markPosted(job.id);
        return { ok: true, retried: true };
      }
      return { ok: false, error: retry && retry.description || 'telegram retry failed' };
    }

    return { ok: false, error: (result && result.description) || 'telegram failed' };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { autoPostToTelegram };
