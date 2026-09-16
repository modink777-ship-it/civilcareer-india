/**
 * CivilCareer — AI Job Extraction API
 * Uses Groq for AI job extraction.
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.GROQ_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,x-owner-key'
  );

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

  // --------------------------------------------------
  // Fetch page content if URL is provided
  // --------------------------------------------------

  let content = text || '';

  if (url && !content) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; CivilCareerBot/1.0)'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!r.ok) {
        return res.status(400).json({
          error: `Could not fetch URL. HTTP ${r.status}`
        });
      }

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
      return res.status(400).json({
        error: 'Could not fetch URL: ' + e.message
      });
    }
  }

  // --------------------------------------------------
  // AI extraction prompt
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Groq
  // --------------------------------------------------

  if (!GROQ_KEY) {
    return res.status(500).json({
      error:
        'GROQ_API_KEY is not configured in Vercel Environment Variables.'
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

        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],

        temperature: 0.1,

        max_completion_tokens: 1200,

        response_format: {
          type: 'json_object'
        }
      })
    });

    // Read response as text first so we can see the
    // actual Groq error if something goes wrong.
    const responseText = await r.text();

    if (!r.ok) {
      console.error(
        'Groq API error:',
        r.status,
        responseText
      );

      return res.status(502).json({
        error: `Groq API error (${r.status})`,
        details: responseText
      });
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(
        'Groq returned invalid JSON:',
        responseText
      );

      return res.status(502).json({
        error: 'Groq returned an invalid API response.'
      });
    }

    const raw =
      data.choices?.[0]?.message?.content || '';

    if (!raw) {
      console.error(
        'Groq returned empty content:',
        JSON.stringify(data)
      );

      return res.status(502).json({
        error: 'Groq returned an empty response.'
      });
    }

    // Remove markdown code fences if the model adds them.
    const json = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let extracted;

    try {
      extracted = JSON.parse(json);
    } catch (e) {
      console.error(
        'Groq returned invalid extraction JSON:',
        json
      );

      return res.status(502).json({
        error: 'Groq returned invalid extraction JSON.',
        raw: json
      });
    }

    return res.status(200).json({
      extracted,
      source: 'groq'
    });

  } catch (e) {
    console.error(
      'Groq request failed:',
      e.message
    );

    return res.status(502).json({
      error: 'Groq request failed.',
      details: e.message
    });
  }
};
