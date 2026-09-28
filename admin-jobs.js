/**
 * admin-jobs.js
 * Admin API for job review, bulk publish, bulk reject, bulk delete.
 *
 * GET  /api/admin-jobs?tab=review|published|deleted&key=X  → list jobs
 * POST /api/admin-jobs  { key, action, ids[] }
 *   actions: publish | reject | delete | restore
 */

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

function isAuthed(req) {
  const ownerKey = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;
  const key = req.body?.key
    || req.headers["x-owner-key"]
    || new URL("https://x.com" + (req.url || "")).searchParams.get("key");
  return ownerKey && key === ownerKey;
}

module.exports = async function adminJobs(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: "Unauthorized" });

  // ── GET — list jobs by tab ──────────────────────────────────────────────
  if (req.method === "GET") {
    const params = new URL("https://x.com" + (req.url || "")).searchParams;
    const tab    = params.get("tab") || "review";
    const page   = parseInt(params.get("page") || "1");
    const limit  = parseInt(params.get("limit") || "50");
    const search = params.get("search") || "";
    const offset = (page - 1) * limit;

    let query = supabase.from("jobs")
      .select("id,role,company,sector,location,source_name,source_url,deadline,vacancy_count,review_state,published,created_at,telegram_posted", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (tab === "review")    query = query.eq("published", false).neq("review_state", "deleted");
    if (tab === "published") query = query.eq("published", true);
    if (tab === "deleted")   query = query.eq("review_state", "deleted");
    if (search)              query = query.ilike("role", `%${search}%`);

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ jobs: data || [], total: count || 0, page, limit });
  }

  // ── POST — bulk actions ─────────────────────────────────────────────────
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, ids } = req.body || {};
  if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "action and ids[] required" });
  }

  let update = {};
  if (action === "publish") {
    update = { published: true, review_state: "approved", published_at: new Date().toISOString() };
  } else if (action === "reject") {
    update = { published: false, review_state: "rejected" };
  } else if (action === "delete") {
    update = { published: false, review_state: "deleted" };
  } else if (action === "restore") {
    update = { published: false, review_state: "pending" };
  } else {
    return res.status(400).json({ error: "Unknown action: " + action });
  }

  const { error, count } = await supabase.from("jobs")
    .update(update)
    .in("id", ids);

  if (error) return res.status(500).json({ error: error.message });

  // If publishing, also post to Telegram
  if (action === "publish") {
    try {
      const { data: jobs } = await supabase.from("jobs")
        .select("id,role,company,sector,location,city,salary,salary_min,salary_max,deadline,apply_url,application_url,source_url,slug,experience_level,experience_min")
        .in("id", ids);

      if (jobs && jobs.length > 0) {
        const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
        const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
        const https = require("https");

        for (const job of jobs) {
          if (!BOT_TOKEN || !CHANNEL_ID) break;
          const emoji = { government:"🏛️", psu:"🔷", private:"🏢", mnc:"🌐" }[job.sector] || "💼";
          const lines = [`${emoji} *${job.role || "Job Opening"}*`];
          if (job.company)  lines.push(`🏗️ *Company:* ${job.company}`);
          if (job.location) lines.push(`📍 *Location:* ${job.location}`);
          if (job.deadline) lines.push(`⏰ *Last Date:* ${new Date(job.deadline).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`);
          const url = job.apply_url || job.source_url || (job.slug ? `https://civilcareer.in/jobs/${job.slug}` : "https://civilcareer.in");
          lines.push(""); lines.push(`🔗 [View & Apply](${url})`); lines.push(""); lines.push(`📢 @CivilCareerIndiaJobs`);

          await new Promise((resolve) => {
            const body = JSON.stringify({ chat_id: CHANNEL_ID, text: lines.join("\n"), parse_mode: "Markdown", disable_web_page_preview: false });
            const r = https.request({ hostname:"api.telegram.org", path:`/bot${BOT_TOKEN}/sendMessage`, method:"POST", headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)} }, (res2) => { res2.resume(); resolve(); });
            r.on("error", resolve);
            r.write(body); r.end();
          });

          await supabase.from("jobs").update({ telegram_posted: true, telegram_posted_at: new Date().toISOString() }).eq("id", job.id);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    } catch (_) {}
  }

  return res.status(200).json({ ok: true, action, affected: ids.length });
};
