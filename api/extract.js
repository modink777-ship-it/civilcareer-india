/**
 * CivilCareer — AI Job Extraction API
 *
 * Free-first automatic AI failover chain:
 *   1. Groq
 *   2. Google Gemini
 *   3. Cerebras
 *   4. OpenRouter free-model router
 *
 * If a provider returns 429/quota/rate-limit, 5xx, timeout,
 * invalid/empty output, or another recoverable provider error,
 * the next configured provider is tried automatically.
 *
 * No client-side API keys. No new API route. Replace only api/extract.js.
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const CEREBRAS_API = 'https://api.cerebras.ai/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const REQUEST_TIMEOUT_MS = 12000;

const EXTRACTION_FIELDS = {
  role: '',
  company: '',
  location: '',
  state: '',
  country: '',
  description: '',
  qualification: '',
  skills: '',
  experience_level: '',
  salary: '',
  vacancy_count: '',
  deadline: '',
  employment_type: '',
  sector: '',
  source_url: '',
  apply_url: '',
  recruitment_authority: ''
};

function extractionPrompt(content, url) {
  return `
Extract job information from the following text.

Return ONLY one valid JSON object. No markdown, no explanation.

Rules:
- Never guess.
- If information is not found, use an empty string.
- Keep dates in YYYY-MM-DD format when possible.
- Do not invent salary, vacancies, eligibility, company names, URLs, or deadlines.
- country should be "India" only when the text clearly indicates India or the location is clearly Indian.
- Preserve the actual job title and company/organization.
- For government recruitment, put the recruiting authority in recruitment_authority.
- Keep description concise: 2-3 factual sentences.

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
}

function cleanJsonText(raw) {
  let s = String(raw || '').trim();

  // Remove markdown fences if a provider adds them.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Some models add a short sentence before/after the JSON.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }

  return s;
}

function normalizeExtracted(value, url) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI returned a non-object extraction result.');
  }

  const out = { ...EXTRACTION_FIELDS };

  for (const key of Object.keys(EXTRACTION_FIELDS)) {
    const v = value[key];
    if (v === null || v === undefined) {
      out[key] = '';
    } else if (typeof v === 'string') {
      out[key] = v.trim();
    } else if (Array.isArray(v)) {
      out[key] = v.map(x => String(x)).join(', ').trim();
    } else {
      out[key] = String(v).trim();
    }
  }

  if (!out.source_url && url) out.source_url = url;

  if (!out.role && !out.company && !out.description) {
    throw new Error('AI returned an empty extraction.');
  }

  return out;
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

async function readProviderResponse(response) {
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const err = new Error(
      `${response.status} ${response.statusText || ''}`.trim()
    );
    err.status = response.status;
    err.retryAfter = retryAfter || null;
    err.providerBody = data || text.slice(0, 500);
    throw err;
  }

  return data;
}

async function callGroq(prompt) {
  if (!GROQ_KEY) throw Object.assign(new Error('GROQ_API_KEY not configured'), { skipped: true });

  const r = await fetchWithTimeout(GROQ_API, {
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

  const data = await readProviderResponse(r);
  return data?.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) throw Object.assign(new Error('GEMINI_API_KEY not configured'), { skipped: true });

  const r = await fetchWithTimeout(
    `${GEMINI_API}?key=${encodeURIComponent(GEMINI_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  const data = await readProviderResponse(r);
  return (data?.candidates?.[0]?.content?.parts || [])
    .map(x => x?.text || '')
    .join('')
    .trim();
}

async function callCerebras(prompt) {
  if (!CEREBRAS_KEY) throw Object.assign(new Error('CEREBRAS_API_KEY not configured'), { skipped: true });

  const r = await fetchWithTimeout(CEREBRAS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CEREBRAS_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' }
    })
  });

  const data = await readProviderResponse(r);
  return data?.choices?.[0]?.message?.content || '';
}

async function callOpenRouter(prompt) {
  if (!OPENROUTER_KEY) throw Object.assign(new Error('OPENROUTER_API_KEY not configured'), { skipped: true });

  const r = await fetchWithTimeout(OPENROUTER_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://civilcareer-india-two.vercel.app/',
      'X-Title': 'CivilCareer India'
    },
    body: JSON.stringify({
      // OpenRouter's free router chooses an available free model.
      model: 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1200
    })
  });

  const data = await readProviderResponse(r);
  return data?.choices?.[0]?.message?.content || '';
}

const PROVIDERS = [
  { name: 'groq', key: GROQ_KEY, call: callGroq },
  { name: 'gemini', key: GEMINI_KEY, call: callGemini },
  { name: 'cerebras', key: CEREBRAS_KEY, call: callCerebras },
  { name: 'openrouter_free', key: OPENROUTER_KEY, call: callOpenRouter }
];

async function runExtractionChain(prompt, sourceUrl) {
  const attempts = [];

  for (const provider of PROVIDERS) {
    if (!provider.key) {
      attempts.push({
        provider: provider.name,
        status: 'skipped',
        reason: 'API key not configured'
      });
      continue;
    }

    const started = Date.now();

    try {
      const raw = await provider.call(prompt);

      if (!raw) {
        throw new Error('Empty AI response.');
      }

      const parsed = JSON.parse(cleanJsonText(raw));
      const extracted = normalizeExtracted(parsed, sourceUrl);

      attempts.push({
        provider: provider.name,
        status: 'success',
        ms: Date.now() - started
      });

      return {
        extracted,
        source: provider.name,
        attempts
      };
    } catch (err) {
      const status = Number(err?.status || 0);

      // 429/quota, 5xx, timeout, invalid JSON, empty output and
      // provider/network failures all fall through to the next AI.
      attempts.push({
        provider: provider.name,
        status: status === 429 ? 'rate_limited' : 'failed',
        httpStatus: status || null,
        retryAfter: err?.retryAfter || null,
        reason: String(err?.message || 'Provider failed').slice(0, 300),
        ms: Date.now() - started
      });

      console.error(
        `[AI extraction] ${provider.name} failed`,
        status || '',
        err?.message || err
      );
    }
  }

  const configured = PROVIDERS.filter(x => x.key).map(x => x.name);

  const error = new Error(
    configured.length
      ? 'All configured AI extraction providers failed or were rate-limited.'
      : 'No AI extraction provider is configured.'
  );

  error.attempts = attempts;
  return { error };
}

module.exports = async function handler(req, res) {
  // This endpoint is server-side only; no provider API key is exposed to
  // the browser. Keep the existing permissive CORS behavior for compatibility.
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }

  const { url, text } = body;

  if (!url && !text) {
    return res.status(400).json({ error: 'Provide url or text' });
  }

  // --------------------------------------------------
  // Fetch page content if URL is provided
  // --------------------------------------------------

  let content = text || '';

  if (url && !content) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CivilCareerBot/1.0)'
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow'
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
        error: 'Could not fetch URL: ' + String(e?.message || e)
      });
    }
  }

  const prompt = extractionPrompt(content, url);

  const result = await runExtractionChain(prompt, url);

  if (result.error) {
    return res.status(502).json({
      error: result.error.message,
      providers: result.attempts
    });
  }

  return res.status(200).json({
    extracted: result.extracted,
    source: result.source,
    providers: result.attempts
  });
};
