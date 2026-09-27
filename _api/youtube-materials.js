'use strict';

/**
 * CivilCareer — YouTube Study Materials Transcriber
 * POST /api/youtube-materials  (admin key required)
 *
 * WHY InnerTube API instead of HTML scraping:
 *   YouTube serves Cloudflare bot-detection HTML (not real content) to
 *   server-side requests. The ytInitialPlayerResponse regex approach therefore
 *   fails 100% of the time from Vercel. The InnerTube API is what the YouTube
 *   Android app uses — it requires no API key, is publicly accessible from any
 *   IP, and reliably returns full caption track data.
 *
 * Body: { url, title?, category? }
 */

const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractVideoId(url) {
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

function formatDuration(seconds) {
  const s = parseInt(seconds, 10) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ── InnerTube player request ─────────────────────────────────────────────────
// Uses the official YouTube Android client context — no API key required.
// This is a documented public endpoint used by the YouTube mobile app.

async function fetchPlayerData(videoId) {
  const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // public Android client key
  const url = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;

  const body = JSON.stringify({
    videoId,
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '17.31.35',
        androidSdkVersion: 30,
        userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
        hl: 'en',
        gl: 'IN',
        utcOffsetMinutes: 330,
      },
    },
    playbackContext: {
      contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' },
    },
    racyCheckOk: true,
    contentCheckOk: true,
  });

  const r = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '17.31.35',
      'Origin': 'https://www.youtube.com',
    },
    body,
  });

  if (!r.ok) throw new Error(`InnerTube API returned HTTP ${r.status}`);
  const data = await r.json();

  // playabilityStatus check
  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason = data?.playabilityStatus?.reason || status;
    throw new Error(`Video not playable: ${reason}`);
  }

  return data;
}

// ── Caption fetch + parse ─────────────────────────────────────────────────────

async function fetchCaptionXml(trackUrl) {
  const r = await fetch(trackUrl + '&fmt=xml', {
    signal: AbortSignal.timeout(14000),
    headers: { 'User-Agent': 'CivilCareer-YT/1.0' },
  });
  if (!r.ok) throw new Error(`Caption fetch HTTP ${r.status}`);
  return r.text();
}

function captionXmlToText(xml) {
  const textRe = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  const parts = [];
  let m;
  while ((m = textRe.exec(xml)) !== null) {
    const decoded = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/\n/g, ' ').trim();
    if (decoded) parts.push(decoded);
  }
  // Group into ~250-word paragraphs
  const words = parts.join(' ').split(/\s+/).filter(Boolean);
  const paragraphs = [];
  for (let i = 0; i < words.length; i += 250) {
    paragraphs.push(words.slice(i, i + 250).join(' '));
  }
  return paragraphs.join('\n\n');
}

async function fetchCaptionJson3(trackUrl) {
  const r = await fetch(trackUrl + '&fmt=json3', {
    signal: AbortSignal.timeout(14000),
    headers: { 'User-Agent': 'CivilCareer-YT/1.0' },
  });
  if (!r.ok) throw new Error(`Caption fetch HTTP ${r.status}`);
  const data = await r.json();
  const events = (data.events || []).filter(e => e.segs && e.segs.length);
  const words = events
    .flatMap(e => e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')))
    .join(' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

  const paragraphs = [];
  for (let i = 0; i < words.length; i += 250) {
    paragraphs.push(words.slice(i, i + 250).join(' '));
  }
  return paragraphs.join('\n\n');
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only.' });
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Admin key required.' });
  if (!SUPA || !KEY) return res.status(500).json({ ok: false, error: 'Supabase not configured.' });

  // Parse body
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { url, title: customTitle, category: customCategory } = body;

  if (!url) return res.status(400).json({ ok: false, error: 'Request body must include `url`.' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ ok: false, error: 'Cannot extract a YouTube video ID from that URL.' });

  // ── Step 1: Get player data via InnerTube ────────────────────────────────
  let playerData;
  try {
    playerData = await fetchPlayerData(videoId);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Could not load video: ${err.message}` });
  }

  const details  = playerData.videoDetails || {};
  const ytTitle  = details.title || 'Untitled Video';
  const ytAuthor = details.author || 'Unknown Channel';
  const ytLength = details.lengthSeconds || '0';

  // ── Step 2: Find caption tracks ──────────────────────────────────────────
  const tracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (!tracks.length) {
    return res.status(422).json({
      ok: false,
      error: 'This video has no closed captions (CC). Only videos with CC enabled can be transcribed. Try a video that shows the CC button in YouTube.',
    });
  }

  // Prefer English, then any auto-generated, then first available
  const track =
    tracks.find(t => t.languageCode === 'en' && !t.kind?.includes('asr')) ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.kind?.includes('asr')) ||
    tracks[0];

  const trackUrl = track.baseUrl;
  if (!trackUrl) {
    return res.status(422).json({ ok: false, error: 'Caption track URL not available for this video.' });
  }

  // ── Step 3: Fetch and parse captions ─────────────────────────────────────
  let transcriptText;
  try {
    // Try json3 first, fall back to xml
    try {
      transcriptText = await fetchCaptionJson3(trackUrl);
    } catch {
      const xml = await fetchCaptionXml(trackUrl);
      transcriptText = captionXmlToText(xml);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Caption fetch failed: ${err.message}` });
  }

  const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 20) {
    return res.status(422).json({
      ok: false,
      error: 'Transcript is too short to be useful (fewer than 20 words). The video may have auto-generated captions that are empty.',
    });
  }

  // ── Step 4: Save to Supabase ─────────────────────────────────────────────
  const finalTitle    = customTitle || ytTitle;
  const finalCategory = customCategory || detectCategory(finalTitle + ' ' + ytTitle);
  const durationFmt   = formatDuration(ytLength);
  const descLine      = `Channel: ${ytAuthor} · Duration: ${durationFmt} · ~${wordCount.toLocaleString()} words`;

  const payload = {
    title_en:      finalTitle.slice(0, 255),
    description_en: descLine.slice(0, 600),
    content:       transcriptText,
    file_url:      `https://www.youtube.com/watch?v=${videoId}`,
    source_url:    `https://www.youtube.com/watch?v=${videoId}`,
    category:      finalCategory,
    access_type:   'Free',
    published:     false,
    review_state:  'Pending Review',
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
    stats: { videoId, title: finalTitle, channel: ytAuthor, duration: durationFmt, transcriptWords: wordCount },
    material,
  });
};
