/**
 * CivilCareer Social Engine — Phase 2 content helpers.
 * Deterministic text only; no network or database access.
 */
function siteLink(sourceType, row, siteUrl) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const slug = row && row.slug ? '/' + encodeURIComponent(String(row.slug)) : '';
  return sourceType === 'govt_job' ? base + '/government-jobs' + slug : base + '/jobs' + slug;
}

function officialUrl(sourceType, row) {
  if (!row) return '';
  if (sourceType === 'govt_job') return row.official_notice_url || row.official_apply_url || row.official_site_url || '';
  return row.source_url || row.apply_url || row.application_url || row.company_url || '';
}

const RADAR_LABELS = {
  newly_announced: 'NEWLY ANNOUNCED',
  application_open: 'APPLICATIONS OPEN',
  '7_days': '7 DAYS LEFT',
  '3_days': '3 DAYS LEFT',
  '24_hours': '24 HOURS LEFT',
  closing_today: 'CLOSING TODAY',
  closed: 'APPLICATION WINDOW CLOSED',
};

function renderRadarContent(sourceType, event, row, siteUrl) {
  const title = sourceType === 'govt_job' ? (row.title || 'Government Job') : (row.role || 'Civil Engineering Opportunity');
  const org = sourceType === 'govt_job' ? (row.organization || 'Government Organization') : (row.company || 'Organization');
  const link = siteLink(sourceType, row, siteUrl);
  const official = officialUrl(sourceType, row);
  const location = row.location || row.state || '';
  const vacancy = sourceType === 'govt_job' ? row.civil_posts_count : row.vacancy_count;
  const deadline = sourceType === 'govt_job'
    ? (row.apply_end || row.deadline_text || '')
    : (row.deadline || row.valid_through || '');
  const label = RADAR_LABELS[event] || 'RECRUITMENT UPDATE';
  const eventLine = {
    newly_announced: 'A new verified listing has been added to CivilCareer.',
    application_open: 'The verified application window is open.',
    '7_days': 'The verified application deadline is seven days away.',
    '3_days': 'The verified application deadline is three days away.',
    '24_hours': 'The verified application deadline is within the next 24 hours.',
    closing_today: 'The verified application deadline is today.',
    closed: 'The verified application deadline has passed.',
  }[event] || 'A verified recruitment update is available.';
  const verify = official
    ? 'Verify on the official notification: ' + official
    : 'Verify on the official notification and application page.';

  const common = [
    '💼 ' + title,
    '🏢 ' + org,
    location ? '📍 ' + location : '',
    vacancy != null ? '👥 Vacancies: ' + Number(vacancy).toLocaleString('en-IN') : '',
    deadline ? '⏰ Apply by: ' + deadline : '',
    eventLine,
  ].filter(Boolean);

  return {
    title: title + ' — ' + label,
    body_telegram: ['🔔 ' + label, ...common, '🔗 CivilCareer: ' + link, verify].join('\n'),
    body_linkedin: [
      label.charAt(0) + label.slice(1).toLowerCase() + ' — ' + title,
      'Organization: ' + org,
      location ? 'Location: ' + location : '',
      vacancy != null ? 'Vacancies: ' + Number(vacancy).toLocaleString('en-IN') : '',
      deadline ? 'Apply by: ' + deadline : '',
      eventLine,
      'CivilCareer details: ' + link,
      verify,
    ].filter(Boolean).join('\n'),
    caption_instagram: [
      label + ': ' + title,
      org,
      location ? '📍 ' + location : '',
      vacancy != null ? '👥 ' + Number(vacancy).toLocaleString('en-IN') + ' vacancies' : '',
      deadline ? '⏰ ' + deadline : '',
      'Details: ' + link,
      verify,
      '#CivilEngineering #CivilJobs #GovernmentJobs #IndiaJobs #JobAlert',
    ].filter(Boolean).join('\n'),
    whatsapp_text: [
      label, title, 'Organization: ' + org,
      location ? 'Location: ' + location : '',
      vacancy != null ? 'Vacancies: ' + Number(vacancy).toLocaleString('en-IN') : '',
      deadline ? 'Apply by: ' + deadline : '',
      'Details: ' + link, verify,
    ].filter(Boolean).join('\n').slice(0, 1000),
    link_url: link,
    media_url: null,
  };
}

const UPDATE_FIELDS = {
  deadline: 'Deadline',
  deadline_text: 'Deadline',
  apply_end: 'Application end',
  application_start: 'Application start',
  vacancy_count: 'Vacancies',
  civil_posts_count: 'Civil vacancies',
  previous_apply_end: 'Previous application end',
  official_apply_url: 'Apply URL',
  official_notice_url: 'Official notice URL',
  official_site_url: 'Official site URL',
  application_url: 'Application URL',
  apply_url: 'Apply URL',
  exam_date: 'Exam date',
  qualification: 'Qualification',
  age_limit: 'Age limit',
  salary: 'Pay',
  location: 'Location',
  company: 'Organization',
  role: 'Role',
  title: 'Title',
  status: 'Status',
};

function renderUpdateContent(sourceType, row, changes, siteUrl) {
  const title = sourceType === 'govt_job' ? (row.title || 'Government Job') : (row.role || 'Civil Engineering Opportunity');
  const org = sourceType === 'govt_job' ? (row.organization || 'Government Organization') : (row.company || 'Organization');
  const link = siteLink(sourceType, row, siteUrl);
  const official = officialUrl(sourceType, row);
  const verify = official ? 'Verify on the official notification: ' + official : 'Verify on the official notification and application page.';
  const lines = (Array.isArray(changes) ? changes : []).slice(0, 12).map((c) =>
    '• ' + (UPDATE_FIELDS[c.field] || String(c.field).replace(/_/g, ' ')) + ': ' +
    (c.after == null || String(c.after).trim() === '' ? 'To be announced' : String(c.after))
  );
  return {
    title: title + ' — Recruitment Update',
    body_telegram: ['🔄 RECRUITMENT UPDATE', '💼 ' + title, '🏢 ' + org, ...lines, '🔗 CivilCareer: ' + link, verify].join('\n'),
    body_linkedin: ['Recruitment update — ' + title, 'Organization: ' + org, ...lines.map(x => x.replace(/^• /, '')), 'CivilCareer details: ' + link, verify].join('\n'),
    caption_instagram: ['🔄 Update: ' + title, org, ...lines, 'Details: ' + link, verify, '#CivilEngineering #CivilJobs #JobAlert'].join('\n'),
    whatsapp_text: ['RECRUITMENT UPDATE', title, 'Organization: ' + org, ...lines, 'Details: ' + link, verify].join('\n').slice(0, 1000),
    link_url: link,
    media_url: null,
  };
}

module.exports = { RADAR_LABELS, renderRadarContent, renderUpdateContent };
