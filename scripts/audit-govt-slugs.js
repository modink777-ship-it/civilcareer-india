'use strict';

/**
 * Government-jobs slug audit — crawl every published /government-jobs/job/
 * URL and report the ones that do not answer HTTP 200/301-style success.
 *
 * Two ways to get the list:
 *   1. Read the govt-jobs-slugs.csv downloaded from Admin → Government Jobs →
 *      Published → "Export slugs (CSV)" (the slug_export action's CSV).
 *   2. Or POST the admin govt-review API directly (needs ADMIN_KEY):
 *        node scripts/audit-govt-slugs.js --api https://site.vercel.app --key SECRET
 *
 * Usage:
 *   node scripts/audit-govt-slugs.js [govt-jobs-slugs.csv] [--site https://…] [--delay 150]
 *   node scripts/audit-govt-slugs.js --api https://site.vercel.app --key SECRET [--delay 150]
 *
 * Exit status: 0 when every URL answers, 1 when any URL is broken — safe to
 * wire into CI or a post-export checklist.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { file: null, site: null, key: null, delay: 150, timeout: 15000, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--site') out.site = argv[++i];
    else if (a === '--api') out.site = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--delay') out.delay = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--timeout') out.timeout = Math.max(1000, Number(argv[++i]) || 15000);
    else if (a === '--verbose') out.verbose = true;
    else if (a === '-h' || a === '--help') { out.help = true; }
    else if (!a.startsWith('--') && !out.file) out.file = a;
  }
  return out;
}

/* RFC-4180 single-line CSV reader: the slug_export CSV quotes every field,
   and titles can contain commas and doubled quotes. */
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length);
  if (!lines.length) return { header: [], rows: [] };
  const parseLine = (line) => {
    const fields = [];
    let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { fields.push(cur); cur = ''; }
      else cur += c;
    }
    fields.push(cur);
    return fields;
  };
  const header = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).map(f => {
    const o = {};
    header.forEach((h, idx) => { o[h] = f[idx] == null ? '' : f[idx]; });
    return o;
  });
  return { header, rows };
}

/* Fetch the slug list live from the govt-review API (admin-only). */
async function fetchFromApi(site, key, timeout) {
  const base = String(site || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('--api must be an https:// URL');
  if (!key) throw new Error('--key is required with --api');
  const r = await fetch(`${base}/api/govt-review?action=slug_export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ format: 'csv', limit: 5000 }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`slug_export failed: ${r.status} ${await r.text().catch(() => '')}`.slice(0, 200));
  return r.text();
}

async function checkUrl(url, timeout) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      /* A browser-like UA: some platforms answer bots differently, and this
         audit must measure what a real visitor would get. */
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CivilCareerSlugAudit/1.0)' },
      signal: AbortSignal.timeout(timeout),
    });
    return { url, status: r.status, ok: r.status >= 200 && r.status < 400 };
  } catch (e) {
    return { url, status: 0, ok: false, error: String((e && e.message) || e) };
  }
}

module.exports._internal = { parseCsv, checkUrl };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split(' */')[0]);
    return 0;
  }

  const csv = args.api
    ? await fetchFromApi(args.site, args.key, args.timeout)
    : (() => {
        const file = args.file || 'govt-jobs-slugs.csv';
        const p = path.resolve(file);
        if (!fs.existsSync(p)) {
          console.error(`CSV not found: ${p}\nExport it from Admin → Government Jobs → Published → "Export slugs (CSV)",\nor pass --api/--key to fetch the list live.`);
          process.exit(2);
        }
        return fs.readFileSync(p, 'utf8');
      })();

  const { header, rows } = parseCsv(csv);
  const urlCol = header.includes('public_url') ? 'public_url' : null;
  if (!urlCol) {
    console.error('CSV does not look like a slug_export result (no public_url column).');
    return 2;
  }
  const urls = rows.map(r => r[urlCol]).filter(Boolean).map(u => u.replace(/\/+$/, ''));
  const unique = [...new Set(urls)];
  if (!unique.length) { console.error('No URLs in the export — nothing published yet?'); return 0; }

  console.log(`Auditing ${unique.length} published URL(s)…`);
  const failed = [];
  let done = 0;
  for (const url of unique) {
    /* Bounded concurrency: 6 at a time keeps the sweep quick without hammering one box. */
    const res = await checkUrl(url, args.timeout);
    done++;
    if (!res.ok) failed.push(res);
    else if (args.verbose) console.log(`  ✓ ${res.status} ${url}`);
    console.error(`  [${done}/${unique.length}] ${res.ok ? 'ok' : 'FAIL ' + res.status} ${url}`);
    if (args.delay && done < unique.length) await new Promise(r => setTimeout(r, args.delay));
  }

  console.log('');
  if (failed.length) {
    console.log(`✗ ${failed.length}/${unique.length} URL(s) need attention:`);
    for (const f of failed) console.log(`  ${f.status || 'network-error'} ${f.url}${f.error ? ' — ' + f.error : ''}`);
    return 1;
  }
  console.log(`✓ All ${unique.length} published URL(s) answered successfully.`);
  return 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code || 0))
    .catch(e => { console.error('Audit failed:', e.message || e); process.exit(2); });
}
