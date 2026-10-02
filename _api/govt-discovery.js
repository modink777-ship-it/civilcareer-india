/**
 * api/govt-discovery.js
 *
 * Agent Reach government discovery pipeline.
 * Source of truth: public.govt_sources.
 *
 * Flow:
 * govt_sources -> robots check -> official page fetch -> candidate extraction
 * -> civil rules classifier -> govt_job_leads -> govt_job_staging.
 *
 * Nothing is published here. Private jobs are never touched.
 */

"use strict";

const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { classifyPost } = require("../lib/civil-classifier");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const ROBOTS_UA =
  "CivilCareerBot/1.0 (+https://civilcareer-india-two.vercel.app)";

const REQUEST_GAP_MS = 2000;
const MAX_REDIRECTS = 5;
const robotsCache = new Map();
const hostLastRequest = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeDelay(url) {
  const host = new URL(url).hostname;
  const previous = hostLastRequest.get(host) || 0;
  const wait = REQUEST_GAP_MS - (Date.now() - previous);

  if (wait > 0) await sleep(wait);

  hostLastRequest.set(host, Date.now());
}

function rawFetch(url, timeoutMs = 12000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      return reject(new Error(`Too many redirects: ${url}`));
    }

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
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return rawFetch(next, timeoutMs, redirects + 1)
            .then(resolve)
            .catch(reject);
        }

        let body = "";

        res.on("data", (d) => {
          body += d;
          // Protect the free pipeline from unexpectedly huge responses.
          if (body.length > 2_000_000) {
            req.destroy(new Error("Response too large"));
          }
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            body,
            headers: res.headers || {},
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

    if (field === "user" + "-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (
      (field === "allow" || field === "disallow") &&
      current
    ) {
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

  const specific = groups.filter((group) =>
    group.agents.includes("civilcareerbot")
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const selected = specific.length ? specific : wildcard;

  if (!selected.length) return true;

  const parsed = new URL(targetUrl);
  const targetPath = parsed.pathname + parsed.search;

  const matches = selected
    .flatMap((group) => group.rules)
    .filter((rule) => robotsRuleMatches(rule.path, targetPath))
    .sort((a, b) => {
      const aLength = a.path.replace(/\*$/, "").length;
      const bLength = b.path.replace(/\*$/, "").length;

      if (aLength !== bLength) return bLength - aLength;
      if (a.type === b.type) return 0;

      // Equal-length Allow wins.
      return a.type === "allow" ? -1 : 1;
    });

  return !matches.length || matches[0].type === "allow";
}

async function updateSource(sourceId, patch) {
  if (!sourceId) return;

  await supabase
    .from("govt_sources")
    .update(patch)
    .eq("id", sourceId);
}

async function checkRobots(source) {
  const sourceUrl = String(source.url || "").trim();
  if (!sourceUrl) {
    return { allowed: false, status: "robots:invalid-source-url" };
  }

  const parsed = new URL(sourceUrl);
  const origin = parsed.origin;

  if (robotsCache.has(origin)) {
    const cached = robotsCache.get(origin);
    await updateSource(source.id, {
      robots_ok: cached.allowed,
      last_status: cached.status,
    });
    return cached;
  }

  const robotsUrl = `${origin}/robots.txt`;
  let result;

  try {
    await politeDelay(robotsUrl);
    const response = await rawFetch(robotsUrl, 10000);

    if (response.status >= 200 && response.status < 300) {
      const allowed = robotsAllows(response.body, sourceUrl);
      result = {
        allowed,
        status: allowed ? "robots:allowed" : "robots:disallowed",
      };
    } else if (response.status >= 400 && response.status < 500) {
      // robots.txt unavailable via 4xx: crawl may proceed.
      result = {
        allowed: true,
        status: `robots:unavailable-4xx-${response.status}; crawl_allowed`,
      };
    } else if (response.status >= 500) {
      // Server failure: fail closed.
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

  await updateSource(source.id, {
    robots_ok: result.allowed,
    last_status: result.status,
  });

  return result;
}

async function fetchSource(source) {
  const robots = await checkRobots(source);

  if (!robots.allowed) {
    return {
      ok: false,
      status: robots.status,
      body: "",
      url: source.url,
    };
  }

  try {
    await politeDelay(source.url);
    const response = await rawFetch(source.url, 15000);

    if (response.status === 403 || response.status === 429) {
      return {
        ok: false,
        status: `source:http-${response.status}; stopped`,
        body: "",
        url: response.url,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        status: `source:http-${response.status}`,
        body: "",
        url: response.url,
      };
    }

    return {
      ok: true,
      status: `source:http-${response.status}`,
      body: response.body,
      url: response.url,
    };
  } catch (error) {
    return {
      ok: false,
      status: `source:error:${String(error.message || "unknown").slice(0, 180)}`,
      body: "",
      url: source.url,
    };
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function cleanText(value, max = 500) {
  return decodeEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function stripHtml(html) {
  return cleanText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
    20000
  );
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(decodeEntities(href), baseUrl).toString();
  } catch (_) {
    return "";
  }
}

function extractCandidates(html, source) {
  const candidates = [];
  const seen = new Set();

  const anchorRe =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const href = absoluteUrl(match[1], source.url);
    const title = cleanText(match[2], 240);

    if (!href || !title || title.length < 8) continue;

    let parsed;
    try {
      parsed = new URL(href);
    } catch (_) {
      continue;
    }

    // Stay on the official source host. We do not follow arbitrary external links.
    if (parsed.hostname !== new URL(source.url).hostname) continue;

    const signal =
      /recruit|vacan|career|appoint|notification|advertisement|advt|engineer|civil|junior|assistant|executive|manager|trainee|draught|surveyor|tender/i.test(
        `${title} ${href}`
      );

    if (!signal) continue;

    const key = `${href}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      title,
      source_url: href,
      excerpt: title,
      org_hint: source.org || source.name,
    });

    if (candidates.length >= 30) break;
  }

  // Some portals expose the notice as plain text rather than an anchor.
  // Keep one conservative fallback candidate for a source page itself.
  if (!candidates.length) {
    const pageText = stripHtml(html, 4000);

    if (
      /recruit|vacan|career|notification|advertisement|engineer|civil/i.test(
        pageText
      )
    ) {
      candidates.push({
        title: `${source.name} recruitment / vacancy notice`,
        source_url: source.url,
        excerpt: pageText.slice(0, 600),
        org_hint: source.org || source.name,
      });
    }
  }

  return candidates;
}

const CIVIL_POSITIVE = [
  /\bcivil\s+engineer(?:ing)?\b/i,
  /\b(?:je|ae|aee|ee)\s*[-/]?\s*civil\b/i,
  /\bassistant\s+engineer\s+(?:civil|works)\b/i,
  /\bsite\s+\/?\s*project\s+engineer\b/i,
  /\bstructural\b/i,
  /\bhighway\b/i,
  /\broad\b/i,
  /\btransportation\b/i,
  /\bgeotechnical\b/i,
  /\bquantity\s+surveyor\b/i,
  /\bdraughtsman\s*\(?\s*civil\b/i,
  /\bsurveyor\b/i,
  /\boverseer\b/i,
  /\bworks\s+manager\b/i,
  /\bssc\s+je\b/i,
  /\brrb\s+je\b/i,
  /\bese\b/i,
  /\bgate\b/i,
  /\bb\.?\s*e\.?\s*\/?\s*b\.?\s*tech\.?\s+(?:in\s+)?civil\b/i,
  /\bdiploma\s+(?:in\s+)?civil\b/i,
  /\biti\s+draughtsman\s+civil\b/i,
];

const CIVIL_NEGATIVE = [
  /\bcivil\s+judge\b/i,
  /\bcivil\s+court\b/i,
  /\bcity\s+civil\s+court\b/i,
  /\bcivil\s+services\b/i,
  /\bcivil\s+clerk\b/i,
  /\bcivil\s+labourer\b/i,
  /\bcivil\s+defen[cs]e\b/i,
  /\bcivil\s+surgeon\b/i,
  /\bcivilian\s+(?:driver|mts)\b/i,
  /\bbank\b/i,
  /\bteacher\b/i,
  /\bnurse\b/i,
  /\bpolice\b/i,
];

function classifyCivil(title, excerpt) {
  const verdict = classifyPost({
    title,
    description: excerpt,
    organization: ''
  });
  return {
    civil_status: verdict.outcome,
    tier: verdict.tier,
    relevance_score: verdict.score,
    confidence: verdict.outcome === 'civil' ? 0.9 : verdict.outcome === 'discipline_unknown' ? 0.45 : 0.98,
    match_reasons: {
      positive: verdict.reasons || [],
      negative: verdict.outcome === 'not_civil' ? ['shared-civil-classifier'] : [],
    },
  };
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dedupeKey(candidate, classification) {
  return hash(
    [
      normalize(candidate.org_hint),
      normalize(candidate.title),
      normalize(candidate.source_url),
      classification.civil_status,
    ].join("|")
  );
}

async function upsertLead(source, candidate) {
  const urlHash = hash(candidate.source_url);

  const payload = {
    source_id: source.id,
    source_url: candidate.source_url,
    title: candidate.title.slice(0, 500),
    org_hint: String(candidate.org_hint || "").slice(0, 250),
    discovered_at: new Date().toISOString(),
    status: "new",
    url_hash: urlHash,
  };

  const { data, error } = await supabase
    .from("govt_job_leads")
    .upsert(payload, { onConflict: "url_hash" })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data.id };
}

async function stageCandidate(source, leadId, candidate, classification) {
  const key = dedupeKey(candidate, classification);

  if (classification.civil_status === "not_civil") {
    return { ok: true, skipped: "not_civil" };
  }

  const payload = {
    lead_id: leadId,
    status: classification.civil_status === "discipline_unknown"
      ? "needs_info"
      : "pending",
    relevance_tier: classification.tier,
    relevance_score: classification.relevance_score,
    confidence: classification.confidence,
    extraction_method: "rules",
    dedupe_key: key,
    match_reasons: classification.match_reasons,
    full_payload: {
      title: candidate.title,
      organization: candidate.org_hint || source.org || source.name,
      official_notice_url: candidate.source_url,
      official_site_url: source.url,
      excerpt: candidate.excerpt,
      source_name: source.name,
      source_type: source.type,
      source_category: source.category,
      source_state: source.state,
      civil_status: classification.civil_status,
    },
  };

  const { error } = await supabase
    .from("govt_job_staging")
    .upsert(payload, { onConflict: "dedupe_key" });

  return {
    ok: !error,
    error: error?.message || null,
  };
}

async function processSource(source) {
  const result = {
    source: source.name,
    source_id: source.id,
    robots: null,
    fetched: false,
    candidates: 0,
    staged: 0,
    errors: [],
  };

  const robots = await checkRobots(source);
  result.robots = robots.status;

  if (!robots.allowed) {
    await updateSource(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: robots.status,
      robots_ok: false,
    });
    return result;
  }

  const fetched = await fetchSource(source);
  result.fetched = fetched.ok;

  if (!fetched.ok) {
    await updateSource(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: fetched.status,
      robots_ok: true,
    });
    result.errors.push(fetched.status);
    return result;
  }

  const candidates = extractCandidates(fetched.body, {
    ...source,
    url: fetched.url,
  });

  result.candidates = candidates.length;

  for (const candidate of candidates) {
    const classification = classifyCivil(
      candidate.title,
      candidate.excerpt
    );

    const lead = await upsertLead(source, candidate);

    if (!lead.ok) {
      result.errors.push(`lead:${lead.error}`);
      continue;
    }

    const staged = await stageCandidate(
      source,
      lead.id,
      candidate,
      classification
    );

    if (staged.ok) {
      if (staged.skipped === 'not_civil') {
        result.skipped = (result.skipped || 0) + 1;
      } else {
        result.staged += 1;
      }
    } else {
      result.errors.push(`stage:${staged.error}`);
    }
  }

  await updateSource(source.id, {
    last_run_at: new Date().toISOString(),
    last_status: result.errors.length
      ? `ok; candidates=${result.candidates}; staged=${result.staged}; errors=${result.errors.length}`
      : `ok; candidates=${result.candidates}; staged=${result.staged}`,
    robots_ok: true,
  });

  return result;
}

async function getSources() {
  const { data, error } = await supabase
    .from("govt_sources")
    .select(
      "id,name,type,url,kind,org,category,state,enabled,robots_ok,last_run_at,last_status"
    )
    .eq("enabled", true)
    .order("name");

  if (error) throw new Error(`govt_sources read failed: ${error.message}`);

  return data || [];
}

module.exports = async function govtDiscovery(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Authorization is handled centrally by api/[[...path]].js.
  // Only dispatcher-approved cron requests may execute the scan.
  const isCron = req.isCron === true;

  if (req.method === "GET" && !isCron) {
    const sources = await getSources();

    return res.status(200).json({
      ok: true,
      message:
        "Agent Reach source-driven discovery is configured. POST with owner key or use the scheduled cron to run it.",
      enabled_sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        enabled: s.enabled,
        robots_ok: s.robots_ok,
        last_run_at: s.last_run_at,
        last_status: s.last_status,
      })),
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isCron) {
    return res.status(401).json({ error: "Cron authorization required." });
  }

  robotsCache.clear();
  hostLastRequest.clear();

  const sources = await getSources();
  const results = [];

  for (const source of sources) {
    try {
      results.push(await processSource(source));
    } catch (error) {
      const message = String(
        error?.message || "unknown error"
      ).slice(0, 240);

      results.push({
        source: source.name,
        source_id: source.id,
        robots: null,
        fetched: false,
        candidates: 0,
        staged: 0,
        errors: [message],
      });

      await updateSource(source.id, {
        last_run_at: new Date().toISOString(),
        last_status: `run-error:${message}`,
      });
    }
  }

  const summary = {
    sources: sources.length,
    sources_processed: results.length,
    candidates: results.reduce(
      (n, r) => n + Number(r.candidates || 0),
      0
    ),
    staged: results.reduce(
      (n, r) => n + Number(r.staged || 0),
      0
    ),
    errors: results.reduce(
      (n, r) => n + (r.errors?.length || 0),
      0
    ),
  };

  return res.status(200).json({
    ok: true,
    summary,
    results,
    note:
      "Agent Reach writes only to govt_job_leads and govt_job_staging. Nothing is published and the private jobs table is untouched.",
  });
};
