'use strict';

/**
 * CivilCareer — Government Civil Jobs listing endpoint (public, read-only)
 * GET /api/govt-jobs[?dept=&state=&q=&hideExpired=1]
 *
 * Feeds the dedicated /govt-jobs page: a GovtJobGuru-style table of
 * GOVERNMENT CIVIL ENGINEERING notifications only.
 *
 * Inclusion rules (deliberately strict — the public jobs feed mixes in
 * private ads that carry a wrong `sector` value):
 *   1. sector = Government  AND
 *   2. it is a real government source — gov_scope set, ingested by the
 *      govt-discovery pipeline, gov.in / nic.in links, or a recognised
 *      government employer — AND
 *   3. it is civil-engineering relevant (same keyword set the discovery
 *      pipeline uses at ingestion).
 *
 * Private employers (Pvt Ltd / manpower / staffing / consultancy) are
 * dropped even when their sector flag says Government.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

const LIST_FIELDS = [
  'id', 'role', 'company', 'sector', 'location', 'location_display', 'state',
  'qualification', 'deadline', 'vacancy_count', 'application_url', 'apply_url',
  'source_url', 'source', 'gov_scope', 'ingestion_source', 'slug', 'created_at',
  'posted_at', 'status', 'description', 'recruitment_authority', 'application_start',
].join(',');

/* ── Civil engineering relevance (mirrors _api/govt-discovery.js) ───────── */

const CIVIL_KW = [
  'civil engineer', 'civil engineering', 'site engineer', 'structural engineer',
  'planning engineer', 'quantity surveyor', 'highway engineer', 'road engineer',
  'bridge engineer', 'geotechnical', 'water resources', 'irrigation engineer',
  'drainage engineer', 'surveyor', 'qs engineer', 'billing engineer',
  'qaqc engineer', 'bim engineer', 'junior engineer', 'assistant engineer',
  'executive engineer', 'section engineer', 'works engineer', 'project engineer',
  'je civil', 'ae civil', 'ee civil', 'pwd', 'cpwd', 'nhai', 'cwc', 'mes',
  'construction', 'infrastructure', 'civil works', 'building works', 'draftsman',
  'draughtsman', 'estimator', 'estimation', 'architect', 'town planning',
  'urban development', 'panchayat', 'municipal', 'water supply', 'sanitation',
  'railway engineer', 'metro rail', 'bridge works', 'roads and buildings',
  'r&b', 'storage works', 'irrigation', 'canal', 'dam', 'buildings',
];
const CIVIL_RE = new RegExp(CIVIL_KW.join('|'), 'i');

/* ── Private-commercial signals (never government) ──────────────────────── */

const PRIVATE_RE = /\b(pvt|private limited|pvt\.? ltd|limited|ltd\.?|llp|inc|manpower|staffing|recruiters?|consultanc|consulting|solutions|services private|technologies|infotech|softech|adzuna|indeed|naukri|linkedin)\b/i;

/* ── Real government signals ────────────────────────────────────────────── */

const GOV_EMPLOYER_RE = /\b(government|govt|ministry|department of|public works|pwd|cpwd|ccwd|cwc|nhai|nhpc|nmdc|ongc|gail|bhel|ntpc|npcc|nbcc|wapcos|sail|ril|ircon|rites|irctc|rrb|rrc|railway|metro|dmrc|kmrl|cmrl|gmrc|bmrcl|upsc|ssc|psc|sssb|staff selection|public service commission|municipal|nagar (nigam|palika)|panchayat|jal (nigam|sansthan)|irrigation|water resources|military engineer|mes\b|bro\b|drdo|isro|csir|cimfr|crri|cco|niT\b|iit|cpwd|housing board|development authority|port trust|authority|corporation|board|sarpanch|kvs|nvs)\b/i;

const GOV_DOMAIN_RE = /(\.gov\.in|\.nic\.in|gov\.in\/|nic\.in\/|ncs\.gov|employmentnews)/i;

/* ── Department (tab) classification — civil-engineering oriented ───────── */

