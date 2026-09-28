#!/usr/bin/env node
/**
 * CivilCareer — one-off data repair: mislabeled sectors
 *
 *   node scripts/fix-mislabeled-sectors.js           # report only (default)
 *   node scripts/fix-mislabeled-sectors.js --apply   # write the correction
 *
 * Why this exists
 * ---------------
 * 36 of the 400 published rows are flagged sector = "Government" but came from
 * an adzuna.in scrape of a private employer (Aeroteck Manpower, Adani, Phoenix
 * Mills, Jeena Sikho Lifecare …). The public /api/jobs feed trusts that column,
 * so those ads appear under Government filters, and any future "government
 * only" feature inherits the bad data.
 *
 * /api/govt-jobs no longer trusts the flag, but the column itself is still
 * wrong, so this corrects the source of truth. Rows matching a job-board or
 * staffing signal are set to sector = "Private"; genuine government notices
 * (gov.in / nic.in / ncs.gov links, or the govt-discovery pipeline) are left
 * exactly as they are.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
 * in the environment. Never commit those values.
 */
'use strict';

const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
const APPLY = process.argv.includes('--apply');

/* Commercial signals — a real government notice never carries these. */
const AGGREGATOR_RE = /(adzuna|indeed|naukri|linkedin|shine\.com|timesjobs|monster\.com|foundit|apna\.co|hirist|instahyre|cutshort)/i;
const PRIVATE_RE = /\b(pvt|private limited|pvt\.? ltd|manpower|staffing|recruiters?|consultanc|consulting|infotech|softech)\b/i;
const GOV_DOMAIN_RE = /(\.gov\.in|\.nic\.in|gov\.in\/|nic\.in\/|ncs\.gov|employmentnews)/i;

function looksCommercial(row) {
  const url = [row.apply_url, row.application_url, row.source_url].filter(Boolean).join(' ');
  if (GOV_DOMAIN_RE.test(url)) return false;                       // official link wins
  if (/govt_discovery/i.test(String(row.ingestion_source || row.source || ''))) return false;
  const hay = `${url} ${row.source || ''} ${row.company || ''}`;
  return AGGREGATOR_RE.test(hay) || PRIVATE_RE.test(String(row.company || ''));
}

async function supa(path, opts = {}) {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(opts.headers || {}),
    },
  });
}

(async () => {
  if (!SUPA_URL || !SUPA_KEY) {
    console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
    process.exit(1);
  }

  const fields = 'id,role,company,sector,published,source,source_url,apply_url,application_url,ingestion_source';
  const r = await supa(
    `jobs?select=${encodeURIComponent(fields)}`
    + `&sector=in.(${encodeURIComponent('"Government","Public Sector"')})`
    + '&order=created_at.desc&limit=1000'
  );
  if (!r.ok) {
    console.error(`Query failed (${r.status}): ${String(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const rows = await r.json();
  const suspects = rows.filter(looksCommercial);

  console.log(`Scanned ${rows.length} row(s) flagged Government/Public Sector.`);
  console.log(`Mislabeled (commercial employer or job board): ${suspects.length}`);
  for (const s of suspects) {
    console.log(`  ${s.published ? 'published' : 'draft    '} [${s.sector}] ${String(s.company || '').slice(0, 40)} | ${String(s.role || '').slice(0, 50)}`);
  }

  if (!suspects.length) {
    console.log('Nothing to correct.');
    return;
  }

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to set these rows to sector = "Private".');
    return;
  }

  let changed = 0;
  for (const s of suspects) {
    const patch = await supa(`jobs?id=eq.${encodeURIComponent(s.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sector: 'Private' }),
    });
    if (patch.ok) changed += 1;
    else console.error(`  failed for ${s.id}: ${patch.status}`);
  }
  console.log(`\nCorrected ${changed} of ${suspects.length} row(s) to sector = "Private".`);
})().catch((e) => {
  console.error('Repair failed:', e && e.message);
  process.exit(1);
});
