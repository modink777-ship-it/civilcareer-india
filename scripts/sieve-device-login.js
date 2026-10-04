#!/usr/bin/env node
/**
 * CivilCareer — Sieve device login.
 *
 * One-time interactive provisioning of SIEVE_API_KEY. The key is written
 * straight into the project's local secret store (`.env`, gitignored) and is
 * NEVER printed, logged or committed.
 *
 *   node scripts/sieve-device-login.js
 *
 * The user approves in their own browser; this script only displays the
 * verification URL + code and polls. It never opens a link, signs in or
 * approves on the user's behalf.
 *
 * After it finishes, set the same value in the deployment:
 *   Vercel → Project → Settings → Environment Variables → SIEVE_API_KEY
 * (or run `vercel env add SIEVE_API_KEY`). The value is not shown here.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sieve = require('../lib/sieve');

const CLIENT_NAME = process.env.SIEVE_CLIENT_NAME || 'CivilCareer';
const ENV_PATH = path.join(__dirname, '..', '.env');
const MAX_RESTARTS = 3;

function upsertEnv(name, value) {
  let text = '';
  try { text = fs.readFileSync(ENV_PATH, 'utf8'); } catch (_) { text = ''; }
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, line);
  else text = text.replace(/\s*$/, '\n') + line + '\n';
  fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
}

async function main() {
  if (typeof fetch !== 'function' || typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    console.error('This script needs Node 18+ (global fetch + AbortSignal.timeout).');
    process.exit(1);
  }

  for (let attempt = 1; attempt <= MAX_RESTARTS; attempt += 1) {
    const started = await sieve.startDeviceAuth(CLIENT_NAME, {});
    if (!started.ok) {
      console.error(`Could not start the device login (${started.kind || 'error'}): ${started.message || ''}`);
      process.exit(1);
    }

    console.log('');
    console.log('  Sieve device login');
    console.log('  ──────────────────');
    console.log(`  Tool name (self-reported): ${CLIENT_NAME}`);
    console.log(`  Open this link in your browser and sign in / sign up:`);
    console.log(`    ${started.verification_uri_complete || started.verification_uri}`);
    console.log(`  Confirm the code shown on the page matches:  ${started.user_code}`);
    console.log('');
    console.log('  Approve ONLY if YOU started this login. If you did not, close the page.');
    console.log('  The code expires in about 10 minutes and works once.');
    console.log('');
    console.log('  Waiting for approval…');

    const out = await sieve.pollDeviceToken(started.device_code, {
      intervalMs: started.interval,
      expiresInMs: started.expires_in,
      onTick: ({ polls }) => process.stdout.write(`\r  Still waiting (poll ${polls})…   `),
    });

    if (out.ok) {
      upsertEnv('SIEVE_API_KEY', out.apiKey);
      console.log('\n');
      console.log(`  Approved. Wrote SIEVE_API_KEY=${'*'.repeat(Math.max(8, String(out.apiKey).length))} to .env (not printed).`);
      console.log(`  Key name: ${out.keyName || '(unnamed)'}`);
      console.log('  Next: set the same value in Vercel → Settings → Environment Variables as SIEVE_API_KEY,');
      console.log('  then redeploy. The value is intentionally not shown here.');
      return;
    }

    if (out.state === 'expired' && attempt < MAX_RESTARTS) {
      console.log('\n  The code expired; starting a fresh one…');
      continue;
    }

    console.log('');
    console.error(`  Device login did not complete (${out.state || 'error'}): ${out.message || ''}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Device login failed:', (err && err.message) || err);
  process.exit(1);
});
