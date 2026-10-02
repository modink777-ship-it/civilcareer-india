#!/usr/bin/env node
'use strict';

const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

function json(value) {
  return JSON.stringify(value);
}

async function db(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

async function main() {
  if (!SUPA || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const now = new Date().toISOString();
  const r = await db(
    `govt_jobs?status=eq.active&apply_end=not.is.null&apply_end=lt.${encodeURIComponent(now.slice(0, 10))}&select=id,slug,apply_end,status`,
    { method: 'GET' }
  );
  if (!r.ok) throw new Error(`Government expiry lookup failed (HTTP ${r.status})`);

  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(json({ closed: 0, ids: [] }));
    return;
  }

  const ids = rows.map(x => x.id).filter(Boolean);
  const q = ids.map(id => encodeURIComponent(id)).join(',');
  const patch = await db(
    `govt_jobs?id=in.(${q})&status=eq.active`,
    {
      method: 'PATCH',
      body: json({ status: 'closed', change_log: rows.map(row => ({
        at: now,
        action: 'auto_closed_expired',
        apply_end: row.apply_end,
      })) })
    }
  );
  if (!patch.ok) throw new Error(`Government expiry update failed (HTTP ${patch.status})`);

  console.log(json({ closed: rows.length, ids }));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
