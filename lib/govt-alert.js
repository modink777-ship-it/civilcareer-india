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

/**
 * Body for "what the bulk publish actually did".
 *
 * Why this exists: ⚡ Publish all ready is one click that can publish nothing at all —
 * every queued row may be waiting on a notice, or past its deadline — and a bulk action
 * that silently does nothing is indistinguishable from one nobody clicked. The owner
 * gets told the count, the titles that went live, and the reasons the rest stayed back.
 *
 * @param {Object} result  what publishReady() returned: { published, jobs, skipped, failed }
 * @param {Object} [opts]  { siteUrl }
 */
function formatPublishSummary(result, opts = {}) {
  const r = result || {};
  const published = Number(r.published) || 0;
  const jobs = Array.isArray(r.jobs) ? r.jobs.filter(Boolean) : [];
  const skipped = Array.isArray(r.skipped) ? r.skipped.filter(Boolean) : [];
  const failed = Array.isArray(r.failed) ? r.failed.filter(Boolean) : [];

  const lines = [published
    ? (published === 1 ? '⚡ <b>Publish-all: 1 civil posting is live</b>' : `⚡ <b>Publish-all: ${published} civil postings are live</b>`)
    : '⚡ <b>Publish-all: nothing was ready</b>', ''];

  for (const j of jobs.slice(0, MAX_LINES)) {
    const title = escapeHtml(String(j.title || '(untitled)').slice(0, 140));
    lines.push(`• <b>${title}</b>`);
  }
  if (jobs.length > MAX_LINES) lines.push(`…and ${jobs.length - MAX_LINES} more.`);

  /* Why the rest stayed back — grouped, because "no official notice" repeats. */
  const reasons = new Map();
  for (const s of skipped) {
    const key = String((s && s.because) || 'not ready').slice(0, 90);
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  const left = skipped.length + failed.length;
  if (left) {
    lines.push('', `Left in the queue: ${left}`);
    for (const [because, n] of [...reasons.entries()].slice(0, 4)) lines.push(`• ${n} — ${escapeHtml(because)}`);
    for (const f of failed.slice(0, 3)) {
      lines.push(`• refused: ${escapeHtml(String(f.title || '(untitled)').slice(0, 80))} — ${escapeHtml(String(f.error || '').slice(0, 120))}`);
    }
  }

  const site = String(opts.siteUrl || '').replace(/\/+$/, '');
  if (site) lines.push('', `Review queue: ${escapeHtml(`${site}/admin`)}`, `Public list: ${escapeHtml(`${site}/government-jobs`)}`);
  return lines.join('\n');
}

/** Send the bulk-publish summary. Same contract as the others: never throws. */
async function sendPublishSummary(result, opts = {}) {
  const tgToken = token();
  const tgChat = chatId();
  if (!tgToken || !tgChat) return { sent: false, skipped: 'telegram-not-configured', error: null };

  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChat,
        text: formatPublishSummary(result, opts).slice(0, 3900),
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
 * Body for "a title that should never be published is live on the site".
 *
 * Why this exists: four records published on 2026-10-03 went out with the
 * source's link text ("Click here to view the advertisement") or a results
 * page's headline ("Traffic Survey Result"), and the public list showed them
 * as post names. The publish gate refuses those today, but nothing noticed
 * the rows that were already live. The guard says it out loud on every run —
 * deliberately without de-duplication: silence while a bad title is live is
 * the failure mode this whole module exists to prevent.
 *
 * @param {{garbage:Array, weak:Array, checked:number}} report  from auditPublished()
 * @param {Object} [opts]  { siteUrl }
 */
function formatTitleGuard(report, opts = {}) {
  const r = report || {};
  const garbage = Array.isArray(r.garbage) ? r.garbage.filter(Boolean) : [];
  if (!garbage.length) return '';
  const weak = Array.isArray(r.weak) ? r.weak.filter(Boolean) : [];

  const lines = [garbage.length === 1
    ? '🚨 <b>Title guard: 1 bad title is live on the site</b>'
    : `🚨 <b>Title guard: ${garbage.length} bad titles are live on the site</b>`, ''];

  for (const g of garbage.slice(0, MAX_LINES)) {
    const title = escapeHtml(String(g.title || '(untitled)').slice(0, 140));
    lines.push(`• <b>${title}</b>`);
    const why = [String(g.verdict || '').replace(/_/g, ' '), String(g.reason || '')]
      .filter(Boolean).join(' — ');
    if (why) lines.push(`  ${escapeHtml(why.slice(0, 160))}`);
    if (g.slug) lines.push(`  ${escapeHtml(String(g.slug).slice(0, 140))}`);
  }
  if (garbage.length > MAX_LINES) lines.push('', `…and ${garbage.length - MAX_LINES} more.`);

  if (weak.length) {
    lines.push('', `${weak.length} more title${weak.length === 1 ? ' is' : 's are'} weak — worth a trim.`);
  }
  const site = String(opts.siteUrl || '').replace(/\/+$/, '');
  if (site) lines.push('', `Fix or unpublish: ${escapeHtml(`${site}/admin`)}`);
  lines.push('', 'This alert repeats every run until it is fixed.');
  return lines.join('\n');
}

/** Send the title-guard alert. Same contract as the others: never throws. */
async function sendTitleGuard(report, opts = {}) {
  const text = formatTitleGuard(report, opts);
  if (!text) return { sent: false, skipped: 'nothing-bad', error: null };

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

module.exports = {
  sendCivilDigest,
  formatDigest,
  sendPipelineWarning,
  formatPipelineWarning,
  formatPublishSummary,
  sendPublishSummary,
  formatTitleGuard,
  sendTitleGuard,
  alertConfigured,
  MAX_LINES,
};
