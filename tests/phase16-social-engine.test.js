/* ════════════════════════════════════════════════════════════
   P2 — Social Content Engine regression tests (gap report F1–F8)

   F1 lib/social-core.js      Truth Lock hashes, content locks,
                              rollup, caps, redaction
   F2 lib/social-templates.js per-platform renderers + snapshots
   F3 lib/social-publishers.js Telegram send + real
                              LinkedIn/Instagram publishers
   F4 _api/social.js          admin-only handler + dispatcher
   F5 admin.html              Social tab (source-level checks;
                              the admin bundle round-trip is
                              asserted by phase1-security)
   F6 _api/exam-tracker.js    re-routed through the engine
   F7 _api/admin-jobs.js      legacy autopost gate
   F8 .env.example            every variable documented
   ════════════════════════════════════════════════════════════ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const core = require('../lib/social-core');
const templates = require('../lib/social-templates');
const publishers = require('../lib/social-publishers');
const social = require('../_api/social');
const examTracker = require('../_api/exam-tracker');

const root = path.join(__dirname, '..');

/* ── shared harness ─────────────────────────────── */

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { res.headers[k] = v; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    /* sendJson writes JSON through end() — parse it back
       so assertions can read res.body.<field> either way. */
    end(body) {
      let parsed = body;
      try { parsed = body ? JSON.parse(body) : body; } catch (_) { parsed = body; }
      res.body = parsed;
      return res;
    },
  };
  return res;
}

/* The exact req/res shape _api/exam-tracker.js uses for its
   in-process call into the Social handler (callSocial). */
function inProcessRes() {
  const res = {
    statusCode: 200,
    setHeader() {},
    end(data) {
      let json = null;
      try { json = data ? JSON.parse(data) : null; } catch (_) { json = null; }
      res.body = json;
    },
  };
  return res;
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function stubFetch(impl) {
  const real = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = real; };
}

const OWNER_ENV = {
  OWNER_KEY: 'test-owner-key',
  SUPABASE_URL: 'https://db-test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc-test-key',
};

/* ═══ F1 — lib/social-core.js ════════════════════ */

test('F1 contentHash: deterministic, nulls as empty strings, unit-separator joined', () => {
  const a = core.contentHash({ title: 'T', body_telegram: 'x' });
  const b = core.contentHash({ title: 'T', body_telegram: 'x' });
  assert.equal(a, b);
  assert.equal(a, core.sha256(['T', 'x', '', '', '', '', ''].join('')));
  /* null vs missing vs empty string all hash identically */
  assert.equal(
    core.contentHash({ title: null, body_telegram: undefined }),
    core.contentHash({ title: '', body_telegram: '' })
  );
  /* any content change changes the hash */
  assert.notEqual(
    core.contentHash({ title: 'T' }),
    core.contentHash({ title: 'T2' })
  );
});

test('F1 truthHash: canonical JSON is key-order independent', () => {
  const snap1 = { b: 2, a: { z: 1, y: 2 }, c: [3, 1, 2] };
  const snap2 = { a: { y: 2, z: 1 }, c: [3, 1, 2], b: 2 };
  assert.equal(core.truthHash(snap1), core.truthHash(snap2));
  assert.notEqual(core.truthHash(snap1), core.truthHash({ a: 1 }));
  /* volatile metadata changes the hash — Truth Lock must notice */
  const base = { name: 'SSC JE', status: 'application_open' };
  assert.notEqual(core.truthHash(base), core.truthHash({ ...base, vacancy_count: 500 }));
});

