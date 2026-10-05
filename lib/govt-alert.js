'use strict';

/**
 * CivilCareer — "new civil postings" owner alert.
 *
 * The six aggregator feeds are crawled every couple of hours and everything
 * lands in the private review queue, so the owner otherwise has to open
 * /admin to find out whether anything arrived. This sends one Telegram
 * message listing what was newly staged.
 *
 * Deliberately narrow:
 *   * only genuinely NEW postings are reported. A re-crawl that merely sees the
 *     same row again, or records a change to one already in the queue, is not
 *     news — the crawler's dedupe decides this, not the alert.
 *   * both writers (scripts/crawl-govt-pipeline.js and the /api/govt-discovery
 *     cron) call it. Whichever runs second finds the rows already staged and
 *     reports nothing, so the owner is never told twice about one posting.
 *   * best effort. A notification failure must never fail a crawl, so every
 *     error is swallowed and the caller's run continues.
 */

function token(env = process.env) {
  return String(env.TELEGRAM_BOT_TOKEN || '').trim();
}
function chatId(env = process.env) {
  return String(env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID || '').trim();
}

/** True when an alert can actually be delivered. Used to skip the work entirely. */
function alertConfigured(env = process.env) {
  return Boolean(token(env) && chatId(env));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MAX_LINES = 10;

/**
 * Plain-text body for the digest. Exported so the wording is testable without a
 * network call, and so a caller can log exactly what it would have sent.
 *
 * @param {Array} items  staged postings, newest first
 * @param {Object} [opts] { siteUrl, queueUrl }
 */
function formatDigest(items, opts = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '';

  const head = list.length === 1
    ? '🛠 1 new civil engineering posting to review'
    : `🛠 ${list.length} new civil engineering postings to review`;

  const lines = [head, ''];

  for (const it of list.slice(0, MAX_LINES)) {
    const title = escapeHtml(String(it.title || '(untitled)').slice(0, 140));
    lines.push(`• <b>${title}</b>`);

    const meta = [
      it.organization ? escapeHtml(String(it.organization).slice(0, 80)) : '',
      it.qualification ? escapeHtml(String(it.qualification).slice(0, 120)) : '',
      it.deadline ? `closes ${escapeHtml(String(it.deadline).slice(0, 20))}` : '',
    ].filter(Boolean).join(' · ');
    if (meta) lines.push(`  ${meta}`);

    /* Where it came from, so a wrong-looking entry is one tap from the site. */
    const source = String(it.source || it.url || '');
    if (source) lines.push(`  ${escapeHtml(source.slice(0, 160))}`);
  }

  if (list.length > MAX_LINES) lines.push('', `…and ${list.length - MAX_LINES} more.`);

  const queue = opts.queueUrl || (opts.siteUrl ? `${String(opts.siteUrl).replace(/\/+$/, '')}/admin` : '');
  if (queue) lines.push('', `Review and publish: ${escapeHtml(queue)}`);

  return lines.join('\n');
}

/**
 * Send the digest. Returns { sent, skipped, error } and never throws.
 * Telegram's own limit is 4096 characters; the digest is capped well below that,
 * but the body is trimmed defensively so a long feed cannot make the send fail.
 */
async function sendCivilDigest(items, opts = {}) {
  const text = formatDigest(items, opts);
  if (!text) return { sent: false, skipped: 'nothing-new', error: null };

  const tgToken = token();
  const tgChat = chatId();
  if (!tgToken || !tgChat) return { sent: false, skipped: 'telegram-not-configured', error: null };

  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChat,
        text: text.slice(0, 3900),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { sent: false, skipped: null, error: `HTTP ${r.status} ${body.slice(0, 120)}` };
    }
    return { sent: true, skipped: null, error: null };
  } catch (e) {
    return { sent: false, skipped: null, error: String((e && e.message) || e).slice(0, 160) };
  }
}

/**
 * Body for the "the pipeline looks frozen" warning.
 *
 * Why this exists: the queue silently froze at "sources: 0" — every health signal
 * still read clean, the admin panel showed a tidy run, and nothing new arrived for
 * days. A run that seeds no source, or that parses nothing from any source while
 * reporting no errors at all, is not "no news"; it is a broken pipeline. That has to
 * be said out loud rather than left to be noticed.
 */
function formatPipelineWarning(detail, opts = {}) {
  const lines = [
    '🚨 <b>Government jobs pipeline looks frozen</b>',
    '',
    escapeHtml(String(detail || 'A sweep produced nothing at all, with no errors reported.').slice(0, 400)),
    '',
    'Nothing reaches the review queue until this is fixed.',
  ];
  const site = String(opts.siteUrl || '').replace(/\/+$/, '');
  if (site) lines.push('', `Check the sources: ${escapeHtml(`${site}/admin`)}`);
  return lines.join('\n');
}

/** Send the freeze warning. Same contract as sendCivilDigest: never throws. */
async function sendPipelineWarning(detail, opts = {}) {
  const tgToken = token();
  const tgChat = chatId();
  if (!tgToken || !tgChat) return { sent: false, skipped: 'telegram-not-configured', error: null };

  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChat,
        text: formatPipelineWarning(detail, opts).slice(0, 3900),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { sent: false, skipped: null, error: `HTTP ${r.status} ${body.slice(0, 120)}` };
    }
    return { sent: true, skipped: null, error: null };
  } catch (e) {
    return { sent: false, skipped: null, error: String((e && e.message) || e).slice(0, 160) };
  }
}

module.exports = {
  sendCivilDigest,
  formatDigest,
  sendPipelineWarning,
  formatPipelineWarning,
  alertConfigured,
  MAX_LINES,
};
