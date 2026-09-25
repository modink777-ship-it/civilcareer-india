#!/usr/bin/env node
/**
 * CivilCareer — scheduled job-discovery trigger
 *
 * This script no longer scrapes anything itself. Discovery has exactly ONE
 * implementation: the pipeline behind `GET /api/jobs?discovery=cron` in
 * api/jobs.js, which pulls from LinkedIn/Naukri/Indeed-class sources via the
 * news + configured providers, AND from the career pages of the top Indian
 * construction companies in lib/company-careers.js, then applies the
 * civil-only + India-only + freshness gates and stores survivors as
 * UNPUBLISHED drafts in the admin Discovery tab.
 *
 * Keeping the pipeline server-side means:
 *   • the same gates decide admission whether a run is scheduled or manual;
 *   • a fix to the gates takes effect immediately, with no redeploy of actions;
 *   • the free-AI failover chain (lib/ai-models.js) is used for enrichment;
 *   • this script needs no Supabase service key — only a trigger credential.
 *
 * SCHEDULE: .github/workflows/job-scraper.yml runs this every 4 hours
 * (`0 *&#47;4 * * *`). Vercel's own cron is kept as a once-a-day safety net,
 * because Vercel restricts sub-daily schedules to paid plans.
 *
 * REQUIRED ENVIRONMENT
 *   SITE_URL      deployment origin, e.g. https://civilcareer-india-two.vercel.app
 *   CRON_SECRET   preferred trigger credential (same value as in Vercel)
 *   OWNER_KEY     accepted alternative to CRON_SECRET
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID   optional 4-hourly summary
 */

'use strict';

const SITE_URL = String(process.env.SITE_URL || process.env.CIVILCAREER_SITE_URL || '').trim().replace(/\/+$/, '');
const CRON_SECRET = String(process.env.CRON_SECRET || '').trim();
const OWNER_KEY = String(process.env.OWNER_KEY || '').trim();
const TG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();

const REQUEST_TIMEOUT_MS = 240000;

async function notifyAdmin(lines) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: lines.join('\n'), parse_mode: 'HTML' }),
    });
  } catch (_) {
    /* a failed notification must never fail the run */
  }
}

function fmtCounts(stats) {
  const rows = [];
  for (const [key, st] of Object.entries(stats || {})) {
    if (!st) continue;
    const flag = st.ok === false ? '✗' : (st.items ? '•' : '·');
    rows.push(
      `${flag} <b>${key}</b> — ${st.items ?? 0} found, ${st.accepted ?? 0} accepted` +
      (st.rejectedCivil ? `, ${st.rejectedCivil} non-civil` : '') +
      (st.rejectedIndia ? `, ${st.rejectedIndia} non-India` : '') +
      (st.rejectedAge || st.rejectedFuture ? `, ${(st.rejectedAge || 0) + (st.rejectedFuture || 0)} too old` : '') +
      (st.rejectedDupe ? `, ${st.rejectedDupe} duplicate` : '') +
      (st.configured === false ? ' (not configured)' : '') +
      (st.error ? ` — ${String(st.error).slice(0, 120)}` : '')
    );
  }
  return rows;
}

async function main() {
  if (!SITE_URL) {
    console.error('Missing SITE_URL. Set it to your deployment origin, e.g. https://civilcareer-india-two.vercel.app');
    process.exit(1);
  }
  if (!CRON_SECRET && !OWNER_KEY) {
    console.error('Missing CRON_SECRET (preferred) or OWNER_KEY. Scheduled discovery is authenticated.');
    process.exit(1);
  }

  const endpoint = `${SITE_URL}/api/jobs?discovery=cron`;
  const headers = { 'User-Agent': 'CivilCareer scheduled discovery/1.0' };
  if (CRON_SECRET) headers.Authorization = `Bearer ${CRON_SECRET}`;
  if (OWNER_KEY) headers['x-owner-key'] = OWNER_KEY;

  console.log(`Running discovery: ${endpoint}`);

  let res;
  try {
    res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    console.error(`Discovery request failed: ${err && err.message}`);
    process.exit(1);
  }

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* non-JSON error page */ }

  if (!res.ok) {
    console.error(`Discovery run failed: HTTP ${res.status}`);
    console.error(text.slice(0, 1200));
    process.exit(1);
  }

  const count = (data && data.count) || 0;
  const stats = (data && data.sourceStats) || {};
  const careers = stats.company_careers || null;
  const ai = (data && data.aiEnrichment) || null;

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(`  ${count} new draft${count === 1 ? '' : 's'} saved for admin review`);
  console.log(`  fresh (≤24h): ${data?.fresh24hCount ?? 0}   up to 30 days: ${data?.backup30dCount ?? 0}   no date: ${data?.unknownDateCount ?? 0}`);
  console.log(`  already on the site: ${data?.skippedExisting ?? 0}   older than 30 days: ${data?.olderCandidates ?? 0}`);
  if (careers) {
    console.log(`  company career pages: ${careers.companiesChecked}/${careers.companiesTotal} checked, ` +
      `${careers.companiesWithVacancies} with civil vacancies, ${careers.items} candidates` +
      (careers.error ? ` — ${careers.error}` : ''));
    for (const r of (careers.reports || []).filter(x => x.items).slice(0, 12)) {
      console.log(`     • ${r.company} → ${r.items} (${r.viaJsonLd} structured, ${r.viaLinks} links)`);
    }
  }
  if (ai) {
    console.log(`  AI enrichment: ${ai.enriched}/${ai.attempted} filled${ai.provider ? ` via ${ai.provider}` : ''}` +
      (ai.skipped ? ` (skipped: ${ai.skipped})` : '') + (ai.failed ? `, ${ai.failed} failed` : ''));
  }
  console.log('────────────────────────────────────────────');
  for (const row of fmtCounts(stats)) console.log('  ' + row.replace(/<\/?b>/g, ''));
  console.log('════════════════════════════════════════════');

  // Only ping the owner when there is something to review.
  if (count > 0) {
    await notifyAdmin([
      `🏗️ <b>${count} civil job draft${count === 1 ? '' : 's'}</b> ready to review`,
      `Fresh (≤24h): ${data?.fresh24hCount ?? 0}   Up to 30 days: ${data?.backup30dCount ?? 0}`,
      ...fmtCounts(stats).slice(0, 12),
      '',
      `Review: ${SITE_URL}/admin → Discovery`,
    ]);
  }
}

main().catch(err => {
  console.error('Fatal error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