const DEPARTMENTS = [
  { key: 'railway', label: 'Railway & Metro', re: /\b(railway|rrb|rrc|ircon|rites|irctc|metro|dmrc|kmrl|cmrl|gmrc|bmrcl|mrvc|krcl|rail vikas|loco)\b/i },
  { key: 'defence', label: 'Defence & MES', re: /\b(defence|defense|army|navy|air force|military engineer|mes\b|bro\b|drdo|bsf|crpf|cisf|itbp|coast guard|ssb\b|ordnance|assam rifles|border roads)\b/i },
  { key: 'psu', label: 'PSU & Maharatna', re: /\b(ntpc|bhel|sail|ongc|iocl|bpcl|hpcl|gail|nhpc|sjvn|npcil|nbcc|npcc|wapcos|nhai|powergrid|nmdc|concor|irfc|pfc|rec\b|mazagon|grse|bdl|bel\b|hal\b|cochin shipyard|engineers india|ecil|mecon|mstc|hudco|wcl|secl|mcl|nhsrcl)\b/i },
  { key: 'ssc-psc', label: 'SSC / State PSC', re: /\b(ssc\b|staff selection|upsc|bpsc|appsc|tnpsc|kpsc|mpsc|uppsc|uppsc|hpsc|jpsc|cgpsc|opsc|gpsc|kpsc|psc\b|public service commission|sssb|jkssb|kpsc|kerala psc|tspsc|apsc|mpsc|rajasthan psc)\b/i },
  { key: 'state', label: 'State PWD & Irrigation', re: /\b(pwd|public works|roads and buildings|r&b|irrigation|water resources|jal (nigam|sansthan|shakti)|panchayat|municipal|nagar|urban development|housing board|development authority|zilla parishad|gram panchayat|water supply|sewerage|drainage|minor irrigation|major irrigation|state government)\b/i },
  { key: 'central', label: 'Central Govt & CPWD', re: /\b(cpwd|central public works|ministry|department of|government of india|nhai|survey of india|geological survey|cwc|central water commission|nhsrc|cantt?onment|central government|authority of india|commission)\b/i },
  { key: 'institute', label: 'Institutes & Universities', re: /\b(iit|nit\b|iiit|iim\b|university|college|institute|aiims|kvs|nvs|sainik school|navodaya|csir|iiser|niT\b)\b/i },
];

