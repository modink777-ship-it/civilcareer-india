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
const { adapterFor, selectCivil, classifyRecord, officialNoticeLinks } = require("../lib/govt-aggregators");
const {
  buildPayload,
  keepReviewedFields,
  reviewedAlready,
  isOfficialHost,
  dedupeKey,
  hash,
  extractDeadline,
} = require("../lib/govt-lead-payload");
const { sendCivilDigest, sendPipelineWarning, sendTitleGuard } = require("../lib/govt-alert");
const { auditPublished } = require("../lib/govt-title");

const ROBOTS_UA =
  "CivilCareerBot/1.0 (+https://civilcareer-india-two.vercel.app)";

const REQUEST_GAP_MS = 2000;
const MAX_REDIRECTS = 5;
const robotsCache = new Map();
/* Raw robots.txt per origin, so a posting's own page can be checked against the same
   rules without a second download. */
const robotsText = new Map();
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
    /* source.id is absent when this is a bare robots check for a detail page. */
    if (source.id) {
      await updateSource(source.id, {
        robots_ok: cached.allowed,
        last_status: cached.status,
      });
    }
    return cached;
  }

  const robotsUrl = `${origin}/robots.txt`;
  let result;

  try {
    await politeDelay(robotsUrl);
    const response = await rawFetch(robotsUrl, 10000);

    if (response.status >= 200 && response.status < 300) {
      const allowed = robotsAllows(response.body, sourceUrl);
      robotsText.set(origin, response.body);
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

const BLOCKED_RETRIES = 2;
const BLOCKED_BACKOFF_MS = 1500;

/* One paced request to the source page. */
async function sourceRequest(source) {
  await politeDelay(source.url);
  return rawFetch(source.url, 15000);
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
    let response = await sourceRequest(source);

    /* ka.indgovtjobs.net sits behind Cloudflare: the same declared bot user agent gets
       200 most of the time and an intermittent 403 at others (verified by hand against
       the live host). One pause-and-retry turns most of those into a normal run; when it
       still refuses we say so as a TRANSIENT block, not as a broken source, because the
       page is fine — the site is throttling us. The bot never disguises itself or
       retries harder than this. */
    for (let attempt = 1; attempt <= BLOCKED_RETRIES && (response.status === 403 || response.status === 429); attempt += 1) {
      await sleep(BLOCKED_BACKOFF_MS * attempt);
      response = await sourceRequest(source);
    }

    if (response.status === 403 || response.status === 429) {
      return {
        ok: false,
        status: `transient:http-${response.status}; throttled; retried; stopped`,
        body: "",
        url: response.url,
        transient: true,
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
      /* The site's OWN evidence travels with the candidate: its Qualification column,
         its deadline column, the section it filed the posting under. Without these the
         review queue showed "Deadline — / Qualification — / Posts found —" for every
         aggregator lead, because only the crawler used to carry them. */
      record,
      select,
      verdict,
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

/* Aggregator records are classified from the site's own table, so a detail page is
   fetched only for the records that already survived — and only to attach the real
   official notice URL the publish gate demands. Card listings (allgovernmentjobs,
   linkingsky) publish no qualification or last date at all; the posting's own page
   is where those live. Bounded per source and by the run deadline, so one slow host
   cannot eat the serverless budget. */
const MAX_DETAIL_FETCHES = Number(process.env.GOVT_MAX_DETAIL_FETCHES || 8);

/* How long a "we looked, there was no official link" answer is trusted before the row is
   worth another look. Without an expiry, one misread page would keep a lead unpublishable
   for ever. */
const NOTICE_RECHECK_DAYS = Number(process.env.GOVT_NOTICE_RECHECK_DAYS || 14);

function noticeCheckedRecently(prev) {
  const at = prev && prev.payload && prev.payload.notice_checked_at;
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && (Date.now() - t) < NOTICE_RECHECK_DAYS * 86400000;
}

/* Enrich the rows that still need a notice — not the same first few on every run.

   The old version always started at candidates[0], so with a per-run cap only the first
   few rows of each feed were ever looked at and the rest were unroutable for ever unless
   a human pasted a URL. Now a row that already carries a notice (or was checked inside
   NOTICE_RECHECK_DAYS) is left alone, and the rest are worked oldest-first, so successive
   sweeps walk the whole queue. */
async function attachOfficialNotices(candidates, stopAt, existing) {
  let fetches = 0;
  let errors = 0;
  let skipped = 0;

  const pending = [];
  for (const candidate of candidates) {
    const prev = existing && existing.get
      ? existing.get(dedupeKey(candidate, candidate.classification || {})) || null
      : null;
    candidate.previous = prev;
    if ((prev && isOfficialHost(prev.payload && prev.payload.official_notice_url)) || noticeCheckedRecently(prev)) {
      skipped += 1;
      continue;
    }
    pending.push(candidate);
  }

  /* Longest-waiting first: rows we have never looked at sort before rows we looked at days
     ago, so nothing can starve behind a feed that keeps publishing. */
  pending.sort((a, b) => {
    const ta = a.previous && a.previous.created_at ? Date.parse(a.previous.created_at) : 0;
    const tb = b.previous && b.previous.created_at ? Date.parse(b.previous.created_at) : 0;
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });

  for (const candidate of pending) {
    if (fetches >= MAX_DETAIL_FETCHES) break;
    if (Date.now() > stopAt) break;
    fetches += 1;
    candidate.noticeCheckedAt = new Date().toISOString();

    const own = candidate.source_url;

    /* The aggregator sometimes links straight AT the notification (linkingsky posts a
       direct PDF). If that target is an official host it IS the notice. */
    if (isOfficialHost(own)) {
      candidate.officialNotice = own;
      continue;
    }
    if (/\.pdf(?:$|[?#])/i.test(own)) continue;

    try {
      const detail = await fetchDetail(own);
      if (!detail.ok) { errors += 1; candidate.detail_error = detail.status; continue; }
      candidate.detailText = detail.body;
      candidate.officialNotice = officialNoticeLinks(detail.body, detail.url, isOfficialHost)[0]
        || (isOfficialHost(detail.url) ? detail.url : "")
        || "";
    } catch (error) {
      errors += 1;
      candidate.detail_error = String((error && error.message) || error).slice(0, 120);
    }
  }

  return { fetches, errors, skipped, pending: pending.length };
}

/* One posting page. Same robots policy and pacing as every other request in this
   pipeline: no detail page is fetched that robots.txt disallows. */
async function fetchDetail(url) {
  const allowed = await robotsAllowsUrl(url);
  if (!allowed) return { ok: false, status: "robots_disallows", body: "", url };

  try {
    await politeDelay(url);
    const response = await rawFetch(url, 12000);
    if (![200, 203].includes(response.status)) {
      return { ok: false, status: `http-${response.status}`, body: "", url: response.url };
    }
    return { ok: true, status: `http-${response.status}`, body: response.body, url: response.url };
  } catch (error) {
    return { ok: false, status: `error:${String(error.message || "unknown").slice(0, 80)}`, body: "", url };
  }
}

/* robots.txt for an arbitrary URL (a posting's own page), reusing the text the
   source sweep already downloaded for that origin. A failure here means "do not
   fetch", never "fetch anyway". */
async function robotsAllowsUrl(targetUrl) {
  try {
    const origin = new URL(targetUrl).origin;
    let text = robotsText.get(origin);
    if (text === undefined) {
      await politeDelay(`${origin}/robots.txt`);
      const response = await rawFetch(`${origin}/robots.txt`, 10000);
      text = response.status >= 200 && response.status < 300 ? response.body : "";
      robotsText.set(origin, text);
    }
    return robotsAllows(text, targetUrl);
  } catch (_) {
    return false;
  }
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

/* dedupeKey() / hash() now live in lib/govt-lead-payload.js, next to the payload they
   key on, so scripts/govt-queue-preview.js can predict the queue without duplicating the
   formula. */

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

/* Adapt either candidate shape into the shared payload builder. An adapter candidate
   carries the site's own record; a generic anchor candidate IS the record. */
function stagingPayload(source, candidate, classification) {
  const record = candidate.record || {
    title: candidate.title,
    url: candidate.source_url,
    org: candidate.org_hint,
    postName: candidate.title,
    excerpt: candidate.excerpt,
  };
  const officialNotice = candidate.officialNotice
    || (isOfficialHost(candidate.source_url) ? candidate.source_url : "");

  return buildPayload({
    source,
    record,
    select: candidate.select || {},
    verdict: candidate.verdict || classification,
    officialNotice,
    detailText: candidate.detailText || "",
    /* Recorded so the next sweep knows this page was already read. */
    noticeCheckedAt: candidate.noticeCheckedAt || null,
  });
}

/* One read of the rows this sweep is about to overwrite, keyed by dedupe_key. The staging
   write is an upsert on dedupe_key, which REPLACES the payload — so without this a notice a
   reviewer pasted would be wiped by the next sweep two hours later, and a row a reviewer
   had already rejected or published would come back as pending.

   Scoped by the keys themselves (≤30 per source, 64 chars each) using the same
   `?col=in.(...)` shape the rest of this codebase already sends in production — a jsonb
   path filter would be new, unproven syntax against the live gateway. */
async function existingStaging(keys) {
  const map = new Map();
  const list = (keys || []).filter(Boolean).slice(0, 30);
  if (!list.length) return map;
  try {
    const inList = list.map((k) => `"${String(k).replace(/"/g, "")}"`).join(",");
    const r = await rest(
      `govt_job_staging?dedupe_key=in.(${encodeURIComponent(inList)})`
        + "&select=dedupe_key,status,payload,created_at"
    );
    if (!r.ok) return map;
    for (const row of (await r.json()) || []) {
      if (row && row.dedupe_key) map.set(row.dedupe_key, row);
    }
  } catch (_) {
    /* A failed read must not stop the sweep: worst case the upsert behaves as before. */
  }
  return map;
}

async function stageCandidate(source, leadId, candidate, classification, existing) {
  const key = dedupeKey(candidate, classification);
  const prev = existing && existing.get ? existing.get(key) : null;

  /* A human already decided this one. Re-staging it as pending would put a rejected lead
     back in front of the reviewer every two hours and could duplicate a published job. */
  if (reviewedAlready(prev)) {
    return { ok: true, error: null, skipped: 'already_reviewed' };
  }
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
    /* ONE payload shape, built by lib/govt-lead-payload.js and shared with the GitHub
       crawler. It carries the aggregator's own evidence (qualification, deadline,
       vacancies, source_section, civil_evidence) and — critically — leaves
       official_notice_url EMPTY unless a real government/PSU link was found. Writing
       the aggregator's own article URL there is what made every queued row look
       publishable while the publish gate refused all of them. */
    payload: keepReviewedFields(stagingPayload(source, candidate, classification), prev),
  };

  /* A notice the reviewer pasted, and the lead URL it arrived on, survive the re-crawl.
     Only a link the publish gate accepts is carried over — never an aggregator URL. */
  if (prev && prev.status === 'needs_info' && payload.payload.official_notice_url) {
    payload.status = 'pending';
  }

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

async function processSource(source, stopAt) {
  const result = {
    source: source.name,
    source_id: source.id,
    robots: null,
    fetched: false,
    candidates: 0,
    staged: 0,
    detail_fetches: 0,
    official_links: 0,
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
  let candidates;
  /* The rows this sweep is about to overwrite, read once. The key each candidate will get
     is computed the same way here and in the loop below. */
  let existing = new Map();

  if (adapter) {
    candidates = adapterCandidates(fetched.body, source, adapter);
    result.candidates = candidates.length;
    existing = await existingStaging(
      candidates.map((candidate) => dedupeKey(
        candidate,
        candidate.classification || classifyCivil(candidate.title, candidate.excerpt)
      ))
    );
    /* Only the rows that already survived cost a fetch, and only to attach the real
       official notice link (plus the qualification/last date the card listings never
       publish). Bounded per source and by the run deadline. */
    const detail = await attachOfficialNotices(candidates, stopAt, existing);
    result.detail_fetches = detail.fetches;
    result.official_links = candidates.filter((c) => c.officialNotice).length;
    result.notice_pending = detail.pending;
    result.notice_settled = detail.skipped;
    if (detail.errors) result.errors.push(`detail:${detail.errors} page(s) failed`);
  } else {
    candidates = extractCandidates(fetched.body, {
      ...source,
      url: fetched.url,
    });
    result.candidates = candidates.length;
    /* The same pre-read, so an official source's rejected row is not resurrected either. */
    existing = await existingStaging(
      candidates.map((candidate) => dedupeKey(
        candidate,
        candidate.classification || classifyCivil(candidate.title, candidate.excerpt)
      ))
    );
  }

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
      classification,
      existing
    );

    if (staged.ok) {
      if (staged.skipped) result.skipped_reviewed = (result.skipped_reviewed || 0) + 1;
      else result.staged += 1;
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

/* Source rows are defined by config/govt-sources.json, and only the GitHub
   crawler used to seed them. When that workflow cannot run, a table that was
   emptied or never seeded leaves this sweep reporting a clean "0 sources" — a
   silent freeze, with the panel showing nothing wrong. Seed here too, with the
   same idempotent upsert by url, so a cron run is self-sufficient.

   Loaded defensively: if the bundler ever excludes config/, the sweep must
   still run rather than fail at module load. */
let SOURCE_CONFIG = null;
try {
  SOURCE_CONFIG = require("../config/govt-sources.json");
} catch (_) {
  SOURCE_CONFIG = null;
}

async function ensureSources() {
  const sources =
    SOURCE_CONFIG && Array.isArray(SOURCE_CONFIG.sources)
      ? SOURCE_CONFIG.sources
      : null;

  if (!sources || !sources.length) {
    return { seeded: 0, error: "source config unavailable" };
  }

  /* Only the config's own keys are sent: the seeder spreads this object into
     PostgREST, and an unknown column rejects the whole batch (PGRST204).
     merge-duplicates leaves last_status / items_* on an existing row alone. */
  const payload = sources.map((s) => ({ ...s, enabled: Boolean(s.enabled) }));
  const r = await rest("govt_sources?on_conflict=url", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    return {
      seeded: 0,
      error: `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`,
    };
  }

  const rows = await r.json();
  return { seeded: Array.isArray(rows) ? rows.length : 0, error: null };
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
  robotsText.clear();
  hostLastRequest.clear();

  const seed = await ensureSources();

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

  /* Detail fetches stop here, leaving room for the staging writes that follow. */
  const detailStopAt = startedAt + TIME_BUDGET_MS - 6000;

  let cursor = 0;
  async function worker() {
    while (cursor < ordered.length && Date.now() - startedAt <= TIME_BUDGET_MS) {
      const source = ordered[cursor];
      cursor += 1;
      try {
        results.push(await processSource(source, detailStopAt));
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

  /* Tell the owner what is waiting. One query for everything this run actually
     inserted — the alternate path, a per-candidate existence check, would add a
     request per posting inside a 50 s budget. The other writer (the GitHub
     crawler) alerts from its own dedupe, so whichever runs second sees the rows
     already staged and stays quiet. Best effort: never fails the response. */
  let alert = { sent: false, skipped: "nothing-new", error: null };
  try {
    const since = new Date(startedAt).toISOString();
    const fresh = await rest(
      `govt_job_staging?select=status,payload&created_at=gte.${encodeURIComponent(since)}`
        + `&civil_status=in.(civil,multi_incl_civil)&order=created_at.desc&limit=25`
    );
    const rows = fresh.ok ? (await fresh.json()) || [] : [];
    alert = await sendCivilDigest(
      rows.map((r) => ({
        title: (r.payload && r.payload.title) || "(untitled)",
        organization: (r.payload && r.payload.organization) || "",
        qualification: (r.payload && r.payload.qualification) || "",
        deadline: (r.payload && r.payload.deadline && r.payload.deadline.date) || "",
        source: (r.payload && r.payload.source_url) || "",
      })),
      { siteUrl: process.env.SITE_URL }
    );
  } catch (e) {
    alert = { sent: false, skipped: null, error: String((e && e.message) || e).slice(0, 160) };
  }

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

  /* Silence is the failure mode that hurt most: the queue froze while every health
     signal still looked clean. A run that seeds no source, or that parses nothing from
     any source while reporting no errors at all, is a broken pipeline rather than a
     quiet day. Say it out loud instead of waiting for someone to notice. */
  const stalled = !seed.seeded || Boolean(seed.error)
    || (summary.sources > 0 && summary.candidates === 0 && summary.errors === 0);

  let warning = { sent: false, skipped: null, error: null };
  if (stalled) {
    const reason = seed.error
      ? `Could not seed govt_sources: ${seed.error}`
      : !seed.seeded
        ? "The sweep seeded 0 sources — the govt_sources table is empty."
        : `All ${summary.sources} sources ran clean but produced no candidates at all.`;
    warning = await sendPipelineWarning(reason, { siteUrl: process.env.SITE_URL });
  }

  /* Title guard: the same read-only sweep the crawler runs, from the other
     writer. Rows published before the title gate still carry their link-text
     titles on the public list; say so on every run until they are fixed.
     Best effort — never fails the response. */
  let titleGuard = { sent: false, skipped: "not-run", error: null };
  try {
    const pub = await rest(`govt_jobs?status=eq.active&select=id,title,slug,post_name&order=published_at.desc&limit=500`);
    if (pub.ok) {
      const report = auditPublished((await pub.json()) || []);
      titleGuard = await sendTitleGuard(report, { siteUrl: process.env.SITE_URL });
    } else {
      titleGuard = { sent: false, skipped: "read-failed", error: `HTTP ${pub.status}` };
    }
  } catch (e) {
    titleGuard = { sent: false, skipped: null, error: String((e && e.message) || e).slice(0, 160) };
  }

  return res.status(200).json({
    ok: true,
    seeded: seed.seeded,
    seed_error: seed.error,
    summary,
    alert,
    stalled,
    warning,
    title_guard: titleGuard,
    results,
    deferred,
    note: deferred.length
      ? `Processed ${results.length} of ${sources.length} sources inside the serverless time budget; the rest run first next time and are listed in "deferred". Agent Reach writes only to govt_job_leads and govt_job_staging. Nothing is published and the private jobs table is untouched.`
      : "Agent Reach writes only to govt_job_leads and govt_job_staging. Nothing is published and the private jobs table is untouched.",
  });
};
