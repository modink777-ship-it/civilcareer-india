const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const radar = require('../lib/social-radar');
const radarEvents = require('../lib/radar-events');
const content = require('../lib/social-radar-content');
const cron = require('../_api/social-cron');

const root = path.join(__dirname, '..');

function withFixedNow(iso, fn) {
  const at = Date.parse(iso);
  return fn(at);
}

test('P3 radar emits seven-day reminder only for a fixed deadline', () => {
  withFixedNow('2026-10-02T05:00:00Z', now => {
    const row = {
      id: 'j1',
      role: 'Site Engineer',
      company: 'Example Infra',
      published: true,
      status: 'Active',
      deadline: '2026-10-09',
    };
    assert.deepEqual(radar.radarEvents('job', row, now, 'Asia/Kolkata'), ['7_days']);
  });
});

test('P3 radar emits three-day and closing-today events at the correct windows', () => {
  withFixedNow('2026-10-06T05:00:00Z', now => {
    const row = { published: true, status: 'Active', deadline: '2026-10-09' };
    assert.deepEqual(radar.radarEvents('job', row, now, 'Asia/Kolkata'), ['3_days']);
  });
  withFixedNow('2026-10-09T09:00:00Z', now => {
    const row = { published: true, status: 'Active', deadline: '2026-10-09' };
    assert.deepEqual(radar.radarEvents('job', row, now, 'Asia/Kolkata'), ['24_hours', 'closing_today']);
  });
});

test('P3 radar skips closed, deleted and non-fixed deadlines', () => {
  const base = { deadline: '2026-10-09' };
  assert.deepEqual(radar.radarEvents('job', { ...base, published: false, status: 'Active' }, Date.parse('2026-10-02T05:00:00Z')), []);
  assert.deepEqual(radar.radarEvents('job', { ...base, published: true, status: 'Closed' }, Date.parse('2026-10-02T05:00:00Z')), []);
  assert.deepEqual(radar.radarEvents('govt_job', {
    status: 'active', deadline_kind: 'update_soon', deadline_text: 'Update Soon',
  }, Date.parse('2026-10-02T05:00:00Z')), []);
});

test('P3 application_open and newly_announced are derived from explicit source dates', () => {
  withFixedNow('2026-10-02T05:00:00Z', now => {
    const row = {
      published: true,
      status: 'Active',
      published_at: '2026-10-02T04:00:00Z',
      application_start: '2026-10-02',
      deadline: '2026-10-09',
    };
    const events = radar.radarEvents('job', row, now, 'Asia/Kolkata');
    assert.ok(events.includes('newly_announced'));
    assert.ok(events.includes('application_open'));
  });
});

test('P3 govt relative deadlines are never converted into fake calendar dates', () => {
  const row = {
    status: 'active',
    deadline_kind: 'relative_days',
    deadline_text: 'Within 21 Days',
    apply_end: null,
  };
  assert.equal(radar.sourceDeadline('govt_job', row).fixed, false);
});

test('P3 update detection reports protected factual changes', () => {
  const before = {
    role: 'JE Civil',
    deadline: '2026-10-09',
    vacancy_count: 120,
    application_url: 'https://example.gov/apply',
    location: 'Pune',
  };
  const after = {
    ...before,
    deadline: '2026-10-12',
    vacancy_count: 135,
    application_url: 'https://example.gov/new-apply',
  };
  const changes = radar.compareUpdates('job', before, after);
  const fields = changes.map(x => x.field);
  assert.ok(fields.includes('deadline'));
  assert.ok(fields.includes('vacancy_count'));
  assert.ok(fields.includes('application_url'));
  assert.equal(radar.updateTemplateKey('job', changes).startsWith('job.update.'), true);
});

test('P3 previous_apply_end surfaces government deadline extension changes', () => {
  const before = { apply_end: '2026-10-09', previous_apply_end: '2026-10-09' };
  const after = { apply_end: '2026-10-12', previous_apply_end: '2026-10-09' };
  const changes = radar.compareUpdates('govt_job', before, after);
  assert.ok(changes.some(x => x.field === 'apply_end'));
});

test('P3 content renderers create all four deterministic surfaces with official verification line', () => {
  const row = {
    id: 'j1',
    slug: 'je-civil-2026',
    role: 'Junior Engineer Civil',
    company: 'Example Infra',
    location: 'Pune',
    vacancy_count: 120,
    deadline: '2026-10-09',
    source_url: 'https://example.gov/notice',
  };
  const out = content.renderRadarContent('job', '7_days', row, 'https://civilcareer-india-two.vercel.app');
  assert.match(out.body_telegram, /7 DAYS LEFT/);
  assert.match(out.body_linkedin, /Vacancies: 120/);
  assert.match(out.caption_instagram, /#CivilEngineering/);
  assert.match(out.whatsapp_text, /Verify on the official notification/);
  assert.match(out.body_telegram, /https:\/\/example.gov\/notice/);
});

test('P3 cron secret comparison is constant-time safe for equal-length secrets', () => {
  assert.equal(cron._internal.sameSecret('abc123', 'abc123'), true);
  assert.equal(cron._internal.sameSecret('abc123', 'abc124'), false);
  assert.equal(cron._internal.sameSecret('abc123', 'abc12'), false);
  assert.equal(cron._internal.sameSecret('', 'abc123'), false);
});

test('P3 scheduler workflow uses a 30-minute staggered schedule and secret', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/social-cron.yml'), 'utf8');
  assert.match(workflow, /cron: '17,47 * * * *'/);
  assert.match(workflow, /SOCIAL_CRON_SECRET/);
  assert.match(workflow, /\/api\/social-cron\?op=run/);
});

test('P3 dispatcher-safe rewrite exposes social-cron URL without a second function tree', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const r = vercel.rewrites.find(x => x.source === '/api/social-cron');
  assert.ok(r, 'social-cron rewrite must exist');
  assert.equal(r.destination, '/api/social-graphics?delegate=social-cron');
});

test('P3 legacy private-job direct Telegram default is off', () => {
  const src = fs.readFileSync(path.join(root, '_api/admin-jobs.js'), 'utf8');
  assert.match(src, /process\.env\.LEGACY_TELEGRAM_AUTOPOST \|\| 'false'/);
  assert.match(src, /queueJobSuggestion\(id\)/);
});