function classifyDepartment(job) {
  const hay = [job.company, job.role, job.recruitment_authority, job.source].filter(Boolean).join(' ');
  for (const d of DEPARTMENTS) {
    if (d.re.test(hay)) return d;
  }
  if (String(job.gov_scope || '').toLowerCase() === 'central') {
    return { key: 'central', label: 'Central Govt & CPWD' };
  }
  if (String(job.gov_scope || '').toLowerCase() === 'state') {
    return { key: 'state', label: 'State PWD & Irrigation' };
  }
  return { key: 'other', label: 'Other Govt Bodies' };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function db(path, opts) {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      ...(opts && opts.headers ? opts.headers : {}),
    },
    ...opts,
  });
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Accepts ISO (2026-10-17) or Indian DD-MM-YY / DD-MM-YYYY. */
function parseDeadline(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, +m[2] - 1, +m[1]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDeadline(d) {
  if (!d) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${String(d.getUTCFullYear()).slice(2)}`;
}

function daysLeft(d) {
  if (!d) return null;
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d.getTime() - utcToday) / 86400000);
}

/** Pull a vacancy number out of free text like "3,500 posts". */
function parseVacancies(row) {
  const direct = parseInt(row.vacancy_count, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const hay = `${row.role || ''} ${row.description || ''} ${row.qualification || ''}`;
  const m = /(\d[\d,]{1,7})\s*(?:posts?|vacanc\w+|vacant\s+seats?|openings?)/i.exec(hay);
  if (m) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0 && n < 5000000) return n;
  }
  return null;
}

function primaryUrl(row) {
  return row.apply_url || row.application_url || row.source_url || null;
}

/** True only for genuine government civil-engineering records. */
function isGovtCivil(row) {
  const company = String(row.company || '');
  const hay = [row.company, row.role, row.qualification, row.description, row.source].filter(Boolean).join(' ');
  const url = [row.apply_url, row.application_url, row.source_url].filter(Boolean).join(' ');

  if (!CIVIL_RE.test(hay)) return false;            // civil relevance required
  if (GOV_DOMAIN_RE.test(url)) return true;         // official government link
  if (row.gov_scope || /govt_discovery/i.test(String(row.ingestion_source || ''))) return true;
  if (PRIVATE_RE.test(company)) return false;       // explicitly commercial employer
  return GOV_EMPLOYER_RE.test(hay);
}

function shape(row, now) {
  const d = parseDeadline(row.deadline);
  const left = daysLeft(d);
  const dept = classifyDepartment(row);
  const vacancies = parseVacancies(row);
  const url = primaryUrl(row);
  const walkIn = /\bwalk[\s-]?in\b/i.test(`${row.role || ''} ${row.description || ''}`);
  return {
    id: row.id,
    role: stripHtml(row.role) || 'Government vacancy',
    company: stripHtml(row.company) || 'Government of India',
    department: dept.key,
    departmentLabel: dept.label,
    qualification: stripHtml(row.qualification).slice(0, 220),
    location: stripHtml(row.location_display || row.location || row.state || 'All India'),
    state: stripHtml(row.state) || stateFromLocation(row.location) || 'All India',
    vacancies,
    deadline: d ? d.toISOString().slice(0, 10) : null,
    deadlineText: fmtDeadline(d),
    daysLeft: left,
    expired: left !== null && left < 0,
    closingSoon: left !== null && left >= 0 && left <= 5,
    walkIn,
    applyUrl: url,
    internalUrl: row.slug ? `/jobs/${row.slug}` : null,
    source: stripHtml(row.source),
    govScope: row.gov_scope || null,
    postedAt: row.posted_at || row.created_at || null,
    scrapedAt: now,
  };
}

function stateFromLocation(location) {
  const raw = String(location || '').trim();
  if (!raw) return null;
  const first = raw.split(',')[0].trim();
  return first && !/^india$/i.test(first) ? first : null;
}

/* ── Handler ────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only.' });
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: 'Supabase not configured.' });

  let params = new URLSearchParams();
  try {
    params = new URL(req.url, 'http://localhost').searchParams;
  } catch (_) { /* keep empty */ }
  const wantDept = String(params.get('dept') || '').trim().toLowerCase();
  const wantState = String(params.get('state') || '').trim().toLowerCase();
  const wantQuery = String(params.get('q') || '').trim().toLowerCase();
  const hideExpired = ['1', 'true', 'yes'].includes(String(params.get('hideExpired') || '').toLowerCase());

  try {
    const r = await db(
      `jobs?select=${encodeURIComponent(LIST_FIELDS)}&published=eq.true&sector=eq.Government&order=created_at.desc&limit=1000`
    );
    if (!r.ok) {
      const detail = await r.text();
      console.error('govt-jobs query failed:', r.status, detail.slice(0, 200));
      return res.status(500).json({ ok: false, error: 'Could not load government jobs.' });
    }
    const rows = await r.json();
    const list = Array.isArray(rows) ? rows : [];
    const now = new Date().toISOString();

    let jobs = list.filter(isGovtCivil).map((row) => shape(row, now));

    // De-duplicate by role + company (scrapers can re-add the same notice).
    const seen = new Set();
    jobs = jobs.filter((j) => {
      const key = `${j.role}`.toLowerCase().slice(0, 90) + '|' + `${j.company}`.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort: soonest deadline first, then undated/newest.
    jobs.sort((a, b) => {
      const ad = a.deadline ? Date.parse(a.deadline) : Infinity;
      const bd = b.deadline ? Date.parse(b.deadline) : Infinity;
      if (ad !== bd) return ad - bd;
      return Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0);
    });

    // ── Aggregates for the filter tabs (computed on the full set) ─────────
    const deptMap = new Map();
    const stateMap = new Map();
    let totalVacancies = 0;
    for (const j of jobs) {
      const d = deptMap.get(j.department) || { key: j.department, label: j.departmentLabel, count: 0, vacancies: 0 };
      d.count += 1;
      d.vacancies += j.vacancies || 0;
      deptMap.set(j.department, d);

      const s = stateMap.get(j.state) || { name: j.state, count: 0, vacancies: 0 };
      s.count += 1;
      s.vacancies += j.vacancies || 0;
      stateMap.set(j.state, s);

      totalVacancies += j.vacancies || 0;
    }

    const departments = [
      ...DEPARTMENTS.map((d) => deptMap.get(d.key)).filter(Boolean),
      deptMap.get('other'),
    ].filter(Boolean);
    const states = [...stateMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    // ── Apply requested filters to the returned rows ─────────────────────
    let filtered = jobs;
    if (wantDept && wantDept !== 'all') filtered = filtered.filter((j) => j.department === wantDept);
    if (wantState && wantState !== 'all') filtered = filtered.filter((j) => j.state.toLowerCase() === wantState);
    if (wantQuery) {
      filtered = filtered.filter((j) =>
        `${j.role} ${j.company} ${j.qualification} ${j.location} ${j.state}`.toLowerCase().includes(wantQuery)
      );
    }
    if (hideExpired) filtered = filtered.filter((j) => !j.expired);

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({
      ok: true,
      updatedAt: now,
      year: new Date().getFullYear() + 1,
      totals: {
        notifications: jobs.length,
        shown: filtered.length,
        vacancies: totalVacancies || null,
        states: states.length,
      },
      departments,
      states,
      jobs: filtered,
    });
  } catch (e) {
    console.error('govt-jobs error:', e && e.message);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
};

/* Internals exposed for local test scripts — no effect at runtime. */
module.exports.__test = { isGovtCivil, classifyDepartment, parseVacancies, parseDeadline, shape };
