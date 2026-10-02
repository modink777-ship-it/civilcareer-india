const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../lib/social-radar-service');

function stubFetch(payload, status = 200) {
  const old = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { calls: () => calls, restore: () => { global.fetch = old; } };
}

test('P7 Daily Radar preview is read-only and renders due events', async () => {
  const row = {
    id: 'j-preview',
    slug: 'site-engineer-preview',
    role: 'Site Engineer',
    company: 'Example Infra',
    location: 'Bengaluru',
    published: true,
    status: 'Active',
    deadline: '2026-10-09',
    source_url: 'https://example.gov/notice',
    vacancy_count: 20,
  };
  const fetcher = stubFetch([row]);
  try {
    const out = await service.previewRadar({
      sourceType: 'job',
      limit: 10,
      now: Date.parse('2026-10-02T05:00:00Z'),
      settings: {
        caps_timezone: 'Asia/Kolkata',
        site_url: 'https://civilcareer-india-two.vercel.app',
      },
    });
    assert.equal(out.preview_only, true);
    assert.equal(out.writes_performed, 0);
    assert.equal(out.sends_performed, 0);
    assert.equal(out.scanned, 1);
    assert.equal(out.previews.length, 1);
    assert.equal(out.previews[0].event, '7_days');
    assert.match(out.previews[0].body_telegram, /7 DAYS LEFT/);
    assert.equal(fetcher.calls(), 1, 'preview must not perform duplicate/insert queries');
  } finally {
    fetcher.restore();
  }
});

test('P7 preview helper contains no database insert path', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'social-radar-service.js'), 'utf8');
  const start = src.indexOf('async function previewRadar');
  const end = src.indexOf('async function generateRadarSuggestions', start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);
  assert.doesNotMatch(block, /insertSuggestion\(/);
  assert.doesNotMatch(block, /method:\s*['"]POST['"]/);
});

test('P7 admin endpoint and preview panel are wired', () => {
  const fs = require('fs');
  const path = require('path');
  const api = fs.readFileSync(path.join(__dirname, '..', '_api', 'social.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(api, /op === 'radar-preview'/);
  assert.match(api, /radarService\.previewRadar/);
  assert.match(admin, /Daily CivilCareer Radar — Preview only/);
  assert.match(admin, /loadRadarPreview\(\)/);
});
