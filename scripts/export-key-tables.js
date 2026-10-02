#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
const TABLES = [
  'jobs',
  'govt_jobs',
  'govt_job_posts',
  'exams',
  'exam_tracker',
  'subscribers',
  'whatsapp_subscribers',
  'exam_alert_subscribers',
  'social_suggestions',
  'social_publishes',
  'social_connections',
  'social_settings',
];
const OUT = process.env.BACKUP_OUTPUT || path.join(process.cwd(), 'backup-output');

async function fetchTable(table) {
  const response = await fetch(`${SUPA}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  if (!SUPA || !KEY) throw new Error('SUPABASE_URL and server-side Supabase key are required.');
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {
    exported_at: new Date().toISOString(),
    tables: {},
    note: 'Contains production data. Store only as a private workflow artifact; never commit or publish.',
  };

  for (const table of TABLES) {
    const rows = await fetchTable(table);
    fs.writeFileSync(path.join(OUT, `${table}.json`), JSON.stringify(rows));
    manifest.tables[table] = { rows: Array.isArray(rows) ? rows.length : 0 };
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ ok: true, output: OUT, tables: manifest.tables }));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
