/**
 * CivilCareer Daily Job Scraper
 * Fetches civil engineering jobs from free RSS sources
 * Saves to Supabase as DRAFTS (published: false)
 * You review and publish from admin panel
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT      = process.env.TELEGRAM_ADMIN_CHAT_ID; // YOUR personal chat ID (not channel)

// ── Free RSS feeds (all legal, public) ──────────────────────
const FEEDS = [
  // Indeed India — Civil Engineering
  { url: 'https://in.indeed.com/rss?q=civil+engineer&l=Karnataka&sort=date&fromage=1', sector: 'Private', region: 'Karnataka' },
  { url: 'https://in.indeed.com/rss?q=civil+engineer&l=India&sort=date&fromage=1',     sector: 'Private', region: 'India' },
  { url: 'https://in.indeed.com/rss?q=site+engineer+civil&l=India&sort=date&fromage=1', sector: 'Private', region: 'India' },
  { url: 'https://in.indeed.com/rss?q=junior+engineer+civil&l=India&sort=date&fromage=1', sector: 'Private', region: 'India' },
  { url: 'https://in.indeed.com/rss?q=structural+engineer&l=India&sort=date&fromage=1', sector: 'Private', region: 'India' },
  { url: 'https://in.indeed.com/rss?q=quantity+surveyor&l=India&sort=date&fromage=1',   sector: 'Private', region: 'India' },
  { url: 'https://in.indeed.com/rss?q=project+engineer+civil&l=India&sort=date&fromage=1', sector: 'Private', region: 'India' },
  // Indeed Gulf — Civil Engineering
  { url: 'https://www.indeed.com/rss?q=civil+engineer&l=Dubai&sort=date&fromage=1',     sector: 'Private', region: 'Gulf' },
  { url: 'https://www.indeed.com/rss?q=civil+engineer&l=Abu+Dhabi&sort=date&fromage=1', sector: 'Private', region: 'Gulf' },
  { url: 'https://www.indeed.com/rss?q=civil+engineer&l=Qatar&sort=date&fromage=1',     sector: 'Private', region: 'Gulf' },
  // Government civil jobs
  { url: 'https://in.indeed.com/rss?q=junior+engineer+civil+government&l=Karnataka&sort=date&fromage=3', sector: 'Government', region: 'Karnataka' },
  { url: 'https://in.indeed.com/rss?q=assistant+engineer+civil&l=Karnataka&sort=date&fromage=3',         sector: 'Government', region: 'Karnataka' },
];

// ── Simple RSS parser (no external deps) ─────────────────────
function parseRSS(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const block of itemBlocks) {
    const get = tag => {
      const cdataMatch = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
      if (cdataMatch) return cdataMatch[1].trim();
      const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return plainMatch ? plainMatch[1].trim() : '';
    };

    const title = get('title');
    const link  = get('link') || get('guid');
    if (!title || !link) continue;

    items.push({
      title,
      link: link.replace(/&amp;/g, '&'),
      description: get('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      pubDate: get('pubDate'),
      company: extractCompany(title, get('description')),
    });
  }
  return items;
}

function extractCompany(title, desc) {
  // Indeed format: "Role - Company Name" or "Company Name: Role"
  const dashSplit = title.split(' - ');
  if (dashSplit.length >= 2) return dashSplit[dashSplit.length - 1].trim();
  const colonSplit = title.split(': ');
  if (colonSplit.length >= 2) return colonSplit[0].trim();
  // Try from description
  const compMatch = desc.match(/company[:\s]+([^.|\n]+)/i);
  if (compMatch) return compMatch[1].trim();
  return '';
}

function extractRole(title) {
  const dashSplit = title.split(' - ');
  return dashSplit[0].trim();
}

// ── Supabase helpers ──────────────────────────────────────────
async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function jobExists(sourceUrl) {
  const result = await supabase(`jobs?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`);
  return Array.isArray(result) && result.length > 0;
}

async function insertDraftJob(job) {
  return supabase('jobs', {
    method: 'POST',
    body: JSON.stringify(job),
  });
}

// ── AI extraction using Gemini ────────────────────────────────
async function extractWithGemini(title, description, url) {
  if (!GEMINI_KEY) return null;
  try {
    const prompt = `Extract structured job information from this civil engineering job posting.
Title: ${title}
Description: ${description.slice(0, 800)}
URL: ${url}

Return ONLY valid JSON (no markdown, no explanation):
{
  "role": "exact job title",
  "company": "company or organization name",
  "location": "city, state or country",
  "experience_level": "e.g. 0-2 years or Fresher",
  "qualification": "e.g. B.E. Civil",
  "employment_type": "Full-time or Contract",
  "salary": "salary range if mentioned, else empty string",
  "description": "2-3 sentence summary of the role"
}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ── Telegram notification to YOU (personal chat) ──────────────
async function notifyAdmin(count, failed) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const msg = `🤖 *Daily Job Scraper Report*\n\n` +
    `✅ *${count} new draft jobs* added to admin\n` +
    `${failed > 0 ? `⚠️ ${failed} jobs skipped (duplicates or errors)\n` : ''}` +
    `\n👉 Review and publish at:\nhttps://civilcareer-india-two.vercel.app/admin`;

  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' }),
  });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  let totalAdded = 0;
  let totalSkipped = 0;

  for (const feed of FEEDS) {
    console.log(`\nFetching: ${feed.url}`);
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivilCareer/1.0)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.log(`  ⚠️ HTTP ${res.status} — skipping`);
        continue;
      }

      const xml = await res.text();
      const items = parseRSS(xml);
      console.log(`  Found ${items.length} items`);

      for (const item of items.slice(0, 10)) { // max 10 per feed
        try {
          // Skip if already exists
          if (await jobExists(item.link)) {
            console.log(`  ↩ Duplicate: ${item.title.slice(0, 50)}`);
            totalSkipped++;
            continue;
          }

          // Try AI extraction
          let extracted = null;
          if (GEMINI_KEY) {
            extracted = await extractWithGemini(item.title, item.description, item.link);
            await new Promise(r => setTimeout(r, 500)); // rate limit
          }

          // Build job object
          const job = {
            role:             extracted?.role             || extractRole(item.title),
            company:          extracted?.company          || item.company || 'See job posting',
            location:         extracted?.location         || feed.region,
            experience_level: extracted?.experience_level || '',
            qualification:    extracted?.qualification    || 'B.E. / B.Tech Civil Engineering',
            employment_type:  extracted?.employment_type  || 'Full-time',
            salary:           extracted?.salary           || '',
            description:      extracted?.description      || item.description.slice(0, 500),
            sector:           feed.sector,
            source_url:       item.link,
            status:           'Active',
            published:        false,          // DRAFT — admin must review
            last_verified:    new Date().toISOString().slice(0, 10),
            created_at:       new Date().toISOString(),
          };

          await insertDraftJob(job);
          totalAdded++;
          console.log(`  ✅ Added draft: ${job.role} @ ${job.company}`);

        } catch (err) {
          console.log(`  ❌ Error processing item: ${err.message}`);
          totalSkipped++;
        }
      }

    } catch (err) {
      console.log(`  ❌ Feed error: ${err.message}`);
    }

    // Small delay between feeds
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n═══════════════════════════════`);
  console.log(`✅ Added ${totalAdded} new draft jobs`);
  console.log(`↩  Skipped ${totalSkipped} (duplicates/errors)`);
  console.log(`═══════════════════════════════`);

  // Notify you on Telegram
  await notifyAdmin(totalAdded, totalSkipped);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
