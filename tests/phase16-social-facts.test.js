/* Phase 1 Social Engine facts: pure Truth Lock regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/social-core');

const snapshot = {
  name: 'SSC JE Civil 2026',
  authority: 'Staff Selection Commission',
  status: 'application_open',
  application_end: '2026-10-12',
  vacancy_count: 487,
  civil_posts_count: 487,
  total_posts_in_notification: 1000,
  qualification: 'Diploma/Degree Civil Engineering',
  official_url: 'https://ssc.gov.in',
};

const baseContent = {
  title: 'SSC JE Civil 2026',
  body_telegram: [
    'Applications Open',
    'Civil posts: 487 of 1000 total',
    'Qualification: Diploma/Degree Civil Engineering',
    'Apply by: 12 Oct 2026',
    'Apply: https://civilcareer-india-two.vercel.app/exams',
    'Official: https://ssc.gov.in',
  ].join('\n'),
  body_linkedin: 'SSC JE Civil 2026 — 487 civil posts. Apply by 12 Oct 2026. https://civilcareer-india-two.vercel.app/exams',
  caption_instagram: 'SSC JE Civil 2026 — 487 civil posts — 12 Oct 2026 #CivilEngineering #CivilJobs',
  whatsapp_text: 'SSC JE Civil 2026 — 487 civil posts — Apply by 12 Oct 2026. https://civilcareer-india-two.vercel.app/exams',
  link_url: 'https://civilcareer-india-two.vercel.app/exams',
  media_url: null,
};

test('Truth Lock: exact source numbers/dates and allowlisted URLs pass', () => {
  const result = core.validateFacts(baseContent, snapshot, 'https://civilcareer-india-two.vercel.app');
  assert.equal(result.ok, true, result.errors.join('; '));
});

for (const wrong of ['500', '500+', '1000']) {
  test(`Truth Lock: invented vacancy ${wrong} fails`, () => {
    const content = { ...baseContent, body_telegram: baseContent.body_telegram.replace('487 of 1000', `${wrong} of 1000`) };
    const result = core.validateFacts(content, snapshot, 'https://civilcareer-india-two.vercel.app');
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /unsupported number|civil vacancy number/);
  });
}

test('Truth Lock: total notification vacancies cannot be presented as civil vacancies', () => {
  const content = {
    ...baseContent,
    body_telegram: baseContent.body_telegram.replace('Civil posts: 487', 'Civil posts: 1000'),
  };
  const result = core.validateFacts(content, snapshot, 'https://civilcareer-india-two.vercel.app');
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /civil vacancy number 1000/);
});

test('Truth Lock: wrong deadline fails', () => {
  const content = { ...baseContent, body_telegram: baseContent.body_telegram.replace('12 Oct 2026', '13 Oct 2026') };
  const result = core.validateFacts(content, snapshot, 'https://civilcareer-india-two.vercel.app');
  assert.equal(result.ok, false);
});

test('Truth Lock: disallowed URL fails', () => {
  const content = { ...baseContent, body_telegram: baseContent.body_telegram.replace('https://ssc.gov.in', 'https://evil.example.com') };
  const result = core.validateFacts(content, snapshot, 'https://civilcareer-india-two.vercel.app');
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /URL not present/);
});

test('Truth Lock: approved UTM suffix remains allowed', () => {
  const content = {
    ...baseContent,
    body_telegram: baseContent.body_telegram.replace(
      'https://civilcareer-india-two.vercel.app/exams',
      'https://civilcareer-india-two.vercel.app/exams?utm_source=telegram&utm_medium=social&utm_campaign=CC-JOB-2026-000123',
    ),
  };
  const result = core.validateFacts(content, snapshot, 'https://civilcareer-india-two.vercel.app');
  assert.equal(result.ok, true, result.errors.join('; '));
});
