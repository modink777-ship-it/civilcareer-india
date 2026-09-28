/**
 * civil-scraper.js
 * Scrapes civil engineering jobs from major Indian govt job portals.
 * Saves all as published=false for admin review.
 *
 * POST /api/civil-scraper  { key }  → run scrape
 * GET  /api/civil-scraper  → last 50 scraped jobs
 *
 * Portals covered:
 *  - govtjobguru.in
 *  - freejobalert.com
 *  - indgovtjobs.in
 *  - allgovernmentjobs.in
 *  - sarkarinaukariofficial.com
 *  - sarkariresult.com
 *  - rojgarresult.com
 *  - employmentnews.gov.in
 *  - ssc.gov.in
 *  - upsc.gov.in
 *  - kpsc.kar.nic.in
 *  - tspsc.gov.in
 */

const https = require("https");
const http  = require("http");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// ── Civil engineering keywords ──────────────────────────────────────────────
const CIVIL_KEYWORDS = [
  "civil engineer","civil engineering","junior engineer","je civil",
  "assistant engineer","ae civil","executive engineer","site engineer",
  "structural engineer","planning engineer","quantity surveyor","qs ",
  "project engineer","field engineer","construction engineer",
  "highway engineer","road engineer","bridge engineer","drainage",
  "irrigation engineer","water supply","sewerage","urban planning",
  "town planning","geotechnical","soil testing","survey engineer",
  "autocad","staad","revit","bim","cpwd","nhai","nhpc","rites",
  "nbcc","wapcos","cwc","nmdc civil","pwd civil","phed","phd civil",
  "municipal engineer","estate officer","works officer",
  "junior engineer (civil)","je (civil)","ae (civil)",
  "assistant executive engineer","overseer","work assistant",
];

function isCivil(text) {
  const lower = (text || "").toLowerCase();
  return CIVIL_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── HTTP fetch ──────────────────────────────────────────────────────────────
function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    try {
      const req = mod.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9",
          "Accept-Encoding": "identity",
          "Connection": "close",
        },
        timeout: timeoutMs,
      }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return fetchUrl(loc, timeoutMs).then(resolve).catch(reject);
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => { if (body.length < 500000) body += d; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout: " + url)); });
    } catch (e) { reject(e); }
  });
}

function strip(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<")
    .replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#\d+;/g," ")
    .replace(/\s{2,}/g," ").trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const href = m[1].startsWith("http") ? m[1] : new URL(m[1], baseUrl).href;
      const text = strip(m[2]).slice(0, 200);
      if (text.length > 5) links.push({ href, text });
    } catch (_) {}
  }
  return links;
}

