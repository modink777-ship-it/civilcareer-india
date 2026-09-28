'use strict';

const { allowPublicCors } = require('../lib/security');

/**
 * CivilCareer — YouTube Study Materials
 * POST /api/youtube-materials { url, title?, category? }
 *
 * TRANSCRIPT PIPELINE (replicates what working downloaders do in 2025+ —
 * bare timedtext URLs and anonymous InnerTube calls are bot-gated):
 *
 *   1. WATCH-PAGE SESSION — fetch the video page with a real browser UA,
 *      collect its Set-Cookie jar and the `visitorData` token embedded in
 *      the page HTML. This session is what makes YouTube treat us as a
 *      real client.
 *   2. VISIONOS PLAYER — InnerTube player call as the visionOS client
 *      (clientName VISIONOS, X-YouTube-Client-Name 101), passing the page
 *      session (cookies + X-Goog-Visitor-Id). Returns playability OK and
 *      caption tracks with signed baseUrls. Falls back to the watch page's
 *      own ytInitialPlayerResponse tracks if the API call is refused.
 *   3. TRACK PICK — manual English → auto (ASR) English → any en-* → any
 *      language auto-translated to English (&tlang=en).
 *   4. CONTENT — per track: fmt=json3 → fmt=srv3 (XML <p>/<text>) → fmt=vtt,
 *      always sent WITH the page session cookies.
 */

const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

function db(path, opts = {}) {
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

function isAdmin(req) {
  return req.headers['x-owner-key'] === process.env.OWNER_KEY;
}

// ── Video ID extraction ──────────────────────────────────────────────────

function extractVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  } catch (_) {}
  const m = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

// ── Category detection ───────────────────────────────────────────────────

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  if (/gate|ese/.test(t)) return 'GATE / ESE Prep';
  if (/ssc\s?je|rrb\s?je/.test(t)) return 'SSC JE / RRB JE';
  if (/structural|rcc|reinforced|concrete/.test(t)) return 'Structural Engineering';
  if (/highway|transport|traffic/.test(t)) return 'Transportation';
  if (/geotechnical|soil|foundation/.test(t)) return 'Geotechnical';
  if (/fluid|hydraulic|hydrology/.test(t)) return 'Fluid Mechanics';
  if (/survey|levell|theodolite/.test(t)) return 'Surveying';
  if (/quantity|qs|boq|billing/.test(t)) return 'Quantity Surveying';
  if (/autocad|revit|staad|etabs|primavera/.test(t)) return 'Software & Tools';
  return 'Civil Engineering';
}

// ── JSON helpers ─────────────────────────────────────────────────────────

/** Extract a balanced JSON object that follows a JS assignment marker. */
function extractJsonAfter(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  const maxEnd = Math.min(html.length, start + 2000000);
  for (let i = start; i < maxEnd; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function captionTracksFrom(playerResponse) {
  try {
    const renderer =
      playerResponse &&
      playerResponse.captions &&
      playerResponse.captions.playerCaptionsTracklistRenderer;
    const tracks = (renderer && renderer.captionTracks) || [];
    return Array.isArray(tracks) ? tracks : [];
  } catch { return []; }
}

// ── Step 1: watch-page session ───────────────────────────────────────────

async function fetchWatchSession(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'SOCS=CAI; CONSENT=YES+cb.20210328-17-p0.en+FX+678; PREF=hl=en&gl=IN',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`YouTube watch page HTTP ${r.status}`);
  const html = await r.text();

  // Session cookies from this visit (each Set-Cookie trimmed to name=value).
  let cookieHeader = 'SOCS=CAI; CONSENT=YES+cb.20210328-17-p0.en+FX+678; PREF=hl=en&gl=IN';
  try {
    const set = (typeof r.headers.getSetCookie === 'function') ? r.headers.getSetCookie() : [];
    if (set.length) {
      cookieHeader = [cookieHeader, ...set.map((c) => c.split(';')[0])].join('; ');
    }
  } catch { /* keep default jar */ }

  // visitorData token — the session identity InnerTube calls expect.
  let visitorData = null;
  const vd = html.match(/"visitorData":"([^"]+)"/);
  if (vd) visitorData = vd[1];

  // Page's own player response — fallback track source + video metadata.
  const pagePR = extractJsonAfter(html, 'ytInitialPlayerResponse');
  const pageTracks = captionTracksFrom(pagePR);

  let videoDetails = (pagePR && pagePR.videoDetails) || null;
  if (!videoDetails) {
    const t = html.match(/<title>([^<]+)<\/title>/);
    if (t) videoDetails = { title: t[1].replace(/ - YouTube$/, '').trim() };
  }

  return { cookieHeader, visitorData, pageTracks, videoDetails };
}

// ── Step 2: VISIONOS InnerTube player ────────────────────────────────────