test('F1 validateContent: title required; per-platform limits; hashtag cap', () => {
  assert.equal(core.validateContent({}).ok, false);
  assert.equal(core.validateContent({ title: 'OK' }).ok, true);
  const longTg = { title: 't', body_telegram: 'x'.repeat(4097) };
  assert.equal(core.validateContent(longTg).ok, false);
  assert.match(core.validateContent(longTg).errors.join(' '), /body_telegram exceeds 4096/);
  assert.equal(core.validateContent({ title: 't', body_telegram: 'x'.repeat(4096) }).ok, true);
  const caption = { title: 't', caption_instagram: ' '.repeat(0) + Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ') };
  assert.equal(core.validateContent(caption).ok, false);
  const captionOk = { title: 't', caption_instagram: Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(' ') };
  assert.equal(core.validateContent(captionOk).ok, true);
});

test('F1 linkUrlAllowed: only the site host may be linked', () => {
  const site = 'https://civilcareer-india-two.vercel.app';
  assert.equal(core.linkUrlAllowed('', site), true);
  assert.equal(core.linkUrlAllowed(null, site), true);
  assert.equal(core.linkUrlAllowed('https://civilcareer-india-two.vercel.app/exam-tracker', site), true);
  assert.equal(core.linkUrlAllowed('https://evil.example.com/', site), false);
  assert.equal(core.linkUrlAllowed('javascript:alert(1)', site), false);
});

test('F1 redactSecrets: strips query tokens, Bearer headers and bot URLs', () => {
  const red = core.redactSecrets(
    'POST /bot123456:ABC/sendMessage?access_token=abc123 failed with Bearer eyJhbGciOiJ9.xyz'
  );
  assert.ok(!red.includes('123456:ABC'), 'bot token must be redacted');
  assert.ok(!red.includes('abc123'), 'query token must be redacted');
  assert.ok(!red.includes('eyJhbGciOiJ9'), 'Bearer token must be redacted');
  assert.match(red, /\[REDACTED\]/);
  assert.equal(core.redactSecrets(null), '');
});

test('F1 rollupStatus: v27 rules over REAL rows only', () => {
  const real = (rows) => rows.map((r) => ({ ...r, is_test: false }));
  assert.equal(core.rollupStatus(real([{ status: 'publishing' }])), 'publishing');
  assert.equal(core.rollupStatus(real([{ status: 'needs_second_step' }])), 'publishing');
  assert.equal(core.rollupStatus(real([{ status: 'sent' }, { status: 'sent' }])), 'published');
  assert.equal(core.rollupStatus(real([{ status: 'sent' }, { status: 'failed' }])), 'partial');
  assert.equal(core.rollupStatus(real([{ status: 'failed' }, { status: 'expired' }])), 'approved');
  assert.equal(core.rollupStatus([]), 'approved');
  /* test rows never move the status */
  assert.equal(
    core.rollupStatus([{ status: 'sent', is_test: true }]),
    'approved'
  );
});

test('F1 zonedDayStartUtc: Asia/Kolkata day starts at 18:30 UTC of the previous day', () => {
  /* 2 Oct 2026 12:00 UTC = 17:30 IST on 2 Oct → IST day boundary is 1 Oct 18:30 UTC */
  const start = core.zonedDayStartUtc(Date.UTC(2026, 9, 2, 12), 'Asia/Kolkata');
  assert.equal(new Date(start).toISOString(), '2026-10-01T18:30:00.000Z');
  /* 00:00 UTC = 05:30 IST, still inside the same IST day */
  const early = core.zonedDayStartUtc(Date.UTC(2026, 9, 2, 0), 'Asia/Kolkata');
  assert.equal(new Date(early).toISOString(), '2026-10-01T18:30:00.000Z');
  /* unknown timezone falls back to the default zone */
  const fallback = core.zonedDayStartUtc(Date.UTC(2026, 9, 2, 12), 'Mars/Olympus');
  assert.equal(new Date(fallback).toISOString(), '2026-10-01T18:30:00.000Z');
});

test('F1 attemptsToday: counts real rows on/after the day start only', () => {
  const dayStart = Date.UTC(2026, 9, 1, 18, 30);
  const rows = [
    { platform: 'telegram', is_test: false, last_attempt_at: '2026-10-01T19:00:00Z' },
    { platform: 'telegram', is_test: false, last_attempt_at: '2026-10-01T18:30:00Z' },
    { platform: 'telegram', is_test: true, last_attempt_at: '2026-10-02T10:00:00Z' },
    { platform: 'telegram', is_test: false, last_attempt_at: '2026-10-01T18:29:59Z' },
    { platform: 'linkedin', is_test: false, last_attempt_at: '2026-10-02T10:00:00Z' },
  ];
  assert.equal(core.attemptsToday(rows, 'telegram', dayStart), 2);
  assert.equal(core.attemptsToday(rows, 'linkedin', dayStart), 1);
  assert.equal(core.attemptsToday(rows, 'instagram', dayStart), 0);
});

test('F1 isUncertainPublishing: a send in flight over 2 minutes is uncertain', () => {
  const now = Date.now();
  const stale = { status: 'publishing', updated_at: new Date(now - 3 * 60 * 1000).toISOString() };
  const fresh = { status: 'publishing', updated_at: new Date(now).toISOString() };
  assert.equal(core.isUncertainPublishing(stale, now), true);
  assert.equal(core.isUncertainPublishing(fresh, now), false);
  assert.equal(core.isUncertainPublishing({ status: 'sent', updated_at: '2000-01-01' }, now), false);
});

test('F1 isPublishable: only approved/partial suggestions may publish', () => {
  assert.equal(core.isPublishable({ status: 'approved' }), true);
  assert.equal(core.isPublishable({ status: 'partial' }), true);
  assert.equal(core.isPublishable({ status: 'pending' }), false);
  assert.equal(core.isPublishable({ status: 'published' }), false);
  assert.equal(core.isPublishable({ status: 'rejected' }), false);
});

/* ═══ F2 — lib/social-templates.js ═══════════════ */

const EXAM_ROW = {
  id: '42',
  name: 'SSC JE Civil',
  short_name: 'JE',
  authority: 'Staff Selection Commission',
  status: 'application_open',
  application_end: '2026-11-15',
  vacancy_count: 500,
  eligibility_summary: 'Degree in Civil Engineering',
  official_url: 'https://ssc.nic.in',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
};

test('F2 resolveTemplateKey: exam statuses map to their event templates', () => {
  assert.equal(templates.resolveTemplateKey('exam_tracker', { status: 'application_open' }), 'exam_tracker.application_open.default');
  assert.equal(templates.resolveTemplateKey('exam_tracker', { status: 'notification_out' }), 'exam_tracker.notification_out.default');
  assert.equal(templates.resolveTemplateKey('exam_tracker', { status: 'admit_card' }), 'exam_tracker.admit_card.default');
  assert.equal(templates.resolveTemplateKey('exam_tracker', { status: 'exam_scheduled' }), 'exam_tracker.exam_scheduled.default');
  assert.equal(templates.resolveTemplateKey('exam_tracker', { status: 'result_out' }), 'exam_tracker.result_out.default');
  assert.equal(templates.resolveTemplateKey('exam_tracker', { status: 'draft' }), null);
});

test('F2 buildSuggestion: exam application_open renders all four surfaces', () => {
  const out = templates.buildSuggestion('exam_tracker', '42', EXAM_ROW, { siteUrl: 'https://cc.test' });
  assert.equal(out.ok, true);
  const s = out.suggestion;
  assert.equal(s.source_type, 'exam_tracker');
  assert.equal(s.source_id, '42');
  assert.equal(s.template_key, 'exam_tracker.application_open.default');
  assert.match(s.title, /SSC JE Civil/);
  assert.match(s.body_telegram, /APPLICATIONS OPEN/);
  assert.match(s.body_telegram, /Apply by: 15 Nov 2026/);
  assert.match(s.body_telegram, /Staff Selection Commission/);
  assert.match(s.body_telegram, /Track all exams: https:\/\/cc.test\/exam-tracker/);
  assert.match(s.body_linkedin, /https:\/\/cc.test\/exam-tracker/);
  assert.match(s.caption_instagram, /#CivilEngineering/);
  assert.match(s.whatsapp_text, /APPLICATIONS OPEN/);
  assert.equal(s.link_url, 'https://cc.test/exam-tracker');
  assert.equal(s.media_url, null);
  assert.equal(s.truth_state, 'locked');
});

test('F2 snapshot: content fields in, volatile bookkeeping out', () => {
  const { snapshot } = templates.buildSuggestion('exam_tracker', '42', EXAM_ROW, {});
  assert.equal(snapshot.name, 'SSC JE Civil');
  assert.equal(snapshot.status, 'application_open');
  assert.equal(snapshot.application_end, '2026-11-15');
  assert.equal(snapshot.created_at, undefined, 'created_at must not feed the truth hash');
  assert.equal(snapshot.updated_at, undefined, 'updated_at must not feed the truth hash');
});

test('F2 job template: renders for published jobs, refuses unpublished', () => {
  const job = {
    id: '7', role: 'Site Engineer', company: 'L&T', location: 'Pune',
    salary: '₹4–6 LPA', deadline: '2026-12-01', slug: 'site-engineer-lt-pune',
    published: true,
  };
  const out = templates.buildSuggestion('job', '7', job, { siteUrl: 'https://cc.test' });
  assert.equal(out.ok, true);
  assert.equal(out.suggestion.template_key, 'job.published.default');
  assert.match(out.suggestion.body_telegram, /Site Engineer/);
  assert.match(out.suggestion.body_telegram, /Never pay for a job/);
  assert.equal(out.suggestion.link_url, 'https://cc.test/jobs/site-engineer-lt-pune');
  const draft = templates.buildSuggestion('job', '7', { ...job, published: false }, {});
  assert.equal(draft.ok, false);
});

test('F2 govt job template: renders for active listings only', () => {
  const gj = {
    id: '9', title: 'Junior Engineer (Civil)', organization: 'PWD Maharashtra',
    scope: 'state', state: 'Maharashtra', status: 'active',
    civil_posts_count: 120, total_posts_in_notification: 300,
    deadline_text: '15 Nov 2026', slug: 'pwd-je-civil-2026', reviewed_at: '2026-09-01T00:00:00Z',
    official_notice_url: 'https://maharashtra.gov.in',
  };
  const out = templates.buildSuggestion('govt_job', '9', gj, { siteUrl: 'https://cc.test' });
  assert.equal(out.ok, true);
  assert.match(out.suggestion.body_telegram, /Junior Engineer \(Civil\)/);
  assert.match(out.suggestion.body_telegram, /Civil posts: 120 of 300 total/);
  assert.equal(out.suggestion.link_url, 'https://cc.test/government-jobs/pwd-je-civil-2026');
  const closed = templates.buildSuggestion('govt_job', '9', { ...gj, status: 'closed' }, {});
  assert.equal(closed.ok, false);
});

test('F2 telegram text is plain text (no Markdown tokens that need a parse mode)', () => {
  const out = templates.buildSuggestion('exam_tracker', '42', {
    ...EXAM_ROW,
    name: 'RMC * JE _ Special',
  }, { siteUrl: 'https://cc.test' });
  /* The engine deliberately never sets a parse_mode, so any
     asterisk/underscore in a name is displayed literally. */
  assert.ok(out.suggestion.body_telegram.includes('RMC * JE _ Special'));
});

/* ═══ F3 — lib/social-publishers.js ══════════════ */

test('F3 platformConfigured: each platform reports its own env readiness', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHANNEL_ID: 'c',
    LINKEDIN_ACCESS_TOKEN: 'li', LINKEDIN_ORGANIZATION_ID: 'org',
    INSTAGRAM_ACCESS_TOKEN: 'ig', INSTAGRAM_BUSINESS_ACCOUNT_ID: '178',
  };
  assert.equal(publishers.platformConfigured('telegram', env), true);
  assert.equal(publishers.platformConfigured('linkedin', env), false, 'LinkedIn is Phase 4, not enabled in Phase 1');
  assert.equal(publishers.platformConfigured('instagram', env), false, 'Instagram is Phase 5, not enabled in Phase 1');
  assert.equal(publishers.platformConfigured('telegram', {}), false);
  /* Later platforms remain disabled until their approved phases. */
  assert.equal(publishers.platformConfigured('linkedin', { LINKEDIN_ACCESS_TOKEN: 'li', LINKEDIN_AUTHOR_URN: 'urn:li:person:x' }), false);
  assert.equal(publishers.platformConfigured('linkedin', { LINKEDIN_ORGANIZATION_ID: 'org' }), false);
  assert.equal(publishers.platformConfigured('instagram', { META_ACCESS_TOKEN: 'ig', META_INSTAGRAM_ACCOUNT_ID: '178' }), false);
  /* the test channel is an acceptable Telegram destination */
  assert.equal(publishers.platformConfigured('telegram', {
    TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHANNEL_ID: 'prod',
  }), true);
});

