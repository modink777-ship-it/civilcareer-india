#!/usr/bin/env node
/**
 * Scheduled government discovery trigger.
 * Uses the same CRON_SECRET as Vercel and writes only unpublished drafts.
 */
'use strict';

const SITE_URL = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
const CRON_SECRET = String(process.env.CRON_SECRET || '').trim();

async function main() {
  if (!SITE_URL) throw new Error('Missing SITE_URL');
  if (!CRON_SECRET) throw new Error('Missing CRON_SECRET');
  const url = `${SITE_URL}/api/govt-discovery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(240000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Government discovery failed: HTTP ${res.status}`);
    console.error(text.slice(0, 1600));
    process.exit(1);
  }
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  console.log(`Government discovery completed: ${data?.totalNew ?? 0} new unpublished draft(s).`);
}

main().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
