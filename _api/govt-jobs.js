'use strict';

/**
 * CivilCareer — PUBLIC Government Jobs API (Government Jobs → Civil Engineering)
 *
 * Publication gate (spec §7): every read filters human_reviewed=eq.true in
 * addition to status=eq.active. The database check constraint is the second
 * layer; this reader is the third. Unreviewed rows can never reach the public.
 */

const { allowPublicCors } = require('../lib/security');
const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

const OFFICIAL_GOVT_HOSTS = new Set([
  'ntpc.co.in', 'bhel.com', 'rites.com', 'ircon.org', 'aai.aero',
  'nhpcindia.com', 'nbccindia.com', 'wapcos.gov.in',
]);

function isOfficialGovtUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.endsWith('.gov.in') || h.endsWith('.nic.in')
      || OFFICIAL_GOVT_HOSTS.has(h)
      || [...OFFICIAL_GOVT_HOSTS].some(x => h.endsWith('.' + x));
  } catch (_) { return false; }
}

function db(path, opts = {}) {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

function daysLeft(date) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  const t = new Date();
  const today = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  return Math.round((d - today) / 86400000);
}

/* ══ Master public shape (spec §2) ══
   Missing facts are null — never fabricated. */
function shape(job, posts) {
  const civilPosts = (posts || []).filter(p => p.is_civil);
  const deadline = job.apply_end || null;
  const left = daysLeft(deadline);
  const officialNotification = job.official_notification_url || job.official_notice_url || null;
  const officialSite = job.official_site_url || null;
  const applyUrl = job.official_apply_url || officialNotification || officialSite;
  const source = officialNotification || officialSite;
  return {
    id: job.id,
    slug: job.slug,
    role: job.title,
    title: job.title,
    company: job.organization,
    organization: job.organization,
    department: job.department || job.department_category,
    departmentLabel: job.department_category,
    post: job.post_name || null,
    notificationNo: job.notification_no || null,
    govLevel: job.gov_level || (job.scope === 'state' ? 'state' : 'central'),
    govScope: job.scope,
    civilDiscipline: job.civil_discipline || null,
    specialization: job.civil_specialization || null,
    qualification: job.qualification
      || [...new Set(civilPosts.map(p => p.qualification).filter(Boolean))].join(' / ').slice(0, 300)
      || null,
    branch: job.branch || null,
    experience: job.experience || null,
    location: job.state || 'All India',
    state: job.state || 'All India',
    vacancies: job.civil_vacancies ?? job.civil_posts_count
      ?? (civilPosts.reduce((n, p) => n + (Number(p.vacancies) || 0), 0) || null),
    totalVacancies: job.total_vacancies ?? job.total_posts_in_notification ?? null,
    deadline,
    deadlineText: job.deadline_text || deadline,
    daysLeft: left,
    expired: left !== null && left < 0,
    closingSoon: left !== null && left >= 0 && left <= 5,
    applicationStart: job.application_start || (job.dates && job.dates.start) || null,
    applicationMode: job.application_mode || null,
    applicationFee: job.application_fee || null,
    ageLimit: job.age_limit || null,
    ageRelaxation: job.age_relaxation || null,
    payLevel: job.pay_level || null,
    correctionWindow: job.correction_window || null,
    examDate: job.exam_date || null,
    examMode: job.exam_mode || null,
    selectionStages: Array.isArray(job.selection_stages) ? job.selection_stages : [],
    timeline: Array.isArray(job.timeline) ? job.timeline : [],
    summary: job.summary || null,
    officialNotificationUrl: officialNotification,
    officialApplyUrl: applyUrl,
    officialSiteUrl: officialSite,
    sourceUrl: source,
    verificationStatus: job.verification_status
      || (isOfficialGovtUrl(source) ? 'official' : 'unverified'),
    lastVerifiedAt: job.last_verified_at || null,
    humanReviewed: job.human_reviewed === true,
    publishedAt: job.published_at,
    internalUrl: `/government-jobs/job/${encodeURIComponent(job.slug)}`,
    posts: civilPosts.map(p => ({
      name: p.post_name,
      discipline: p.discipline,
      vacancies: p.vacancies,
      qualification: p.qualification,
      pay: p.pay,
      selection_process: p.selection_process,
    })),
  };
}

const BASE_FILTERS = 'status=eq.active&human_reviewed=eq.true';

