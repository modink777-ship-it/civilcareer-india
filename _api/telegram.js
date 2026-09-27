const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

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

function formatJob(job) {
  const emoji = { government:"🏛️", psu:"🔷", private:"🏢", mnc:"🌐", infrastructure:"🏗️", construction:"🏗️", consulting:"📐" }[job.sector] || "💼";
  const sector = job.sector ? job.sector.charAt(0).toUpperCase() + job.sector.slice(1) : "";
  const exp = job.experience_level || (job.experience_min != null ? `${job.experience_min}+ yrs` : "");
  const salary = job.salary || (job.salary_min ? `₹${job.salary_min}–${job.salary_max || ""}` : "");
  const deadline = job.deadline ? new Date(job.deadline).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }) : "";
  const applyUrl = job.apply_url || job.application_url || job.source_url || (job.slug ? `https://civilcareer.in/jobs/${job.slug}` : "https://civilcareer.in");

  const lines = [`${emoji} *${job.role || "Job Opening"}*`];
  if (job.company)  lines.push(`🏗️ *Company:* ${job.company}`);
  if (sector)       lines.push(`🏷️ *Sector:* ${sector}`);
  if (job.location || job.city) lines.push(`📍 *Location:* ${job.location || job.city}`);
  if (exp)          lines.push(`🎓 *Experience:* ${exp}`);
  if (salary)       lines.push(`💰 *Salary:* ${salary}`);
  if (deadline)     lines.push(`⏰ *Last Date:* ${deadline}`);
  lines.push("");
  lines.push(`🔗 [View & Apply](${applyUrl})`);
  lines.push("");
  lines.push(`📢 @CivilCareerIndiaJobs`);
  return lines.join("\n");
}

async function sendJob(job) {
  if (!BOT_TOKEN || !CHANNEL_ID) return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set" };
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

function isAuthed(req) {
  const ownerKey = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;
  const provided = req.body?.key || req.headers["x-owner-key"] || new URL("https://x.com" + (req.url || "")).searchParams.get("key");
  return ownerKey && provided === ownerKey;
}

module.exports = async function telegramHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const path = req.url?.split("?")[0] || "";

  if (req.method === "GET") {
    if (!isAuthed(req)) return res.status(401).json({ error: "Unauthorized" });
    const [{ count: total }, { count: posted }, { count: pending }] = await Promise.all([
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("published", true),
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("published", true).eq("telegram_posted", true),
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("published", true).neq("telegram_posted", true),
    ]);
    return res.status(200).json({ total_published: total, posted_to_telegram: posted, pending_telegram: pending, bot_configured: !!BOT_TOKEN, channel_configured: !!CHANNEL_ID });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthed(req)) return res.status(401).json({ error: "Unauthorized" });

  if (path.includes("broadcast-all")) {
    const limit  = parseInt(req.body?.limit)  || 50;
    const offset = parseInt(req.body?.offset) || 0;
    const { data: jobs, error } = await supabase.from("jobs")
      .select("id,role,company,sector,location,city,state,experience_level,experience_min,experience_max,salary,salary_min,salary_max,deadline,apply_url,application_url,source_url,slug")
      .eq("published", true)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) return res.status(500).json({ error: error.message });
    if (!jobs || jobs.length === 0) return res.status(200).json({ ok: true, done: true, message: "All jobs posted!" });
    const sent = [], failed = [];
    for (const job of jobs) {
      const r = await sendJob(job);
      if (r.ok) sent.push(job.role);
      else failed.push({ job: job.role, error: r.description || r.error });
      await sleep(1500);
    }
    return res.status(200).json({ ok: true, offset, processed: jobs.length, sent: sent.length, failed: failed.length, failed_list: failed, next_offset: offset + jobs.length, done: jobs.length < limit });
  }

  if (path.includes("bulk")) {
    const limit = parseInt(req.body?.limit) || 30;
    const { data: jobs, error } = await supabase.from("jobs")
      .select("id,role,company,sector,location,city,state,experience_level,experience_min,experience_max,salary,salary_min,salary_max,deadline,apply_url,application_url,source_url,slug")
      .eq("published", true)
      .neq("telegram_posted", true)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    if (!jobs || jobs.length === 0) return res.status(200).json({ ok: true, message: "All caught up — no new jobs to post." });
    const sent = [], failed = [];
    for (const job of jobs) {
      const r = await sendJob(job);
      if (r.ok) sent.push(job.role);
      else failed.push({ job: job.role, error: r.description || r.error });
      await sleep(1500);
    }
    return res.status(200).json({ ok: true, processed: jobs.length, sent: sent.length, failed: failed.length, failed_list: failed });
  }

  const jobId = req.body?.job_id;
  if (!jobId) return res.status(400).json({ error: "job_id required" });
  const { data: job, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (error || !job) return res.status(404).json({ error: "Job not found" });
  const result = await sendJob(job);
  return res.status(result.ok ? 200 : 500).json(result);
};
