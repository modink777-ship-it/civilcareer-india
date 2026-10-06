#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { classifyPost, classifyNotification, classifyNotificationDetailed } = require('../lib/civil-classifier');
const { adapterFor, selectCivil, classifyRecord, officialNoticeLinks } = require('../lib/govt-aggregators');
/* The same payload builder the /api/govt-discovery cron uses. The two writers drifted
   once — the cron staged six fields and put the aggregator's own URL in
   official_notice_url — and the review queue showed empty evidence on every lead.
   One builder, one shape. */
const { buildPayload, keepReviewedFields, reviewedAlready } = require('../lib/govt-lead-payload');
const { sendCivilDigest } = require('../lib/govt-alert');
const execFileAsync = promisify(execFile);

const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SITE = String(process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');
const UA = `CivilCareer-GovtBot/1.0 (+${SITE}/about)`;
const TIMEOUT = Number(process.env.GOVT_FETCH_TIMEOUT_MS || 30000);
/* Bounded by the job timeout in .github/workflows/govt-pipeline.yml. The last
   11-source crawl took 5.4 min of the 15 allowed (~30 s per source), so 18 is
   the most this workflow can be trusted to finish with margin for retries.
   Raise this only alongside timeout-minutes. */
const MAX_SOURCES = Number(process.env.GOVT_MAX_SOURCES || 18);
const MAX_CANDIDATES = Number(process.env.GOVT_MAX_CANDIDATES_PER_SOURCE || 30);
/* Aggregator rows are classified from the site's own table, so a detail page is
   fetched only for the rows that already survived — and only to attach the real
   official notice URL. Eight per source per run keeps the five aggregators inside
   a couple of minutes of the workflow's timeout while still covering a day's new
   postings across the 2-hourly runs. */
const MAX_DETAIL_FETCHES = Number(process.env.GOVT_MAX_DETAIL_FETCHES_PER_SOURCE || 8);
const HOST_GAP_MS = 5000;
const config = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'config', 'govt-sources.json'), 'utf8'));

if (!SUPA || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const hostLast = new Map();
const robotsCache = new Map();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function pace(url) {
  const host = new URL(url).hostname;
  const last = hostLast.get(host) || 0;
  const wait = HOST_GAP_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  hostLast.set(host, Date.now());
}

function clean(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
function sha(v) { return crypto.createHash('sha256').update(String(v || '')).digest('hex'); }
function norm(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function absolute(href, base) { try { return new URL(href, base).href; } catch { return ''; } }
function officialUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.endsWith('.gov.in') || h.endsWith('.nic.in') || /(^|\.)(bhel\.com|ntpc\.co\.in|rites\.com|ircon\.org|aai\.aero)$/.test(h);
  } catch { return false; }
}
function parseDate(raw) {
  const s = clean(raw);
  if (!s) return null;
  let m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function extractDeadline(text) {
  const m = String(text || '').match(/(?:last date|last date to apply|closing date|apply on or before|applications? .*? before)[:\s-]*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4})/i);
  if (m) return { kind: 'fixed', text: m[1], date: parseDate(m[1]) };
  const rel = String(text || '').match(/within\s+(\d{1,3})\s+days?/i);
  if (rel) return { kind: 'relative_days', text: `Within ${rel[1]} days`, date: null, relativeDays: Number(rel[1]) };
  if (/update\s+soon/i.test(text)) return { kind: 'update_soon', text: 'Update Soon', date: null };
  if (/notified\s+soon/i.test(text)) return { kind: 'notified_soon', text: 'Notified Soon', date: null };
  return { kind: 'fixed', text: '', date: null };
}
function parseNotificationNo(text) {
  const m = String(text || '').match(/\b(?:advertisement|advt\.?|notification|cen|ref(?:erence)?)[\s.#:/-]*([A-Z0-9][A-Z0-9./_-]{1,24})\b/i);
  return m ? m[1] : null;
}
function parseOrg(text, fallback) {
  const s = clean(text);
  const m = s.match(/(?:organization|organisation|department|employer)\s*[:\-]\s*([^|;]{3,100})/i);
  return clean(m ? m[1] : fallback) || fallback || 'Government organization';
}
function extractLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = absolute(m[1], base);
    const title = clean(m[2]);
    if (!url || !title || !/^https?:/i.test(url)) continue;
    if (/javascript:|mailto:|tel:/i.test(url)) continue;
    out.push({ title, url });
  }
  const uniq = new Map();
  for (const x of out) if (!uniq.has(x.url)) uniq.set(x.url, x);
  return [...uniq.values()];
}
function extractRss(xml, base) {
  const out = [];
  const re = /<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const t = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const l = b.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i) || b.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (t && l) out.push({ title: clean(t[1]), url: absolute(clean(l[1]), base) });
  }
  return out;
}
/* Aggregator listing pages label every result with the same boilerplate
   ("Apply Now", "View / Apply", "Read More") and put the real title in the URL
   slug: /ssc-recruitment-2026-apply-online-for-1748-junior-engineer-posts/.
   stageLead classifies on the TITLE, so boilerplate meant no discipline signal
   and every civil post on those pages was dropped as not_civil before a human
   could see it — the crawler reported success while staging nothing. When the
   anchor text is one of those labels, fall back to the slug. */