async function visionosPlayer(videoId, session) {
  try {
    const client = {
      clientName: 'VISIONOS',
      clientVersion: '1.02',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      userAgent: BROWSER_UA,
      osName: 'visionOS',
      osVersion: '26.5.23O471',
      hl: 'en',
      gl: 'IN',
      utcOffsetMinutes: 330,
    };
    if (session.visitorData) client.visitorData = session.visitorData;

    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
        'X-YouTube-Client-Name': '101',
        'X-YouTube-Client-Version': '1.02',
        'X-Goog-Visitor-Id': session.visitorData || '',
        Origin: 'https://www.youtube.com',
        'X-Origin': 'https://www.youtube.com',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: session.cookieHeader,
      },
      body: JSON.stringify({
        videoId,
        context: { client },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { tracks: [], videoDetails: null, status: `HTTP ${r.status}` };
    const pr = await r.json();
    const playability = pr && pr.playabilityStatus && pr.playabilityStatus.status;
    const tracks = captionTracksFrom(pr);
    return { tracks, videoDetails: (pr && pr.videoDetails) || null, status: playability || 'UNKNOWN' };
  } catch (e) {
    return { tracks: [], videoDetails: null, status: e && e.message ? e.message : 'error' };
  }
}

// ── Step 3: track selection ──────────────────────────────────────────────

/**
 * Pick the best track. Returns { track, translateTo } where translateTo is
 * set when we must ask YouTube to auto-translate the chosen track into
 * English via &tlang=en.
 */
function pickTrack(tracks) {
  if (!tracks.length) return null;
  const isEn = (t) => /^en([-_]|$)/i.test(String(t.languageCode || ''));

  const manualEn = tracks.filter((t) => isEn(t) && t.kind !== 'asr');
  if (manualEn.length) return { track: manualEn[0], translateTo: null };

  const autoEn = tracks.filter((t) => isEn(t));
  if (autoEn.length) return { track: autoEn[0], translateTo: null };

  // No English track at all → take any track and auto-translate to English.
  const manualAny = tracks.filter((t) => t.kind !== 'asr');
  const any = manualAny.length ? manualAny : tracks;
  return { track: any[0], translateTo: 'en' };
}

// ── Step 4: caption content fetching (multiple formats) ──────────────────

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function json3Lines(json) {
  const events = (json && json.events) || [];
  const lines = [];
  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs)) continue;
    const text = ev.segs.map((s) => (s && s.utf8) || '').join('').replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  }
  return lines;
}