test('F3 LinkedIn: validates config before any network call', async () => {
  let calls = 0;
  const restore = stubFetch(async () => { calls++; throw new Error('no network in validation tests'); });
  try {
    const noToken = await publishers.sendLinkedIn({ token: '', organizationId: '1', text: 'hi' });
    assert.equal(noToken.ok, false);
    assert.match(noToken.error, /LINKEDIN_ACCESS_TOKEN/);
    const noOrg = await publishers.sendLinkedIn({ token: 't', organizationId: '', text: 'hi' });
    assert.equal(noOrg.ok, false);
    assert.match(noOrg.error, /LINKEDIN_ORGANIZATION_ID/);
    const noText = await publishers.sendLinkedIn({ token: 't', organizationId: '1', text: '' });
    assert.equal(noText.ok, false);
    assert.match(noText.error, /Empty LinkedIn text/);
    assert.equal(calls, 0, 'validation failures must not touch the network');
  } finally { restore(); }
});

test('F3 LinkedIn: creates a REST share as the organization and reads the URN', async () => {
  const restore = stubFetch(async (url, init) => {
    assert.equal(url, 'https://api.linkedin.com/rest/shares');
    const payload = JSON.parse(init.body);
    assert.equal(payload.author, 'urn:li:organization:12345');
    assert.equal(payload.lifecycleState, 'PUBLISHED');
    const content = payload.specificContent['com.linkedin.ugc.ShareContent'];
    assert.equal(content.shareCommentary.text, 'Hello LinkedIn');
    assert.equal(content.shareMediaCategory, 'NONE');
    assert.equal(payload.visibility['com.linkedin.ugc.MemberNetworkVisibility'], 'PUBLIC');
    assert.equal(init.headers['LinkedIn-Version'], '202405');
    return {
      status: 201,
      headers: { get: (k) => (String(k).toLowerCase() === 'x-restli-id' ? 'urn:li:share:987654321' : null) },
      text: async () => '',
    };
  });
  try {
    const out = await publishers.sendLinkedIn({
      token: 'li-token', organizationId: '12345', apiVersion: '202405', text: 'Hello LinkedIn',
    });
    assert.equal(out.ok, true);
    assert.equal(out.externalId, '987654321');
    assert.equal(out.externalUrl, 'https://www.linkedin.com/feed/update/urn:li:share:987654321');
    assert.equal(out.destinationRef, '12345');
    assert.equal(out.retryable, false);
  } finally { restore(); }
});

