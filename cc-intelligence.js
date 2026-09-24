/* ═══════════════════════════════════════════════════════════════
   CivilCareer Intelligence Layer (V11) — deterministic, free, safe
   AI-native UX built on DETERMINISTIC rules first (§7, §9, §21, §22):
   - Natural-language search parser (role/location/experience/salary/
     sector/freshness/education) → existing structured filters.
     Low-confidence parses fall back to keyword search. No AI needed.
   - Career Radar · Skill Radar · Career Map (data-driven).
   - Explainable match score on cards (§9): reasons, never mysterious.
   - Deterministic "Job Brief" on detail pages (§8): every fact comes
     from the job record; missing fields render an honest fallback.
   No new Vercel functions, no paid services, no keys in the browser.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9+.#₹\-\s]/g, ' ').replace(/\s+/g, ' ').trim();

  /* ── Role thesaurus: user words → canonical civil roles (§24 intent) ── */
  const ROLES = [
    { canon: 'Site Engineer', pat: ['site engineer', 'site execution', 'site civil'] },
    { canon: 'Quantity Surveyor', pat: ['quantity surveyor', 'quantity surveying', 'qs', 'billing engineer', 'billing', 'estimation engineer', 'estimator'] },
    { canon: 'Planning Engineer', pat: ['planning engineer', 'planner', 'project controls'] },
    { canon: 'Structural Engineer', pat: ['structural engineer', 'structural design', 'structures', 'rcc design'] },
    { canon: 'BIM Engineer', pat: ['bim engineer', 'bim modeler', 'bim', 'revit'] },
    { canon: 'QA/QC Engineer', pat: ['qa/qc', 'qa qc', 'quality engineer', 'quality control', 'quality assurance'] },
    { canon: 'Highway Engineer', pat: ['highway engineer', 'highways', 'road engineer', 'transportation engineer', 'highway'] },
    { canon: 'Design Engineer', pat: ['design engineer', 'civil designer', 'cad engineer'] },
    { canon: 'Project Engineer', pat: ['project engineer'] },
    { canon: 'Surveyor', pat: ['surveyor', 'surveying', 'land survey'] },
    { canon: 'Civil Engineer', pat: ['civil engineer', 'civil engineering', 'graduate engineer trainee', 'get civil'] }
  ];

  /* ── Locations: cities + states (substrings must be unambiguous) ── */
  const CITIES = ['bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'hyderabad', 'chennai', 'pune', 'ahmedabad', 'kolkata', 'kochi', 'coimbatore', 'noida', 'gurugram', 'gurgaon', 'jaipur', 'lucknow', 'indore', 'nagpur', 'visakhapatnam', 'mysuru', 'mangaluru', 'hubballi', 'belagavi', 'surat', 'vadodara', 'bhopal', 'patna', 'guwahati', 'chandigarh', 'thiruvananthapuram'];
  const STATES = ['karnataka', 'maharashtra', 'tamil nadu', 'telangana', 'kerala', 'andhra pradesh', 'delhi', 'gujarat', 'rajasthan', 'uttar pradesh', 'madhya pradesh', 'west bengal', 'bihar', 'assam', 'odisha', 'punjab', 'haryana', 'himachal pradesh', 'jharkhand', 'chhattisgarh', 'goa', 'uttarakhand'];

  /* ── Skills vocabulary (§13) ── */
  const SKILLS = ['autocad', 'civil 3d', 'staad.pro', 'etabs', 'revit', 'bim', 'primavera', 'ms project', 'quantity surveying', 'boq', 'rate analysis', 'billing', 'estimation', 'qa/qc', 'surveying', 'highways', 'structures', 'geotechnical', 'water resources', 'construction management'];

  /* ═══════════ NL SEARCH PARSER (§7) — deterministic ═══════════ */
  function parseQuery(q) {
    const s = ' ' + norm(q) + ' ';
    const out = { role: null, city: null, state: null, exp: null, minSalary: null, sector: null, freshness: null, keywords: [], confident: false };
    if (!s.trim()) return out;

    for (const r of ROLES) { if (r.pat.some(p => s.includes(' ' + p + ' ') || s.includes(' ' + p))) { out.role = r.canon; break; } }
    for (const c of CITIES) { if (s.includes(' ' + c + ' ')) { out.city = c === 'bangalore' ? 'bengaluru' : (c === 'gurgaon' ? 'gurugram' : c); break; } }
    for (const st of STATES) { if (s.includes(' ' + st + ' ')) { out.state = st.replace(/\b\w/g, m => m.toUpperCase()); break; } }

    const fm = s.match(/(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?|yr)\b/);
    if (fm) out.exp = parseFloat(fm[1]);
    if (/\b(fresher|freshers|fresh graduate|no experience|entry[- ]?level|0\s*years?)\b/.test(s)) out.exp = 0;

    const sm = s.match(/₹\s*(\d+(?:\.\d+)?)\s*(lpa|lakh|lac|lakhs)/) || s.match(/(\d+(?:\.\d+)?)\s*(lpa|lakh|lac|lakhs)/) || s.match(/above\s*₹?\s*(\d+(?:\.\d+)?)\s*(lpa)?/);
    if (sm && sm[1]) out.minSalary = parseFloat(sm[1]);

    if (/\b(government|govt|sarkari|psu|public sector)\b/.test(s)) out.sector = 'Government';
    else if (/\b(private|mnc|company)\b/.test(s)) out.sector = 'Private';

    if (/\b(today|posted today|last 24 hours|24h|just posted)\b/.test(s)) out.freshness = 1;
    else if (/\b(this week|last 7 days|7 days)\b/.test(s)) out.freshness = 7;
    else if (/\b(this month|last 30 days|30 days)\b/.test(s)) out.freshness = 30;

    /* confidence: did we extract at least one structured facet? */
    out.confident = !!(out.role || out.city || out.state || out.exp !== null || out.minSalary || out.sector || out.freshness);
    if (out.role || out.city || out.state) {
      const keep = [...(out.role ? [out.role] : []), ...(out.city ? [out.city] : []), ...(out.state ? [out.state] : [])];
      const words = norm(q).split(' ').filter(w => w.length > 2 && !keep.some(k => norm(k).includes(w)));
      out.keywords = words.slice(0, 4);
    }
    return out;
  }

  /* Apply a parsed intent to the EXISTING private-jobs filters (§7) */
  function applyToFilters(p) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    /* §9/§30: persist parsed intent so explainable match badges can light up */
    try {
      const prev = userProfile();
      localStorage.setItem('cc_profile', JSON.stringify(Object.assign({}, prev, {
        role: p.role || prev.role || '',
        location: p.city || p.state || prev.location || '',
        experience: p.exp === 0 ? 'Fresher' : (prev.experience || '')
      })));
    } catch (e) {}
    if (p.sector === 'Government') { location.href = '/government-jobs'; return true; }
    const rEl = document.getElementById('privateRole');
    if (p.role && rEl) {
      const hit = [...rEl.options].find(o => o.value.toLowerCase().includes(p.role.toLowerCase()));
      if (hit) rEl.value = hit.value; else rEl.value = '';
    }
    if (p.city || p.state) {
      const sEl = document.getElementById('privateState');
      if (p.state && sEl) {
        const hit = [...sEl.options].find(o => o.value.toLowerCase() === p.state.toLowerCase());
        if (hit) sEl.value = hit.value;
      }
      const cEl = document.getElementById('privateCity');
      if (p.city && cEl) {
        const hit = [...cEl.options].find(o => o.value.toLowerCase() === p.city);
        if (hit) cEl.value = hit.value;
      }
    }
    if (p.exp !== null) {
      const eEl = document.getElementById('privateExperience');
      if (eEl) {
        const label = p.exp === 0 ? 'Fresher' : (p.exp <= 1 ? '0–1 years' : p.exp <= 3 ? '1–3 years' : p.exp <= 5 ? '3–5 years' : p.exp <= 8 ? '5–8 years' : '8–10 years');
        const hit = [...eEl.options].find(o => norm(o.value) === norm(label) || norm(o.value).includes(norm(label)));
        if (hit) eEl.value = hit.value;
      }
    }
    if (p.minSalary) { const el = document.getElementById('privateSalary'); if (el) el.value = String(p.minSalary * 100000); }
    if (p.freshness) { const el = document.getElementById('privatePosted'); if (el) el.value = String(p.freshness); }
    if (typeof renderPrivate === 'function') renderPrivate();
    return true;
  }

  /* Search-page fallback scoring when AI is unavailable (§22) */
  function searchJobsFallback(q, loc) {
    if (typeof jobs === 'undefined' || typeof scoreJob !== 'function') return null;
    const p = parseQuery(q);
    let rows = jobs.slice();
    if (p.sector) rows = rows.filter(j => (p.sector === 'Government') === ['Government', 'Public Sector'].includes(j.sector));
    if (p.role) rows = rows.filter(j => norm(j.role).includes(norm(p.role)) || norm(j.role_normalized).includes(norm(p.role)));
    if (p.city) rows = rows.filter(j => [j.city, j.location, j.location_display, j.state].filter(Boolean).join(' ').toLowerCase().includes(p.city));
    if (p.state) rows = rows.filter(j => [j.state, j.location, j.location_display].filter(Boolean).join(' ').toLowerCase().includes(p.state.toLowerCase()));
    if (p.exp !== null) rows = rows.filter(j => { const t = norm([j.experience_level, (j.experience_ranges || [])].join(' ')); return p.exp === 0 ? /fresher|0\s*[-–]?\s*1|entry/.test(t) || !t : true; });
    if (p.minSalary) rows = rows.filter(j => Number(j.salary_max || j.salary_min || 0) >= p.minSalary * 100000 || (!j.salary_min && !j.salary_max && !j.salary));
    if (p.freshness) rows = rows.filter(j => Date.now() - new Date(pubDate(j) || 0) <= p.freshness * 86400000);
    if (loc) rows = rows.filter(j => [j.city, j.state, j.location, j.location_display].filter(Boolean).join(' ').toLowerCase().includes(norm(loc)));
    return { rows, parsed: p };
  }

  /* ═══════════ MATCH SCORE (§9) — explainable, deterministic ═══════════ */
  function userProfile() { try { return JSON.parse(localStorage.getItem('cc_profile') || '{}'); } catch { return {}; } }
  function matchJob(j, p) {
    p = p || userProfile();
    let score = 40; const why = []; const gaps = [];
    const text = norm([j.role, j.role_normalized, j.company, j.description, j.skills].join(' '));
    if (p.role) {
      const roleHit = norm(j.role).includes(norm(p.role)) || norm(j.role_normalized).includes(norm(p.role)) || text.includes(norm(p.role));
      if (roleHit) { score += 25; why.push('Matches your target role'); }
      else { score -= 12; gaps.push('Different role than your target'); }
    }
    const locText = norm([j.city, j.state, j.location, j.location_display].join(' '));
    if (p.location) {
      if (locText.includes(norm(p.location))) { score += 20; why.push('In your preferred location'); }
      else { score -= 6; gaps.push('Outside your preferred location'); }
    }
    if (p.skills) {
      const want = String(p.skills).split(',').map(x => norm(x)).filter(Boolean);
      const have = want.filter(k => text.includes(k));
      if (have.length) { score += Math.min(12, have.length * 5); why.push('Skills fit: ' + have.slice(0, 2).join(', ')); }
      const missing = want.filter(k => !have.includes(k));
      if (missing.length && missing.length <= 2) gaps.push(missing[0] + ' not mentioned in this job');
    }
    if (p.experience) {
      const eText = norm([j.experience_level, (j.experience_ranges || [])].join(' '));
      if (norm(p.experience).includes('fresher') && /fresher|0\s*[-–]\s*1|entry/.test(eText)) { score += 10; why.push('Fresher eligible'); }
    }
    const age = Date.now() - new Date(pubDate(j) || 0).getTime();
    if (Number.isFinite(age) && age >= 0 && age < 2 * 86400000) { score += 5; why.push('Posted recently'); }
    if (active(j)) score += 4; else score -= 25;
    score = Math.max(5, Math.min(98, Math.round(score)));
    return { score, why: why.slice(0, 3), gaps: gaps.slice(0, 2) };
  }
  function decorateMatches(root) {
    if (!root) return;
    root.querySelectorAll('.job-card').forEach(card => {
      if (card.querySelector('.cc-match')) return;
      const idEl = card.querySelector('[data-job],[data-save-job]');
      const jid = idEl ? (idEl.dataset.job || idEl.dataset.saveJob) : null;
      const j = (typeof jobs !== 'undefined') ? jobs.find(x => String(x.id) === String(jid)) : null;
      if (!j || !userProfile().role) return;
      const m = matchJob(j);
      const head = card.querySelector('.card-top');
      if (head) head.insertAdjacentHTML('beforeend', `<span class="cc-match" title="${esc(m.why.join(' · ') || 'Based on your profile')}">${m.score}%<small>match</small></span>`);
    });
  }

  /* ═══════════ CAREER RADAR (§11) — deterministic counts ═══════════ */
  function radarData() {
    if (typeof jobs === 'undefined') return null;
    const now = Date.now();
    const privOf = j => (typeof sectorOf === 'function') ? sectorOf(j) === 'Private' : ((j.sector || 'Private') === 'Private');
    const govOf = j => (typeof isGovJob === 'function') ? isGovJob(j) : ['Government', 'Public Sector'].includes(j.sector);
    const priv = jobs.filter(j => privOf(j) && active(j));
    const govt = jobs.filter(j => govOf(j) && active(j));
    const day = 86400000;
    const within = (j, n) => { const t = new Date(pubDate(j) || 0).getTime(); return Number.isFinite(t) && now - t <= n * day; };
    const closing = j => {
      if (!j || !j.deadline || !active(j)) return false;
      const raw = String(j.deadline);
      const t = (/T/.test(raw) ? new Date(raw) : new Date(raw + 'T23:59:59')).getTime();
      return Number.isFinite(t) && t > now && (t - now) / day <= 7;
    };
    return {
      newToday: priv.concat(govt).filter(j => within(j, 1)).length,
      closing: jobs.filter(closing).length,
      highMatch: priv.length,
      govt: govt.length,
      freshers: priv.concat(govt).filter(j => /fresher|0\s*[-–]\s*1|entry/.test(norm([j.experience_level, (j.experience_ranges || [])].join(' ')))).length
    };
  }

  /* ═══════════ CAREER MAP (§12) — curated paths, no fake salaries ═══════════ */
  const MAPS = {
    site: ['Civil Engineering Graduate', 'Site Engineer', 'Senior Site Engineer', 'Project Engineer', 'Project Manager'],
    design: ['Civil Engineering Graduate', 'Design Engineer', 'Structural Engineer', 'Senior Structural Engineer'],
    qs: ['Civil Graduate / Diploma', 'QS / Estimation Engineer', 'Billing Engineer', 'Contracts & Commercial Manager']
  };
  const MAP_SKILLS = {
    'Site Engineer': 'AutoCAD · surveying · QA/QC basics',
    'Senior Site Engineer': 'execution ownership · subcontractor handling',
    'Project Engineer': 'planning · billing · coordination',
    'Project Manager': 'Primavera/MS Project · contracts · HSE',
    'Design Engineer': 'AutoCAD · STAAD.Pro / ETABS basics',
    'Structural Engineer': 'STAAD.Pro · ETABS · IS codes',
    'Senior Structural Engineer': 'peer review · detailing · audits',
    'QS / Estimation Engineer': 'BOQ · rate analysis · measurement',
    'Billing Engineer': 'RA bills · reconciliation',
    'Contracts & Commercial Manager': 'tendering · claims · cost control',
    'Civil Engineering Graduate': 'fundamentals · AutoCAD · internship',
    'Civil Graduate / Diploma': 'fundamentals · estimation basics'
  };

  /* ═══════════ JOB BRIEF (§8) — deterministic, honest fallbacks ═══════════ */
  const NS = 'Not specified in the job posting.';
  function jobBrief(j) {
    const skills = String(j.skills || '').split(/[,;]/).map(x => x.trim()).filter(Boolean).slice(0, 6);
    const quals = jobQuals(j);
    const brief = [
      ['Why this matches', userProfile().role ? matchJob(j).why.join(' · ') || 'Shown because it is an active civil opportunity.' : 'Active civil-engineering opportunity in your field.'],
      ['Key requirements', quals.length ? quals.join(' · ') : (j.qualification || NS)],
      ['Important skills', skills.length ? skills.join(' · ') : NS],
      ['Experience expectation', jobExps(j).join(' · ') || j.experience_level || NS],
      ['Salary / compensation', j.salary || (j.salary_min && j.salary_max ? `${j.salary_min} – ${j.salary_max}` : null) || NS],
      ['Application deadline', j.deadline ? date(j.deadline) : NS],
      ['What to prepare', 'Keep your updated resume, degree/diploma certificates and ID proof ready before applying at the source.'],
      ['Career path', 'Verify the role scope at the source; typical growth follows Site → Senior Site → Project Engineer, or Design → Senior Structural tracks.']
    ];
    return brief.map(([k, v]) => `<div class="detail"><b>${esc(k)}</b>${esc(v)}</div>`).join('');
  }

  /* ═══════════ WIRING ═══════════ */
  function injectHomeSections() {
    if (typeof jobs === 'undefined' || !document.querySelector('[data-page="home"].active')) return;
    /* Career Radar above "Latest opportunities" */
    if (!document.getElementById('ccRadar')) {
      const anchor = document.querySelector('[data-page="home"] .section.soft .container');
      if (anchor) {
        const d = radarData(); if (!d) return;
        const cell = (n, l, href, hot) => `<a class="cc-radar-cell${hot ? ' hot' : ''}" href="${href}" data-dynamic-route="true"><b>${n}</b><span>${l}</span></a>`;
        anchor.insertAdjacentHTML('afterbegin',
          `<div class="cc-radar" id="ccRadar" aria-label="Career radar">${cell(d.newToday, 'New today', '/private-jobs')}${cell(d.closing, 'Closing soon', '/private-jobs', d.closing > 0)}${cell(d.govt, 'Government', '/government-jobs')}${cell(d.freshers, 'For freshers', '/private-jobs?experience=Fresher')}${cell(d.highMatch, 'Private jobs', '/private-jobs')}</div>`);
      }
    }
  }

  function briefOnDetail() {
    const host = document.querySelector('#jobDetailPage .dedicated-card .detail-grid');
    if (!host || host.querySelector('.cc-brief')) return;
    const j = (typeof window.__ccCurrentJob !== 'undefined') ? window.__ccCurrentJob : null;
    if (!j) return;
    host.insertAdjacentHTML('beforeend', `<div class="detail full cc-brief"><b>AI Job Brief</b><div class="detail-grid" style="grid-template-columns:1fr 1fr;margin-top:8px">${jobBrief(j)}</div></div>`);
  }

  let wired = false;
  function boot() {
    if (wired) return; wired = true;
    /* NL search: intercept the homepage smart-search submit.
       Document-level capture so it runs before the original listener
       registered on the form by app.js (at-target listeners fire in
       registration order, so a form-level capture listener is not enough). */
    const form = document.getElementById('smartSearch');
    if (form && !form.dataset.ccNl) {
      form.dataset.ccNl = '1';
      document.addEventListener('submit', function (e) {
        if (e.target !== form) return;
        const qEl = document.getElementById('globalQuery');
        const q = qEl ? qEl.value.trim() : '';
        if (!q) return; /* empty → original behaviour */
        const p = parseQuery(q);
        if (!p.confident) return; /* low confidence → original keyword search */
        if (!document.querySelector('[data-page="home"].active')) return;
        e.preventDefault();
        e.stopPropagation(); /* the original keyword handler never sees this */
        applyToFilters(p);
      }, true);
    }
    /* rotating NL placeholders (§4) */
    const qEl = document.getElementById('globalQuery');
    if (qEl && !qEl.dataset.ccPh) {
      qEl.dataset.ccPh = '1';
      const examples = ['Site engineer jobs in Bengaluru for freshers', 'Government civil engineering jobs this month', 'Highway engineer roles with 2 years experience', 'Construction jobs in Tamil Nadu above ₹5 LPA', 'I want to become a structural engineer'];
      let i = 0;
      setInterval(() => { if (document.activeElement !== qEl && !qEl.value) qEl.placeholder = examples[i++ % examples.length]; }, 4000);
    }
    setInterval(() => { try { injectHomeSections(); briefOnDetail(); decorateMatches(document.querySelector('.page.active')); } catch (e) {} }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.CivilCareerIntelligence = { parseQuery, matchJob, radarData, jobBrief, searchJobsFallback, applyToFilters };
})();