function vttLines(vtt) {
  const out = [];
  for (const raw of vtt.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^WEBVTT|^NOTE|^Kind:|^Language:|^\d+$|-->/.test(line)) continue;
    const cleaned = decodeEntities(line.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function xmlLines(xml) {
  // srv3 uses <p> elements (with nested <s> segments); legacy srv uses <text>.
  const out = [];
  const re = /<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const cleaned = decodeEntities(m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

async function fetchTrackText(baseUrl, translateTo, cookieHeader) {
  const url = baseUrl + (translateTo ? `&tlang=${translateTo}` : '');
  for (const fmt of ['json3', 'srv3', 'vtt']) {
    try {
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}fmt=${fmt}`, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: 'https://www.youtube.com',
          Cookie: cookieHeader,
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const body = await r.text();
      if (!body || body.length < 10) continue;
      if (fmt === 'json3') {
        try {
          const lines = json3Lines(JSON.parse(body));
          if (lines.length) return lines;
        } catch { /* try next format */ }
        continue;
      }
      if (fmt === 'srv3') {
        const lines = xmlLines(body);
        if (lines.length) return lines;
        continue;
      }
      const lines = vttLines(body);
      if (lines.length) return lines;
    } catch { /* try next format */ }
  }
  return null;
}

// ── Full transcript resolution ───────────────────────────────────────────

async function getTranscript(videoId) {
  // Step 1 — establish a real page session.
  const session = await fetchWatchSession(videoId);

  // Step 2 — VISIONOS player with the session (preferred track source).
  let tracks = [];
  let videoDetails = null;
  const api = await visionosPlayer(videoId, session);
  if (api.tracks.length) {
    tracks = api.tracks;
    if (api.videoDetails) videoDetails = api.videoDetails;
  }

  // Fallback — the watch page's own player response (same session).
  if (!tracks.length && session.pageTracks.length) {
    tracks = session.pageTracks;
    const st = api.status || 'no tracks';
    console.log(`youtube-materials: VISIONOS player unusable (${st}); using watch-page caption tracks`);
  }
  if (!videoDetails && session.videoDetails) videoDetails = session.videoDetails;

  if (!tracks.length) {
    throw new Error(
      'No caption tracks available for this video (YouTube reported none in any language). ' +
      'Double-check the video actually shows a CC button on YouTube, then try again.'
    );
  }

  // Steps 3 & 4 — pick the best track and download its content.
  const pick = pickTrack(tracks);
  const lines = await fetchTrackText(pick.track.baseUrl, pick.translateTo, session.cookieHeader);

  if (!lines || !lines.length) {
    const langs = Array.from(new Set(tracks.map((t) => String(t.languageCode || '?')))).join(', ');
    throw new Error(
      `Found caption tracks (${langs}) but could not download their content. ` +
      'This is usually temporary — please retry in a minute.'
    );
  }

  return {
    lines,
    trackInfo: {
      language: String(pick.track.languageCode || ''),
      kind: pick.track.kind === 'asr' ? 'auto' : 'manual',
      translated: Boolean(pick.translateTo),
    },
    videoDetails,
  };
}

// ── Lines → readable paragraphs ──────────────────────────────────────────

function linesToTranscript(rawLines) {
  // Collapse rolling-caption duplicates (same line repeated back-to-back).
  const lines = [];
  for (const l of rawLines) {
    if (!lines.length || lines[lines.length - 1] !== l) lines.push(l);
  }

  const fullText = lines.join(' ').replace(/\s+/g, ' ').trim();
  const words = fullText.split(/\s+/).filter(Boolean);

  // Group into ~250-word paragraphs.
  const paragraphs = [];
  for (let i = 0; i < words.length; i += 250) {
    paragraphs.push(words.slice(i, i + 250).join(' '));
  }

  return { text: paragraphs.join('\n\n'), wordCount: words.length };
}

// ── Main handler ─────────────────────────────────────────────────────────

async function handler(req, res) {
  allowPublicCors(req, res, { methods: 'POST, OPTIONS', headers: 'Content-Type, x-owner-key' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only.' });
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Admin key required.' });
  if (!SUPA || !KEY) return res.status(500).json({ ok: false, error: 'Supabase not configured.' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { url, title: customTitle, category: customCategory } = body;
  if (!url) return res.status(400).json({ ok: false, error: 'Request body must include `url`.' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ ok: false, error: 'Invalid YouTube URL.' });

  try {
    const { lines, trackInfo, videoDetails } = await getTranscript(videoId);
    const { text: transcript, wordCount } = linesToTranscript(lines);

    if (wordCount < 20) {
      return res.status(422).json({
        ok: false,
        error: 'Transcript too short. Try a longer video.',
      });
    }

    const title = (videoDetails && videoDetails.title) || 'Untitled Video';
    const channel = (videoDetails && videoDetails.author) || 'Unknown Channel';
    const lengthSec = videoDetails && videoDetails.lengthSeconds ? parseInt(videoDetails.lengthSeconds, 10) : 0;
    const durationText = lengthSec
      ? `${Math.floor(lengthSec / 3600)}h ${Math.floor((lengthSec % 3600) / 60)}m`
      : 'Unknown duration';

    const finalTitle = customTitle || title;
    const finalCategory = customCategory || detectCategory(finalTitle);
    const trackDesc = trackInfo.kind === 'auto' ? 'auto-generated' : 'closed captions';
    const desc = `Channel: ${channel} · Duration: ${durationText} · ~${wordCount.toLocaleString()} words · ${trackInfo.language}${trackInfo.translated ? ' → en (translated)' : ''} (${trackDesc})`;

    const payload = {
      title_en: finalTitle.slice(0, 255),
      description_en: desc.slice(0, 600),
      content: transcript,
      file_url: `https://www.youtube.com/watch?v=${videoId}`,
      source_url: `https://www.youtube.com/watch?v=${videoId}`,
      category: finalCategory,
      access_type: 'Free',
      published: false,
      review_state: 'Pending Review',
      auto_discovered: true,
    };

    const ins = await db('materials', { method: 'POST', body: JSON.stringify(payload) });
    if (!ins.ok) {
      const errText = await ins.text();
      return res.status(500).json({ ok: false, error: 'Database insert failed.', details: errText });
    }

    const [material] = await ins.json();
    return res.status(201).json({
      ok: true,
      stats: {
        videoId,
        title: finalTitle,
        channel,
        duration: durationText,
        transcriptWords: wordCount,
        captionTrack: trackInfo,
      },
      material,
    });
  } catch (err) {
    console.error('YouTube materials error:', err && err.message);
    return res.status(422).json({
      ok: false,
      error: err.message || 'Could not extract transcript from this video.',
    });
  }
}

/* handler is the Vercel entry point; internals are exposed so local test
   scripts can exercise the pipeline (harmless at runtime). */
module.exports = handler;
module.exports.extractVideoId = extractVideoId;
module.exports.getTranscript = getTranscript;
module.exports.linesToTranscript = linesToTranscript;
