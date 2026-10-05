'use strict';
/**
 * The review queue is private, so the owner only learns about new civil
 * postings if something tells them. lib/govt-alert.js sends one Telegram digest
 * per crawl — and only when genuinely new rows were staged.
 *
 * Two things must hold, and neither is visible from "a message was sent":
 *   1. Scraped text is UNTRUSTED and the message uses Telegram's HTML parse
 *      mode, so a title containing markup must not be able to break or inject
 *      into the message.
 *   2. A notification failure must never fail a crawl, and an unconfigured bot
 *      must not attempt a network call at all.
 */
const assert = require('assert');
const path = require('path');
const alert = require(path.join(__dirname, '..', 'lib', 'govt-alert'));

/* ── the body ───────────────────────────────────────────────────────────── */

assert.strictEqual(alert.formatDigest([]), '', 'nothing new must produce no message');
assert.strictEqual(alert.formatDigest(null), '');

const one = alert.formatDigest([{ title: 'PWD Junior Engineer (Civil)', organization: 'PWD', qualification: 'Diploma in Civil Engineering', deadline: '21-10-2026', source: 'govtjobguru — https://x.in/a' }]);
assert.ok(/^🛠 1 new civil engineering posting to review/.test(one), `singular wording expected, got ${JSON.stringify(one.split('\n')[0])}`);
assert.ok(/PWD Junior Engineer \(Civil\)/.test(one));
assert.ok(/Diploma in Civil Engineering/.test(one), 'the qualification is the evidence, so it belongs in the digest');
assert.ok(/closes 21-10-2026/.test(one));
assert.ok(/https:\/\/x\.in\/a/.test(one), 'the source link must be included so a wrong entry is one tap away');

const many = alert.formatDigest(Array.from({ length: alert.MAX_LINES + 3 }, (_, i) => ({ title: `Post ${i}` })), { siteUrl: 'https://civilcareer-india-two.vercel.app/' });
assert.ok(/13 new civil engineering postings/.test(many), 'plural wording and the real count');
assert.ok(/…and 3 more\./.test(many), 'a long run must be summarised, not truncated silently');
assert.ok(/Review and publish: https:\/\/civilcareer-india-two\.vercel\.app\/admin/.test(many),
  'the digest must link to the queue, with no double slash');

/* Untrusted scraped text must not inject markup into an HTML-parsed message. */
const nasty = alert.formatDigest([{
  title: '<b>pwned</b><a href="https://evil.example">x</a>',
  organization: 'A & B <script>alert(1)</script>',
  qualification: 'Civil "Engineering"',
  source: 'src <i>',
}]);
assert.ok(!/<script/i.test(nasty), 'a scraped <script> must not survive into the message');
assert.ok(!/<b>pwned<\/b>/.test(nasty), 'scraped markup must be escaped, not rendered');
assert.ok(/&lt;b&gt;pwned&lt;\/b&gt;/.test(nasty), 'scraped markup must arrive as literal text');
assert.ok(/&amp;/.test(nasty), 'ampersands must be escaped');
assert.ok(/&quot;/.test(nasty), 'quotes must be escaped');

/* ── the send ───────────────────────────────────────────────────────────── */

(async () => {
  const saved = { ...process.env };
  const realFetch = global.fetch;
  let calls = 0;
  const callsList = [];

  try {
    /* Unconfigured: no network call at all. */
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
    global.fetch = async () => { calls += 1; throw new Error('must not be called'); };
    let r = await alert.sendCivilDigest([{ title: 'X' }]);
    assert.strictEqual(calls, 0, 'an unconfigured alert must not call Telegram');
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.skipped, 'telegram-not-configured');
    assert.strictEqual(alert.alertConfigured(), false);

    /* Configured: posts to the admin chat with the escaped body. */
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '12345';
    assert.strictEqual(alert.alertConfigured(), true);
    global.fetch = async (url, opts) => {
      callsList.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, text: async () => 'ok' };
    };
    r = await alert.sendCivilDigest([{ title: 'PWD JE (Civil)' }], { siteUrl: 'https://site.example' });
    assert.strictEqual(r.sent, true, JSON.stringify(r));
    assert.strictEqual(callsList.length, 1);
    assert.ok(/api\.telegram\.org\/bottest-token\/sendMessage/.test(callsList[0].url), 'the bot token builds the endpoint');
    assert.strictEqual(callsList[0].body.chat_id, '12345');
    assert.strictEqual(callsList[0].body.parse_mode, 'HTML');
    assert.ok(/PWD JE \(Civil\)/.test(callsList[0].body.text));
    assert.ok(callsList[0].body.text.length <= 3900, 'the body must stay inside Telegram\'s limit');

    /* A Telegram error is reported, never thrown. */
    global.fetch = async () => ({ ok: false, status: 400, text: async () => 'Bad Request: chat not found' });
    r = await alert.sendCivilDigest([{ title: 'X' }]);
    assert.strictEqual(r.sent, false);
    assert.ok(/400/.test(r.error), `the HTTP status must be reported, got ${r.error}`);

    /* A network blow-up is swallowed: a crawl must never fail because of this. */
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    r = await alert.sendCivilDigest([{ title: 'X' }]);
    assert.strictEqual(r.sent, false);
    assert.ok(/ECONNRESET/.test(r.error));

    /* Nothing new: still no call, even when configured. */
    global.fetch = async () => { calls += 1; throw new Error('must not be called'); };
    const before = calls;
    r = await alert.sendCivilDigest([]);
    assert.strictEqual(r.skipped, 'nothing-new');
    assert.strictEqual(calls, before, 'an empty digest must not call Telegram');
  } finally {
    global.fetch = realFetch;
    process.env = saved;
  }

  /* The digest is only useful if both writers call it. */
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  for (const file of ['scripts/crawl-govt-pipeline.js', '_api/govt-discovery.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(/require\(['"][^'"]*govt-alert['"]\)/.test(src), `${file} must use the shared alert`);
    assert.ok(/sendCivilDigest\(/.test(src), `${file} must send the digest`);
  }
  const crawler = fs.readFileSync(path.join(root, 'scripts/crawl-govt-pipeline.js'), 'utf8');
  assert.ok(/!\s*staged\.update/.test(crawler),
    'only genuinely new postings may be reported — an update to a queued row is not news');

  console.log('Government new-civil-jobs alert tests: PASS');
})().catch(e => { console.error(e); process.exit(1); });
