/**
 * CivilCareer — AI Job Extraction API
 * Final free-first extraction chain:
 *   1) Groq
 *   2) Gemini 2.5 Flash-Lite
 *   3) Gemini 2.5 Flash
 *
 * Drop-in replacement for the existing /api/extract.js.
 * No new Vercel function is required.
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

const REQUEST_TIMEOUT_MS = 12000;
const URL_FETCH_TIMEOUT_MS = 8000;
const MAX_INPUT_CHARS = 6000;
const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_CHARS = 20000;

const EXTRACTION_FIELDS = [
  'role',
  'company',
  'location',
  'state',
  'country',
  'description',
  'qualification',
  'skills',
  'experience_level',
  'salary',
  'vacancy_count',
  'deadline',
  'employment_type',
  'sector',
  'source_url',
  'apply_url',
  'recruitment_authority'
];

const EMPTY_FIELDS = Object.fromEntries(
  EXTRACTION_FIELDS.map((key) => [key, ''])
);

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanJsonText(value) {
  let text = String(value || '').trim();

  text = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // If the provider added surrounding prose, isolate the first JSON object.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');

  if (first >= 0 && last > first) {
    text = text.slice(first, last + 1);
  }

  return text;
}

function normalizeExtracted(value, sourceUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const result = { ...EMPTY_FIELDS };

  for (const key of EXTRACTION_FIELDS) {
    const raw = value[key];

    if (Array.isArray(raw)) {
      result[key] = raw
        .map((x) => cleanText(x))
        .filter(Boolean)
        .join(', ');
    } else if (raw !== undefined && raw !== null) {
      result[key] = cleanText(raw);
    }
  }

  if (sourceUrl && !result.source_url) {
    result.source_url = sourceUrl;
  }

  // Do not accept an apparently successful provider response
  // that contains no useful extraction at all.
  const useful = ['role', 'company', 'description', 'location']
    .some((key) => result[key]);

  return useful ? result : null;
}

function safeErrorMessage(status, body) {
  const text = cleanText(body).slice(0, 350);

  if (status === 401) return 'authentication failed (401)';
  if (status === 403) return 'access denied (403)';
  if (status === 404) return 'model or endpoint not found (404)';
  if (status === 408) return 'request timeout (408)';
  if (status === 429) return 'rate limited (429)';
  if (status >= 500) return `provider server error (${status})`;

  return text
    ? `provider error (${status}): ${text}`
    : `provider error (${status})`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateIPv4(host) {
  const parts = host.split('.').map(Number);

  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isPrivateIPv6(host) {
  const h = host.toLowerCase();

  return (
    h === '::1' ||
    h === '::' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe8') ||
    h.startsWith('fe9') ||
    h.startsWith('fea') ||
    h.startsWith('feb')
  );
}

function isUnsafeHostname(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');

  if (
    !h ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.home') ||
    h.endsWith('.lan')
  ) {
    return true;
  }

  if (isPrivateIPv4(h) || isPrivateIPv6(h)) {
    return true;
  }

  return false;
}

async function validatePublicHttpUrl(input) {
  let parsed;

  try {
    if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) {
      return { ok: false, reason: 'invalid URL' };
    }

    parsed = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'only http/https URLs are allowed' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed' };
  }

  if (isUnsafeHostname(parsed.hostname)) {
    return { ok: false, reason: 'private or local URLs are not allowed' };
  }

  // Best-effort DNS check. This blocks common SSRF targets before fetch.
  // If DNS lookup is unavailable in the runtime, the hostname checks above
  // still apply.
  try {
    const dns = require('node:dns').promises;
    const addresses = await dns.lookup(parsed.hostname, {
      all: true,
      verbatim: true
    });

    for (const entry of addresses) {
      const address = String(entry.address || '');

      if (
        isPrivateIPv4(address) ||
        isPrivateIPv6(address) ||
        address === '0.0.0.0' ||
        address === '::'
      ) {
        return {
          ok: false,
          reason: 'URL resolves to a private or local network address'
        };
      }
    }
  } catch {
    // Do not fail every legitimate URL if DNS lookup is unavailable.
  }

  return { ok: true, url: parsed.toString() };
}

function buildPrompt(content, sourceUrl) {
  return `
Extract job information from the following text.

Return ONLY one valid JSON object. No markdown. No explanation.

Rules:
- Never guess.
- If information is not found, use an empty string.
- Keep dates in YYYY-MM-DD format when possible.
- Do not invent salary, vacancies, eligibility, company names, URLs, deadlines, or recruitment authorities.
- country should be "India" only when the text clearly indicates India or the location is clearly Indian.
- Preserve the source URL exactly when supplied.
- apply_url must be a direct application URL only if the text clearly provides one.
- description must be a concise 2-3 sentence summary based only on the supplied text.
- employment_type must be one of: Full-time, Part-time, Contract, Internship, Apprenticeship, Temporary, Government, or empty.
- sector must be Private, Government, Public Sector, or empty.

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
  "source_url": "${sourceUrl || ''}",
  "apply_url": "direct application URL if different from source",
  "recruitment_authority": "exam board or authority if government job"
}

Text to analyze:

${content}

Return ONLY the JSON object.
`;
}

async function callGroq(prompt, sourceUrl) {
  if (!GROQ_KEY) {
    return {
      ok: false,
      provider: 'groq',
      reason: 'not configured'
    };
  }

  try {
    const response = await fetchWithTimeout(
      GROQ_API,
      {
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
      },
      REQUEST_TIMEOUT_MS
    );

    const responseText = (await response.text()).slice(0, MAX_RESPONSE_CHARS);

    if (!response.ok) {
      return {
        ok: false,
        provider: 'groq',
        status: response.status,
        reason: safeErrorMessage(response.status, responseText)
      };
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        provider: 'groq',
        status: response.status,
        reason: 'invalid provider JSON response'
      };
    }

    const raw = data?.choices?.[0]?.message?.content || '';
    const jsonText = cleanJsonText(raw);

    let parsed;

    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return {
        ok: false,
        provider: 'groq',
        status: response.status,
        reason: 'invalid extraction JSON'
      };
    }

    const extracted = normalizeExtracted(parsed, sourceUrl);

    if (!extracted) {
      return {
        ok: false,
        provider: 'groq',
        status: response.status,
        reason: 'empty or unusable extraction'
      };
    }

    return {
      ok: true,
      provider: 'groq',
      extracted
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'groq',
      reason: error?.name === 'AbortError'
        ? 'request timeout'
        : 'network/request failure'
    };
  }
}

async function callGeminiModel(model, prompt, sourceUrl) {
  if (!GEMINI_KEY) {
    return {
      ok: false,
      provider: `gemini:${model}`,
      reason: 'not configured'
    };
  }

  const endpoint =
    `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': GEMINI_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1400,
            responseMimeType: 'application/json'
          }
        })
      },
      REQUEST_TIMEOUT_MS
    );

    const responseText = (await response.text()).slice(0, MAX_RESPONSE_CHARS);

    if (!response.ok) {
      return {
        ok: false,
        provider: `gemini:${model}`,
        status: response.status,
        reason: safeErrorMessage(response.status, responseText)
      };
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        provider: `gemini:${model}`,
        status: response.status,
        reason: 'invalid provider JSON response'
      };
    }

    const raw = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || '')
      .join('') || '';

    if (!raw) {
      const finishReason =
        data?.candidates?.[0]?.finishReason || '';

      return {
        ok: false,
        provider: `gemini:${model}`,
        status: response.status,
        reason: finishReason
          ? `empty model output (${finishReason})`
          : 'empty model output'
      };
    }

    const jsonText = cleanJsonText(raw);

    let parsed;

    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return {
        ok: false,
        provider: `gemini:${model}`,
        status: response.status,
        reason: 'invalid extraction JSON'
      };
    }

    const extracted = normalizeExtracted(parsed, sourceUrl);

    if (!extracted) {
      return {
        ok: false,
        provider: `gemini:${model}`,
        status: response.status,
        reason: 'empty or unusable extraction'
      };
    }

    return {
      ok: true,
      provider: `gemini:${model}`,
      extracted
    };
  } catch (error) {
    return {
      ok: false,
      provider: `gemini:${model}`,
      reason: error?.name === 'AbortError'
        ? 'request timeout'
        : 'network/request failure'
    };
  }
}

async function runExtractionChain(prompt, sourceUrl) {
  const attempts = [];

  const providers = [];

  if (GROQ_KEY) {
    providers.push(() => callGroq(prompt, sourceUrl));
  } else {
    attempts.push({
      provider: 'groq',
      status: null,
      reason: 'not configured'
    });
  }

  if (GEMINI_KEY) {
    // Flash-Lite first for fast, high-volume extraction, then Flash.
    providers.push(() =>
      callGeminiModel('gemini-2.5-flash-lite', prompt, sourceUrl)
    );
    providers.push(() =>
      callGeminiModel('gemini-2.5-flash', prompt, sourceUrl)
    );
  } else {
    attempts.push({
      provider: 'gemini',
      status: null,
      reason: 'not configured'
    });
  }

  for (const run of providers) {
    const result = await run();

    if (result.ok) {
      return {
        ok: true,
        extracted: result.extracted,
        source: result.provider,
        providers: [
          ...attempts,
          {
            provider: result.provider,
            status: 200,
            reason: 'success'
          }
        ]
      };
    }

    attempts.push({
      provider: result.provider,
      status: result.status ?? null,
      reason: result.reason || 'provider failed'
    });
  }

  return {
    ok: false,
    attempts
  };
}

module.exports = async function handler(req, res) {
  // Kept compatible with the existing frontend.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,x-owner-key'
  );
  res.setHeader('Cache-Control', 'no-store');

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
    } catch {
      body = {};
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Invalid request body'
    });
  }

  const rawUrl = cleanText(body.url);
  const rawText = cleanText(body.text);

  if (!rawUrl && !rawText) {
    return res.status(400).json({
      error: 'Provide url or text'
    });
  }

  if (rawText.length > MAX_INPUT_CHARS) {
    body.text = rawText.slice(0, MAX_INPUT_CHARS);
  }

  const url = rawUrl || '';
  let content = rawText || '';

  // --------------------------------------------------
  // Fetch page content if URL is provided.
  // Includes basic SSRF protection.
  // --------------------------------------------------

  if (url && !content) {
    const validation = await validatePublicHttpUrl(url);

    if (!validation.ok) {
      return res.status(400).json({
        error: `Could not fetch URL: ${validation.reason}`
      });
    }

    try {
      const response = await fetchWithTimeout(
        validation.url,
        {
          redirect: 'manual',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; CivilCareerBot/1.0)'
          }
        },
        URL_FETCH_TIMEOUT_MS
      );

      // Follow only a small number of redirects, validating every target.
      let currentResponse = response;
      let currentUrl = validation.url;

      for (let hop = 0; hop < 3; hop += 1) {
        if (![301, 302, 303, 307, 308].includes(currentResponse.status)) {
          break;
        }

        const location = currentResponse.headers.get('location');

        if (!location) {
          break;
        }

        const nextUrl = new URL(location, currentUrl).toString();
        const nextValidation = await validatePublicHttpUrl(nextUrl);

        if (!nextValidation.ok) {
          return res.status(400).json({
            error: `Could not fetch URL: ${nextValidation.reason}`
          });
        }

        currentUrl = nextValidation.url;

        currentResponse = await fetchWithTimeout(
          currentUrl,
          {
            redirect: 'manual',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (compatible; CivilCareerBot/1.0)'
            }
          },
          URL_FETCH_TIMEOUT_MS
        );
      }

      if (!currentResponse.ok) {
        return res.status(400).json({
          error: `Could not fetch URL. HTTP ${currentResponse.status}`
        });
      }

      const html = await currentResponse.text();

      content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_INPUT_CHARS);

      if (!content) {
        return res.status(400).json({
          error: 'The URL returned no usable text.'
        });
      }
    } catch (error) {
      return res.status(400).json({
        error:
          error?.name === 'AbortError'
            ? 'Could not fetch URL: request timeout'
            : 'Could not fetch URL: network/request failure'
      });
    }
  }

  if (!content) {
    return res.status(400).json({
      error: 'No usable text was provided.'
    });
  }

  const prompt = buildPrompt(content, url);

  const result = await runExtractionChain(prompt, url);

  if (result.ok) {
    return res.status(200).json({
      extracted: result.extracted,
      source: result.source,
      providers: result.providers
    });
  }

  console.error(
    'All AI extraction providers failed:',
    JSON.stringify(result.attempts)
  );

  return res.status(502).json({
    error: 'All configured AI extraction providers failed or were rate-limited.',
    providers: result.attempts
  });
};

