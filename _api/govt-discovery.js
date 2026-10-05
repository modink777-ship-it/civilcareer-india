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
/* Plain REST instead of @supabase/supabase-js: the SDK ships the legacy
   @supabase/node-fetch fork, whose url.parse() use makes Node 22+ print a
   DeprecationWarning (DEP0169) in every Vercel cold-start log. Same
   service-key contract as _api/job-collector.js. */
const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');

function rest(path, opts = {}) {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

/* The sources that remain enabled are engineering AGGREGATORS, not official
   notice pages. Their anchors say "Apply Now" / "View / Apply", so harvesting
   anchors and classifying the anchor text finds no discipline at all and stages
   noise. The shared adapter library reads each site's own table/card structure
   and rules on the posting's own words — the same extraction the GitHub crawler
   uses, so both writers agree on what "civil" means. */
const { adapterFor, selectCivil, classifyRecord } = require("../lib/govt-aggregators");

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

  try {
    await rest(`govt_sources?id=eq.${encodeURIComponent(sourceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch (_) { /* source bookkeeping must never fail a scan */ }
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

/* Structured extraction for aggregator sources: one candidate per posting, from
   the site's own table, pre-classified with the shared civil classifier. Returns
   null when the source has no adapter, so official sources keep the anchor
   harvester below. */
function adapterCandidates(html, source, adapter) {
  const candidates = [];

  for (const record of adapter.extract(html, source.url)) {
    if (candidates.length >= 30) break;

    const select = selectCivil(record);
    if (!select.keep) continue;

    const verdict = classifyRecord(record, select);
    const top = verdict.posts[0] || {};

    /* Same gate the GitHub crawler applies: a posting that is neither civil nor
       civil-eligible never reaches the review queue. */
    if (verdict.civil_status === "not_civil" && top.level === "not_civil") continue;

    candidates.push({
      title: record.title.slice(0, 240),
      source_url: record.url,
      excerpt: [record.postName, record.qualification, record.section]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500),
      org_hint: record.org || source.org || source.name,
      classification: {
        civil_status: verdict.civil_status,
        tier: top.tier || "B",
        relevance_score: top.score || 60,
        confidence: top.outcome === "civil" ? 0.9 : 0.6,
        match_reasons: {
          positive: Array.isArray(top.reasons) ? top.reasons : [],
          negative: [],
        },
      },
    });
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
  const text = `${title} ${excerpt}`;

  const negative = CIVIL_NEGATIVE.filter((re) => re.test(text));
  if (negative.length) {
    return {
      civil_status: "not_civil",
      tier: "C",
      relevance_score: 0,
      confidence: 0.98,
      match_reasons: {
        positive: [],
        negative: negative.map(String),
      },
    };
  }

  const positive = CIVIL_POSITIVE.filter((re) => re.test(text));

  if (positive.length >= 2) {
    return {
      civil_status: "civil",
      tier: "A",
      relevance_score: Math.min(100, 70 + positive.length * 8),
      confidence: 0.9,
      match_reasons: {
        positive: positive.map(String),
        negative: [],
      },
    };
  }

  if (positive.length === 1) {
    return {
      civil_status: "discipline_unknown",
      tier: "B",
      relevance_score: 55,
      confidence: 0.65,
      match_reasons: {
        positive: positive.map(String),
        negative: [],
      },
    };
  }

  return {
    civil_status: "discipline_unknown",
    tier: "U",
    relevance_score: 20,
    confidence: 0.3,
    match_reasons: {
      positive: [],
      negative: [],
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

  const r = await rest('govt_job_leads?on_conflict=url_hash&select=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    return { ok: false, error: (await r.text()).slice(0, 200) };
  }

  const rows = await r.json();
  return { ok: true, id: rows[0] && rows[0].id };
}

async function stageCandidate(source, leadId, candidate, classification) {
  const key = dedupeKey(candidate, classification);

  /* Column contract: write ONLY columns that exist in the canonical
     migrations (phase19-govt-pipeline.sql). An unknown column makes
     PostgREST reject the whole row with PGRST204 and stages nothing.
     `payload` (not `full_payload`) is what the human publish gate in
     _api/govt-review.js reads, so staging into a private column would
     leave the row unpublishable. */
  const payload = {
    lead_id: leadId,
    status:
      classification.civil_status === "not_civil"
        ? "needs_info"
        : "pending",
    civil_status: classification.civil_status,
    tier: classification.tier,
    relevance_score: classification.relevance_score,
    confidence: classification.confidence,
    extraction_method: "rules",
    dedupe_key: key,
    match_reasons: classification.match_reasons,
    payload: {
      title: candidate.title,
      organization: candidate.org_hint || source.org || source.name,
      source_url: candidate.source_url,
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

  const r = await rest('govt_job_staging?on_conflict=dedupe_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(payload),
  });

  return {
    ok: r.ok,
    error: r.ok ? null : (await r.text()).slice(0, 200),
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
    /* A blocked robots check is a policy outcome, but an unreachable or
       unverified robots.txt is a dead source. Record it as an error too:
       otherwise a run in which a third of the sources never even fetched
       still reports a clean summary and the admin source-health panel keeps
       showing the previous run's numbers. */
    if (/unreachable|unverified/.test(robots.status)) {
      result.errors.push(robots.status);
    }
    await updateSource(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: robots.status,
      robots_ok: false,
      last_error: result.errors.length ? result.errors[0].slice(0, 300) : null,
    });
    return result;
  }

  const fetched = await fetchSource(source);
  result.fetched = fetched.ok;

  if (!fetched.ok) {
    result.errors.push(fetched.status);
    await updateSource(source.id, {
      last_run_at: new Date().toISOString(),
      last_status: fetched.status,
      robots_ok: true,
      last_error: fetched.status.slice(0, 300),
    });
    return result;
  }

  const adapter = adapterFor(source.url);
  const candidates = adapter
    ? adapterCandidates(fetched.body, source, adapter)
    : extractCandidates(fetched.body, {
      ...source,
      url: fetched.url,
    });

  result.candidates = candidates.length;

  for (const candidate of candidates) {
    const classification = candidate.classification || classifyCivil(
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
      result.staged += 1;
    } else {
      result.errors.push(`stage:${staged.error}`);
    }
  }

  /* items_found / items_staged / last_error back the admin source-health
     panel (govt-review?action=health). Only the GitHub crawler wrote them
     before, so the panel showed zeroes for everything this cron staged. */
  await updateSource(source.id, {
    last_run_at: new Date().toISOString(),
    last_status: result.errors.length
      ? `ok; candidates=${result.candidates}; staged=${result.staged}; errors=${result.errors.length}`
      : `ok; candidates=${result.candidates}; staged=${result.staged}`,
    robots_ok: true,
    items_found: result.candidates,
    items_staged: result.staged,
    last_error: result.errors.length ? result.errors[0].slice(0, 300) : null,
  });

  return result;
}

async function getSources() {
  const select = 'id,name,type,url,kind,org,category,state,enabled,robots_ok,last_run_at,last_status';
  const r = await rest(`govt_sources?select=${select}&enabled=eq.true&order=name`);

  if (!r.ok) throw new Error(`govt_sources read failed: HTTP ${r.status}`);

  return (await r.json()) || [];
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

  /* A full sweep walks every configured source (28+ today) and one slow host
     used to consume the whole serverless budget on its own: the function was
     killed at maxDuration and callers saw 504 (GitHub Actions exit 22).
     Run with bounded concurrency and an explicit deadline, stalest sources
     first, so a run always answers 200 and the next run continues where this
     one stopped. */
  const TIME_BUDGET_MS = 50000;
  const CONCURRENCY = 4;
  const startedAt = Date.now();

  const ordered = [...sources].sort((a, b) => {
    const ta = a.last_run_at ? Date.parse(a.last_run_at) : 0;
    const tb = b.last_run_at ? Date.parse(b.last_run_at) : 0;
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });

  let cursor = 0;
  async function worker() {
    while (cursor < ordered.length && Date.now() - startedAt <= TIME_BUDGET_MS) {
      const source = ordered[cursor];
      cursor += 1;
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
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ordered.length) }, () => worker())
  );

  const deferred = ordered.slice(cursor).map((s) => s.name);

  const summary = {
    sources: sources.length,
    sources_processed: results.length,
    sources_deferred: deferred.length,
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
    deferred,
    note: deferred.length
      ? `Processed ${results.length} of ${sources.length} sources inside the serverless time budget; the rest run first next time and are listed in "deferred". Agent Reach writes only to govt_job_leads and govt_job_staging. Nothing is published and the private jobs table is untouched.`
      : "Agent Reach writes only to govt_job_leads and govt_job_staging. Nothing is published and the private jobs table is untouched.",
  });
};