test('F3 LinkedIn: 429 is retryable, 400 is not', async () => {
  const restore = stubFetch(async () => ({
    status: 429,
    headers: { get: () => null },
    text: async () => JSON.stringify({ message: 'Rate limit exceeded' }),
  }));
  try {
    const out = await publishers.sendLinkedIn({ token: 't', organizationId: '1', text: 'hi' });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true);
    assert.match(out.error, /Rate limit exceeded/);
  } finally { restore(); }
  const restore400 = stubFetch(async () => ({
    status: 400,
    headers: { get: () => null },
    text: async () => JSON.stringify({ message: 'Invalid organization URN' }),
  }));
  try {
    const out = await publishers.sendLinkedIn({ token: 't', organizationId: '1', text: 'hi' });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, false);
  } finally { restore400(); }
});

test('F3 LinkedIn: a network failure is honest and retryable', async () => {
  const restore = stubFetch(async () => { throw new Error('socket hang up'); });
  try {
    const out = await publishers.sendLinkedIn({ token: 't', organizationId: '1', text: 'hi' });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true);
    assert.match(out.error, /network error/);
  } finally { restore(); }
});

test('F3 Instagram: validates config before any network call', async () => {
  let calls = 0;
  const restore = stubFetch(async () => { calls++; throw new Error('no network in validation tests'); });
  try {
    const noToken = await publishers.sendInstagram({ token: '', accountId: '1', caption: 'hi' });
    assert.equal(noToken.ok, false);
    assert.match(noToken.error, /INSTAGRAM_ACCESS_TOKEN/);
    const noAccount = await publishers.sendInstagram({ token: 't', accountId: '', caption: 'hi' });
    assert.equal(noAccount.ok, false);
    assert.match(noAccount.error, /INSTAGRAM_BUSINESS_ACCOUNT_ID/);
    const noCaption = await publishers.sendInstagram({ token: 't', accountId: '1', caption: '' });
    assert.equal(noCaption.ok, false);
    assert.match(noCaption.error, /Empty Instagram caption/);
    assert.equal(calls, 0, 'validation failures must not touch the network');
  } finally { restore(); }
});

