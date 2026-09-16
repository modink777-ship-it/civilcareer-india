/**
 * CivilCareer — AI Job Extraction API
 * Uses Groq (FREE — 14,400 requests/day) instead of Gemini
 * Sign up free at console.groq.com → get GROQ_API_KEY
 * Falls back to basic text extraction if no API key
 */
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY; // kept as fallback

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { url, text } = body;
  if (!url && !text) return res.status(400).json({ error: 'Provide url or text' });

  // Fetch page content if URL provided
  let content = text || '';
  if (url && !content) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivilCareerBot/1.0)' },
        signal: AbortSignal.timeout(8000)
      });
      const html = await r.text();
      // Strip HTML tags for cleaner text
      content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000);
    } catch (e) {
      return res.status(400).json({ error: 'Could not fetch URL: ' + e.message });
    }
  }

  const prompt = `Extract job information from this text and return ONLY valid JSON with these fields (leave field empty string if not found, never guess):

{
  "role": "job title/designation",
  "company": "company or organization name",
  "location": "city or location",
  "state": "Indian state",
  "country": "country (default India)",
  "description": "job description summary (2-3 sentences)",
  "qualification": "educational qualification required",
  "skills": "required skills (comma separated)",
  "experience_level": "experience required",
  "salary": "salary or pay scale if mentioned",
  "vacancy_count": "number of vacancies if mentioned",
  "deadline": "last date in YYYY-MM-DD format",
  "employment_type": "Full-time / Contract / Government",
  "sector": "Private or Government or Public Sector",
  "source_url": "${url || ''}",
  "apply_url": "direct application URL if different from source",
  "recruitment_authority": "exam board or authority if government job"
}

Text: ${content}

Return ONLY the JSON object, no explanation.`;

  // Try Groq first (free)
  if (GROQ_KEY) {
    try {
      const r = await fetch(GROQ_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 1000
        })
      });
      const data = await r.json();
      const raw = data.choices?.[0]?.message?.content || '';
      const json = raw.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(json);
      return res.status(200).json({ extracted, source: 'groq' });
    } catch (e) {
      console.error('Groq failed:', e.message);
    }
  }

  // Fallback to Gemini if available
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      const data = await r.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const json = raw.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(json);
      return res.status(200).json({ extracted, source: 'gemini' });
    } catch (e) {
      console.error('Gemini failed:', e.message);
    }
  }

  return res.status(500).json({ error: 'No AI API key configured. Add GROQ_API_KEY in Vercel env vars (free at console.groq.com)' });
};
