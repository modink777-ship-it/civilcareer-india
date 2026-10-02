function escapeXml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrap(text, max = 34) {
  const words = String(text || '').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function titleBlock(text, x, y) {
  return wrap(text).map((line, i) =>
    '<text x="' + x + '" y="' + (y + i * 58) + '" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0b1f3a">' +
    escapeXml(line) + '</text>'
  ).join('');
}

function createGraphic(type, data = {}, size = '1080x1080') {
  const portrait = size === '1080x1350';
  const width = 1080;
  const height = portrait ? 1350 : 1080;
  const title = data.title || data.role || data.name || 'CivilCareer Update';
  const subtitle = data.organization || data.authority || data.company || 'CivilCareer';
  const deadline = data.deadline || data.apply_end || data.application_end || '';
  const vacancies = data.civil_posts_count ?? data.vacancy_count;
  const label = {
    government_job: 'GOVERNMENT JOB',
    govt_job: 'GOVERNMENT JOB',
    psu_job: 'PSU JOB',
    exam_alert: 'EXAM ALERT',
    deadline_alert: 'DEADLINE ALERT',
    result_alert: 'RESULT UPDATE',
    new_job: 'NEW CIVIL JOB',
  }[type] || 'CIVILCAREER UPDATE';

  const body = [];
  if (subtitle) body.push('<text x="72" y="420" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#4d5b6d">' + escapeXml(subtitle) + '</text>');
  if (vacancies != null) body.push('<text x="72" y="500" font-family="Arial, sans-serif" font-size="30" fill="#4d5b6d">Vacancies: ' + escapeXml(Number(vacancies).toLocaleString('en-IN')) + '</text>');
  if (deadline) body.push('<text x="72" y="555" font-family="Arial, sans-serif" font-size="30" fill="#4d5b6d">Apply by: ' + escapeXml(deadline) + '</text>');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
    '<rect width="100%" height="100%" fill="#e7eff7"/>' +
    '<rect x="48" y="48" width="' + (width - 96) + '" height="' + (height - 96) + '" rx="28" fill="#ffffff" stroke="#dce3ea" stroke-width="3"/>' +
    '<text x="72" y="120" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#247568">' + escapeXml(label) + '</text>' +
    titleBlock(title, 72, 210) +
    body.join('') +
    '<line x1="72" y1="' + (height - 170) + '" x2="' + (width - 72) + '" y2="' + (height - 170) + '" stroke="#dce3ea" stroke-width="2"/>' +
    '<text x="72" y="' + (height - 110) + '" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#155ea8">Verify on the official notification</text>' +
    '<text x="' + (width - 72) + '" y="' + (height - 110) + '" text-anchor="end" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#247568">CivilCareer</text>' +
    '</svg>';
}

module.exports = { escapeXml, wrap, createGraphic };