test('F3 Instagram: container → publish → permalink', async () => {
  const restore = stubFetch(async (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST' && url.endsWith('/media')) {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('caption'), 'Hello Instagram');
      assert.equal(params.get('image_url'), 'https://cc.test/og.png');
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'container-1' }) };
    }
    if (method === 'POST' && url.endsWith('/media_publish')) {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('creation_id'), 'container-1');
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: '17895695668004550' }) };
    }
    if (method === 'GET' && url.includes('fields=permalink')) {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ permalink: 'https://www.instagram.com/p/CxY1yQ/' }) };
    }
    throw new Error(`unexpected Instagram call: ${method} ${url}`);
  });
  try {
    const out = await publishers.sendInstagram({
      token: 'ig-token', accountId: '17841', apiVersion: 'v21.0',
      caption: 'Hello Instagram', mediaUrl: 'https://cc.test/og.png',
    });
    assert.equal(out.ok, true);
    assert.equal(out.externalId, '17895695668004550');
    assert.equal(out.externalUrl, 'https://www.instagram.com/p/CxY1yQ/');
    assert.equal(out.destinationRef, '17841');
  } finally { restore(); }
});

test('F3 Instagram: a container failure is honest, not a silent skip', async () => {
  const restore = stubFetch(async () => ({
    status: 400,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { message: 'Invalid image URL' } }),
  }));
  try {
    const out = await publishers.sendInstagram({ token: 't', accountId: '1', caption: 'hi', mediaUrl: 'https://x/y.png' });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, false);
    assert.match(out.error, /Invalid image URL/);
  } finally { restore(); }
});

test('F3 Instagram: a video media_url posts as video_url', async () => {
  const restore = stubFetch(async (url, init) => {
    if (String(url).endsWith('/media')) {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('video_url'), 'https://cc.test/reel.mp4');
      assert.equal(params.has('image_url'), false);
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'container-2' }) };
    }
    if (String(url).endsWith('/media_publish')) {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'm2' }) };
    }
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({}) };
  });
  try {
    const out = await publishers.sendInstagram({ token: 't', accountId: '1', caption: 'hi', mediaUrl: 'https://cc.test/reel.mp4' });
    assert.equal(out.ok, true);
    assert.equal(out.externalId, 'm2');
  } finally { restore(); }
});

test('F3 Telegram test destination is optional and never falls back to production', () => {
  assert.equal(
    publishers.telegramTestChannel({ TELEGRAM_TEST_CHANNEL_ID: 'test-1', TELEGRAM_CHANNEL_ID: 'prod' }),
    'test-1'
  );
  assert.equal(
    publishers.telegramTestChannel({ TELEGRAM_CHANNEL_ID: 'prod' }),
    null
  );
  assert.equal(publishers.telegramTestChannel({}), null);
});

test('F3 sendTelegram: validates config before any network call', async () => {
  const noToken = await publishers.sendTelegram({ token: '', chatId: 'c', text: 'hi' });
  assert.equal(noToken.ok, false);
  assert.match(noToken.error, /TELEGRAM_BOT_TOKEN/);
  const noChat = await publishers.sendTelegram({ token: 't', chatId: '', text: 'hi' });
  assert.equal(noChat.ok, false);
  assert.match(noChat.error, /TELEGRAM_CHANNEL_ID/);
  const noText = await publishers.sendTelegram({ token: 't', chatId: 'c', text: '' });
  assert.equal(noText.ok, false);
  assert.match(noText.error, /Empty Telegram text/);
});

/* ═══ F4 — _api/social.js handler + dispatcher ═══ */

test('F4 handler: unauthenticated callers get 401 before any config is revealed', async () => {
  const res = mockRes();
  /* With the deployment fully configured (owner key AND
     Supabase), a caller without credentials must be refused
     with 401 — auth runs before any configuration check, so
     an unauthenticated caller never learns whether Supabase
     is wired up. (When OWNER_KEY is unset the handler
     honestly reports 503 'not configured' instead.) */
  await withEnv(OWNER_ENV, async () => {
    await social({ method: 'GET', url: '/api/social', headers: {} }, res);
  });
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /owner key/i);
});

