/**
 * telegram.js — CivilCareer
 *
 * POST /api/telegram                  { key, job_id }          → post one job
 * POST /api/telegram/bulk             { key, limit }           → post unposted jobs (cron)
 * POST /api/telegram/broadcast-all    { key, limit, offset }   → bulk send all 616
 * GET  /api/telegram/status           ?key=YOUR_KEY            → stats
 */

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// ─── Telegram API ───────────────────────────────────────────────────────────

function tgApi(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, raw: data }); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Format job message ─────────────────────────────────────────────────────

function formatJob(job) {
  const sectorEmoji = {
    government: "🏛️", psu: "🔷", private: "🏢", mnc: "🌐",
    infrastructure: "🏗️", construction: "🏗️", consulting: "📐",
  };
  const emoji = sectorEmoji[job.sector] || "💼";

  const title    = job.role || "Job Opening";
  const company  = job.company || "";
  const location = job.location || job.city || job.state || "India";
  const sector   = job.sector ? job.sector.charAt(0).toUpperCase() + job.sector.slice(1) : "";
  const exp      = job.experience_level || (job.experience_min != null ? `${job.experience_min}+ yrs` : "");
  const salary   = job.salary || (job.salary_min ? `₹${job.salary_min}–${job.salary_max || ""}` : "");
  const deadline = job.deadline
    ? new Date(job.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "";

  const applyUrl = job.apply_url || job.application_url || job.source_url ||
    (job.slug ? `https://civilcareer.in/jobs/${job.slug}` : "https://civilcareer.in");

  const lines = [
    `${emoji} *${title}*`,
  ];

  if (company)  lines.push(`🏗️ *Company:* ${company}`);
  if (sector)   lines.push(`🏷️ *Sector:* ${sector}`);
  if (location) lines.push(`📍 *Location:* ${location}`);
  if (exp)      lines.push(`🎓 *Experience:* ${exp}`);
  if (salary)   lines.push(`💰 *Salary:* ${salary}`);
  if (deadline) lines.push(`⏰ *Last Date:* ${deadline}`);

  lines.push("");
  lines.push(`🔗 [View & Apply](${applyUrl})`);
  lines.push("");
  lines.push(`📢 @CivilCareerIndiaJobs`);

  return lines.join("\n");
}

// ─── Send one job ───────────────────────────────────────────────────────────

async function sendJob(job) {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set in env" };
  }

  const result = await tgApi("sendMessage", {
    chat_id: CHANNEL_ID,
    text: formatJob(job),
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  });

  if (result.ok) {
    await supabase.from("jobs").update({
      telegram_posted: true,
      telegram_posted_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  return result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Auth ───────────────────────────────────────────────────────────────────

function isAuthed(req) {
  const ownerKey = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;
  const provided = req.body?.key || req.headers["x-owner-key"] || new URL("https://x.com" + (req.url || "")).searchParams.get("key");
  return ownerKey && provided === ownerKey;
}

// ─── Handler ────────────────────────────────────────────────────────────────

module.exports = async function
