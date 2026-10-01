/**
 * CivilCareer — Telegram Bot Webhook (Feature D)
 *
 * PUBLIC  POST /api/telegram/webhook
 *   Receives Telegram updates. Verified with the
 *   `X-Telegram-Bot-Api-Secret-Token` header when TELEGRAM_WEBHOOK_SECRET
 *   is configured (set the same value as secret_token in setWebhook).
 *
 * ADMIN   GET  /api/telegram/webhook            → getWebhookInfo
 *         POST /api/telegram/webhook            → { action: 'set-webhook' }
 *   The dispatcher's ADMIN_RULES elevate dashboard sessions; direct owner-key
 *   scripts keep working (hasValidOwnerKey in api/[[...path]].js).
 *
 * ONE-TIME USER SETUP (run in any browser or curl):
 *   https://api.telegram.org/bot<TOKEN>/setWebhook
 *     ?url=https://civilcareer-india-two.vercel.app/api/telegram/webhook
 *     &secret_token=<any long random string>
 *   …then put the SAME string into the Vercel env var TELEGRAM_WEBHOOK_SECRET.
 *   (The admin button below does this automatically.)
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (optional but recommended),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
 *
 * Tables: jobs, exam_tracker, salary_data, whatsapp_subscribers
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

const SITE_URL = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');

/* ── helpers ──────────────────────────────────────────────────── */

function j(res, code, obj) {
  return res.status(code).json(obj);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function supa(path, opts = {}) {
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

async function readJson(res) {
  const t = await res.text();
  if (!res.ok) throw new Error(t || `Supabase ${res.status}`);
  return t ? JSON.parse(t) : [];
}

function tgApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Promise.resolve({ ok: false, description: 'TELEGRAM_BOT_TOKEN not set' });
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json().catch(() => ({ ok: false, description: 'Bad Telegram response' })))
    .catch((e) => ({ ok: false, description: e.message }));
}

/* 1 request per user per 3 seconds (in-memory, per lambda instance). */
const lastMsg = new Map();
function userRateLimited(chatId) {
  const now = Date.now();
  const last = lastMsg.get(chatId) || 0;
  lastMsg.set(chatId, now);
  if (lastMsg.size > 2000) {
    for (const [k, t] of lastMsg) if (now - t > 60000) lastMsg.delete(k);
  }
  return now - last < 3000;
}

/* ── formatting ───────────────────────────────────────────────── */

