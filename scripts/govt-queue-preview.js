#!/usr/bin/env node
'use strict';

/**
 * CivilCareer — what would the next crawl actually do?
 *
 * The six aggregator feeds are read, classified and keyed exactly the way the writers
 * key them, and each posting is reported as:
 *
 *     NEW             not in the queue at all — this sweep would stage it
 *     QUEUED          already queued and still unreviewed — the sweep refreshes it
 *     NEEDS INFO      queued, parked for a human decision
 *     APPROVED        already published — the sweep now leaves it alone
 *     REJECTED        a human said no — the sweep now leaves it alone
 *
 * Reachable facts only:
 *   * the dedupe key is lib/govt-lead-payload.js's dedupeKey() — the same call the
 *     staging upsert uses, so "already queued" here means the same thing it means there;
 *   * with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set it also reads the queue and prints
 *     whether a real official notice link is already on record for each lead;
 *   * without credentials it still prints every feed's postings and their statuses as
 *     "unknown — no queue access", and says so, instead of guessing.
 *
 * Run: node scripts/govt-queue-preview.js [--json] [--feed=<host fragment>]
 * Costs nothing but time; writes nothing, anywhere.
 */

const fs = require('fs');
const path = require('path');

const { adapterFor, selectCivil, classifyRecord, officialNoticeLinks } = require('../lib/govt-aggregators');
const { dedupeKey, isOfficialHost } = require('../lib/govt-lead-payload');

const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const SITE = String(process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');
const UA = `CivilCareer-Preview/1.0 (+${SITE}/about)`;
const TIMEOUT_MS = Number(process.env.GOVT_FETCH_TIMEOUT_MS || 20000);

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const ONLY = (args.find((a) => a.startsWith('--feed=')) || '').split('=')[1] || '';

function rest(pathname, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${pathname}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.text() : '' };
}

/** The candidate shape the cron stages: same fields, so the same key comes out. */
function candidatesFor(source, html) {
  const adapter = adapterFor(source.url);
  if (!adapter) return [];

  const out = [];
  for (const record of adapter.extract(html, source.url)) {
    const select = selectCivil(record);
    if (!select.keep) continue;
    const verdict = classifyRecord(record, select);
    const top = verdict.posts[0] || {};
    if (verdict.civil_status === 'not_civil' && top.level === 'not_civil') continue;
    out.push({
      title: record.title.slice(0, 240),
      source_url: record.url,
      excerpt: [record.postName, record.qualification, record.section].filter(Boolean).join(' · ').slice(0, 500),
      org_hint: record.org || source.org || source.name,
      record,
      select,
      verdict,
      classification: {
        civil_status: verdict.civil_status,
        tier: top.tier || 'B',
        relevance_score: top.score || 60,
        confidence: top.outcome === 'civil' ? 0.9 : 0.6,
      },
    });
  }
  return out;
}

async function queueState(keys) {
  const map = new Map();
  if (!SUPA || !KEY || !keys.length) return { asked: false, map };
  const list = keys.map((k) => `"${k}"`).join(',');
  const r = await rest(`govt_job_staging?dedupe_key=in.(${encodeURIComponent(list)})&select=dedupe_key,status,payload`);
  if (!r.ok) return { asked: true, map, error: `HTTP ${r.status} ${(await r.text()).slice(0, 120)}` };
  for (const row of (await r.json()) || []) map.set(row.dedupe_key, row);
  return { asked: true, map };
}