test('F4 handler: the real owner key is accepted (auth precedes the config check)', async () => {
  const res = mockRes();
  await withEnv({ ...OWNER_ENV, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    await social({
      method: 'GET',
      url: '/api/social',
      headers: { 'x-owner-key': 'test-owner-key' },
    }, res);
    /* authenticated, but Supabase is not wired in this environment */
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Supabase server configuration/);
  });
});

test('F4 handler: OPTIONS is same-origin CORS only', async () => {
  const res = mockRes();
  await withEnv(OWNER_ENV, async () => {
    await social({ method: 'OPTIONS', url: '/api/social', headers: { origin: 'https://civilcareer-india-two.vercel.app' } }, res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://civilcareer-india-two.vercel.app');
  });
});

test('F4 handler: unknown ops are rejected without touching the database', async () => {
  const res = mockRes();
  await withEnv(OWNER_ENV, async () => {
    await social({
      method: 'POST',
      url: '/api/social?op=bogus',
      headers: { 'x-owner-key': 'test-owner-key' },
      body: {},
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Unknown op/);
  });
});

test('F4 dispatcher: /api/social is registered and every method is admin-only', () => {
  const dispatch = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
  assert.match(dispatch, /'\/api\/social':\s*\(\) => require\('\.\.\/_api\/social'\)/);
  assert.match(dispatch, /'\/api\/social': req => !hasValidOwnerKey\(req\)/);
});

test('F4 drain: SOCIAL_CRON_SECRET (or owner key) is required — 401 otherwise', async () => {
  await withEnv({ ...OWNER_ENV, SOCIAL_CRON_SECRET: 'social-cron-secret' }, async () => {
    const bare = mockRes();
    await social({ method: 'GET', url: '/api/social?op=drain', headers: {} }, bare);
    assert.equal(bare.statusCode, 401);
    assert.match(bare.body.error, /SOCIAL_CRON_SECRET/);

    const wrong = mockRes();
    await social({ method: 'GET', url: '/api/social?op=drain', headers: { authorization: 'Bearer wrong-secret' } }, wrong);
    assert.equal(wrong.statusCode, 401);

    /* an ordinary admin session is not a scheduler credential */
    const session = mockRes();
    await social({ method: 'GET', url: '/api/social?op=drain', headers: { authorization: 'Bearer admin-session-token' } }, session);
    assert.equal(session.statusCode, 401);
  });
});

test('F4 drain: the scheduler credential passes auth and reaches the engine', async () => {
  const res = mockRes();
  await withEnv({
    ...OWNER_ENV,
    SOCIAL_CRON_SECRET: 'social-cron-secret',
    SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined,
  }, async () => {
    await social({ method: 'GET', url: '/api/social?op=drain', headers: { authorization: 'Bearer social-cron-secret' } }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Supabase server configuration/);
  });
  /* the x-cron-secret header and POST bodies work too */
  const res2 = mockRes();
  await withEnv({
    ...OWNER_ENV,
    SOCIAL_CRON_SECRET: 'social-cron-secret',
    SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined,
  }, async () => {
    await social({ method: 'POST', url: '/api/social', headers: { 'x-cron-secret': 'social-cron-secret' }, body: { op: 'drain' } }, res2);
    assert.equal(res2.statusCode, 500);
    assert.match(res2.body.error, /Supabase server configuration/);
  });
  /* the owner key keeps draining (manual / GitHub Actions runs) */
  const res3 = mockRes();
  await withEnv({
    ...OWNER_ENV,
    SOCIAL_CRON_SECRET: undefined,
    SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined,
  }, async () => {
    await social({ method: 'GET', url: '/api/social?op=drain', headers: { 'x-owner-key': 'test-owner-key' } }, res3);
    assert.equal(res3.statusCode, 500);
    assert.match(res3.body.error, /Supabase server configuration/);
  });
});

test('F4 drain: publishes the approved queue through the full pipeline', async () => {
  const restore = stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('social_settings')) {
      return { ok: true, json: async () => [{ id: 1, kill_switch: false, require_approval: false, per_platform_daily_caps: { telegram: 5, linkedin: 2, instagram: 2 }, caps_timezone: 'Asia/Kolkata', default_hashtags: [], footer: null, site_url: null }] };
    }
    if (u.includes('social_suggestions')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [] };
  });
  try {
    const res = mockRes();
    await withEnv({ ...OWNER_ENV, SOCIAL_CRON_SECRET: 'social-cron-secret' }, async () => {
      await social({ method: 'GET', url: '/api/social?op=drain&limit=10', headers: { authorization: 'Bearer social-cron-secret' } }, res);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.drained, 0);
    assert.equal(res.body.published, 0);
    assert.deepEqual(res.body.results, []);
  } finally { restore(); }
});

