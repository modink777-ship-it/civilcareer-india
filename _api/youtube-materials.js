'use strict';

/**
 * CivilCareer — YouTube Study Materials
 * POST /api/youtube-materials { url, title?, category? }
 *
 * Uses YouTube's public caption endpoint (no API key, no auth needed).
 * Much more reliable than InnerTube API which requires authentication.
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

// ── Fetch video metadata from YouTube page ───────────────────────────────

async function fetchVideoMetadata(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!r.ok) throw new Error(`YouTube page HTTP ${r.status}`);
  const html = await r.text();

  // Extract title from <title> tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch
    ? titleMatch[1].replace(' - YouTube', '').replace(/\s*\|\s*YouTube\s*$/, '').trim()
    : 'Untitled Video';

  // Extract duration from initial data
  const durationMatch = html.match(/"duration":"(\d+)"/);
  const duration = durationMatch ? Math.floor(parseInt(durationMatch[1], 10)) : 0;

  const durationText = duration
    ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
    : 'Unknown duration';

  // Try to get channel name from metadata
  const channelMatch = html.match(/"author":"([^"]+)"/);
  const channel = channelMatch ? channelMatch[1] : 'Unknown Channel';

  return { title, channel, duration, durationText };
}

// ── Fetch captions via YouTube's public endpoint ──────────────────────────

async function fetchCaptions(videoId) {
  // Get caption list
  const captionListUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
  const listResp = await fetch(captionListUrl, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (!listResp.ok) {
    throw new Error('Video has no captions. Enable closed captions (CC) on YouTube and try again.');
  }
  const listXml = await listResp.text();

  // Find English caption track
  const trackMatch = listXml.match(/lang_code="en"[^>]*name="([^"]*)"[^>]*lang="en"[^>]*yt:format_rank="(\d+)"[^>]*>[\s\S]*?<\/track>|<track[^>]*lang="en"[^>]*>/);
  if (!trackMatch) {
    throw new Error('No English captions found. Try a video with English closed captions.');
  }

  // Get first track (usually auto or English)
  const enMatch = listXml.match(/lang="en"/);
  if (!enMatch) {
    throw new Error('No English captions available.');
  }

  // Fetch captions in VTT format (easier to parse than XML)
  const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=vtt`;
  const captResp = await fetch(captionUrl, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (!captResp.ok) {
    throw new Error('Could not fetch captions (HTTP ' + captResp.status + ')');
  }
  const vttText = await captResp.text();
  return vttText;
}

// ── Parse VTT captions into readable text ────────────────────────────────

function parseVTT(vttText) {
  const lines = vttText.split('\n');
  const textLines = [];
  let inContent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip timecodes and metadata
    if (!trimmed || /^WEBVTT|^NOTE|^\d{2}:\d{2}/.test(trimmed)) continue;
    // Remove HTML tags
    const cleaned = trimmed
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) textLines.push(cleaned);
  }

  const fullText = textLines.join(' ');
  const words = fullText.split(/\s+/);

  // Group into ~250-word paragraphs
  const paragraphs = [];
  for (let i = 0; i < words.length; i += 250) {
    paragraphs.push(words.slice(i, i + 250).join(' '));
  }

  return { text: paragraphs.join('\n\n'), wordCount: words.length };
}

// ── Main handler ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
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
    // Fetch metadata
    const meta = await fetchVideoMetadata(videoId);
    
    // Fetch captions
    const vttText = await fetchCaptions(videoId);
    
    // Parse captions
    const { text: transcript, wordCount } = parseVTT(vttText);
    
    if (wordCount < 20) {
      return res.status(422).json({
        ok: false,
        error: 'Transcript too short. Try a longer video.',
      });
    }

    // Prepare material record
    const finalTitle = customTitle || meta.title;
    const finalCategory = customCategory || detectCategory(finalTitle + ' ' + meta.title);
    const desc = `Channel: ${meta.channel} · Duration: ${meta.durationText} · ~${wordCount.toLocaleString()} words`;

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
      stats: { videoId, title: finalTitle, channel: meta.channel, duration: meta.durationText, transcriptWords: wordCount },
      material,
    });

  } catch (err) {
    console.error('YouTube materials error:', err);
    return res.status(422).json({
      ok: false,
      error: err.message || 'Could not extract transcript from this video.',
    });
  }
};
