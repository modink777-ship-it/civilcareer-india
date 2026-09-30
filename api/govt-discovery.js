/**
 * govt-discovery.js
 * Scrapes Indian government job portals directly — no API keys needed.
 */

const https = require("https");
const http = require("http");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const ROBOTS_UA =
  "CivilCareerBot/1.0 (+https://civilcareer-india-two.vercel.app)";

const robotsCache = new Map();

function rawFetch(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;

    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent": ROBOTS_UA,
          Accept: "text/html,application/xhtml+xml,text/plain",
          "Accept-Language": "en-IN,en;q=0.9",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          const nextUrl = new URL(res.headers.location, url).toString();
          return rawFetch(nextUrl, timeoutMs).then(resolve).catch(reject);
        }

        let body = "";

        res.on("data", (d) => {
          body += d;
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body,
            headers: res.headers,
            url,
          });
        });
      }
    );

    req.on("error", reject);

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

function parseRobots(text) {
  const groups = [];
  let current = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if ((field === "allow" || field === "disallow") && current) {
      current.rules.push({ type: field, path: value });
    }
  }

  return groups;
}

function robotsRuleMatches(rulePath, targetPath) {
  if (!rulePath) return false;

  let pattern = rulePath;
  const endAnchored = pattern.endsWith("$");

  if (endAnchored) pattern = pattern.slice(0, -1);

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp("^" + escaped + (endAnchored ? "$" : "")).test(
    targetPath
  );
}

function robotsAllows(text, targetUrl) {
  const groups = parseRobots(text);

  // Prefer an explicit CivilCareerBot group. Otherwise use the wildcard group.
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent === "civilcareerbot")
  );
  const wildcard = groups.filter((group) =>
    group.agents.includes("*")
  );

  const selectedGroups = specific.length ? specific : wildcard;
  if (!selectedGroups.length) return true;

  const target = new URL(targetUrl);
  const targetPath = target.pathname + target.search;

  const matches = selectedGroups
    .flatMap((group) => group.rules)
    .filter((rule) => robotsRuleMatches(rule.path, targetPath))
    .sort((a, b) => {
      const aLength = a.path.replace(/\*$/, "").length;
      const bLength = b.path.replace(/\*$/, "").length;

      if (bLength !== aLength) return bLength - aLength;

      // Equal-length Allow wins.
      if (a.type !== b.type) {
        return a.type === "allow" ? -1 : 1;
      }

      return 0;
    });

  if (!matches.length) return true;

  return matches[0].type === "allow";
}

async function recordRobotsStatus(targetUrl, robotsResult) {
  try {
    const host = new URL(targetUrl).hostname;

    // Keep source health auditable without requiring a schema change.
    // A host can have more than one configured source, so update matching
    // source URLs rather than assuming a single source row.
    const { data, error } = await supabase
      .from("govt_sources")
      .select("id,url")
      .ilike("url", `%${host}%`);

    if (error || !Array.isArray(data)) return;

    for (const source of data) {
      await supabase
        .from("govt_sources")
        .update({
          robots_ok: Boolean(robotsResult.allowed),
          last_status: robotsResult.status,
        })
        .eq("id", source.id);
    }
  } catch (_) {
    // Robots enforcement must never be weakened because status recording fails.
  }
}

async function checkRobots(targetUrl) {
  const parsed = new URL(targetUrl);
  const origin = parsed.origin;

  if (robotsCache.has(origin)) {
    const cached = robotsCache.get(origin);
    await recordRobotsStatus(targetUrl, cached);
    return cached;
  }

  const robotsUrl = `${origin}/robots.txt`;
  let result;

  try {
    const response = await rawFetch(robotsUrl, 10000);

    if (response.status >= 200 && response.status < 300) {
      const allowed = robotsAllows(response.body, targetUrl);

      result = {
        allowed,
        status: allowed ? "robots:allowed" : "robots:disallowed",
      };
    } else if (response.status >= 400 && response.status < 500) {
      // A 4xx response means robots.txt is unavailable. The crawl may proceed.
      result = {
        allowed: true,
        status: `robots:unavailable-4xx-${response.status}; crawl_allowed`,
      };
    } else if (response.status >= 500) {
      // Server/network failure: fail closed and do not crawl.
      result = {
        allowed: false,
        status: `robots:unreachable-http-${response.status}`,
      };
    } else {
      result = {
        allowed: false,
        status: `robots:unverified-http-${response.status}`,
      };
    }
  } catch (_) {
    result = {
      allowed: false,
      status: "robots:unreachable",
    };
  }

  robotsCache.set(origin, result);
  await recordRobotsStatus(targetUrl, result);

  return result;
}

