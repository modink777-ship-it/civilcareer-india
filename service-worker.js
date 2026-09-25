const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.GROQ_API_KEY;
const SITE_URL = (process.env.SITE_URL || 'https://civilcareer-india-two.vercel.app').replace(/\/+$/, '');

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = new Set([
    SITE_URL,
    'https://civilcareer-india-two.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ]);
  return allowed.has(origin) ? origin : SITE_URL;
}

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true;
  if (h === '0.0.0.0') return true;

  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/;
  if (ipv4.test(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] === 169 && parts[1] === 254 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  }

  return false;
}

function isAllowedExternalUrl(value) {
  if (!value || typeof value !== 'string') return { ok: false, reason: 'missing URL' };
  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    return { ok: false, reason: 'invalid URL' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'unsupported protocol' };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { ok: false, reason: 'private/internal host blocked' };
  }
  return { ok: true, url: parsed };
}

module.exports = async function handler(req, res) {
  const origin = getAllowedOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  const { url, text } = body;

  if (!url && !text) {
    return res.status(400).json({
      error: 'Provide url or text'
    });
  }

  let content = text || '';

  if (url && !content) {
    const safe = isAllowedExternalUrl(url);
    if (!safe.ok) {
      return res.status(400).json({ error: `URL rejected: ${safe.reason}` });
    }

    try {
      const r = await fetch(safe.url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CivilCareerBot/1.0)'
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });

      if (!r.ok) {
        return res.status(400).json({
          error: `Could not fetch URL. HTTP ${r.status}`
        });
      }

      const html = await r.text();
      content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000);
    } catch (e) {
      return res.status(400).json({
        error: 'Could not fetch URL: ' + e.message
      });
    }
  }

  const prompt = `
Extract job information from the following text.

Return ONLY a valid JSON object.

Rules:
- Never guess.
- If information is not found, use an empty string.
- Keep dates in YYYY-MM-DD format when possible.
- Do not invent salary, vacancies, eligibility, company names, URLs, or deadlines.
- country should be "India" only when the text clearly indicates India or the location is clearly Indian.

Use exactly these fields:

{
  "role": "job title/designation",
  "company": "company or organization name",
  "location": "city or location",
  "state": "Indian state",
  "country": "country",
  "description": "job description summary in 2-3 sentences",
  "qualification": "educational qualification required",
  "skills": "required skills, comma separated",
  "experience_level": "experience required",
  "salary": "salary or pay scale if mentioned",
  "vacancy_count": "number of vacancies if mentioned",
  "deadline": "last date in YYYY-MM-DD format",
  "employment_type": "Full-time / Part-time / Contract / Internship / Apprenticeship / Temporary / Government",
  "sector": "Private or Government or Public Sector",
  "source_url": "${url || ''}",
  "apply_url": "direct application URL if different from source",
  "recruitment_authority": "exam board or authority if government job"
}

Text to analyze:

${content}

Return ONLY the JSON object.
`;

  if (!GROQ_KEY) {
    return res.status(500).json({
      error: 'GROQ_API_KEY is not configured in Vercel Environment Variables.'
    });
  }

  try {
    const r = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' }
      })
    });

    const responseText = await r.text();

    if (!r.ok) {
      console.error('Groq API error:', r.status, responseText);
      return res.status(502).json({
        error: `Groq API error (${r.status})`,
        details: responseText
      });
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('Groq returned invalid JSON:', responseText);
      return res.status(502).json({
        error: 'Groq returned an invalid API response.'
      });
    }

    const raw = data.choices?.[0]?.message?.content || '';

    if (!raw) {
      console.error('Groq returned empty content:', JSON.stringify(data));
      return res.status(502).json({
        error: 'Groq returned an empty response.'
      });
    }

    const json = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let extracted;

    try {
      extracted = JSON.parse(json);
    } catch (e) {
      console.error('Groq returned invalid extraction JSON:', json);
      return res.status(502).json({
        error: 'Groq returned invalid extraction JSON.',
        raw: json
      });
    }

    return res.status(200).json({ extracted, source: 'groq' });
  } catch (e) {
    console.error('Groq request failed:', e.message);
    return res.status(502).json({
      error: 'Groq request failed.',
      details: e.message
    });
  }
};



