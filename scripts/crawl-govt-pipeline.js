#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { classifyPost, classifyNotification, classifyNotificationDetailed } = require('../lib/civil-classifier');
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
      // Explicitly stop on access/rate-limit responses. Never bypass them.
      if (r.status === 403 || r.status === 429) throw new Error(`HTTP ${r.status} (crawl stopped for this source)`);
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
      if (/HTTP 403|HTTP 429/.test(msg) || attempt === maxAttempts) throw err;
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
  const text = clean(`${candidate.title}\n${pageText}`).slice(0, 12000);
  const deadline = extractDeadline(text);
  if (deadline.date && deadline.date < new Date().toISOString().slice(0, 10)) return { skipped: 'expired' };
  const post = { post_name: candidate.title, discipline: /civil/i.test(text) ? 'Civil' : null, qualification: extractQualification(text) };
  const classified = classifyNotificationDetailed([post], { title: candidate.title, description: text, organization: source.org, org_hint: source.org });
  if (classified.civil_status === 'not_civil' && classified.civil_discipline === 'not_civil') return { skipped: 'not_civil' };
  const top = classified.posts[0];
  const officialNotice = officialUrl(candidate.url) ? candidate.url : (officialUrl(source.url) ? source.url : null);
  /* Spec §8: a discovery portal URL is a lead, never the official link. */
  if (source.type === 'official' && !officialUrl(candidate.url)) return { skipped: 'not_official' };
  const payload = {
    title: clean(candidate.title).slice(0, 500),
    organization: parseOrg(text, source.org),
    organization_hint: source.org,
    source_type: source.type,
    source_url: candidate.url,
    official_notice_url: officialNotice || candidate.url || '',
    official_site_url: (officialNotice || candidate.url) ? new URL(officialNotice || candidate.url).origin : '',
    official_notification_url: candidate.url,
    notification_no: parseNotificationNo(text),
    deadline,
    post_candidates: classified.posts.map(x => ({ ...x.post, outcome: x.outcome, tier: x.tier, score: x.score, level: x.level, specialization: x.specialization })),
    civil_discipline: classified.civil_discipline,
    civil_specialization: classified.specialization,
    excerpt: text.slice(0, 3500),
    discovered_at: new Date().toISOString()
  };
  const dedupeKey = sha([norm(payload.organization), norm(payload.notification_no || payload.title), norm(payload.deadline.date || payload.deadline.text)].join('|'));
  const check = await supa(`govt_job_staging?dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id,linked_govt_job_id&limit=1`);
  const dupes = check.ok ? await check.json() : [];
  if (dupes.length) {
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

async function runSource(source, sourceId) {
  const result = { source: source.name, found: 0, staged: 0, skipped: {}, error: null };
  try {
    if (!(await robotsAllowed(source.url))) { result.error = 'robots.txt disallows this source'; await updateSource(sourceId, { robots_ok: false, last_status: 'robots_blocked', last_run_at: new Date().toISOString(), last_error: result.error }); return result; }
    const metaR = await supa(`govt_sources?id=eq.${encodeURIComponent(sourceId)}&select=etag,last_modified&limit=1`);
    const meta = metaR.ok ? (await metaR.json())[0] || {} : {};
    const headers = {}; if (meta.etag) headers['If-None-Match'] = meta.etag; if (meta.last_modified) headers['If-Modified-Since'] = meta.last_modified;
    const page = await fetchText(source.url, headers);
    if (page.notModified) { await updateSource(sourceId, { robots_ok: true, last_status: 'not_modified', last_run_at: new Date().toISOString() }); return result; }
    let candidates = source.kind === 'rss' ? extractRss(page.text, source.url) : extractLinks(page.text, source.url);
    if (!candidates.length) candidates = [{ title: source.name, url: source.url }];
    candidates = candidates.filter(x => looksLikeCandidate(x.title, x.url)).slice(0, MAX_CANDIDATES);
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
      if (staged.staged) result.staged += 1;
      else result.skipped[staged.skipped || 'unknown'] = (result.skipped[staged.skipped || 'unknown'] || 0) + 1;
    }
    await updateSource(sourceId, { robots_ok: true, last_status: 'ok', last_run_at: new Date().toISOString(), etag: page.etag || null, last_modified: page.lastModified || null, last_error: null, items_found: result.found, items_staged: result.staged });
  } catch (e) {
    result.error = e.message || String(e);
    await updateSource(sourceId, { last_status: 'error', last_run_at: new Date().toISOString(), last_error: result.error });
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
  console.log(JSON.stringify({ ok: totals.errors === 0, totals, reports }, null, 2));
  if (totals.errors === reports.length && reports.length) process.exitCode = 1;
}

main().catch(e => { console.error(e.stack || e); process.exit(1); });