async function fetch(url, timeoutMs = 12000) {
  const robots = await checkRobots(url);

  if (!robots.allowed) {
    throw new Error(
      `Robots policy prevented crawl: ${url} (${robots.status})`
    );
  }

  return rawFetch(url, timeoutMs);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ").trim();
}

function between(text, start, end) {
  const s = text.indexOf(start);
  if (s === -1) return "";
  const e = text.indexOf(end, s + start.length);
  return e === -1 ? text.slice(s + start.length) : text.slice(s + start.length, e);
}

function extractDeadline(text) {
  const patterns = [
    /last date[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /closing date[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /apply (?:by|before|on)[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const d = new Date(m[1].replace(/[\/\.]/g, "-"));
        if (!isNaN(d)) return d.toISOString().slice(0, 10);
      } catch (_) {}
    }
  }
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function slugify(s) {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80);
}

async function scrapeSSC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://ssc.gov.in/");
    const text = stripHtml(body);
    const noticeSection = between(text, "Notice Board", "Important Links") || text;
    const lines = noticeSection.split(/\n|\.\s/).filter((l) => l.trim().length > 15);
    for (const line of lines.slice(0, 8)) {
      if (/recruitment|notification|result|exam|post/i.test(line)) {
        jobs.push({
          title: line.trim().slice(0, 120),
          company: "Staff Selection Commission (SSC)",
          location: "All India", job_type: "government",
          deadline: extractDeadline(line + " " + text),
          source_url: "https://ssc.gov.in",
          description: `SSC notification: ${line.trim()}. Visit ssc.gov.in for full details and application link.`,
        });
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeUPSC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://upsc.gov.in/");
    const text = stripHtml(body);
    for (const line of text.split(/\n|\.\s/).filter((l) => l.trim().length > 15)) {
      if (/recruitment|notification|advt|advertisement|vacancy/i.test(line) && !/privacy|cookie/i.test(line)) {
        jobs.push({
          title: line.trim().slice(0, 120),
          company: "Union Public Service Commission (UPSC)",
          location: "All India", job_type: "government",
          deadline: extractDeadline(line + " " + text),
          source_url: "https://upsc.gov.in",
          description: `UPSC notification: ${line.trim()}. Visit upsc.gov.in for syllabus and application link.`,
        });
        if (jobs.length >= 5) break;
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeCPWD() {
  const jobs = [];
  try {
    const { body } = await fetch("https://cpwd.gov.in/");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => /recruit|vacancy|junior|senior|engineer/i.test(l)).slice(0, 6)) {
      jobs.push({
        title: line.trim().slice(0, 120),
        company: "Central Public Works Department (CPWD)",
        location: "All India", job_type: "government",
        deadline: extractDeadline(text),
        source_url: "https://cpwd.gov.in",
        description: `CPWD notification: ${line.trim()}. Visit cpwd.gov.in for complete details.`,
      });
    }
  } catch (_) {}
  return jobs;
}

async function scrapeNCS() {
  const jobs = [];
  try {
    for (const url of [
      "https://www.ncs.gov.in/jobseeker/pages/jobsearch.aspx?JobCategory=Engineering",
      "https://www.ncs.gov.in/jobseeker/pages/jobsearch.aspx?JobCategory=Civil+Engineering",
    ]) {
      try {
        const { body } = await fetch(url);
        const text = stripHtml(body);
        const rows = text.match(/([A-Z][A-Za-z\s\/]+(?:Engineer|Officer|Manager|Supervisor|Inspector|Technician)[A-Za-z\s\/]*)/g) || [];
        for (const title of rows.slice(0, 10)) {
          jobs.push({
            title: title.trim(), company: "Via NCS Portal",
            location: "India", job_type: "government",
            deadline: extractDeadline(text), source_url: url,
            description: `Job listed on National Career Service portal. Title: ${title.trim()}. Visit the portal to apply.`,
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return jobs;
}

async function scrapeEmploymentNews() {
  const jobs = [];
  try {
    const { body } = await fetch("https://www.employmentnews.gov.in/NewEmp/Home.aspx");
    const text = stripHtml(body);
    for (const line of text.split("\n").filter((l) => l.trim().length > 20)) {
      if (/engineer|officer|manager|inspector|assistant|technician/i.test(line) && !/privacy|cookie|follow|subscribe/i.test(line)) {
        jobs.push({
          title: line.trim().slice(0, 120), company: "Government of India",
          location: "India", job_type: "government",
          deadline: extractDeadline(text),
          source_url: "https://www.employmentnews.gov.in",
          description: `Notification from Employment News: ${line.trim()}`,
        });
        if (jobs.length >= 6) break;
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeNTPC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://careers.ntpc.co.in/");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => l.trim().length > 20 && !/^[\s\d]*$/.test(l))) {
      if (/engineer|officer|executive|trainee|manager/i.test(line)) {
        jobs.push({
          title: line.trim().slice(0, 120), company: "NTPC Limited",
          location: "India", job_type: "psu",
          deadline: extractDeadline(text),
          source_url: "https://careers.ntpc.co.in",
          description: `NTPC career opportunity: ${line.trim()}. Apply at careers.ntpc.co.in.`,
        });
        if (jobs.length >= 5) break;
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeNBCC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://www.nbccindia.com/nbccindia/newsite/htdocs/recruit.jsp");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => l.trim().length > 20)) {
      if (/engineer|manager|officer|executive|consultant/i.test(line)) {
        jobs.push({
          title: line.trim().slice(0, 120), company: "NBCC (India) Limited",
          location: "India", job_type: "psu",
          deadline: extractDeadline(text),
          source_url: "https://www.nbccindia.com/nbccindia/newsite/htdocs/recruit.jsp",
          description: `NBCC recruitment: ${line.trim()}. Visit NBCC portal for details.`,
        });
        if (jobs.length >= 5) break;
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeRITES() {
  const jobs = [];
  try {
    const { body } = await fetch("https://www.rites.com/web/index.php/career");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => l.trim().length > 20)) {
      if (/engineer|manager|officer|consultant|supervisor/i.test(line)) {
        jobs.push({
          title: line.trim().slice(0, 120), company: "RITES Limited",
          location: "India", job_type: "psu",
          deadline: extractDeadline(text),
          source_url: "https://www.rites.com/web/index.php/career",
          description: `RITES career opportunity: ${line.trim()}. Apply at rites.com.`,
        });
        if (jobs.length >= 5) break;
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeKPSC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://kpsc.kar.nic.in/");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => /recruitment|notification|vacancy|engineer|officer/i.test(l) && l.trim().length > 15).slice(0, 6)) {
      jobs.push({
        title: line.trim().slice(0, 120),
        company: "Karnataka Public Service Commission (KPSC)",
        location: "Karnataka", job_type: "state_psc",
        deadline: extractDeadline(text), source_url: "https://kpsc.kar.nic.in",
        description: `KPSC notification: ${line.trim()}. Visit kpsc.kar.nic.in for application.`,
      });
    }
  } catch (_) {}
  return jobs;
}

async function scrapeTSPSC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://tspsc.gov.in/");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => /recruitment|notification|vacancy|engineer|officer/i.test(l) && l.trim().length > 15).slice(0, 6)) {
      jobs.push({
        title: line.trim().slice(0, 120),
        company: "Telangana State Public Service Commission (TSPSC)",
        location: "Telangana", job_type: "state_psc",
        deadline: extractDeadline(text), source_url: "https://tspsc.gov.in",
        description: `TSPSC notification: ${line.trim()}. Visit tspsc.gov.in for application.`,
      });
    }
  } catch (_) {}
  return jobs;
}

async function scrapeMPSC() {
  const jobs = [];
  try {
    const { body } = await fetch("https://mpsc.gov.in/");
    const text = stripHtml(body);
    for (const line of text.split(/\n/).filter((l) => /recruitment|notification|vacancy|engineer|officer/i.test(l) && l.trim().length > 15).slice(0, 5)) {
      jobs.push({
        title: line.trim().slice(0, 120),
        company: "Maharashtra Public Service Commission (MPSC)",
        location: "Maharashtra", job_type: "state_psc",
        deadline: extractDeadline(text), source_url: "https://mpsc.gov.in",
        description: `MPSC notification: ${line.trim()}. Visit mpsc.gov.in for application.`,
      });
    }
  } catch (_) {}
  return jobs;
}

/* The jobs table stores deadline as an ISO date; portals publish dd/mm/yyyy.
   Anything unparseable becomes NULL instead of failing the whole row. */
function normDate(value) {
  const m = String(value || "").match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]); if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function upsertJobs(rawJobs) {
  const inserted = [], skipped = [];
  for (const raw of rawJobs) {
    if (!raw.title || raw.title.length < 8) continue;
    const slug = slugify(raw.title + "-" + (raw.company || "govt")) + "-" + Date.now();
    const { data: existing } = await supabase.from("jobs").select("id")
      .ilike("role", `%${raw.title.slice(0, 40).trim()}%`)
      .eq("company", raw.company || "")
      .gte("created_at", new Date(Date.now() - 60 * 86400000).toISOString())
      .limit(1);
    if (existing && existing.length > 0) { skipped.push(raw.title); continue; }
    /* A private-company name in the discovery payload vetoes the Government
       label (staffing/consultancy ads were being stored as Government). */
    const privateCompany = /\b(private limited|pvt\.?\s*ltd|llp|manpower|staffing|consultancy|solutions private|lifecare|walk-?in)\b/i.test(raw.company || '');
    const { error } = await supabase.from("jobs").insert({
      role: raw.title.slice(0, 200),
      company: (raw.company || "Government").slice(0, 200),
      location: (raw.location || "India").slice(0, 200),
      sector: privateCompany ? 'Private' : 'Government',
      status: "Active",
      source: "govt-discovery",
      source_url: raw.source_url || "",
      description: (raw.description || "").slice(0, 2000),
      deadline: normDate(raw.deadline),
      published: false,
      review_state: "Pending Review",
      ingestion_source: "agent_reach",
      slug,
    });
    if (error) skipped.push(`${raw.title} (${error.message})`);
    else inserted.push(raw.title);
  }
  return { inserted, skipped };
}

module.exports = async function govtDiscovery(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ownerKey = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;
  const isCron = /vercel-cron/i.test(String(req.headers["user-agent"] || ""));
  const providedKey = req.body?.key || req.headers["x-owner-key"];
  const authed = (ownerKey && providedKey === ownerKey) || isCron;

  /* Plain GET is a status probe. The daily Vercel cron (vercel-cron UA on
     GET — Vercel crons cannot send POST bodies or secrets) triggers a run. */
  if (req.method === "GET" && !isCron) {
    const { data, error } = await supabase.from("jobs").select("id, role, company, created_at")
      .eq("source", "govt-discovery").order("created_at", { ascending: false }).limit(20);
    return res.status(200).json({
      message: "POST with owner key — or the daily Vercel cron — triggers a scrape run.",
      last_scraped: data || [], error: error?.message || null,
    });
  }

  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authed) return res.status(401).json({ error: "Unauthorized" });

  const scrapers = [scrapeSSC, scrapeUPSC, scrapeCPWD, scrapeNCS, scrapeEmploymentNews, scrapeNTPC, scrapeNBCC, scrapeRITES, scrapeKPSC, scrapeTSPSC, scrapeMPSC];
  const names   = ["SSC","UPSC","CPWD","NCS","EmploymentNews","NTPC","NBCC","RITES","KPSC","TSPSC","MPSC"];
  const results = await Promise.allSettled(scrapers.map((s) => s()));

  const allJobs = [], portalSummary = {};
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") { portalSummary[names[i]] = r.value.length; allJobs.push(...r.value); }
    else portalSummary[names[i]] = `error: ${r.reason?.message || "unknown"}`;
  }

  const { inserted, skipped } = await upsertJobs(allJobs);
  return res.status(200).json({
    ok: true, portals_scraped: portalSummary,
    total_raw: allJobs.length, inserted: inserted.length, skipped: skipped.length,
    inserted_titles: inserted,
    note: "New jobs saved as Pending Review (published=false, ingestion_source=agent_reach). Review in the admin Agent Reach inbox before publishing.",
  });
};