/** One word for what the next sweep would do with this lead. */
function verdictFor(key, queue, asked) {
  if (!asked) return { state: 'unknown', notice: null };
  const row = queue.get(key);
  if (!row) return { state: 'NEW', notice: false };
  const notice = Boolean(row.payload && isOfficialHost(row.payload.official_notice_url));
  if (row.status === 'approved') return { state: 'APPROVED', notice };
  if (row.status === 'rejected') return { state: 'REJECTED', notice };
  if (row.status === 'needs_info') return { state: 'NEEDS INFO', notice };
  return { state: 'QUEUED', notice };
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'govt-sources.json'), 'utf8'));
  const sources = (config.sources || []).filter((s) => s.enabled !== false && (!ONLY || s.url.includes(ONLY)));

  const report = [];
  let totals = { feeds: 0, found: 0, NEW: 0, QUEUED: 0, 'NEEDS INFO': 0, APPROVED: 0, REJECTED: 0, unknown: 0, withNotice: 0 };

  for (const source of sources) {
    const fetched = await fetchText(source.url).catch((e) => ({ ok: false, status: String(e.message || e), body: '' }));
    const adapter = adapterFor(source.url);
    const candidates = fetched.ok && adapter ? candidatesFor(source, fetched.body) : [];

    /* The keys are computed for the whole feed first, so the queue is read in one query. */
    const keyed = candidates.map((c) => ({ candidate: c, key: dedupeKey(c, c.classification) }));
    const queue = await queueState(keyed.map((x) => x.key));

    const rows = keyed.map(({ candidate, key }) => {
      const v = verdictFor(key, queue.map, queue.asked);
      return {
        key,
        title: candidate.title,
        post: candidate.record.postName || '',
        qualification: candidate.record.qualification || '',
        section: candidate.record.section || '',
        evidence: candidate.select.evidence,
        official_notice_found: v.notice,
        next_sweep: v.state,
        url: candidate.source_url,
      };
    });

    totals.feeds += 1;
    totals.found += rows.length;
    for (const r of rows) {
      totals[r.next_sweep === 'unknown' ? 'unknown' : r.next_sweep] = (totals[r.next_sweep === 'unknown' ? 'unknown' : r.next_sweep] || 0) + 1;
      if (r.official_notice_found) totals.withNotice += 1;
    }

    report.push({
      feed: source.name,
      url: source.url,
      adapter: adapter ? adapter.id : null,
      fetched: fetched.ok,
      status: fetched.ok ? 200 : fetched.status,
      found: rows.length,
      queue_checked: queue.asked,
      queue_error: queue.error || null,
      rows,
    });
    if (!queue.asked) totals.unknown = totals.found;
  }

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify({ generated_at: new Date().toISOString(), queue_available: Boolean(SUPA && KEY), totals, report }, null, 1)}\n`);
    return;
  }

  console.log('Government queue preview — what the next sweep would stage\n');
  if (!SUPA || !KEY) {
    console.log('! SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, so the queue could not be read.');
    console.log('  Every lead below is listed as "unknown — no queue access". Nothing was written.\n');
  }

  for (const feed of report) {
    console.log(`── ${feed.feed}`);
    console.log(`   ${feed.fetched ? `fetched ${feed.found} civil-relevant posting(s)` : `FETCH FAILED: ${feed.status}`}${feed.adapter ? ` · adapter ${feed.adapter}` : ' · no adapter → the sweep would use the anchor harvester'}`);
    if (feed.queue_error) console.log(`   queue read failed: ${feed.queue_error}`);
    for (const r of feed.rows) {
      const notice = r.official_notice_found ? 'official notice on record' : 'no official notice yet';
      console.log(`   [${r.next_sweep.padEnd(10)}] ${r.title.slice(0, 78)}`);
      console.log(`                ${r.evidence ? `matched: ${r.evidence}` : ''}${r.qualification ? ` · ${r.qualification.slice(0, 60)}` : ''} · ${notice}`);
    }
    console.log('');
  }

  console.log('Summary (per lead):');
  console.log(`  ${totals.found} civil-relevant posting(s) across ${totals.feeds} feed(s)`);
  console.log(`  NEW ${totals.NEW} · QUEUED ${totals.QUEUED} · NEEDS INFO ${totals['NEEDS INFO']} · APPROVED ${totals.APPROVED} · REJECTED ${totals.REJECTED}${totals.unknown ? ` · unknown ${totals.unknown}` : ''}`);
  console.log(`  ${totals.withNotice} already have an official notice link on record`);
  console.log('\nNothing was written: this script only reads.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`queue preview failed: ${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = { verdictFor };
