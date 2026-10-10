'use strict';

/**
 * IndexNow publish ping — fire-and-forget notifying Bing/Yandex (and the
 * engines that share the protocol, including Seznam and Naver) that newly
 * published content exists so detail pages get crawled within hours, not
 * weeks. Google does not support IndexNow; for it, submitting the sitemap
 * again through the Search Console API (SITEMAP_PING_API keyless ping is
 * deprecated since 2023, so nothing is sent) remains the only supported
 * route — the sitemap itself already lists every published page and is
 * re-fetched by GoogleBot weekly.
 *
 * Best-effort by design: a ping failure or an unset INDEXNOW_KEY must
 * NEVER delay or fail a publish. Returns {sent:boolean, status:number}
 * and only throws on impossibility (never on network failure).
 *
 * Key hosting: set INDEXNOW_KEY in the environment, then the dispatcher
 * answers GET /<INDEXNOW_KEY>.txt with that key (see _api/indexnow-key.js)
 * — the protocol's ownership proof.
 */

const { SITE_URL } = require('../lib/security');

const KEY = () => String(process.env.INDEXNOW_KEY || '').trim();

/* IndexNow accepts ≤10,000 URLs per POST; batches of 50 URLs here so a
   publish_ready sweep of 40 rows stays one request. */
function pingEndpoint() {
  return 'https://api.indexnow.org/indexnow'; /* shared indexaddAll across engines */
}

/**
 * Ping one or more just-published pages.
 * @param {string[]} paths e.g. ['/government-jobs/job/rrb-je-2026']
 */
async function pingPublished(paths, reason = 'publish') {
  const key = KEY();
  if (!key) return { sent: false, reason: 'INDEXNOW_KEY not configured' };
  const siteUrl = String(SITE_URL || '').replace(/\/+$/, '');
  const urls = (Array.isArray(paths) ? paths : [paths])
    .filter(Boolean)
    .map(p => `${siteUrl}${p.startsWith('/') ? p : '/' + p}`);
  if (!urls.length) return { sent: false, reason: 'nothing to ping' };

  try {
    const r = await fetch(pingEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(siteUrl).host,
        key,
        keyLocation: `${siteUrl}/${key}.txt`,
        urlList: urls.slice(0, 10000),
      }),
      signal: AbortSignal.timeout(8000),
    });
    /* 200 enrolled; 202 accepted; 4xx = ownership/format problem —
       never retry automatically (would mask config errors in logs). */
    if (!r.ok) {
      console.error(`[ping:${reason}] indexnow ${r.status} — check INDEXNOW_KEY + key file`);
      return { sent: false, status: r.status };
    }
    return { sent: true, status: r.status, count: urls.length };
  } catch (e) {
    console.error(`[ping:${reason}] unreachable:`, String((e && e.message) || e).slice(0, 120));
    return { sent: false, error: 'network' };
  }
}

module.exports = { pingPublished };
module.exports._internal = { KEY, pingEndpoint };