const md = (s) => String(s ?? '').replace(/[_*[\]()`~>#+-=|{}.!\\]/g, (c) => `\\${c}`);

function jobCard(r) {
  const days = r.deadline
    ? Math.ceil((new Date(`${r.deadline}T23:59:59`) - Date.now()) / 86400000)
    : null;
  return [
    `*${md(r.role || 'Civil Engineering Job')}*`,
    `🏢 ${md(r.company || '—')}`,
    r.location || r.city ? `📍 ${md(r.location || r.city)}` : null,
    r.salary ? `💰 ${md(r.salary)}` : null,
    days != null && days >= 0 ? `⏰ ${days}d left to apply` : null,
    `🔗 [View and Apply](${r.apply_url || r.application_url || r.source_url || `${SITE_URL}/private-jobs`})`,
  ].filter(Boolean).join('\n');
}

function examCard(e) {
  return [
    `*📋 ${md(e.name)}*${e.short_name ? ` (${md(e.short_name)})` : ''}`,
    `Status: *${md(String(e.status || 'upcoming').replace(/_/g, ' '))}*`,
    e.notification_date ? `📢 Notification: ${md(e.notification_date)}` : null,
    e.application_start ? `🗓 Apply from: ${md(e.application_start)}` : null,
    e.application_end ? `⏳ Apply until: ${md(e.application_end)}` : null,
    e.exam_date ? `📝 Exam: ${md(e.exam_date)}` : null,
    e.vacancy_count ? `👷 Vacancies: ${md(e.vacancy_count)}` : null,
    e.qualification ? `🎓 Eligibility: ${md(e.qualification)}` : null,
    e.official_url ? `🔗 [Official notification](${e.official_url})` : null,
    `\n[📊 Track this exam](${SITE_URL}/exam-tracker)`,
  ].filter(Boolean).join('\n');
}

const HELP_TEXT = [
  `*CivilCareer Job Bot* 🏗️`,
  ``,
  `*jobs* site engineer bangalore — latest matching jobs`,
  `*exam* ssc je — exam status \\& dates`,
  `*salary* site engineer bangalore — salary range`,
  `*subscribe* — daily job alerts on WhatsApp`,
  `*9876543210 Site Engineer Bangalore* — complete your subscription`,
  ``,
  `🌐 [Open CivilCareer](${SITE_URL})`,
].join('\n');

/* ── command handlers ─────────────────────────────────────────── */

const KNOWN_CITIES = [
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi', 'hyderabad',
  'chennai', 'pune', 'ahmedabad', 'kolkata', 'kochi', 'noida', 'gurugram',
  'gurgaon', 'jaipur', 'nashik', 'indore', 'lucknow', 'nagpur', 'surat',
];

function parseCommand(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  const low = t.toLowerCase();

  /* "9876543210 Site Engineer Bangalore" — the subscribe completion format */
  const subMatch = low.match(/^(\+?91[\s-]?)?([6-9]\d{9})\s+(.+)$/);
  if (subMatch) {
    const rest = t.replace(low.match(/^(\+?91[\s-]?)?([6-9]\d{9})\s+/i)[0], '');
    return { cmd: '_subscribe_details', number: subMatch[2], rest };
  }

  const m = low.match(/^(jobs?|exam|salary|subscribe|start|help)\b\s*(.*)$/);
  if (!m) return { cmd: '_help', rest: t };
  return { cmd: m[1], rest: t.slice(m[1].length).trim() };
}

/* Split "site engineer bangalore" into role + city (city must be a suffix). */
function splitRoleCity(rest) {
  const low = rest.toLowerCase();
  for (const city of KNOWN_CITIES) {
    if (low.endsWith(` ${city}`) || low === city) {
      return { role: rest.slice(0, rest.length - city.length).trim(), city };
    }
  }
  return { role: rest.trim(), city: '' };
}

async function cmdJobs(rest, chatId) {
  const { role, city } = splitRoleCity(rest);
  if (!role) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `Which role? Try:\n*jobs site engineer bangalore*\n*jobs quantity surveyor*`,
    });
  }
  let path = `jobs?select=role,company,location,city,salary,deadline,apply_url,application_url,source_url,slug&published=eq.true&order=created_at.desc&limit=5&role=ilike.*${encodeURIComponent(role)}*`;
  if (city) path += `&or=(location.ilike.*${encodeURIComponent(city)}*,city.ilike.*${encodeURIComponent(city)}*)`;
  const rows = await readJson(await supa(path));
  if (!rows.length) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `No open *${md(role)}* jobs right now\\.\nNew listings are added daily — [browse all jobs](${SITE_URL}/private-jobs)`,
    });
  }
  const list = rows.map((r, i) => `${i + 1}\\) ${jobCard(r)}`).join('\n\n');
  return tgApi('sendMessage', {
    chat_id: chatId,
    parse_mode: 'MarkdownV2',
    text: `🏗️ *Latest ${md(role)}${city ? ` jobs in ${md(city)}` : ' jobs'}:*\n\n${list}\n\n[See all jobs](${SITE_URL}/private-jobs)`,
  });
}

async function cmdExam(rest, chatId) {
  if (!rest) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `Which exam? Try:\n*exam ssc je*\n*exam gate 2026*\n*exam rrb je*`,
    });
  }
  const rows = await readJson(await supa(
    `exam_tracker?select=*&is_active=eq.true&order=updated_at.desc.nullslast&limit=3&or=(name.ilike.*${encodeURIComponent(rest)}*,short_name.ilike.*${encodeURIComponent(rest)}*)`
  ));
  if (!rows.length) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `No exam matching "*${md(rest)}*" in the tracker yet\\.\n[Browse all tracked exams](${SITE_URL}/exam-tracker)`,
    });
  }
  const cards = rows.map((e) => examCard(e)).join('\n\n―――――\n\n');
  return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'MarkdownV2', text: cards });
}

async function cmdSalary(rest, chatId) {
  const { role, city } = splitRoleCity(rest);
  if (!role) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `Which role? Try:\n*salary site engineer bangalore*\n*salary quantity surveyor*`,
    });
  }
  let path = `salary_data?select=role,city,company_type,experience_years,salary_annual,is_verified&role=ilike.*${encodeURIComponent(role)}*&order=salary_annual.asc&limit=200`;
  if (city) path += `&city=ilike.*${encodeURIComponent(city)}*`;
  const rows = await readJson(await supa(path));
  if (!rows.length) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `No salary data for *${md(role)}*${city ? ` in ${md(city)}` : ''} yet\\.\nSee live numbers: ${SITE_URL}/salary`,
    });
  }
  const lpa = (n) => md(`₹${(n / 100000).toFixed(1)}L`);
  const median = rows[Math.floor((rows.length - 1) / 2)].salary_annual;
  const text = [
    `💰 *${md(role)}*${city ? ` · ${md(city)}` : ''} — from ${rows.length} report${rows.length > 1 ? 's' : ''}`,
    ``,
    `Min: *${lpa(rows[0].salary_annual)}* / year`,
    `Median: *${lpa(median)}* / year`,
    `Max: *${lpa(rows[rows.length - 1].salary_annual)}* / year`,
    ``,
    `[Full breakdown by experience \\& company type](${SITE_URL}/salary)`,
  ].join('\n');
  return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'MarkdownV2', text });
}

async function cmdSubscribe(chatId) {
  return tgApi('sendMessage', {
    chat_id: chatId, parse_mode: 'MarkdownV2',
    text: [
      `📲 Get daily job alerts on WhatsApp\\!`,
      ``,
      `Reply with your WhatsApp number and preferred role\\.`,
      `Format:`,
      `*9876543210 Site Engineer Bangalore*`,
    ].join('\n'),
  });
}

async function cmdSubscribeDetails(number, rest, chatId) {
  const { role, city } = splitRoleCity(rest || '');
  const payload = {
    whatsapp: `+91${number}`,
    preferred_roles: role ? [role] : null,
    city: city || null,
    language: 'en',
  };
  try {
    /* Upsert on the UNIQUE whatsapp column — re-sending updates prefs. */
    const r = await supa('whatsapp_subscribers', {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await r.text());
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `✅ You are subscribed\\!\n\n${role ? `Role: *${md(role)}*\n` : ''}${city ? `City: *${md(city)}*\n` : ''}Daily job alerts will arrive on WhatsApp *+91 ${md(number)}*\\.\n\n[Manage your alerts](${SITE_URL}/job-alerts.html)`,
    });
  } catch (_) {
    return tgApi('sendMessage', {
      chat_id: chatId, parse_mode: 'MarkdownV2',
      text: `⚠️ Could not save that right now\\. Please try again, or [subscribe on the website](${SITE_URL}/job-alerts.html)`,
    });
  }
}

async function cmdHelp(chatId) {
  return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'MarkdownV2', text: HELP_TEXT });
}

async function handleMessage(message) {
  const chatId = message.chat && message.chat.id;
  const text = String(message.text || '').trim();
  if (!chatId || !text) return;

  if (userRateLimited(chatId)) return; /* silently drop flood */

  const { cmd, rest, number } = parseCommand(text);
  try {
    if (cmd === '_subscribe_details') return await cmdSubscribeDetails(number, rest, chatId);
    if (cmd === '_help' || cmd === 'start' || cmd === 'help') return await cmdHelp(chatId);
    if (cmd === 'jobs') return await cmdJobs(rest, chatId);
    if (cmd === 'exam') return await cmdExam(rest, chatId);
    if (cmd === 'salary') return await cmdSalary(rest, chatId);
    if (cmd === 'subscribe') return await cmdSubscribe(chatId);
    return await cmdHelp(chatId);
  } catch (err) {
    if (isSetupError(String(err && err.message))) {
      return tgApi('sendMessage', {
        chat_id: chatId, parse_mode: 'MarkdownV2',
        text: `⏳ The job database is being set up\\. Try again later or [open CivilCareer](${SITE_URL})`,
      });
    }
    return cmdHelp(chatId).catch(() => {});
  }
}

function isSetupError(detail) {
  return /PGRST205|relation .* does not exist|Could not find the table/i.test(String(detail || ''));
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }
  if (!SUPA || !KEY) {
    return j(res, 500, { error: 'Supabase server configuration is missing' });
  }

  const q = new URL(req.url, 'http://localhost').searchParams;
  const body = parseBody(req);
  const wantsAdmin =
    Boolean(req.headers['x-owner-key']) || (req.method !== 'POST' || Boolean(body.key));

  /* ── ADMIN — webhook info / one-click setup ─────────────────── */
  if (wantsAdmin) {
    if (!requireOwner(req, res)) return;
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return j(res, 400, { error: 'TELEGRAM_BOT_TOKEN not configured in Vercel.' });
    }
    if (req.method === 'GET') {
      const info = await tgApi('getWebhookInfo', {});
      return j(res, 200, { webhook: info.ok ? info.result : info });
    }
    if (req.method === 'POST' && body.action === 'set-webhook') {
      const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
      const payload = { url: `${SITE_URL}/api/telegram/webhook`, allowed_updates: ['message'], drop_pending_updates: true };
      if (secret) payload.secret_token = secret;
      const r = await tgApi('setWebhook', payload);
      return j(res, r.ok ? 200 : 500, { ok: r.ok, result: r.result || r.description });
    }
    return j(res, 400, { error: 'Unknown action' });
  }

  /* ── PUBLIC — the actual webhook ─────────────────────────────── */
  if (req.method !== 'POST') {
    return j(res, 405, { error: 'Method not allowed' });
  }

  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (expected) {
    const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
    if (got !== expected) return j(res, 401, { error: 'Invalid webhook secret' });
  }

  const message = body.message || body.edited_message;
  if (message && message.text) await handleMessage(message);

  /* Always 200 — Telegram retries non-2xx webhooks aggressively. */
  return j(res, 200, { ok: true });
};
