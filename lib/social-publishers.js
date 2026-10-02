/**
 * CivilCareer — Social Content Engine publishers (P2, gap report F3)
 *
 * Every platform send goes through this module so the API layer
 * never talks to a platform directly. Publishers return a uniform
 * result:
 *   { ok, externalId, externalUrl, destinationRef, error, response, retryable }
 * `response` is the RAW platform response — the API layer redacts
 * it (redactSecrets) before persisting response_snapshot.
 *
 * Telegram: fully implemented (plain-text channel posts).
 * LinkedIn (F12, P5) and Instagram (F13, P6): the send
 * interface is wired and FAILS CLOSED with an explicit
 * "not implemented" error so the ledger records the attempt
 * honestly instead of silently skipping a platform.
 */

const { PLATFORMS } = require('./social-core');

const TELEGRAM_API_HOST = 'api.telegram.org';

/* ── Telegram ─────────────────────────────────────────── */

/**
 * POST /sendMessage to a channel. Plain text (no parse_mode) so
 * unusual exam/company names can never break delivery — the same
 * discipline as the pre-engine announcer in _api/exam-tracker.js.
 */
function sendTelegram({ token, chatId, text, disablePreview = true }) {
  return new Promise((resolve) => {
    if (!token) {
      resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set', retryable: false });
      return;
    }
    if (!chatId) {
      resolve({ ok: false, error: 'TELEGRAM_CHANNEL_ID not set', retryable: false });
      return;
    }
    if (!text) {
      resolve({ ok: false, error: 'Empty Telegram text', retryable: false });
      return;
    }

    const https = require('https');
    const body = JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4096),
      disable_web_page_preview: disablePreview,
    });

    const rq = https.request({
      hostname: TELEGRAM_API_HOST,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, (rs) => {
      let data = '';
      rs.on('data', (d) => { data += d; });
      rs.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = null; }
        if (parsed && parsed.ok) {
          const messageId = parsed.result && parsed.result.message_id;
          const numeric = String(chatId).replace(/^-100/, '');
          resolve({
            ok: true,
            externalId: messageId != null ? String(messageId) : null,
            externalUrl: /^\d+$/.test(numeric) && messageId != null
              ? `https://t.me/c/${numeric}/${messageId}`
              : null,
            destinationRef: String(chatId),
            error: null,
            response: parsed,
            retryable: false,
          });
          return;
        }
        const description = parsed && (parsed.description || parsed.error_code);
        /* 429 and 5xx are retryable; other Telegram errors are not. */
        const code = parsed && parsed.error_code;
        resolve({
          ok: false,
          externalId: null,
          externalUrl: null,
          destinationRef: String(chatId),
          error: description || `Telegram error (HTTP ${rs.statusCode})`,
          response: parsed,
          retryable: code === 429 || (rs.statusCode >= 500),
        });
      });
    });
    rq.on('error', (err) => resolve({
      ok: false, error: `Telegram network error: ${err && err.message}`,
      retryable: true, response: null,
    }));
    rq.on('timeout', () => {
      rq.destroy();
      resolve({ ok: false, error: 'Telegram request timed out', retryable: true, response: null });
    });
    rq.write(body);
    rq.end();
  });
}

/* ── LinkedIn (P5 / F12) ──────────────────────────────── */

function sendLinkedIn() {
  /* The UGC-post flow (share → poll for status) is built in P5.
     Until then a LinkedIn publish attempt is an honest failure,
     never a silent skip: the ledger row records it. */
  return Promise.resolve({
    ok: false,
    externalId: null,
    externalUrl: null,
    destinationRef: null,
    error: 'LinkedIn publisher ships in Phase 5 (F12) — not yet available',
    response: null,
    retryable: false,
  });
}

/* ── Instagram (P6 / F13) ─────────────────────────────── */

function sendInstagram() {
 /* The media-container flow (create container → publish) is
    built in P6. Same fail-closed contract as LinkedIn. */
  return Promise.resolve({
    ok: false,
    externalId: null,
    externalUrl: null,
    destinationRef: null,
    error: 'Instagram publisher ships in Phase 6 (F13) — not yet available',
    response: null,
    retryable: false,
  });
}

/* ── dispatch + configuration ─────────────────────────── */

const PUBLISHERS = {
  telegram: sendTelegram,
  linkedin: sendLinkedIn,
  instagram: sendInstagram,
};

function publisherFor(platform) {
  return PUBLISHERS[platform] || null;
}

/**
 * Is the platform wired up enough to attempt a send?
 * Telegram needs bot token + a channel (real or test).
 * LinkedIn/Instagram report their env readiness even though
 * the send itself is not implemented until P5/P6.
 */
function platformConfigured(platform, env = process.env) {
  switch (platform) {
    case 'telegram':
      return Boolean(env.TELEGRAM_BOT_TOKEN &&
        (env.TELEGRAM_CHANNEL_ID || env.TELEGRAM_TEST_CHANNEL_ID));
    case 'linkedin':
      return Boolean(env.LINKEDIN_ACCESS_TOKEN);
    case 'instagram':
      return Boolean(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
    default:
      return false;
  }
}

/** Telegram chat id for a test send (the private test channel). */
function telegramTestChannel(env = process.env) {
  return env.TELEGRAM_TEST_CHANNEL_ID || env.TELEGRAM_CHANNEL_ID || null;
}

module.exports = {
  PUBLISHERS, publisherFor, platformConfigured,
  sendTelegram, sendLinkedIn, sendInstagram,
  telegramTestChannel, PLATFORMS,
};
