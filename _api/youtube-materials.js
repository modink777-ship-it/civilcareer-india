'use strict';

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

// Extract YouTube video ID from a URL
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    const v = u.searchParams.get('v');
    if (v) return v;
    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1];
  } catch (_) { /* fall through */ }
  const re = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/;
  const m = re.exec(url);
  return m ? m[1] : null;
}

// Auto-detect category from title text
function detectCategory(text) {
  const lower = (text || '').toLowerCase();
  if (/gate|ese/.test(lower)) return 'GATE / ESE Prep';
  if (/ssc\s?je|rrb\s?je/.test(lower)) return 'SSC JE / RRB JE';
  if (/structural|rcc|reinforced|concrete/.test(lower)) return 'Structural Engineering';
  if (/highway|transport|traffic/.test(lower)) return 'Transportation';
  if (/geotechnical|soil\s?mechanics|foundation/.test(lower)) return 'Geotechnical';
  if (/fluid\s?mechanics|hydraulic|hydrology/.test(lower)) return 'Fluid Mechanics';
  if (/survey|levelling|theodolite/.test(lower)) return 'Surveying';
  if (/quantity|qs|bill\s?of\s?quantities|boq/.test(lower)) return 'Quantity Surveying';
  return 'Civil Engineering';
}

// Convert seconds to a human-readable duration
function formatDuration(seconds) {
  const s = parseInt(seconds, 10) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Parse YouTube json3 caption format into plain-text paragraphs (~300 words each)
function captionsToText(json3) {
  const events = (json3.events || []).filter(e => e.segs && e.segs.length);
  const words = events
    .flatMap(e => e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split into ~300-word paragraphs
  const wordArr = words.split(' ');
  const paragraphs = [];
  for (let i = 0; i < wordArr.length; i += 300) {
    paragraphs.push(wordArr.slice(i, i + 300).join(' '));
  }
  return paragraphs.join('\n\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only.' });
  }

  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Admin key required.' });
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase configuration missing.' });
  }

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const { url, title: customTitle, category: customCategory } = body;

  if (!url) {
    return res.status(400).json({ ok: false, error: 'Request body must include a `url` field.' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ ok: false, error: 'Could not extract a YouTube video ID from the URL provided.' });
  }

  // Step 1: Fetch the YouTube watch page
  let pageHtml;
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CivilCareer-Bot/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!pageRes.ok) throw new Error(`YouTube page returned HTTP ${pageRes.status}`);
    pageHtml = await pageRes.text();
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Failed to fetch YouTube page: ${err.message}` });
  }

  // Step 2: Extract ytInitialPlayerResponse JSON
  const playerMatch = /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*(?:var |window\.|<\/script>)/.exec(pageHtml);
  if (!playerMatch) {
    return res.status(500).json({ ok: false, error: 'Could not find player data on the YouTube page. The video may be private or unavailable.' });
  }

  let playerData;
  try {
    playerData = JSON.parse(playerMatch[1]);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Could not parse YouTube player data.' });
  }

  // Step 3: Extract video metadata
  const videoDetails = playerData.videoDetails || {};
  const ytTitle    = videoDetails.title || 'Untitled Video';
  const ytChannel  = videoDetails.author || 'Unknown Channel';
  const ytDuration = videoDetails.lengthSeconds || '0';

  // Step 4: Find caption tracks
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!captionTracks.length) {
    return res.status(500).json({ ok: false, error: 'No captions available for this video. Only videos with closed captions (CC) can be transcribed.' });
  }

  // Prefer English, fall back to first available
  const track = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
  const captionUrl = track.baseUrl;

  // Step 5: Fetch caption JSON
  let json3;
  try {
    const captionRes = await fetch(`${captionUrl}&fmt=json3`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!captionRes.ok) throw new Error(`Caption fetch returned HTTP ${captionRes.status}`);
    json3 = await captionRes.json();
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Failed to fetch captions: ${err.message}` });
  }

  // Step 6: Parse captions into plain text
  const transcriptText = captionsToText(json3);
  const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;

  if (wordCount < 10) {
    return res.status(500).json({ ok: false, error: 'Transcript is empty or too short to be useful.' });
  }

  const finalTitle    = customTitle || ytTitle;
  const finalCategory = customCategory || detectCategory(finalTitle + ' ' + ytTitle);
  const durationFmt   = formatDuration(ytDuration);

  const description = `Channel: ${ytChannel} · Duration: ${durationFmt} · ~${wordCount.toLocaleString()} words`;

  const payload = {
    title: finalTitle.slice(0, 255),
    description: description.slice(0, 600),
    content: transcriptText,
    source_url: `https://www.youtube.com/watch?v=${videoId}`,
    category: finalCategory,
    type: 'Video Transcript',
    published: false,
    review_state: 'Pending Review',
    auto_discovered: true,
  };

  const ins = await db('materials', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

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
      channel: ytChannel,
      duration: durationFmt,
      transcriptWords: wordCount,
    },
    material,
  });
};
