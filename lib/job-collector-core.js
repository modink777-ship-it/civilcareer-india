/**
 * CivilCareer — Job Collector core
 *
 * Turns ONE submitted item (pasted text, a URL's page text, an OCR'd poster,
 * a PDF's extracted text) into ZERO OR MORE structured job candidates:
 *
 *   split into individual jobs → parse fields → score civil relevance →
 *   score confidence → dedupe against the existing jobs table
 *
 * Rules that matter:
 *   • NEVER invent a field. Anything not present in the source is null.
 *   • Deterministic first (free, fast, explainable); AI only as a bounded,
 *     cached second pass when the deterministic result is thin.
 *   • Vision/OCR uses the Gemini free tier when GEMINI_API_KEY exists, and
 *     degrades to "needs text" instead of failing when it does not.
 *   • No new dependencies: plain fetch + the existing chatJSON chain.
 */
'use strict';

const { chatJSON, parseJsonLoose } = require('./ai-models');

const MAX_TEXT = 12000;
const MAX_DESCRIPTION = 4000;

/* ── tiny helpers ────────────────────────────────────────────────────── */

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

function oneLine(value) {
  return clean(value).replace(/\n+/g, ' ').trim();
}

function stripHtml(html) {
  return clean(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function capWords(value) {
  return String(value || '').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function titleCase(value) {
  const s = oneLine(value);
  if (!s) return '';
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
    return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return s;
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function toIsoDate(value) {
  const s = oneLine(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const d = new Date(/T\d/.test(s) ? s : `${s} UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/* ── multi-job splitting ─────────────────────────────────────────────── */

const HEADER_NOISE = /^(hiring|we are hiring|urgent requirement|requirement|requirements|required|job description|job details|description|responsibilities|roles? and responsibilities|location|job location|salary|ctc|qualification|qualifications|eligibility|experience|contact|contact us|apply|how to apply|note|notes|important|benefits|about us|about the company|company|company profile|interview|walk[- ]?in|vacancy|vacancies|posts?|positions?|openings?|send (your )?cv|share (your )?cv|email|phone|address|skills|key skills|designation|department|industry|job type|work mode|no\.? of (posts?|vacancies)|last date|deadline)$/i;

/* A line that starts with a label ("Skills: AutoCAD") is a field line, not a
   job title, even though it may contain role words. */
function startsWithLabel(bare) {
  const m = bare.match(/^([A-Za-z][A-Za-z /()]{1,24})\s*[:：]/);
  return Boolean(m && HEADER_NOISE.test(m[1].trim()));
}

/* Word-bounded so "Infrastructure" does not match "structure" and "AutoCAD"
   does not match "cad". */
const ROLE_WORD = /\b(project\s+manager|project\s+engineer|site\s+supervisor|site\s+engineer|planning\s+engineer|billing\s+engineer|quantity\s+surveyor|qa\/?qc|store\s*keeper|storekeeper|engineer|engineering|manager|supervisor|surveyor|surveying|draughtsman|draftsman|drafter|billing|planner|planning|estimator|estimation|inspector|foreman|architect|designer|coordinator|technician|quality|cad\b|bim|structural|structure|geotech\w*|highway|roadway|water\s+(supply|resources)|site|execution|quantity|service|maintenance)\b/i;

/* Anchored at the end of the line: company names END with the suffix, while job
   titles like "Project Manager" merely contain such a word. */
const COMPANY_SUFFIX = /\b(pvt\.?\s*ltd\.?|private\s+limited|limited|ltd\.?|llp|inc\.?|corporation|corp\.?|infra(?:structure)?|constructions?|builders?|developers?|projects?|consultants?|consultancy|enterprises?|industries?|group|associates)\b\s*[.,]?$/i;

const SENTENCE_WORDS = /(?:^|\s)(we|are|is|looking|required|requires|candidates?|should|will|must|have|has|with|and|the|for|a|an|our|you|your|us|to|of|in|on|at|preferred|immediate|joiners?)(?:\s|$)/gi;

function looksLikeJobTitle(line) {
  const raw = String(line || '').replace(/^[-•*●▪\d.\)\s]+/, '').trim();
  /* "Site Engineer - 4-6 LPA" is a title plus its salary: keep the title. */
  let bare = raw.replace(/[:：\-–—]+$/, '').trim()
    .replace(/\s*[-–|,(]\s*(?:₹|rs\.?|inr)?\s*\d[\d,.]*(?:\s*[-–]\s*\d[\d,.]*)?\s*(?:k|lpa|lakhs?|lacs?|thousand|per\s*month|pm|pa)?\s*\)?$/i, '')
    .trim();
  if (!bare || bare.length < 3 || bare.length > 64) return null;
  if (HEADER_NOISE.test(bare)) return null;
  if (startsWithLabel(bare)) return null;
  if (COMPANY_SUFFIX.test(bare)) return null;      // "ABC Infrastructure Pvt Ltd" is a company, not a role
  if (!ROLE_WORD.test(bare)) return null;
  if (/[.!?]$/.test(bare)) return null;
  const sentenceHits = (bare.match(SENTENCE_WORDS) || []).length;
  if (sentenceHits >= 2) return null;
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length > 8) return null;
  return titleCase(bare) || null;
}

/**
 * Split one message/poster into individual jobs.
 * @returns {Array<{title:string|null, block:string}>}
 */
function splitJobCandidates(text) {
  const body = clean(text);
  if (!body) return [];
  const lines = body.split('\n');

  const hits = [];
  lines.forEach((line, i) => {
    const title = looksLikeJobTitle(line);
    if (title) hits.push({ i, title });
  });

  if (!hits.length) {
    const firstLine = lines.map((l) => oneLine(l)).find((l) => l.length > 2) || null;
    return [{ title: firstLine ? titleCase(firstLine).slice(0, 120) : null, block: body }];
  }

  if (hits.length > 25) hits.length = 25;

  return hits.map((hit, n) => {
    const next = hits[n + 1] ? hits[n + 1].i : lines.length;
    const block = clean(lines.slice(hit.i, next).join('\n'));
    return { title: hit.title, block: block || body };
  });
}

/* ── field parsers (null when absent — never guessed) ────────────────── */

const CITY_STATE = {
  bengaluru: 'Karnataka', bangalore: 'Karnataka', mysuru: 'Karnataka', mysore: 'Karnataka',
  hubballi: 'Karnataka', hubli: 'Karnataka', mangaluru: 'Karnataka', belagavi: 'Karnataka',
  mumbai: 'Maharashtra', pune: 'Maharashtra', nagpur: 'Maharashtra', nashik: 'Maharashtra',
  thane: 'Maharashtra', navi: 'Maharashtra', aurangabad: 'Maharashtra', kolhapur: 'Maharashtra',
  chennai: 'Tamil Nadu', coimbatore: 'Tamil Nadu', madurai: 'Tamil Nadu', trichy: 'Tamil Nadu',
  tiruchirappalli: 'Tamil Nadu', salem: 'Tamil Nadu', tirunelveli: 'Tamil Nadu',
  hyderabad: 'Telangana', warangal: 'Telangana', secunderabad: 'Telangana',
  visakhapatnam: 'Andhra Pradesh', vijayawada: 'Andhra Pradesh', guntur: 'Andhra Pradesh',
  tirupati: 'Andhra Pradesh', nellore: 'Andhra Pradesh', kurnool: 'Andhra Pradesh',
  delhi: 'Delhi', 'new delhi': 'Delhi', noida: 'Uttar Pradesh', 'greater noida': 'Uttar Pradesh',
  ghaziabad: 'Uttar Pradesh', lucknow: 'Uttar Pradesh', kanpur: 'Uttar Pradesh',
  varanasi: 'Uttar Pradesh', agra: 'Uttar Pradesh', meerut: 'Uttar Pradesh',
  gurugram: 'Haryana', gurgaon: 'Haryana', faridabad: 'Haryana', sonipat: 'Haryana',
  panipat: 'Haryana', karnal: 'Haryana', rohtak: 'Haryana', hisar: 'Haryana',
  kolkata: 'West Bengal', howrah: 'West Bengal', durgapur: 'West Bengal', siliguri: 'West Bengal',
  asansol: 'West Bengal', ahmedabad: 'Gujarat', surat: 'Gujarat', vadodara: 'Gujarat',
  rajkot: 'Gujarat', gandhinagar: 'Gujarat', jaipur: 'Rajasthan', jodhpur: 'Rajasthan',
  udaipur: 'Rajasthan', kota: 'Rajasthan', ajmer: 'Rajasthan', bikaner: 'Rajasthan',
  bhopal: 'Madhya Pradesh', indore: 'Madhya Pradesh', jabalpur: 'Madhya Pradesh',
  gwalior: 'Madhya Pradesh', ujjain: 'Madhya Pradesh', raipur: 'Chhattisgarh',
  bhilai: 'Chhattisgarh', bilaspur: 'Chhattisgarh', patna: 'Bihar', gaya: 'Bihar',
  ranchi: 'Jharkhand', dhanbad: 'Jharkhand', jamshedpur: 'Jharkhand', rourkela: 'Odisha',
  bhubaneswar: 'Odisha', cuttack: 'Odisha', kochi: 'Kerala', ernakulam: 'Kerala',
  kozhikode: 'Kerala', calicut: 'Kerala', thiruvananthapuram: 'Kerala', thrissur: 'Kerala',
  chandigarh: 'Chandigarh', mohali: 'Punjab', ludhiana: 'Punjab', amritsar: 'Punjab',
  jalandhar: 'Punjab', dehradun: 'Uttarakhand', haridwar: 'Uttarakhand', shimla: 'Himachal Pradesh',
  guwahati: 'Assam', silchar: 'Assam', bhubaneshwar: 'Odisha',
};

const STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
  'uttarakhand', 'west bengal', 'delhi', 'jammu and kashmir', 'ladakh', 'puducherry', 'chandigarh',
];

const SKILLS = [
  'autocad', 'auto cad', 'civil 3d', 'staad pro', 'staad', 'etabs', 'safe', 'revit', 'tekla',
  'navisworks', 'primavera', 'ms project', 'microsoft project', 'planswift', 'ms excel', 'excel',
  'bim', 'gis', 'qgis', 'arcgis', 'total station', 'dumpy level', 'autolevel', 'auto level',
  'boq', 'estimation', 'billing', 'rate analysis', 'bar bending schedule', 'bbs', 'quantity surveying',
  'quantity surveyor', 'site supervision', 'site execution', 'surveying', 'drafting', 'tendering',
  'contracts', 'hse', 'safety', 'quality control', 'quality assurance', 'qa/qc', 'qa/qc civil',
  'project management', 'planning', 'scheduling', 'structural design', 'rcc', 'steel structures',
  'water supply', 'sewerage', 'roads', 'highways', 'bridges', 'irrigation', 'metro', 'tunnelling',
  'geotechnical', 'soil investigation', 'foundation', 'earthwork', 'pavement', 'asphalt',
  'construction management', 'site engineer tools', 'pdf', 'sketchup', '3ds max',
];

function parseLocation(block, whole) {
  const explicit = oneLine((block.match(/(?:job\s*)?location\s*[:\-–]\s*([^\n|]{2,80})/i) || [])[1]);
  const basedAt = oneLine((block.match(/based\s+(?:at|in)\s*[:\-]?\s*([^\n|]{2,80})/i) || [])[1]);
  const source = explicit || basedAt;
  const haystack = `${source || ''} ${whole || ''}`.toLowerCase();
  let city = null;
  if (source) {
    const first = source.split(/[,\-–]/)[0].trim().toLowerCase();
    if (first && CITY_STATE[first]) city = capWords(first);
  }
  if (!city) {
    for (const key of Object.keys(CITY_STATE)) {
      if (new RegExp(`(^|[^a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(haystack)) {
        city = capWords(key); break;
      }
    }
  }
  let state = null;
  if (source) {
    const lower = source.toLowerCase();
    const hit = STATES.find((s) => lower.includes(s));
    if (hit) state = capWords(hit);
  }
  if (!state && city && CITY_STATE[city.toLowerCase()]) state = CITY_STATE[city.toLowerCase()];
  if (!state) {
    const hit = STATES.find((s) => new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i').test(haystack));
    if (hit) state = capWords(hit);
  }
  const location = source ? titleCase(source).slice(0, 120) : (city ? [city, state].filter(Boolean).join(', ') : null);
  return { city, state, location };
}

function parseExperience(block) {
  const text = oneLine((block.match(/[^\n]*(?:experience|exp)\b[^\n]*/i) || [])[0]) || null;
  const range = block.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i);
  let min = null;
  let max = null;
  if (range) {
    min = Number(range[1]);
    max = Number(range[2]);
  } else {
    const single = block.match(/(\d{1,2})\s*\+\s*(?:years?|yrs?)/i) || block.match(/(?:minimum|min\.?|at least)\s*(\d{1,2})\s*(?:years?|yrs?)/i);
    if (single) min = Number(single[1]);
  }
  const fresher = /freshers?\b/i.test(block);
  if (fresher && min === null) min = 0;
  if (min !== null && max !== null && max < min) { const t = min; min = max; max = t; }
  return { experience_min: min, experience_max: max, fresher_allowed: fresher || null, experience_text: text };
}

function parseSalary(block) {
  const text = oneLine((block.match(/[^\n]*(?:salary|ctc|pay|stipend|package)\b[^\n]*/i) || [])[0]) || null;
  const source = text || block;
  const currencyFor = (raw) => {
    if (/₹|rs\.?|inr|rupees?/i.test(raw)) return 'INR';
    if (/\$|usd/i.test(raw)) return 'USD';
    if (/€|eur/i.test(raw)) return 'EUR';
    if (/aed|dhs/i.test(raw)) return 'AED';
    return null;
  };
  const unitFactor = (unit) => {
    const u = String(unit || '').toLowerCase();
    if (/lpa|lakh|lac|lacs/.test(u)) return 100000;
    if (/^k$|thousand/.test(u)) return 1000;
    return 1;
  };
  const periodOf = (unit, raw) => {
    const u = String(unit || '').toLowerCase();
    if (/lpa|per annum|annum|year|pa\b/.test(u) || /per\s*(annum|year)/i.test(raw)) return 'year';
    if (/month|pm\b|p\.m/.test(u) || /per\s*month/i.test(raw)) return 'month';
    if (/day|daily/.test(u)) return 'day';
    return null;
  };
  const range = source.match(/(?:₹|rs\.?|inr|\$|usd|€|eur)?\s*([\d][\d,.]*)\s*(k|lpa|lakhs?|lacs?|thousand)?\s*(?:-|–|to)\s*(?:₹|rs\.?|inr|\$)?\s*([\d][\d,.]*)\s*(k|lpa|lakhs?|lacs?|thousand)?/i);
  let min = null; let max = null; let unit = null;
  let single = null; let plain = null;
  if (range) {
    unit = range[2] || range[4] || null;
    const f = unitFactor(unit);
    const a = Number(String(range[1]).replace(/,/g, ''));
    const b = Number(String(range[3]).replace(/,/g, ''));
    if (Number.isFinite(a)) min = a * f;
    if (Number.isFinite(b)) max = b * f;
  } else {
    single = source.match(/(?:₹|rs\.?|inr|\$)\s*([\d][\d,.]*)\s*(k|lpa|lakhs?|lacs?|thousand)?/i);
    if (single) {
      unit = single[2] || null;
      const a = Number(String(single[1]).replace(/,/g, ''));
      if (Number.isFinite(a)) min = a * unitFactor(unit);
    } else {
      plain = source.match(/([\d][\d,.]*)\s*(lpa|lakhs?|lacs?)\b/i);
      if (plain) {
        unit = plain[2];
        const a = Number(String(plain[1]).replace(/,/g, ''));
        if (Number.isFinite(a)) min = a * 100000;
      }
    }
  }
  const hasAny = min !== null || max !== null;
  /* "LPA"/"lakh" only exist in Indian salary talk — INR is implied, not invented. */
  const currency = currencyFor(source) || (hasAny && /lpa|lakhs?|lacs?|inr|rs\.?/i.test(source) ? 'INR' : null);
  /* Display value: the labelled line, else the line that holds the matched
     numbers, else the matched fragment — never the whole block. */
  let lineHit = null;
  if (!text) {
    const num = range ? range[1] : (single ? single[1] : (plain ? plain[1] : null));
    if (num) lineHit = block.split('\n').map(oneLine).find((l) => l && l.includes(num)) || null;
  }
  const matched = range ? range[0] : (single ? single[0] : (plain ? plain[0] : null));
  const salary = text || lineHit || (hasAny && matched ? oneLine(matched) : null);
  return {
    salary: salary ? salary.slice(0, 200) : null,
    salary_min: min,
    salary_max: max,
    salary_currency: hasAny ? currency : null,
    salary_period: hasAny ? (periodOf(unit, source) || (unit && /lpa|lakh|lac/i.test(unit) ? 'year' : null)) : null,
  };
}

function parseContacts(block) {
  const emails = block.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const phones = block.match(/(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g) || [];
  const urls = block.match(/https?:\/\/[^\s)>\]]+/g) || [];
  return {
    application_email: emails.length ? emails[0].toLowerCase() : null,
    application_phone: phones.length ? phones[0].replace(/\s+/g, '') : null,
    application_url: urls.length ? urls[0] : null,
    _extra_emails: emails.slice(1, 4),
    _extra_phones: phones.slice(1, 4),
  };
}

function parseCompany(block, titleLine, headerText) {
  const explicit = oneLine((block.match(/(?:company|organization|organisation|employer)\s*[:\-–]\s*([^\n]{2,90})/i) || [])[1]);
  let name = explicit || null;
  if (!name && headerText) {
    name = oneLine((headerText.match(/(?:company|organization|organisation|employer)\s*[:\-–]\s*([^\n]{2,90})/i) || [])[1]) || null;
  }
  /* Strong suffixes first so "ABC Infrastructure Pvt Ltd" is not truncated at
     "Infrastructure"; weaker suffixes (Builders, Projects, …) are the fallback. */
  const strong = /([A-Z0-9][A-Za-z0-9&.'()\- ]{2,60}?(?:Pvt\.?\s*Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|Inc\.?|Corporation|Corp\.?))/i;
  const weak = /([A-Z0-9][A-Za-z0-9&.'()\- ]{2,60}?(?:Infra(?:structure)?|Constructions?|Builders?|Developers?|Projects?|Consultants?|Consultancy|Enterprises?|Industries?|Technologies|Solutions?|Services|Group|Associates))/i;
  if (!name) {
    const hay = headerText || '';
    const m = hay.match(strong) || block.match(strong) || hay.match(weak) || block.match(weak);
    if (m) name = oneLine(m[1]);
  }
  if (!name && titleLine) {
    const m = titleLine.match(/(?:at|@)\s*([A-Za-z0-9&.'()\- ]{3,60})$/);
    if (m) name = oneLine(m[1]);
  }
  if (name) {
    name = name.replace(/[^\w).&'\s-]+$/, '').trim().slice(0, 120);
    /* Never echo the role itself back as the employer. */
    if (titleLine && name.toLowerCase() === String(titleLine).toLowerCase()) name = null;
    if (name && name.split(/\s+/).length < 2 && !COMPANY_SUFFIX.test(name)) name = null;
  }
  return name || null;
}

function parseQualification(block) {
  const m = block.match(/\b(B\.?\s?E\.?|B\.?\s?Tech|B\.?\s?Sc|B\.?\s?Arch|Diploma|M\.?\s?Tech|M\.?\s?E\.?|ME|AMIE|ITI)\b[^\n]{0,60}/i);
  if (!m) {
    const branchOnly = block.match(/\b(civil|construction|structural)\s+engineering\b/i);
    return branchOnly ? { qualification: oneLine(branchOnly[0]), degree: null, branch: 'Civil' } : { qualification: null, degree: null, branch: null };
  }
  const text = oneLine(m[0]).slice(0, 160);
  const degree = /b\.?\s?e|b\.?\s?tech|b\.?\s?arch/i.test(text) ? (/(b\.?\s?arch)/i.test(text) ? 'B.Arch' : (/b\.?\s?tech/i.test(text) ? 'B.Tech' : 'B.E'))
    : (/diploma/i.test(text) ? 'Diploma' : (/m\.?\s?tech/i.test(text) ? 'M.Tech' : (/m\.?\s?e\b/i.test(text) ? 'M.E' : (/iti/i.test(text) ? 'ITI' : (/b\.?\s?sc/i.test(text) ? 'B.Sc' : null)))));
  const branch = /civil/i.test(text) ? 'Civil' : (/structural/i.test(text) ? 'Structural' : (/construction/i.test(text) ? 'Construction' : null));
  return { qualification: text, degree, branch };
}

function parseSkills(block) {
  const lower = block.toLowerCase();
  const found = [];
  for (const skill of SKILLS) {
    const re = new RegExp(`(^|[^a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(lower)) {
      const label = skill.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Autocad/, 'AutoCAD');
      if (!found.some((f) => f.toLowerCase() === label.toLowerCase())) found.push(label);
    }
  }
  return found.slice(0, 20);
}

function parseJobType(block) {
  if (/full[\s-]?time/i.test(block)) return 'Full-time';
  if (/part[\s-]?time/i.test(block)) return 'Part-time';
  if (/contract(?:ual)?\b/i.test(block)) return 'Contract';
  if (/intern(?:ship)?\b/i.test(block)) return 'Internship';
  if (/temporary|temp\b/i.test(block)) return 'Temporary';
  if (/freelance/i.test(block)) return 'Freelance';
  return null;
}

function parseWorkMode(block) {
  if (/work\s*from\s*home|\bwfh\b|remote/i.test(block)) return 'Remote';
  if (/hybrid/i.test(block)) return 'Hybrid';
  if (/on[\s-]?site|site[\s-]?based/i.test(block)) return 'On-site';
  return null;
}

function parseExpiry(block) {
  const m = block.match(/(?:last date|apply by|apply before|deadline|valid till|valid through)\s*[:\-–]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4})/i);
  return m ? toIsoDate(m[1]) : null;
}

/* ── relevance ───────────────────────────────────────────────────────── */

const RELEVANCE_RULES = [
  ['government_engineering', 4, /\b(govt|government|psu|rrb|upsc|ssc|state psc|kpsc|municipal|corporation of|nmdc|bhel|ntpc|nhai|ircon|rites|cpwd|aiims|metro rail)\b/i],
  ['quantity_surveying', 5, /\b(quantity surveyor|quantity surveying|boq|rate analysis|bar bending|bbs|estimation|estimator|take[- ]?off)\b/i],
  ['billing', 4, /\b(billing engineer|billing|invoice|measurement book|mb book)\b/i],
  ['planning', 4, /\b(planning engineer|planner|primavera|ms project|scheduling|programme manager|project planning)\b/i],
  ['bim', 5, /\b(bim|revit|navisworks|tekla|bim model(l)?er|digital construction)\b/i],
  ['qa_qc', 4, /\b(qa\/?qc|quality control|quality assurance|qc engineer|qa engineer)\b/i],
  ['surveying', 4, /\b(surveyor|surveying|total station|land survey|levelling|dumpy level)\b/i],
  ['geotechnical', 5, /\b(geotechnical|soil investigation|geotech|foundation design|ground improvement)\b/i],
  ['structural', 5, /\b(structural|rcc|steel structure|staad|etabs|design engineer.*structure|structure.*design)\b/i],
  ['transportation', 5, /\b(highway|roadway|roads? engineer|pavement|asphalt|bridge|tunnel|metro|railway)\b/i],
  ['water_resources', 5, /\b(water supply|sewerage|drainage|irrigation|pipeline|water resources|stp|wtp)\b/i],
  ['infrastructure', 3, /\b(infrastructure|infra project|utilities|power project|highway project|metro project)\b/i],
  ['construction', 3, /\b(construction|contractor|site execution|site engineer|projects? engineer|construction management|earthwork|excavation)\b/i],
  ['architecture_related', 2, /\b(architect|architecture|interior|facade|planning drawings?)\b/i],
  ['civil_engineering', 3, /\b(civil engineer|civil engineering|b\.?e\.? civil|b\.?tech civil|diploma civil|civil supervisor|civil drafter)\b/i],
  ['project_management', 2, /\b(project manager|project management|pmc|construction manager)\b/i],
];

const NON_CIVIL_RULES = /\b(sales|marketing|telecaller|business development|hr executive|recruiter|accountant|accounting|finance manager|content writer|graphic designer|digital marketing|data entry|customer support|driver|security guard|nurse|teacher|chef|cook|housekeeping|delivery|bpo|call center)\b/i;

function classifyRelevance(text, title = '') {
  const body = oneLine(text);
  const reasons = [];
  let best = null;
  let bestScore = 0;
  for (const [category, weight, re] of RELEVANCE_RULES) {
    if (re.test(body)) {
      if (!reasons.some((r) => r === category)) reasons.push(category);
      if (weight > bestScore) { bestScore = weight; best = category; }
    }
  }
  /* The role in the title is the strongest statement of what the job is:
     "Site Engineer" beats a skills line that merely mentions Staad Pro. */
  const titleBody = oneLine(title);
  if (titleBody) {
    let titleBest = null;
    let titleScore = 0;
    for (const [category, weight, re] of RELEVANCE_RULES) {
      if (re.test(titleBody)) {
        if (!reasons.some((r) => r === category)) reasons.push(category);
        if (weight + 2 > titleScore) { titleScore = weight + 2; titleBest = category; }
      }
    }
    if (titleBest && titleScore > bestScore) { best = titleBest; bestScore = titleScore; }
  }
  const nonCivil = NON_CIVIL_RULES.test(body);
  if (!best && nonCivil) {
    return { category: 'non_relevant', score: 0.05, reason: `matched non-civil wording${reasons.length ? ` (also: ${reasons.slice(0, 3).join(', ')})` : ''}` };
  }
  if (!best) {
    return { category: 'uncertain', score: 0.3, reason: 'no civil-engineering signal found — send to admin review' };
  }
  if (nonCivil && bestScore <= 2) {
    return { category: 'non_relevant', score: 0.1, reason: `civil wording (${best}) is outweighed by non-civil wording` };
  }
  return {
    category: best,
    score: Math.min(1, bestScore / 5),
    reason: `matched ${reasons.slice(0, 4).join(' + ')}`,
  };
}

/* ── confidence ──────────────────────────────────────────────────────── */

function scoreConfidence(job) {
  let score = 0.25;
  const found = [];
  const missing = [];
  const weigh = (key, value, points, label) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') { score += points; found.push(label); }
    else missing.push(label);
  };
  weigh('title', job.title, 0.2, 'title');
  weigh('company', job.company, 0.2, 'company');
  weigh('location', job.location, 0.15, 'location');
  weigh('contact', job.application_email || job.application_phone || job.application_url, 0.15, 'contact');
  weigh('skills', Array.isArray(job.skills) && job.skills.length ? job.skills.join(',') : null, 0.05, 'skills');
  if (job.description && job.description.length >= 80) { score += 0.05; found.push('description'); } else missing.push('description');
  return {
    confidence_score: Math.round(Math.min(0.95, score) * 100) / 100,
    confidence_reason: `found: ${found.join(', ') || 'nothing'}; missing: ${missing.join(', ') || 'nothing'}`,
  };
}

/* ── duplicate scoring against an existing row ───────────────────────── */

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenSet(value) {
  return new Set(normalise(value).split(' ').filter((w) => w.length > 2));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function titleSimilarity(a, b) {
  return jaccard(tokenSet(a), tokenSet(b));
}

function duplicateScore(candidate, existing) {
  const reasons = [];
  let score = 0;
  const c = candidate || {};
  const e = existing || {};
  if (c.application_email && normalise(c.application_email) === normalise(e.application_email)) { score += 0.35; reasons.push('same email'); }
  if (c.application_phone && digits(c.application_phone) && digits(c.application_phone) === digits(e.application_phone)) { score += 0.3; reasons.push('same phone'); }
  if (c.application_url && String(c.application_url) === String(e.source_url || e.application_url || '')) { score += 0.35; reasons.push('same apply URL'); }
  if (c.company && normalise(c.company) === normalise(e.company)) { score += 0.3; reasons.push('same company'); }
  if (c.title && titleSimilarity(c.title, e.role || e.title) >= 0.7) { score += 0.2; reasons.push('similar title'); }
  if (c.city && normalise(c.city) === normalise(e.city)) { score += 0.1; reasons.push('same city'); }
  const desc = jaccard(tokenSet(c.description), tokenSet(e.description));
  if (desc >= 0.5) { score += 0.2; reasons.push(`description overlap ${Math.round(desc * 100)}%`); }
  return { score: Math.round(Math.min(1, score) * 100) / 100, reasons };
}

/* ── deterministic extraction ────────────────────────────────────────── */

function candidateFrom(title, block, whole, source) {
  /* The poster header (company name, banner lines) sits above the first role,
     so it is scanned globally and shared by every candidate from that item. */
  const headerText = whole.split('\n').slice(0, 20).join('\n');
  const base = {
    title: title || null,
    company: parseCompany(block, title, headerText),
    ...parseLocation(block, whole),
    ...parseExperience(block),
    ...parseSalary(block),
    ...parseContacts(block),
    ...parseQualification(block),
    skills: parseSkills(block),
    job_type: parseJobType(block),
    work_mode: parseWorkMode(block),
    expiry: parseExpiry(block),
    description: clean(block).slice(0, MAX_DESCRIPTION) || null,
    source_type: (source && source.type) || 'manual',
    source_url: (source && source.url) || null,
    source_file: (source && source.file) || null,
  };
  delete base._extra_emails;
  delete base._extra_phones;
  const relevance = classifyRelevance(`${base.title || ''} ${block}`, base.title);
  const confidence = scoreConfidence(base);
  return {
    ...base,
    relevance_category: relevance.category,
    relevance_score: relevance.score,
    relevance_reason: relevance.reason,
    ...confidence,
    extraction_method: 'rules',
  };
}

function extractFromText(text, source = {}) {
  return splitJobCandidates(text)
    .map(({ title, block }) => candidateFrom(title, block, text, source))
    .filter((job) => job.title || (job.description && job.description.length > 40));
}

/* ── AI-assisted structuring (bounded, cached) ───────────────────────── */

const aiCache = new Map();
const AI_CACHE_MAX = 100;

function aiCacheKey(text) {
  let hash = 0;
  const s = clean(text).slice(0, 4000);
  for (let i = 0; i < s.length; i += 1) { hash = (hash * 31 + s.charCodeAt(i)) | 0; }
  return `k${hash}`;
}

function fieldOf(obj, ...names) {
  for (const n of names) {
    const v = obj ? obj[n] : undefined;
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

/**
 * Ask the free-tier chain to structure text that the deterministic pass found
 * thin. Returns an array of job candidates or [] (caller keeps its own result).
 */
async function structureWithAI(text, source = {}) {
  const key = aiCacheKey(text);
  if (aiCache.has(key)) return aiCache.get(key);
  const prompt = [
    'You extract job vacancies from civil-engineering recruitment material.',
    'Return STRICT JSON only: {"jobs":[{"title","company","city","state","location","experience_min","experience_max","fresher_allowed","qualification","skills","salary_text","application_email","application_phone","application_url","job_type","work_mode","expiry","description"}]}',
    'Rules: copy values only from the text; use null when the text does not state it; never invent company names, salaries, locations or links.',
    'If the text lists several roles, return one object per role. If it is not a job advertisement, return {"jobs":[]}.',
    '',
    'TEXT:',
    clean(text).slice(0, 6000),
  ].join('\n');

  let out;
  try {
    out = await chatJSON({ prompt, maxTokens: 1600, temperature: 0.1 });
  } catch (err) {
    const empty = [];
    aiCache.set(key, empty);
    return empty;
  }
  const parsed = out && out.json ? out.json : parseJsonLoose(out && out.text);
  const rows = parsed && Array.isArray(parsed.jobs) ? parsed.jobs.slice(0, 25) : [];
  const jobs = rows.map((row) => {
    const base = {
      title: fieldOf(row, 'title'),
      company: fieldOf(row, 'company'),
      city: fieldOf(row, 'city'),
      state: fieldOf(row, 'state'),
      location: fieldOf(row, 'location'),
      experience_min: Number.isFinite(Number(fieldOf(row, 'experience_min'))) ? Number(fieldOf(row, 'experience_min')) : null,
      experience_max: Number.isFinite(Number(fieldOf(row, 'experience_max'))) ? Number(fieldOf(row, 'experience_max')) : null,
      fresher_allowed: fieldOf(row, 'fresher_allowed') === true ? true : null,
      qualification: fieldOf(row, 'qualification'),
      skills: Array.isArray(row.skills) ? row.skills.map((s) => oneLine(s)).filter(Boolean).slice(0, 20) : [],
      salary: fieldOf(row, 'salary_text', 'salary'),
      salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
      application_email: fieldOf(row, 'application_email'),
      application_phone: fieldOf(row, 'application_phone'),
      application_url: fieldOf(row, 'application_url'),
      job_type: fieldOf(row, 'job_type'),
      work_mode: fieldOf(row, 'work_mode'),
      expiry: toIsoDate(fieldOf(row, 'expiry')),
      description: fieldOf(row, 'description'),
      source_type: source.type || 'manual',
      source_url: source.url || null,
      source_file: source.file || null,
    };
    const relevance = classifyRelevance(`${base.title || ''} ${base.description || ''}`);
    const confidence = scoreConfidence(base);
    return {
      ...base,
      relevance_category: relevance.category,
      relevance_score: relevance.score,
      relevance_reason: relevance.reason,
      ...confidence,
      extraction_method: 'ai',
      ai_provider: out && out.provider ? out.provider : null,
      ai_model: out && out.model ? out.model : null,
    };
  });
  aiCache.set(key, jobs);
  if (aiCache.size > AI_CACHE_MAX) aiCache.delete(aiCache.keys().next().value);
  return jobs;
}

/* ── vision / OCR (Gemini free tier; graceful when unconfigured) ─────── */

const VISION_PROMPT = [
  'Transcribe ALL text visible in this recruitment poster/screenshot/document.',
  'Keep the layout readable: one role per line, and copy contact details, salary, location, experience and qualification exactly as shown.',
  'Do not summarise, do not translate, do not add anything that is not visible.',
].join('\n');

/**
 * OCR / document transcription for images and PDFs.
 * Uses the Gemini free tier when GEMINI_API_KEY is configured.
 * @returns {{ok:boolean, text?:string, reason?:string, provider?:string, model?:string}}
 */
async function visionExtract({ base64, mime, filename }) {
  const keys = String(process.env.GEMINI_API_KEY || '').split(/[,\s]+/).map((k) => k.trim()).filter((k) => k.length > 8);
  if (!keys.length) return { ok: false, reason: 'no_vision_provider' };
  if (!base64) return { ok: false, reason: 'no_file_data' };
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const body = {
    contents: [{
      parts: [
        { text: VISION_PROMPT },
        { inline_data: { mime_type: mime || 'image/jpeg', data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  };
  for (const key of keys.slice(0, 2)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(50000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const text = (data && data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts || [])
        .map((p) => p && p.text)
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return { ok: true, text: clean(text), provider: 'gemini', model };
    } catch (_) { /* try the next key */ }
  }
  return { ok: false, reason: 'vision_failed' };
}

/* ── public API ──────────────────────────────────────────────────────── */

module.exports = {
  clean,
  oneLine,
  stripHtml,
  titleCase,
  toIsoDate,
  splitJobCandidates,
  parseLocation,
  parseExperience,
  parseSalary,
  parseContacts,
  parseCompany,
  parseQualification,
  parseSkills,
  parseJobType,
  parseWorkMode,
  parseExpiry,
  classifyRelevance,
  scoreConfidence,
  duplicateScore,
  jaccard,
  extractFromText,
  structureWithAI,
  visionExtract,
  CITY_STATE,
  SKILLS,
  RELEVANCE_RULES,
};