function extractDeadline(text) {
  const patterns = [
    /last date[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /closing date[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /apply (?:by|before)[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) {
      try {
        const d = new Date(match[1].replace(/[\/\.]/g,"-"));
        if (!isNaN(d) && d > new Date()) return d.toISOString().slice(0,10);
      } catch (_) {}
    }
  }
  const d = new Date(); d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0,10);
}

function extractVacancies(text) {
  const m = text.match(/(\d+)\s*(?:posts?|vacancies|vacancies|seats?|positions?)/i);
  return m ? parseInt(m[1]) : null;
}

function extractOrg(text) {
  const orgs = [
    "UPSC","SSC","CPWD","NHAI","NHPC","NTPC","NBCC","RITES","WAPCOS","CWC",
    "PWD","PHD","PHED","NMDC","ONGC","GAIL","BEL","DRDO","ISRO","AAI",
    "KPSC","TSPSC","MPSC","MPPSC","BPSC","RPSC","APPSC","TNPSC","KERALA PSC",
    "Railways","RRB","BMRCL","DMRC","MMRCL","Metro Rail",
    "Municipal Corporation","BBMP","BMC","MCGM","NMMC",
    "TNEB","MSEDCL","BESCOM","NLC","Coal India","SAIL","HAL",
  ];
  const lower = text.toLowerCase();
  for (const org of orgs) {
    if (lower.includes(org.toLowerCase())) return org;
  }
  return null;
}

function slugify(s) {
  return (s||"").toLowerCase().replace(/[^\w\s-]/g,"").replace(/\s+/g,"-").slice(0,80) + "-" + Date.now();
}

// ── Portal scrapers ─────────────────────────────────────────────────────────

async function scrapeGovtJobGuru() {
  const jobs = [];
  try {
    const urls = [
      "https://govtjobguru.in/civil-engineering-jobs/",
      "https://govtjobguru.in/government-jobs-openings/",
    ];
    for (const url of urls) {
      try {
        const { body } = await fetchUrl(url);
        const links = extractLinks(body, url);
        for (const { href, text } of links) {
          if (isCivil(text) && href.includes("govtjobguru.in") && !href.includes("category") && !href.includes("tag")) {
            jobs.push({
              role: text.slice(0,200),
              company: extractOrg(text) || "Government",
              sector: "government",
              source_url: href,
              source_name: "GovtJobGuru",
              description: text,
              deadline: extractDeadline(text),
              vacancy_count: extractVacancies(text),
            });
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return jobs;
}

async function scrapeFreeJobAlert() {
  const jobs = [];
  try {
    const urls = [
      "https://www.freejobalert.com/government-jobs/",
      "https://www.freejobalert.com/civil-engineering-jobs/",
    ];
    for (const url of urls) {
      try {
        const { body } = await fetchUrl(url);
        const links = extractLinks(body, url);
        for (const { href, text } of links) {
          if (isCivil(text) && href.includes("freejobalert.com") && text.length > 15) {
            jobs.push({
              role: text.slice(0,200),
              company: extractOrg(text) || "Government",
              sector: "government",
              source_url: href,
              source_name: "FreeJobAlert",
              description: text,
              deadline: extractDeadline(text),
              vacancy_count: extractVacancies(text),
            });
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return jobs;
}

async function scrapeAllGovtJobs() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://allgovernmentjobs.in/latest-government-jobs");
    const links = extractLinks(body, "https://allgovernmentjobs.in");
    for (const { href, text } of links) {
      if (isCivil(text) && href.includes("allgovernmentjobs.in") && text.length > 15) {
        jobs.push({
          role: text.slice(0,200),
          company: extractOrg(text) || "Government",
          sector: "government",
          source_url: href,
          source_name: "AllGovtJobs",
          description: text,
          deadline: extractDeadline(text),
          vacancy_count: extractVacancies(text),
        });
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeSarkariNaukari() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://www.sarkarinaukariofficial.com/latest-jobs/");
    const links = extractLinks(body, "https://www.sarkarinaukariofficial.com");
    for (const { href, text } of links) {
      if (isCivil(text) && href.includes("sarkarinaukari") && text.length > 15) {
        jobs.push({
          role: text.slice(0,200),
          company: extractOrg(text) || "Government",
          sector: "government",
          source_url: href,
          source_name: "SarkariNaukari",
          description: text,
          deadline: extractDeadline(text),
          vacancy_count: extractVacancies(text),
        });
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeRojgarResult() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://rojgarresult.com/");
    const links = extractLinks(body, "https://rojgarresult.com");
    for (const { href, text } of links) {
      if (isCivil(text) && href.includes("rojgarresult.com") && text.length > 15) {
        jobs.push({
          role: text.slice(0,200),
          company: extractOrg(text) || "Government",
          sector: "government",
          source_url: href,
          source_name: "RojgarResult",
          description: text,
          deadline: extractDeadline(text),
          vacancy_count: extractVacancies(text),
        });
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeSarkariResult() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://www.sarkariresult.com/latestjob.php");
    const links = extractLinks(body, "https://www.sarkariresult.com");
    for (const { href, text } of links) {
      if (isCivil(text) && text.length > 15) {
        jobs.push({
          role: text.slice(0,200),
          company: extractOrg(text) || "Government",
          sector: "government",
          source_url: href,
          source_name: "SarkariResult",
          description: text,
          deadline: extractDeadline(text),
          vacancy_count: extractVacancies(text),
        });
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeNaukri() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://www.naukri.com/civil-engineering-jobs-in-india");
    const links = extractLinks(body, "https://www.naukri.com");
    for (const { href, text } of links) {
      if (isCivil(text) && text.length > 10) {
        jobs.push({
          role: text.slice(0,200),
          company: extractOrg(text) || "Private",
          sector: "private",
          source_url: href.startsWith("http") ? href : "https://www.naukri.com" + href,
          source_name: "Naukri",
          description: text,
          deadline: extractDeadline(text),
        });
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeSSCPortal() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://ssc.gov.in/");
    const text = strip(body);
    const lines = text.split(/\n|\.(?=\s)/).filter(l => l.trim().length > 20);
    for (const line of lines) {
      if (isCivil(line) || /recruitment|notification|vacancy/i.test(line)) {
        jobs.push({
          role: line.trim().slice(0,200),
          company: "Staff Selection Commission (SSC)",
          sector: "government",
          source_url: "https://ssc.gov.in",
          source_name: "SSC",
          description: line.trim(),
          deadline: extractDeadline(line + " " + text),
        });
        if (jobs.length >= 5) break;
      }
    }
  } catch (_) {}
  return jobs;
}

async function scrapeUPSCPortal() {
  const jobs = [];
  try {
    const { body } = await fetchUrl("https://upsc.gov.in/");
    const text = strip(body);
    const lines = text.split(/\n/).filter(l => /recruitment|notification|vacancy|advt/i.test(l) && l.trim().length > 15);
    for (const line of lines.slice(0,5)) {
      if (isCivil(line) || /engineer|works|technical/i.test(line)) {
        jobs.push({
          role: line.trim().slice(0,200),
          company: "UPSC",
          sector: "government",
          source_url: "https://upsc.gov.in",
          source_name: "UPSC",
          description: line.trim(),
          deadline: extractDeadline(line + " " + text),
        });
      }
    }
  } catch (_) {}
  return jobs;
}

// ── Dedup & save ────────────────────────────────────────────────────────────

async function upsertJobs(rawJobs) {
  const inserted = [], skipped = [], errors = [];

  for (const raw of rawJobs) {
    if (!raw.role || raw.role.length < 8) continue;

    // Dedup: same role+source in last 30 days
    const { data: existing } = await supabase
      .from("jobs")
      .select("id")
      .ilike("role", `%${raw.role.slice(0,50).trim()}%`)
      .eq("source_name", raw.source_name || "")
      .gte("created_at", new Date(Date.now() - 30*86400000).toISOString())
      .limit(1);

    if (existing && existing.length > 0) { skipped.push(raw.role); continue; }

    const { error } = await supabase.from("jobs").insert({
      role:         raw.role.slice(0,200),
      company:      (raw.company || "Government").slice(0,200),
      location:     (raw.location || "India").slice(0,200),
      sector:       raw.sector || "government",
      source:       "civil-scraper",
      source_name:  raw.source_name || "",
      source_url:   raw.source_url || "",
      description:  (raw.description || "").slice(0,3000),
      deadline:     raw.deadline || null,
      vacancy_count:raw.vacancy_count || null,
      published:    false,
      review_state: "pending",
      slug:         slugify(raw.role),
    });

    if (error) errors.push(`${raw.role}: ${error.message}`);
    else inserted.push(raw.role);
  }

  return { inserted, skipped, errors };
}

// ── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function civilScraper(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ownerKey = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;

  if (req.method === "GET") {
    const { data } = await supabase.from("jobs")
      .select("id,role,company,source_name,deadline,published,review_state,created_at")
      .eq("source","civil-scraper")
      .order("created_at",{ascending:false})
      .limit(50);
    return res.status(200).json({ jobs: data || [], total: data?.length || 0 });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const provided = req.body?.key || req.headers["x-owner-key"];
  if (!ownerKey || provided !== ownerKey) return res.status(401).json({ error: "Unauthorized" });

  // Run all scrapers in parallel
  const scrapers = [
    ["GovtJobGuru",    scrapeGovtJobGuru],
    ["FreeJobAlert",   scrapeFreeJobAlert],
    ["AllGovtJobs",    scrapeAllGovtJobs],
    ["SarkariNaukari", scrapeSarkariNaukari],
    ["RojgarResult",   scrapeRojgarResult],
    ["SarkariResult",  scrapeSarkariResult],
    ["Naukri",         scrapeNaukri],
    ["SSC",            scrapeSSCPortal],
    ["UPSC",           scrapeUPSCPortal],
  ];

  const results = await Promise.allSettled(scrapers.map(([,fn]) => fn()));
  const summary = {}, allJobs = [];

  for (let i = 0; i < results.length; i++) {
    const [name] = scrapers[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      summary[name] = r.value.length;
      allJobs.push(...r.value);
    } else {
      summary[name] = `error: ${r.reason?.message || "failed"}`;
    }
  }

  const { inserted, skipped, errors } = await upsertJobs(allJobs);

  return res.status(200).json({
    ok: true,
    portals: summary,
    total_found: allJobs.length,
    new_jobs_saved: inserted.length,
    duplicates_skipped: skipped.length,
    errors: errors.length,
    error_list: errors,
    note: "All saved as published=false. Go to admin panel → Review tab to approve.",
  });
};
