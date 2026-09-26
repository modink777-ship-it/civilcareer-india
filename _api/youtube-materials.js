'use strict';
const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const { requireOwner } = require('../lib/security');

function db(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } });
}
function clean(v, n = 2000) { return String(v || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function videoId(url) { try { const u = new URL(url); const host = u.hostname.toLowerCase(); if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0]; if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') return u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1] || ''; } catch {} return ''; }
function category(title) { const t = String(title).toLowerCase(); if (/gate|ese/.test(t)) return 'GATE / ESE Prep'; if (/ssc\s*je|rrb\s*je/.test(t)) return 'SSC JE / RRB JE'; if (/structural|rcc/.test(t)) return 'Structural Engineering'; if (/highway|transport/.test(t)) return 'Transportation'; if (/geotechnical|soil/.test(t)) return 'Geotechnical'; if (/fluid|hydraulic/.test(t)) return 'Fluid Mechanics'; if (/survey/.test(t)) return 'Surveying'; if (/quantity|qs/.test(t)) return 'Quantity Surveying'; return 'Civil Engineering'; }
function transcriptFromEvents(events) { const out=[]; for (const e of Array.isArray(events)?events:[]) { const segs=Array.isArray(e.segs)?e.segs:[]; const text=segs.map(s=>String(s.utf8||'')).join('').replace(/\s+/g,' ').trim(); if(text)out.push(text); } return out.join(' ').replace(/\s+([,.!?])/g,'$1').trim(); }
function transcriptFromXml(xml) { return [...String(xml||'').matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)].map(m=>m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"')).join(' ').replace(/\s+/g,' ').trim(); }

async function fetchCaptionTrack(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CivilCareer' }, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw Error(`Caption service returned HTTP ${r.status}`);
  const text = await r.text();
  try { const j = JSON.parse(text); const transcript = transcriptFromEvents(j.events || []); if (transcript) return transcript; } catch {}
  const transcript = transcriptFromXml(text);
  if (transcript) return transcript;
  throw Error('The caption track was empty.');
}

async function fallbackTimedText(id, lang = 'en') {
  const urls = [
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}&kind=asr&fmt=srv3`,
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}&fmt=srv3`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CivilCareer' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const text = transcriptFromXml(await r.text());
      if (text) return text;
    } catch {}
  }
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!requireOwner(req, res)) return;
  if (!SUPA || !KEY) return res.status(503).json({ error: 'Supabase server configuration is missing.' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); } }
  const id = videoId(body.url);
  if (!id) return res.status(400).json({ error: 'Enter a valid YouTube watch, shorts, embed or youtu.be URL.' });
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, { headers: { 'User-Agent': 'Mozilla/5.0 CivilCareer' }, signal: AbortSignal.timeout(7000) });
    if (!page.ok) throw Error(`YouTube returned HTTP ${page.status}`);
    const html = await page.text();
    const m = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/);
    let player = {};
    if (m) { try { player = JSON.parse(m[1]); } catch {} }
    const details = player.videoDetails || {};
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    let transcript = '';
    if (tracks.length) {
      const track = tracks.find(x => x.languageCode === 'en') || tracks.find(x => /^en(-|$)/i.test(x.languageCode || '')) || tracks[0];
      const capUrl = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
      transcript = await fetchCaptionTrack(capUrl);
    }
    if (!transcript) transcript = await fallbackTimedText(id, 'en');
    if (!transcript) throw Error('This video does not expose public captions or a YouTube timed-text track. CivilCareer cannot create a reliable transcript from this video yet; use a video with captions/auto-captions or paste a transcript for review.');

    const title = clean(details.title || body.title || `YouTube Civil Engineering video ${id}`, 300);
    const channel = clean(details.author || '', 180);
    const duration = Number(details.lengthSeconds || 0);
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const payload = {
      title_en: clean(body.title || title, 300),
      description_en: clean(`${channel ? channel + ' · ' : ''}${duration ? `${duration}s · ` : ''}${words.toLocaleString('en-IN')} words`, 600),
      content: transcript,
      source_url: `https://www.youtube.com/watch?v=${id}`,
      category: clean(body.category || category(title), 80),
      type: 'Video Transcript',
      published: false,
      review_state: 'Pending Review',
      auto_discovered: true,
    };
    const r = await db('materials', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { const e = await r.text(); throw Error(e.slice(0, 600) || 'Could not save transcript.'); }
    const data = await r.json();
    return res.status(201).json({ ok: true, stats: { videoId: id, title, channel, duration, transcriptWords: words }, material: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    const message = e.message || 'Transcript extraction failed.';
    return res.status(/cannot create a reliable transcript|public captions|timed-text track/i.test(message) ? 422 : 500).json({ error: message });
  }
};