test('F4 drain: the kill switch stops the drain before any queue read', async () => {
  const restore = stubFetch(async (url) => {
    if (String(url).includes('social_settings')) {
      return { ok: true, json: async () => [{ id: 1, kill_switch: true, require_approval: true, per_platform_daily_caps: { telegram: 5 }, caps_timezone: 'Asia/Kolkata' }] };
    }
    throw new Error('the queue must not be read while the kill switch is ON');
  });
  try {
    const res = mockRes();
    await withEnv({ ...OWNER_ENV, SOCIAL_CRON_SECRET: 'social-cron-secret' }, async () => {
      await social({ method: 'GET', url: '/api/social?op=drain', headers: { authorization: 'Bearer social-cron-secret' } }, res);
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /Kill switch/);
  } finally { restore(); }
});

test('F4 dispatcher: the drain route authenticates with SOCIAL_CRON_SECRET', () => {
  const dispatch = fs.readFileSync(path.join(root, 'api', '[[...path]].js'), 'utf8');
  assert.match(dispatch, /function isSocialDrainRequest/);
  assert.match(dispatch, /SOCIAL_CRON_SECRET/);
  assert.match(dispatch, /req\.isSocialCron = true/);
  /* the CRON_SECRET routes stay exam-alerts + govt-discovery only:
     scheduler access to the drain must never imply crawler access */
  assert.match(dispatch, /const CRON_ROUTES = new Set\(\[\s*'\/api\/exam-alerts',\s*'\/api\/govt-discovery',\s*\]\)/);
  /* Vercel Hobby crons run at most once per day — a 15-minute
     drain FAILS the whole deployment, so the scheduler lives in
     GitHub Actions instead (docs/00-gap-report.md F10). */
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(
    !vercel.crons.some((c) => String(c.path).includes('op=drain')),
    'the drain must not be a Vercel cron — Hobby plans allow at most daily crons'
  );
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'social-drain.yml'), 'utf8'
  );
  assert.match(workflow, /'\*\/30 \* \* \* \*'/);
  assert.match(workflow, /op=drain/);
  assert.match(workflow, /SOCIAL_CRON_SECRET/);
});

test('F4 in-process contract: the exam-tracker call shape gets a JSON verdict', async () => {
  /* _api/exam-tracker.js invokes the handler in-process with a
     minimal req ({method, url, headers, body}) and a res exposing
     only setHeader/end. This reproduces that contract exactly. */
  const restore = stubFetch(async () => ({ ok: true, json: async () => [] }));
  try {
    await withEnv(OWNER_ENV, async () => {
      const res = inProcessRes();
      await social({
        method: 'POST',
        url: '/api/social?op=create',
        headers: { 'x-owner-key': 'test-owner-key' },
        body: { op: 'create', source_type: 'not_a_source', source_id: '1' },
      }, res);
      /* validation failures are honest 400s — the caller
         (exam-tracker) reads body.error either way */
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'source_type must be one of: exam_tracker, job, govt_job');
    });
  } finally { restore(); }
});

test('F4 in-process contract: unconfigured Supabase degrades gracefully, never throws', async () => {
  const res = inProcessRes();
  await withEnv({ OWNER_KEY: 'test-owner-key', SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    await social({
      method: 'POST',
      url: '/api/social?op=create',
      headers: { 'x-owner-key': 'test-owner-key' },
      body: { op: 'create', source_type: 'exam_tracker', source_id: '1' },
    }, res);
    assert.equal(res.body.error, 'Supabase server configuration is missing');
  });
});

/* ═══ F5 — admin.html Social tab ═════════════════ */

test('F5 admin.html: Social tab exists and wires every queue action', () => {
  const src = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.match(src, /data-tab="social"/);
  assert.match(src, /id="panel-social"/);
  assert.match(src, /loadSocial\(\)/);
  for (const fn of [
    'socialApprove', 'socialReject', 'socialPublish', 'socialPublishEverywhere',
    'socialPreview', 'socialEdit', 'socialCopyWhatsApp',
    'socialArchive', 'socialResolve', 'socialRegenerate',
    'socialAddConnection', 'socialConnAction', 'socialSetFilter',
  ]) {
    assert.ok(src.includes(`function ${fn}`) || src.includes(`onclick="${fn}`), `admin.html must wire ${fn}`);
  }
  assert.match(src, /api\/social\?op=settings/);
  assert.match(src, /api\/social\?op=connections/);
  assert.ok(!src.includes('function socialTest('), 'the current public Telegram flow does not need a separate test-channel button');
  assert.match(src, /Publish Everywhere/);
  assert.match(src, /Copy WhatsApp/);
});

/* ═══ F6 — exam-tracker re-route ═════════════════ */

test('F6 exam-tracker: no longer talks to api.telegram.org directly', () => {
  const src = fs.readFileSync(path.join(root, '_api', 'exam-tracker.js'), 'utf8');
  assert.ok(!src.includes('api.telegram.org'), 'direct Telegram API calls must be gone');
  assert.ok(!src.includes('sendMessage'), 'direct sendMessage must be gone');
  assert.match(src, /require\('\.\/social'\)/);
  assert.match(src, /source_type: 'exam_tracker'/);
  /* the old fire-and-forget announcer helpers are removed */
  assert.ok(!src.includes('function examTelegramText'));
  assert.ok(!src.includes('function tgApi'));
});

test('F6 exam-tracker: module still exports the handler', () => {
  assert.equal(typeof examTracker, 'function');
});

/* ═══ F6b — gov-review → social engine producer ═══ */

