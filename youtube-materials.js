/**
 * youtube-materials.js  (fixed)
 * Extracts civil engineering YouTube playlists/channels and saves as study materials.
 *
 * POST /api/youtube-materials  { key }  → run extraction
 * GET  /api/youtube-materials           → list saved materials
 */

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// Civil engineering YouTube channels/playlists (curated, always free)
const YOUTUBE_SOURCES = [
  { title: "GATE Civil Engineering Lectures", channel: "NPTEL-NOC IITM", url: "https://www.youtube.com/playlist?list=PLbRMhDVUMngekIL9XiAP9v0iev8O8LHGK", topic: "GATE Prep", access_type: "free" },
  { title: "Structural Analysis – IIT Kharagpur", channel: "NPTEL", url: "https://www.youtube.com/playlist?list=PLbMVogVj5nJSi1SXcN5tEhQ3IHMHHkPxb", topic: "Structural Engineering", access_type: "free" },
  { title: "Fluid Mechanics – IIT Bombay", channel: "NPTEL", url: "https://www.youtube.com/playlist?list=PLOzRYVm0a65eklyMDXaqPNFVDqB1WOB1w", topic: "Fluid Mechanics", access_type: "free" },
  { title: "Soil Mechanics – IIT Bombay", channel: "NPTEL", url: "https://www.youtube.com/playlist?list=PLOzRYVm0a65dHpBclR5oWX9LGVVD_EKRD", topic: "Geotechnical", access_type: "free" },
  { title: "Transportation Engineering – IIT Bombay", channel: "NPTEL", url: "https://www.youtube.com/playlist?list=PLOzRYVm0a65fXx9L_FQMoaX-_TYt3Tq6h", topic: "Transportation", access_type: "free" },
  { title: "AutoCAD Civil 3D Full Course", channel: "CADTraining", url: "https://www.youtube.com/watch?v=TmrKNBrfvsY", topic: "Software", access_type: "free" },
  { title: "STAAD Pro Tutorial for Beginners", channel: "Civil Engineering by Sandeep Jyani", url: "https://www.youtube.com/watch?v=NLotKqEjnMQ", topic: "Software", access_type: "free" },
  { title: "SSC JE Civil Engineering Full Syllabus", channel: "Sandeep Jyani", url: "https://www.youtube.com/watch?v=Q3bKYOHlpT0", topic: "SSC JE Prep", access_type: "free" },
  { title: "RCC Design – IS 456", channel: "Civil Engineering Academy", url: "https://www.youtube.com/watch?v=vB3Bji2s8HQ", topic: "Structural Design", access_type: "free" },
  { title: "Quantity Surveying & Estimation", channel: "CE & T", url: "https://www.youtube.com/watch?v=gQ3j9GK4lXE", topic: "QS & Estimation", access_type: "free" },
  { title: "Highway Engineering – GATE", channel: "NPTEL", url: "https://www.youtube.com/watch?v=WhlDkRy1yXE", topic: "Highway Engineering", access_type: "free" },
  { title: "Environmental Engineering Water Treatment", channel: "NPTEL", url: "https://www.youtube.com/watch?v=pEDT1TV3GhE", topic: "Environmental Engg", access_type: "free" },
  { title: "Surveying & Levelling", channel: "Civil Engineering by Sandeep Jyani", url: "https://www.youtube.com/watch?v=TcHXi2LDy4s", topic: "Surveying", access_type: "free" },
  { title: "Construction Management – Project Planning", channel: "NPTEL", url: "https://www.youtube.com/watch?v=Kf2_u5VHbKE", topic: "Construction Management", access_type: "free" },
  { title: "UPSC ESE Civil Engineering Preparation", channel: "Made Easy", url: "https://www.youtube.com/c/MadeEasyGroup", topic: "UPSC ESE Prep", access_type: "free" },
];

function slugify(s) {
  return (s||"").toLowerCase().replace(/[^\w\s-]/g,"").replace(/\s+/g,"-").slice(0,80) + "-yt";
}

module.exports = async function youtubeMaterials(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ownerKey = process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY || process.env.ADMIN_OWNER_KEY;

  if (req.method === "GET") {
    const { data, error } = await supabase.from("study_materials")
      .select("id,title,topic,access_type,url,created_at")
      .eq("source","youtube")
      .order("created_at",{ascending:false})
      .limit(50);
    return res.status(200).json({ materials: data || [], error: error?.message || null });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const provided = req.body?.key || req.headers["x-owner-key"];
  if (!ownerKey || provided !== ownerKey) return res.status(401).json({ error: "Unauthorized" });

  const inserted = [], skipped = [], errors = [];

  for (const item of YOUTUBE_SOURCES) {
    // Check duplicate
    const { data: existing } = await supabase.from("study_materials")
      .select("id").ilike("title", `%${item.title.slice(0,40)}%`).limit(1);

    if (existing && existing.length > 0) { skipped.push(item.title); continue; }

    const { error } = await supabase.from("study_materials").insert({
      title:       item.title,
      topic:       item.topic || "Civil Engineering",
      channel:     item.channel || "",
      url:         item.url,
      access_type: item.access_type || "free",
      source:      "youtube",
      published:   true,
      slug:        slugify(item.title),
    });

    if (error) errors.push(`${item.title}: ${error.message}`);
    else inserted.push(item.title);
  }

  return res.status(200).json({
    ok: true,
    inserted: inserted.length,
    skipped: skipped.length,
    errors: errors.length,
    error_list: errors,
    inserted_titles: inserted,
  });
};
