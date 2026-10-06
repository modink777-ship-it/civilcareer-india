/* Title guard: nothing with a garbage title should be live on the public list.
 *
 * The publish gate refuses a junk title today (govt-review approve), but the four
 * records published on 2026-10-03 predate it and are still served as civil
 * vacancies. Both pipeline writers (the GitHub crawler and the /api/govt-discovery
 * cron) now run a read-only sweep of active rows after every run and tell the
 * owner — deliberately on every run, because silence while a bad title is live is
 * the failure mode this exists to prevent.
 *
 * What must hold:
 *   1. auditPublished separates "must never be live" (junk / not_recruitment)
 *      from advisory (weak) and leaves clean rows alone — and never throws on
 *      malformed input.
 *   2. The Telegram body escapes untrusted scraped titles (HTML parse mode).
 *   3. The send follows the module's never-throws contract: unconfigured means
 *      zero network calls, an HTTP error is reported rather than thrown, and a
 *      clean site produces no message at all.
 *   4. Both writers actually call the guard — the wiring is the whole feature.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const { auditPublished } = require(path.join(root, 'lib', 'govt-title'));
const alert = require(path.join(root, 'lib', 'govt-alert'));

const PUBLISHED = [
  { id: 'j1', title: 'Traffic Survey Result', slug: 'traffic-survey-result', post_name: null },
  { id: 'j2', title: 'Click here to view the advertisement', slug: 'click-here', post_name: null },
  { id: 'j3', title: 'Junior Engineer (Civil) Recruitment', slug: 'je-civil', post_name: null },
  { id: 'j4', title: 'Advertisement for the post of Assistant Engineer (Civil) on Direct Recruitment basis',
    slug: 'ae-civil', post_name: 'Assistant Engineer (Civil)' },
  { id: 'j5', title: 'Applications are invited for the post of Junior Engineer (Civil) in the Water Resources Department of the Government of Assam, please read the advertisement carefully before applying online',
    slug: 'je-civil-assam-long', post_name: null },
];

test('auditPublished separates the titles that must never be live from the weak ones', () => {
  const r = auditPublished(PUBLISHED);
  assert.strictEqual(r.checked, 5);
  assert.deepStrictEqual(r.garbage.map(g => g.id), ['j1', 'j2']);
  assert.strictEqual(r.garbage[0].verdict, 'not_recruitment');
  assert.strictEqual(r.garbage[1].verdict, 'junk');
  assert.ok(r.garbage[0].reason, 'every entry must carry why it is garbage');
  assert.deepStrictEqual(r.weak.map(w => w.id), ['j5'], 'only the long headline is weak');
  const ids = r.garbage.concat(r.weak).map(x => x.id);
  assert.ok(!ids.includes('j3'), 'a clean row is not reported');
  assert.ok(!ids.includes('j4'), 'a wrapper that cleans to ok is not garbage');

  assert.deepStrictEqual(auditPublished([]), { checked: 0, garbage: [], weak: [] });
  assert.deepStrictEqual(auditPublished(null), { checked: 0, garbage: [], weak: [] });
  assert.deepStrictEqual(auditPublished([null, undefined]), { checked: 0, garbage: [], weak: [] });
});

test('formatTitleGuard is silent when the site is clean and loud when it is not', () => {
  assert.strictEqual(alert.formatTitleGuard({ checked: 10, garbage: [], weak: [] }), '',
    'a clean site must produce no message');
  assert.strictEqual(alert.formatTitleGuard(null), '');
  assert.strictEqual(alert.formatTitleGuard(undefined), '');

  const report = auditPublished(PUBLISHED);
  const msg = alert.formatTitleGuard(report, { siteUrl: 'https://site.example/' });
  assert.match(msg, /2 bad titles are live/, 'plural wording with the real count');
  assert.match(msg, /Traffic Survey Result/);
  assert.match(msg, /not recruitment/, 'the verdict must be readable, not an enum');
  assert.match(msg, /result \/ key \/ list page/, 'the reason says why');
  assert.match(msg, /1 more title is weak/, 'the advisory count rides along');
  assert.match(msg, /Fix or unpublish: https:\/\/site\.example\/admin/,
    'the admin link must be exact — no double slash');
  assert.match(msg, /repeats every run/, 'the owner must know it will repeat');

  const one = alert.formatTitleGuard({ garbage: report.garbage.slice(0, 1), weak: [] });
  assert.match(one, /1 bad title is live/, 'singular wording');

  const many = alert.formatTitleGuard({
    garbage: Array.from({ length: alert.MAX_LINES + 3 }, (_, i) => ({ id: 'g' + i, title: 'Post ' + i, verdict: 'junk', reason: 'link text' })),
    weak: [],
  });
  assert.match(many, /13 bad titles are live/, 'plural wording and the real count');
  assert.match(many, /…and 3 more\./, 'a long run must be summarised, not truncated silently');
});

test('untrusted titles cannot inject markup into the guard message', () => {
  const msg = alert.formatTitleGuard({
    garbage: [{ id: 'x', title: '<b>pwned</b><a href="https://evil.example">x</a>', verdict: 'junk', reason: 'a & b <script>alert(1)</script>' }],
    weak: [],
  }, { siteUrl: 'https://site.example' });
  assert.ok(!/<script/i.test(msg), 'a scraped <script> must not survive into the message');
  assert.ok(!/<b>pwned<\/b>/.test(msg), 'scraped markup must be escaped, not rendered');
  assert.ok(/&lt;b&gt;pwned&lt;\/b&gt;/.test(msg), 'scraped markup must arrive as literal text');
  assert.ok(/&amp;/.test(msg), 'ampersands must be escaped');
});

test('sendTitleGuard follows the never-throws contract', async () => {
  const saved = { ...process.env };
  const realFetch = global.fetch;
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;

    let calls = 0;
    global.fetch = async () => { calls += 1; throw new Error('must not be called'); };

    /* A clean site: nothing to say, zero network. */
    let r = await alert.sendTitleGuard({ garbage: [] });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.skipped, 'nothing-bad');
    assert.strictEqual(calls, 0, 'a clean site must not call Telegram');

    /* Garbage found but Telegram unconfigured: reported, never attempted. */
    const report = auditPublished(PUBLISHED);
    r = await alert.sendTitleGuard(report, { siteUrl: 'https://site.example' });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.skipped, 'telegram-not-configured');
    assert.strictEqual(calls, 0, 'an unconfigured alert must not call Telegram');

    /* Configured: posts the escaped body to the admin chat. */
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '42';
    const seen = [];
    global.fetch = async (url, opts) => {
      seen.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, text: async () => 'ok' };
    };
    r = await alert.sendTitleGuard(report, { siteUrl: 'https://site.example' });
    assert.strictEqual(r.sent, true, JSON.stringify(r));
    assert.strictEqual(seen.length, 1);
    assert.match(seen[0].url, /api\.telegram\.org\/bottest-token\/sendMessage/);
    assert.strictEqual(seen[0].body.chat_id, '42');
    assert.strictEqual(seen[0].body.parse_mode, 'HTML');
    assert.ok(seen[0].body.text.length <= 3900, "the body must stay inside Telegram's limit");
    assert.match(seen[0].body.text, /Traffic Survey Result/);

    /* A Telegram error is reported, never thrown. */
    global.fetch = async () => ({ ok: false, status: 400, text: async () => 'Bad Request: chat not found' });
    r = await alert.sendTitleGuard(report);
    assert.strictEqual(r.sent, false);
    assert.match(r.error, /400/, `the HTTP status must be reported, got ${r.error}`);
  } finally {
    global.fetch = realFetch;
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('both pipeline writers run the guard', () => {
  const crawler = fs.readFileSync(path.join(root, 'scripts', 'crawl-govt-pipeline.js'), 'utf8');
  assert.match(crawler, /sendTitleGuard\(/, 'the crawler must send the guard alert');
  assert.match(crawler, /auditPublished\(/, 'the crawler must sweep the published rows');
  assert.match(crawler, /govt_jobs\?status=eq\.active/, 'the sweep reads the public list');
  assert.match(crawler, /title_guard/, 'the guard result must appear in the run summary');

  const discovery = fs.readFileSync(path.join(root, '_api', 'govt-discovery.js'), 'utf8');
  assert.match(discovery, /sendTitleGuard\(/, 'the cron writer must send the guard alert too');
  assert.match(discovery, /auditPublished\(/, 'the cron writer must sweep the published rows');
  assert.match(discovery, /govt_jobs\?status=eq\.active/, 'the sweep reads the public list');
  assert.match(discovery, /title_guard: titleGuard/, 'the guard result must appear in the cron response');
});