const GENERIC_ANCHOR = /^(apply\s*(now|online|here)?|read\s*more|view(\s*\/\s*apply)?|view\s*details|more\s*details|details|click\s*here|download|notification|know\s*more|check\s*details)$/i;
function titleFromSlug(url) {
  try {
    const segs = new URL(url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    /* many aggregators end the path with a row id: /.../junior-engineer-posts/44605 */
    let seg = segs[segs.length - 1] || '';
    if (/^\d+$/.test(seg)) seg = segs[segs.length - 2] || seg;
    const words = clean(seg.replace(/\.(html?|php|aspx)$/i, '').replace(/[-_]+/g, ' ')).replace(/\s+/g, ' ').trim();
    return words.length >= 12 ? words : '';
  } catch { return ''; }
}
function candidateTitle(title, url) {
  const t = clean(title);
  return GENERIC_ANCHOR.test(t) ? (titleFromSlug(url) || t) : t;
}
function looksLikeCandidate(title, url) {
  const t = `${title} ${url}`;
  return /\b(civil|engineer|engineering|je|ae|aee|ee|recruit|vacanc|appointment|works|structural|highway|road|bridge|survey|quantity|draught|draftsman|notification|advertisement|cen)\b/i.test(t);
}
async function fetchText(url, headers = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pace(url);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.5', ...headers }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
      const etag = r.headers.get('etag') || '';
      const lastModified = r.headers.get('last-modified') || '';
      if (r.status === 304) return { status: 304, text: '', etag, lastModified, notModified: true, contentType: r.headers.get('content-type') || '' };
      // Access/rate-limit responses are throttles, not broken sources — treat them
      // like the cron does (transient), so the admin panel shows amber instead of
      // red for Cloudflare-protected aggregators such as ka.indgovtjobs.net.
      if (r.status === 403 || r.status === 429) {
        throw new Error(`transient:http-${r.status}; throttled; retried; stopped`);
      }
      // Retry transient upstream failures with bounded exponential backoff.
      if (r.status >= 500 && r.status <= 599) {
        if (attempt === maxAttempts) throw new Error(`HTTP ${r.status}`);
        await sleep(2000 * (2 ** (attempt - 1)));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      return { status: r.status, text, etag, lastModified, contentType: ct };
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/transient:http-403|transient:http-429/.test(msg) || attempt === maxAttempts) throw err;
      await sleep(2000 * (2 ** (attempt - 1)));
    }
  }
  throw new Error(`Fetch failed: ${url}`);
}
async function robotsAllowed(url) {
  const u = new URL(url); const host = u.origin;
  if (robotsCache.has(host)) return robotsCache.get(host);
  try {
    const r = await fetchText(`${host}/robots.txt`, { Accept: 'text/plain,*/*;q=0.1' });
    // robots.txt missing (404) or fetch error => allow access (conservative default).
    // Many government sites don't publish robots.txt at all.
    if (r.status === 404) { robotsCache.set(host, true); return true; }
    const lines = r.text.split(/\r?\n/); let applies = false; let allowed = true;
    for (const line of lines) {
      const [k, ...rest] = line.split(':'); if (!k) continue;
      const key = k.trim().toLowerCase(); const val = rest.join(':').trim();
      if (key === 'user-agent') applies = val === '*' || /civilcareer/i.test(val);
      if (applies && key === 'disallow' && val && u.pathname.startsWith(val)) allowed = false;
    }
    robotsCache.set(host, allowed); return allowed;
  } catch (_) {
    // Network error / DNS failure / timeout => assume allowed (don't block a source).
    robotsCache.set(host, true); return true;
  }
}
async function supa(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } });
}
async function ensureSources() {
  const r = await supa('govt_sources?select=id,url');
  const existing = r.ok ? await r.json() : [];
  const byUrl = new Map(existing.map(x => [x.url, x.id]));
  const ids = new Map();
  for (const s of config.sources) {
    const payload = { ...s, enabled: Boolean(s.enabled) };
    delete payload.id;
    const up = await supa('govt_sources?on_conflict=url', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(payload) });
    if (up.ok) { const rows = await up.json(); if (rows[0]) ids.set(s.url, rows[0].id); }
    else if (byUrl.has(s.url)) ids.set(s.url, byUrl.get(s.url));
  }
  return ids;
}
async function updateSource(id, patch) {
  if (!id) return;
  await supa(`govt_sources?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
async function leadExists(hash) {
  const r = await supa(`govt_job_leads?url_hash=eq.${encodeURIComponent(hash)}&select=id&limit=1`);
  return r.ok && (await r.json()).length > 0;
}
async function createLead(sourceId, candidate, orgHint) {
  const urlHash = sha(candidate.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase());
  if (await leadExists(urlHash)) return null;
  const r = await supa('govt_job_leads', { method: 'POST', body: JSON.stringify({ source_id: sourceId, source_url: candidate.url, title: clean(candidate.title).slice(0, 500), org_hint: clean(orgHint).slice(0, 200), url_hash: urlHash }) });
  if (!r.ok) return null;
  const rows = await r.json(); return rows[0] || null;
}
/* Classify the update type for the AI Inbox (spec §4). Title/URL signals
   decide: results, admit cards, date extensions and corrections are updates
   about EXISTING notifications, everything else is a new lead. */
function detectInboxKind(title, url) {
  const t = `${title} ${url}`;
  if (/\b(result|results|final result|selected candidates|recommendation)\b/i.test(t)) return 'result';
  if (/\b(admit card|hall ticket|call letter|e[- ]?admit)\b/i.test(t)) return 'admit_card';
  if (/\b(extend\w*|re-?open\w*|last date extended)\b/i.test(t)) return 'closing_date_changed';
  if (/\b(corrigendum|addendum|amendment|revised|correction)\b/i.test(t)) return 'updated';
  if (/\b(apply online|online application|notification(?: out)?|advertisement(?: out)?|recruitment|vacancy|vacanc\w+)\b/i.test(t)) return 'new';
  return 'other_update';
}

/* Vacancies (and a few other contested fields) often differ between the
   portal text and the official notification. Per spec §11 conflicting
   values are STORED as open conflicts for human review — never silently
   resolved. Official-source values are marked as the reference. */
async function recordConflictIfAny(stagingId, fieldName, newValue, existingPublished, officialVal) {
  try {
    if (officialVal != null && existingPublished != null && String(officialVal) !== String(existingPublished)) {
      await supa('govt_conflicts', { method: 'POST', body: JSON.stringify({
        recruitment_id: existingPublished.id || null,
        staging_id: stagingId || null,
        field_name: fieldName,
        values: [
          { value: String(officialVal), source_type: 'official', confidence: 1 },
          { value: String(existingPublished), source_type: 'published_record', confidence: 0.9 },
        ],
        status: 'open',
      }) });
      return true;
    }
  } catch (e) { console.error('conflict record failed:', e.message); }
  return false;
}

/* Field-level provenance (spec §10): where each extracted fact came from. */
async function recordProvenance(stagingId, source, candidate, fields) {
  const rows = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && String(v).length)
    .map(([field_name, field_value]) => ({
      recruitment_id: stagingId,
      field_name,
      field_value: String(field_value).slice(0, 400),
      source_id: (source && source.id) || null,
      source_url: candidate.url,
      source_document_url: /\.pdf(?:$|[?#])/i.test(candidate.url) ? candidate.url : null,
      extracted_by: 'rules',
      confidence: 0.7,
      verified: source.type === 'official',
      verified_at: source.type === 'official' ? new Date().toISOString() : null,
    }));
  if (rows.length) {
    const r = await supa('govt_field_provenance', { method: 'POST', body: JSON.stringify(rows) });
    if (!r.ok) console.error('provenance insert failed:', (await r.text()).slice(0, 200));
  }
}

async function stageLead(source, sourceId, lead, candidate, pageText) {
  /* A structured candidate comes from a per-site aggregator adapter and already
     carries the posting's own words: post name, qualification, and the section the
     site filed it under. That is the evidence the classifier needs. Handing it the
     whole LISTING page instead is what made every civil post on those pages look
     like noise — one job's qualification cannot be told apart from the next one's. */
  const scoped = candidate.structured === true;
  /* pageText is the DETAIL page when the adapter could fetch one, and '' when it
     could not — the listing page must never be mixed back in, which is the bug
     this whole path exists to avoid. */
  const own = scoped
    ? [candidate.postName, candidate.qualification, candidate.excerpt, (candidate.qualification ? '' : pageText)].filter(Boolean).join('\n')
    : '';
  const text = clean(`${candidate.title}\n${scoped ? own : pageText}`).slice(0, 12000);
  const deadline = extractDeadline(clean(`${candidate.deadlineText || ''}\n${text}`));
  if (deadline.date && deadline.date < new Date().toISOString().slice(0, 10)) return { skipped: 'expired' };
  const post = scoped
    ? {
      post_name: candidate.postName || candidate.title,
      discipline: candidate.discipline || candidate.section || null,
      qualification: candidate.qualification || extractQualification(text) || null,
      civil_eligible: candidate.civilEligible === true || undefined,
    }
    : { post_name: candidate.title, discipline: /civil/i.test(text) ? 'Civil' : null, qualification: extractQualification(text) };
  const orgHint = candidate.org || source.org;
  const classified = classifyNotificationDetailed([post], {
    title: candidate.title,
    description: text,
    organization: scoped ? orgHint : source.org,
    org_hint: orgHint,
  });
  if (classified.civil_status === 'not_civil' && classified.civil_discipline === 'not_civil') return { skipped: 'not_civil' };
  const top = classified.posts[0];
  const officialNotice = (candidate.officialNotice && officialUrl(candidate.officialNotice)) ? candidate.officialNotice
    : officialUrl(candidate.url) ? candidate.url
      : (officialUrl(source.url) ? source.url : null);
  /* Spec §8: a discovery portal URL is a lead, never the official link. */
  if (source.type === 'official' && !officialUrl(candidate.url)) return { skipped: 'not_official' };
  /* Carries exactly what the aggregator's own row said — qualification, posts,
     last date, advt number, section, and why it qualified — so the reviewer (and the
     publish job, which reads p.qualification) sees the evidence rather than an empty
     card. `officialNotice` is only ever a URL the publish gate accepts; when the row
     has none the field is left empty for the reviewer to fill from the queue. */
  const payload = buildPayload({
    source,
    record: {
      ...candidate,
      org: parseOrg(text, orgHint),
      qualification: post.qualification || candidate.qualification || '',
      vacancies: scoped ? candidate.vacancies : '',
      advtNo: candidate.advtNo || parseNotificationNo(text),
    },
    select: { evidence: scoped ? candidate.evidence : null, eligible: candidate.civilEligible },
    verdict: classified,
    officialNotice,
    detailText: text,
    deadline,
  });
  const dedupeKey = sha([norm(payload.organization), norm(payload.notification_no || payload.title), norm(payload.deadline.date || payload.deadline.text)].join('|'));
  const check = await supa(`govt_job_staging?dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id,linked_govt_job_id,status,payload&limit=1`);
  const dupes = check.ok ? await check.json() : [];
  if (dupes.length) {
    /* A human already decided this row: rejected means rejected, and an approved row
       must not be staged again as pending. */
    if (reviewedAlready(dupes[0])) return { skipped: 'already_reviewed' };
    /* Everything below writes a fresh payload over the row (upsert on dedupe_key), so
       carry the notice a reviewer pasted across it — otherwise attaching one is undone
       by the next two-hourly crawl. */
    keepReviewedFields(payload, dupes[0]);
    /* Same notification seen again → if its fields changed (e.g. extended
       date), record an UPDATED inbox item instead of dropping it silently. */
    const kind = detectInboxKind(candidate.title, candidate.url);
    if (kind !== 'new' && kind !== 'other_update') {
      const upd = await supa('govt_job_staging', { method: 'POST', body: JSON.stringify({
        lead_id: lead.id, status: 'pending', inbox_kind: kind,
        civil_status: classified.civil_status, tier: top.tier, relevance_score: top.score,
        confidence: top.outcome === 'civil' ? 0.9 : 0.55, extraction_method: 'rules',
        duplicate_hash: dedupeKey, linked_govt_job_id: dupes[0].linked_govt_job_id || null,
        match_reasons: top.reasons, payload,
        updated_fields: deadline.date ? { apply_end: deadline.date } : {},
      }) });
      const updRow = upd.ok ? (await upd.json())[0] : null;
      /* Spec §11: when an update claims a different value for a field on the
         PUBLISHED record, store an open conflict instead of silently picking.
         Only an official-source claim acts as the authoritative reference; a
         discovery portal's claim goes to the human with no official weight. */
      const linkedId = dupes[0].linked_govt_job_id || null;
      if (linkedId && deadline.date) {
        try {
          const pr = await supa(`govt_jobs?id=eq.${encodeURIComponent(linkedId)}&select=id,apply_end&limit=1`);
          const pub = pr.ok ? (await pr.json())[0] : null;
          if (pub) {
            await recordConflictIfAny(
              (updRow && updRow.id) || null,
              'apply_end',
              deadline.date,
              pub.apply_end || null,
              source.type === 'official' ? deadline.date : null
            );
          }
        } catch (_) { /* conflict recording must never fail the staging run */ }
      }
      await supa(`govt_job_leads?id=eq.${encodeURIComponent(lead.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'processed' }) });
      return { staged: true, status: 'pending', update: true };
    }
    return { skipped: 'duplicate' };
  }
  const inboxKind = detectInboxKind(candidate.title, candidate.url);
  const status = classified.civil_status === 'discipline_unknown' ? 'needs_info' : 'pending';
  const r = await supa('govt_job_staging', { method: 'POST', body: JSON.stringify({
    lead_id: lead.id, status, inbox_kind: inboxKind, civil_status: classified.civil_status,
    tier: top.tier, relevance_score: top.score,
    confidence: top.outcome === 'civil' ? 0.9 : 0.55, extraction_method: 'rules', dedupe_key: dedupeKey,
    duplicate_hash: dedupeKey,
    match_reasons: top.reasons,
    payload,
    source_evidence: [{ url: candidate.url, source_type: source.type, org: source.org, at: new Date().toISOString(), official: source.type === 'official' }],
  }) });
  if (!r.ok) return { skipped: 'db_error', error: await r.text() };
  const stagedRow = (await r.json())[0];
  await recordProvenance(stagedRow && stagedRow.id, source, candidate, {
    title: payload.title, notification_no: payload.notification_no,
    deadline: deadline.date || deadline.text || null,
    qualification: post.qualification,
  });
  await supa(`govt_job_leads?id=eq.${encodeURIComponent(lead.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'processed' }) });
  return { staged: true, status };
}
function extractQualification(text) {
  const m = String(text || '').match(/\b(?:B\.?E\.?|B\.?Tech|Diploma|ITI|M\.?E\.?|M\.?Tech)\b[^.]{0,120}/i);
  return m ? clean(m[0]).slice(0, 300) : null;
}
async function pdfText(url) {
  const tmp = `/tmp/cc-${sha(url).slice(0, 16)}.pdf`;
  try {
    await pace(url);
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*;q=0.5' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(tmp, buf);
    const { stdout } = await execFileAsync('pdftotext', ['-layout', tmp, '-'], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
    return clean(stdout);
  } catch (_) { return ''; }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

/* ── aggregator feeds ─────────────────────────────────────────────────────
   The five engineering aggregators do not publish a feed: they publish a table
   per discipline or a card per posting, with anchors that only ever say "Apply
   Now" / "View / Apply" / "Detail". `lib/govt-aggregators` reads each site's own
   structure and returns one record per posting, carrying the qualification and
   section the site itself used. Each record is then judged on its own words —
   the whole-page text is never the evidence — and only the survivors cost a
   network fetch, used to attach the official notification link the review gate
   requires before anything can be published. */
async function collectFromAdapter(source, sourceId, adapter, listingText, result) {
  let records = adapter.extract(listingText, source.url);
  if (typeof adapter.nextPage === 'function') {
    const next = adapter.nextPage(listingText, source.url);
    if (next && (await robotsAllowed(next))) {
      try { records = records.concat(adapter.extract((await fetchText(next)).text, source.url)); }
      catch (_) { /* a missing second page must never fail the whole source */ }
    }
  }
  const seen = new Set();
  records = records.filter(r => r.url && !seen.has(r.url) && (seen.add(r.url), true));
  result.records = records.length;

  const kept = [];
  for (const r of records) {
    const select = selectCivil(r);
    if (!select.keep) { result.skipped[select.reason] = (result.skipped[select.reason] || 0) + 1; continue; }
    /* Same classifier the staging writer uses, run locally first, so a posting that
       cannot be civil never creates a lead row at all. */
    const verdict = classifyRecord(r, select);
    if (verdict.civil_status === 'not_civil' && verdict.posts[0].level === 'not_civil') {
      result.skipped.not_civil = (result.skipped.not_civil || 0) + 1;
      continue;
    }
    kept.push({ r, select });
  }
  result.found = kept.length;

  /* The detail budget is smaller than a feed's output, so starting at index 0 every run
     left everything past MAX_DETAIL_FETCHES without an official notice for ever. The
     window rotates with the hour: over a day's crawls every row gets read. */
  const rotate = kept.length > MAX_DETAIL_FETCHES
    ? Math.floor(Date.now() / 3600000) % kept.length
    : 0;
  const ordered = rotate ? kept.slice(rotate).concat(kept.slice(0, rotate)) : kept;

  for (const { r, select } of ordered) {
    const lead = await createLead(sourceId, { title: r.title, url: r.url }, r.org || source.org);
    if (!lead) { result.skipped.duplicate = (result.skipped.duplicate || 0) + 1; continue; }
    let detail = '';
    let officialNotice = '';
    if (result.detailFetches < MAX_DETAIL_FETCHES) {
      result.detailFetches += 1;
      try {
        if (!(await robotsAllowed(r.url))) throw new Error('robots.txt disallows candidate');
        if (/\.pdf(?:$|[?#])/i.test(r.url)) detail = await pdfText(r.url);
        else { const d = await fetchText(r.url); detail = d.text; }
        officialNotice = officialNoticeLinks(detail, r.url, officialUrl)[0] || '';
      } catch (e) {
        result.errors += 1;
        if (!result.detailError) result.detailError = String(e.message || e).slice(0, 120);
      }
    }
    const staged = await stageLead(
      source, sourceId, lead,
      { ...r, structured: true, civilEligible: Boolean(select.eligible), officialNotice },
      detail
    );
    if (staged.staged) {
      result.staged += 1;
      /* Only a posting that was not already in the queue is news. A re-crawl that
         sees the same row, or records a change to it, stays quiet. */
      if (!staged.update) {
        (result.newCivil = result.newCivil || []).push({
          title: r.title,
          organization: r.org || source.org,
          qualification: r.qualification,
          deadline: r.deadlineText,
          source: `${source.name} — ${r.url}`,
        });
      }
    } else result.skipped[staged.skipped || 'unknown'] = (result.skipped[staged.skipped || 'unknown'] || 0) + 1;
  }
}

async function runSource(source, sourceId) {
  const result = { source: source.name, found: 0, staged: 0, skipped: {}, error: null, errors: 0, detailFetches: 0, records: 0 };
  try {
    if (!(await robotsAllowed(source.url))) { result.error = 'robots.txt disallows this source'; await updateSource(sourceId, { robots_ok: false, last_status: 'robots_blocked', last_run_at: new Date().toISOString(), last_error: result.error }); return result; }
    const metaR = await supa(`govt_sources?id=eq.${encodeURIComponent(sourceId)}&select=etag,last_modified&limit=1`);
    const meta = metaR.ok ? (await metaR.json())[0] || {} : {};
    const headers = {}; if (meta.etag) headers['If-None-Match'] = meta.etag; if (meta.last_modified) headers['If-Modified-Since'] = meta.last_modified;
    const page = await fetchText(source.url, headers);
    if (page.notModified) { await updateSource(sourceId, { robots_ok: true, last_status: 'not_modified', last_run_at: new Date().toISOString() }); return result; }
    /* An aggregator feed publishes structured tables; read them and judge each
       posting on its own words before spending a fetch on it. Everything else
       (official govt/PSU sites) keeps the generic anchor harvester. */
    const adapter = adapterFor(source.url);
    if (adapter) {
      await collectFromAdapter(source, sourceId, adapter, page.text, result);
      await updateSource(sourceId, { robots_ok: true, last_status: `ok; adapter=${adapter.id}; candidates=${result.found}; staged=${result.staged}; errors=${result.errors}`, last_run_at: new Date().toISOString(), etag: page.etag || null, last_modified: page.lastModified || null, last_error: null, items_found: result.found, items_staged: result.staged });
      return result;
    }
    let candidates = source.kind === 'rss' ? extractRss(page.text, source.url) : extractLinks(page.text, source.url);
    if (!candidates.length) candidates = [{ title: source.name, url: source.url }];
    candidates = candidates
      .map(x => ({ ...x, title: candidateTitle(x.title, x.url) }))
      .filter(x => looksLikeCandidate(x.title, x.url)).slice(0, MAX_CANDIDATES);
    result.found = candidates.length;
    for (const c of candidates) {
      if (source.type === 'official' && !officialUrl(c.url)) continue;
      const lead = await createLead(sourceId, c, source.org);
      if (!lead) { result.skipped.duplicate = (result.skipped.duplicate || 0) + 1; continue; }
      let detail = '';
      try {
        if (!(await robotsAllowed(c.url))) throw new Error('robots.txt disallows candidate');
        if (/\.pdf(?:$|[?#])/i.test(c.url)) detail = await pdfText(c.url);
        else { const d = await fetchText(c.url); detail = d.text; }
      } catch (_) { detail = ''; }
      const staged = await stageLead(source, sourceId, lead, c, detail || page.text);
      if (staged.staged) {
        result.staged += 1;
        if (!staged.update) {
          (result.newCivil = result.newCivil || []).push({
            title: c.title,
            organization: source.org,
            source: `${source.name} — ${c.url}`,
          });
        }
      } else result.skipped[staged.skipped || 'unknown'] = (result.skipped[staged.skipped || 'unknown'] || 0) + 1;
    }
    await updateSource(sourceId, { robots_ok: true, last_status: 'ok', last_run_at: new Date().toISOString(), etag: page.etag || null, last_modified: page.lastModified || null, last_error: null, items_found: result.found, items_staged: result.staged });
  } catch (e) {
    result.error = e.message || String(e);
    const msg = result.error;
    const throttled = /^transient:http-(403|429)/.test(msg);
    await updateSource(sourceId, {
      last_status: throttled ? msg : 'error',
      last_run_at: new Date().toISOString(),
      last_error: throttled ? null : result.error,
    });
  }
  return result;
}

async function main() {
  const ids = await ensureSources();
  const enabledSources = config.sources.filter(s => s.enabled);
  const sources = enabledSources.slice(0, MAX_SOURCES);
  /* Truncation used to be silent: enabling a source past the cap meant it never
     ran and never errored, so the panel showed a stale "not run yet" forever and
     the source looked configured. Name whatever gets dropped instead. */
  if (enabledSources.length > sources.length) {
    console.error(`WARN: ${enabledSources.length} sources are enabled but GOVT_MAX_SOURCES=${MAX_SOURCES}; not crawled: `
      + enabledSources.slice(MAX_SOURCES).map(s => s.name).join(', '));
  }
  const reports = [];
  for (const source of sources) {
    const id = ids.get(source.url);
    if (!id) { reports.push({ source: source.name, error: 'source row unavailable' }); continue; }
    reports.push(await runSource(source, id));
  }
  const totals = reports.reduce((a, r) => { a.found += r.found || 0; a.staged += r.staged || 0; if (r.error) a.errors += 1; return a; }, { found: 0, staged: 0, errors: 0 });
  /* One digest for the whole run, not one per source. Best effort: a failed
     notification must never fail the crawl. */
  const newCivil = reports.flatMap(r => r.newCivil || []);
  const alert = await sendCivilDigest(newCivil, { siteUrl: SITE });
  if (alert.sent) console.log(`alert: notified owner about ${newCivil.length} new civil posting(s)`);
  else if (alert.error) console.error(`alert: not sent (${alert.error})`);
  else console.log(`alert: skipped (${alert.skipped})`);
  console.log(JSON.stringify({ ok: totals.errors === 0, totals, new_civil: newCivil.length, alert, reports }, null, 2));
  if (totals.errors === reports.length && reports.length) process.exitCode = 1;
}

main().catch(e => { console.error(e.stack || e); process.exit(1); });