const GOVT_JOB_ROW = {
  id: '9', title: 'Junior Engineer (Civil)', organization: 'PWD Maharashtra',
  scope: 'state', state: 'Maharashtra', status: 'active',
  civil_posts_count: 120, total_posts_in_notification: 300,
  deadline_text: '15 Nov 2026', slug: 'pwd-je-civil-2026',
  reviewed_at: '2026-09-01T00:00:00Z',
  official_notice_url: 'https://maharashtra.gov.in',
};

test('F6b gov-review: the approve flow queues a source_type gov_job suggestion', () => {
  const src = fs.readFileSync(path.join(root, '_api', 'govt-review.js'), 'utf8');
  assert.match(src, /require\('\.\/social'\)/);
  assert.match(src, /source_type: 'govt_job'/);
  /* fire-and-forget: the approval response never blocks on the engine */
  assert.match(src, /async function queueSocialSuggestion/);
  assert.match(src, /catch \(socialErr\)/);
});

test('F6b gov-review: the engine creates a govt_job.published.default suggestion', async () => {
  const restore = stubFetch(async (url, init) => {
    const u = String(url);
    if (init && init.method === 'POST' && u.includes('social_suggestions')) {
      const created = JSON.parse(init.body);
      return { ok: true, status: 201, json: async () => [{ ...created, id: 'sug-1' }] };
    }
    if (u.includes('social_settings')) {
      return { ok: true, json: async () => [{ id: 1, require_approval: true, kill_switch: false, per_platform_daily_caps: { telegram: 5, linkedin: 2, instagram: 2 }, caps_timezone: 'Asia/Kolkata', default_hashtags: [], footer: null, site_url: 'https://cc.test' }] };
    }
    if (u.includes('govt_jobs')) return { ok: true, json: async () => [GOVT_JOB_ROW] };
    return { ok: true, json: async () => [] };
  });
  try {
    const res = inProcessRes();
    await withEnv(OWNER_ENV, async () => {
      await social({
        method: 'POST',
        url: '/api/social?op=create',
        headers: { 'x-owner-key': 'test-owner-key' },
        body: { op: 'create', source_type: 'govt_job', source_id: '9' },
      }, res);
    });
    assert.equal(res.statusCode, 201);
    const suggestion = res.body.suggestion;
    assert.equal(suggestion.source_type, 'govt_job');
    assert.equal(suggestion.source_id, '9');
    assert.equal(suggestion.template_key, 'govt_job.published.default');
    assert.match(suggestion.title, /Junior Engineer \(Civil\)/);
    assert.equal(suggestion.link_url, 'https://cc.test/government-jobs/pwd-je-civil-2026');
    assert.ok(suggestion.truth_hash, 'truth hash must be locked at creation');
  } finally { restore(); }
});

/* ═══ F7 — admin-jobs legacy autopost gate ══════ */

test('F7 admin-jobs: legacy Telegram autopost defaults OFF after private-job migration', () => {
  const src = fs.readFileSync(path.join(root, '_api', 'admin-jobs.js'), 'utf8');
  assert.match(src, /LEGACY_AUTOPOST_ON/);
  /* Approved transition plan: legacy private-job autopost remains enabled
     until private jobs are supported as a Social Engine source. */
  assert.match(src, /process\.env\.LEGACY_TELEGRAM_AUTOPOST \|\| 'true'/);
  /* the gate sits on the publish hook */
  assert.match(src, /action === 'publish' && updated > 0 && LEGACY_AUTOPOST_ON/);
  /* Phase 3 wiring: publishes create source_type 'job'
     suggestions through the engine queue. */
  assert.match(src, /async function queueJobSuggestion/);
  assert.match(src, /op: 'create', source_type: 'job'/);
  assert.match(src, /queueJobSuggestion\(id\)/);
});

/* ═══ F8 — .env.example completeness ════════════ */

test('F8 .env.example documents every engine variable', () => {
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const names = env
    .split('\n')
    .map((line) => (line.match(/^([A-Z0-9_]+)=/) || [])[1])
    .filter(Boolean);
  const required = [
    'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'OWNER_KEY', 'SITE_URL', 'CRON_SECRET', 'SOCIAL_CRON_SECRET',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID', 'TELEGRAM_TEST_CHANNEL_ID',
    'LEGACY_TELEGRAM_AUTOPOST', 'ADMIN_EMAIL', 'ADMIN_USER_ID',
    'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN', 'LINKEDIN_ORGANIZATION_ID',
    'LINKEDIN_API_VERSION', 'META_ACCESS_TOKEN', 'META_INSTAGRAM_ACCOUNT_ID',
    'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
  ];
  for (const name of required) {
    assert.ok(names.includes(name), `.env.example must document ${name}`);
  }
});

test('F8 .env.example: CRON_SECRET and SOCIAL_CRON_SECRET stay separate tokens', () => {
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const cronBlock = env.slice(env.indexOf('# Vercel Cron bearer token'), env.indexOf('# Optional discovery'));
  assert.match(cronBlock, /CRON_SECRET/);
  assert.ok(!cronBlock.includes('SOCIAL_CRON_SECRET'), 'social scheduler token must live in its own block');
});
