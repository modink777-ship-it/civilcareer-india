/**
 * CivilCareer — Automated Morning Brief (Feature 10)
 *
 * POST { key } (body or x-owner-key header) → compiles and sends the daily
 * Telegram digest to TELEGRAM_CHANNEL_ID:
 *
 *   🌅 CivilCareer Morning Brief
 *   🆕 New Jobs Today       (top 5 published in the last 24 h)
 *   ⚡ Closing This Week    (jobs with deadline within 7 days, max 3)
 *   🏛️ Exam Alerts         (exams with application_end within 7 days)
 *
 * Triggered daily 07:00 IST by .github/workflows/morning-brief.yml using the
 * OWNER_KEY secret, or manually from the Actions tab (workflow_dispatch).
 *
 * Design notes:
 *  - Uses the same https-based Telegram call pattern as _api/telegram.js.
 *  - Telegram Markdown has fragile parsing: values from the database are
 *    stripped of markdown-breaking characters before interpolation.
 *  - Idempotent per day: a second call the same day is a no-op unless
 *    { force: true } is supplied — protects against accidental double cron.
 */

const https = require('https');

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

function supa(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
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

function isAuthorized(req) {
  const expected = String(process.env.OWNER_KEY || '');
  if (!expected) return false;
  const provided =
    String(req.headers['x-owner-key'] || '').trim() ||
    String(parseBody(req).key || '').trim();
  return provided === expected;
}

/* Telegram-safe text: markdown-breaking characters are removed entirely so
   odd company or exam names can never fail the sendMessage call. */
function tgSafe(value) {
  return String(value ?? '')
    .replace(/[*_\[\]()`~>#+=|{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtDay(value) {
  if (!value) return '';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function tgApi(method, payload) {
  return new Promise(resolve => {
    if (!BOT_TOKEN) return resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
    const body = JSON.stringify(payload);
    const rq = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, rs => {
      let data = '';
      rs.on('data', d => { data += d; });
      rs.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve({ ok: false }); } });
    });
    rq.on('error', () => resolve({ ok: false }));
    rq.on('timeout', () => { rq.destroy(); resolve({ ok: false }); });
    rq.write(body);
    rq.end();
  });
}

function daysUntil(value, now) {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - now) / 86400000);
}

function buildBrief({ jobs, closing, exams }, now) {
  const dateStr = now.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const sep = '━━━━━━━━━━━━━━━━━━━';

  const lines = [];
  lines.push('🌅 *CivilCareer Morning Brief*');
  lines.push(`📅 ${dateStr}`);
  lines.push('');
  lines.push(sep);
  lines.push('🆕 *New Jobs Today*');
  if (jobs.length) {
    for (const j of jobs) {
      const where = j.city || j.state || j.location || 'India';
      lines.push(`- ${tgSafe(j.role)} at ${tgSafe(j.company)} — ${tgSafe(where)}`);
    }
  } else {
    lines.push('- No new jobs in the last 24 hours — check the site for live listings');
  }
  lines.push('');
  lines.push(sep);
  lines.push('⚡ *Closing This Week*');
  if (closing.length) {
    for (const j of closing) {
      lines.push(`- ${tgSafe(j.role)} at ${tgSafe(j.company)} — Apply by ${fmtDay(j.deadline)}`);
    }
  } else {
    lines.push('- Nothing closing in the next 7 days');
  }
  lines.push('');
  lines.push(sep);
  lines.push('🏛️ *Exam Alerts*');
  if (exams.length) {
    for (const e of exams) {
      lines.push(`- ${tgSafe(e.name)} — Last date: ${fmtDay(e.application_end)}`);
    }
  } else {
    lines.push('- No exam deadlines in the next 7 days');
  }
  lines.push('');
  lines.push(sep);
  lines.push('🔗 [View all jobs →](https://civilcareer.in)');
  lines.push('📢 @CivilCareerIndiaJobs');
  return lines.join('\n');
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ error: 'Supabase server configuration is missing' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = parseBody(req);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  /* Idempotency guard: one brief per calendar day unless forced.
     Best-effort — if the morning_briefs table does not exist yet the
     send proceeds and the insert is skipped later. */
  if (!body.force) {
    try {
      const marker = await supa(`morning_briefs?select=id&date=eq.${todayStr}&limit=1`);
      if (marker.ok) {
        const rows = await marker.json();
        if (Array.isArray(rows) && rows.length) {
          return res.status(200).json({
            ok: true,
            skipped: true,
            reason: 'Morning brief already sent today',
            date: todayStr,
          });
        }
      }
    } catch (_) { /* never blocks a send */ }
  }

  try {
    /* 1 ── New jobs (last 24 h, published), top 5 */
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const newJobsR = await supa(
      `jobs?select=role,company,city,state,location&published=eq.true&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5`
    );
    const newJobs = newJobsR.ok ? await newJobsR.json() : [];

    /* 2 ── Jobs closing within 7 days, top 3 */
    const horizon = new Date(now.getTime() + 7 * 86400000);
    const horizonStr = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;
    const closingR = await supa(
      `jobs?select=role,company,deadline&published=eq.true&deadline=gte.${todayStr}&deadline=lte.${horizonStr}&order=deadline.asc&limit=3`
    );
    const closing = closingR.ok ? await closingR.json() : [];

    /* 3 ── Exams closing within 7 days, top 6 */
    const examsR = await supa(
      `exam_tracker?select=name,short_name,application_end&is_active=eq.true&application_end=gte.${todayStr}&application_end=lte.${horizonStr}&order=application_end.asc&limit=6`
    );
    let exams = examsR.ok ? await examsR.json() : [];
    /* Fallback to the legacy exams table if the tracker is empty. */
    if (!exams.length) {
      const legacyR = await supa(
        `exams?select=title_en,application_end&published=eq.true&application_end=gte.${todayStr}&application_end=lte.${horizonStr}&order=application_end.asc&limit=6`
      );
      if (legacyR.ok) {
        const legacy = await legacyR.json();
        exams = legacy.map(x => ({ name: x.title_en, application_end: x.application_end }));
      }
    }

    /* 4 ── Build + send */
    const text = buildBrief({ jobs: newJobs, closing, exams }, now);
    const result = await tgApi('sendMessage', {
      chat_id: CHANNEL_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    if (!result.ok) {
      return res.status(502).json({
        ok: false,
        error: 'Telegram send failed',
        details: result.description || result.error || 'unknown',
      });
    }

    /* 5 ── Log the send (best-effort; table may not exist yet) */
    try {
      await supa('morning_briefs', {
        method: 'POST',
        body: JSON.stringify({ date: todayStr, jobs_count: newJobs.length, sent_at: now.toISOString() }),
      });
    } catch (_) { /* logging must never fail the brief */ }

    return res.status(200).json({
      ok: true,
      jobs_mentioned: newJobs.length + closing.length + exams.length,
      new_jobs: newJobs.length,
      closing_jobs: closing.length,
      exam_alerts: exams.length,
      sent_at: now.toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Morning brief failed', details: err.message });
  }
};