module.exports = async function handler(req, res) {
  allowPublicCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only.' });
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ ok: false, error: 'Supabase not configured.' });

  try {
    const p = new URL(req.url, 'http://localhost').searchParams;
    const slug = p.get('slug');

    /* ── Detail by slug (or ?job= for legacy callers) ─────────────── */
    if (slug || p.get('job')) {
      const wantSlug = slug || p.get('job');
      const jq = `govt_jobs?slug=eq.${encodeURIComponent(wantSlug)}&${BASE_FILTERS}&select=*&limit=1`;
      const jr = await db(jq);
      if (!jr.ok) {
        const t = await jr.text();
        if (/relation .*govt_jobs.* does not exist/i.test(t)) {
          return res.status(200).json({ ok: true, job: null, error: 'Government jobs table is not initialised yet.' });
        }
        throw new Error(t.slice(0, 300));
      }
      const jobs = await jr.json();
      const j = jobs[0];
      if (!j) return res.status(404).json({ ok: false, error: 'Government job not found.' });
      const pr = await db(`govt_job_posts?govt_job_id=eq.${encodeURIComponent(j.id)}&select=post_name,discipline,is_civil,vacancies,pay,qualification,qualification_levels,selection_process`);
      const posts = pr.ok ? await pr.json() : [];
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
      return res.status(200).json({ ok: true, job: shape(j, posts) });
    }

    /* ── Aggregate lists (public listing pages) ───────────────────── */
    const jq = `govt_jobs?${BASE_FILTERS}&order=apply_end.asc.nullslast,published_at.desc&limit=1000`;
    const jr = await db(jq);
    if (!jr.ok) {
      const t = await jr.text();
      if (/relation .*govt_jobs.* does not exist/i.test(t)) {
        return res.status(200).json({
          ok: true, updatedAt: new Date().toISOString(),
          totals: { notifications: 0, shown: 0, vacancies: null, states: 0 },
          departments: [], states: [], organizations: [], qualifications: [], roles: [], jobs: [],
          emptyReason: 'not_initialised',
        });
      }
      throw new Error(t.slice(0, 300));
    }
    const jobs = await jr.json();

    const ids = jobs.map(j => j.id);
    let posts = [];
    if (ids.length) {
      const inList = ids.map(x => `"${String(x).replace(/"/g, '')}"`).join(',');
      const pr = await db(`govt_job_posts?govt_job_id=in.(${encodeURIComponent(inList)})&is_civil=eq.true&select=govt_job_id,post_name,discipline,vacancies,pay,qualification,qualification_levels,selection_process`);
      if (pr.ok) posts = await pr.json();
    }
    const byJob = new Map();
    for (const post of posts) {
      if (!byJob.has(post.govt_job_id)) byJob.set(post.govt_job_id, []);
      byJob.get(post.govt_job_id).push(post);
    }

    let list = jobs.map(j => shape(j, byJob.get(j.id) || []));

    /* Keep the legacy guarantee: only civil-relevant notifications with an
       official source are listed publicly. */
    list = list.filter(j => j.verificationStatus === 'official' || j.verificationStatus === 'official-source');

    /* ── Filters ───────────────────────────────────────────────────── */
    const q = String(p.get('q') || '').toLowerCase().trim();
    const dept = String(p.get('dept') || '').toLowerCase().trim();
    const state = String(p.get('state') || '').toLowerCase().trim();
    const org = String(p.get('organization') || '').toLowerCase().trim();
    const qualification = String(p.get('qualification') || '').toLowerCase().trim();
    const role = String(p.get('role') || '').toLowerCase().trim();
    const level = String(p.get('level') || '').toLowerCase().trim();
    const specialization = String(p.get('specialization') || '').toLowerCase().trim();
    const scope = String(p.get('scope') || '').toLowerCase().trim();

    if (q) list = list.filter(j => `${j.title} ${j.organization} ${j.qualification || ''} ${j.location} ${j.post || ''}`.toLowerCase().includes(q));
    if (dept && dept !== 'all') list = list.filter(j => String(j.departmentLabel).toLowerCase() === dept);
    if (state) list = list.filter(j => j.state.toLowerCase() === state);
    if (org) list = list.filter(j => String(j.organization).toLowerCase().replace(/[^a-z0-9]+/g, '-') === org || String(j.organization).toLowerCase().includes(org));
    if (qualification) list = list.filter(j => String(j.qualification || '').toLowerCase().includes(qualification));
    if (role) list = list.filter(j => `${j.title} ${j.post || ''}`.toLowerCase().includes(role));
    if (level) list = list.filter(j => j.govLevel === level);
    if (specialization) list = list.filter(j => j.specialization === specialization);
    if (scope && scope !== 'all') list = list.filter(j => j.govScope === scope);

    /* ── Facets over the FILTERED list ─────────────────────────────── */
    const deptMap = new Map(), stateMap = new Map(), orgMap = new Map(), qualMap = new Map(), roleMap = new Map();
    let vacancies = 0;
    for (const j of list) {
      const d = deptMap.get(j.departmentLabel) || { key: String(j.departmentLabel).toLowerCase(), label: j.departmentLabel, count: 0, vacancies: 0 };
      d.count++; d.vacancies += j.vacancies || 0; deptMap.set(j.departmentLabel, d);
      const s = stateMap.get(j.state) || { name: j.state, count: 0, vacancies: 0 };
      s.count++; s.vacancies += j.vacancies || 0; stateMap.set(j.state, s);
      const o = orgMap.get(j.organization) || { name: j.organization, count: 0 };
      o.count++; orgMap.set(j.organization, o);
      if (j.qualification) {
        const qual = j.qualification;
        const g = qualMap.get(qual) || { qualification: qual, count: 0 };
        g.count++; qualMap.set(qual, g);
      }
      if (j.post) {
        const r = roleMap.get(j.post) || { role: j.post, count: 0 };
        r.count++; roleMap.set(j.post, r);
      }
      vacancies += j.vacancies || 0;
    }

    /* Pagination (server-side slice for the explorer UI). */
    const page = Math.max(1, Number(p.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(p.get('limit') || 40)));
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const shown = list.slice((page - 1) * limit, page * limit);

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      totals: { notifications: total, shown: shown.length, vacancies: vacancies || null, states: stateMap.size },
      departments: [...deptMap.values()],
      states: [...stateMap.values()],
      organizations: [...orgMap.values()],
      qualifications: [...qualMap.values()],
      roles: [...roleMap.values()],
      jobs: shown,
      meta: { page, limit, total, pages, has_next: page < pages },
    });
  } catch (e) {
    console.error('govt-jobs', e.message);
    return res.status(500).json({ ok: false, error: 'Could not load government jobs.' });
  }
};

module.exports.isOfficialGovtUrl = isOfficialGovtUrl;
