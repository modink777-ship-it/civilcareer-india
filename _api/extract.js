/**
 * CivilCareer — AI Job Extraction API
 *
 * Extraction runs through the free-tier failover chain in lib/ai-models.js:
 *
 *   Groq → Google AI Studio (Gemini) → Cerebras → OpenRouter → Mistral →
 *   GitHub Models → Together → Hugging Face → DeepSeek → Cloudflare → Cohere
 *
 * When one free tier runs out, the next configured one is used automatically, so
 * extraction keeps working. Put several keys in one variable (comma separated) to
 * continue on the same provider after the first key is exhausted.
 *
 *   POST /api/extract                { url?, text? }        → { extracted, provider, model, attempts }
 *   GET  /api/extract?status=1&key=… → { providers:[…] }     (owner key required)
 */

'use strict';

const { chatJSON, providerStatus } = require('../lib/ai-models');

/* Constant-time-ish owner key check (no extra module needed). */
function ownerKeyOk(req) {
  const owner = String(process.env.OWNER_KEY || '').trim();
  if (!owner) return false;
  const provided = String(
    (req.query && req.query.key) || (req.headers && req.headers['x-owner-key']) || ''
  ).trim();
  if (!provided || provided.length !== owner.length) return false;
  let diff = 0;
  for (let i = 0; i < owner.length; i++) diff |= owner.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  /* ── Admin diagnostic: which free AI tiers are configured ── */
  if (req.method === 'GET') {
    if (!ownerKeyOk(req)) {
      return res.status(401).json({ error: 'Owner key required. Add ?key=<OWNER_KEY>.' });
    }
    return res.status(200).json({
      providers: providerStatus(),
      order: providerStatus().filter(p => p.configured).map(p => `${p.label} (${p.model})`),
      configuredCount: providerStatus().filter(p => p.configured).length,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const { url, text } = body;

  if (!url && !text) {
    return res.status(400).json({ error: 'Provide url or text' });
  }

  /* ────────────────────────────────────────────────
     Fetch page content if only a URL was supplied
  ──────────────────────────────────────────────── */
  let content = String(text || '');

  if (url && !content) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivilCareerBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!r.ok) {
        return res.status(400).json({ error: `Could not fetch URL. HTTP ${r.status}` });
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
      return res.status(400).json({ error: 'Could not fetch URL: ' + e.message });
    }
  }

  if (!content.trim()) {
    return res.status(400).json({ error: 'No readable text found at that URL. Paste the vacancy text instead.' });
  }

  /* ────────────────────────────────────────────────
     Extraction prompt
  ──────────────────────────────────────────────── */
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

  /* ────────────────────────────────────────────────
     Free-tier failover chain
  ──────────────────────────────────────────────── */
  try {
    const out = await chatJSON({ prompt, maxTokens: 1200, temperature: 0.1 });

    if (!out || !out.json || typeof out.json !== 'object') {
      return res.status(502).json({
        error: 'The AI provider returned an unusable response. Try again or paste the vacancy text.',
        attempts: (out && out.attempts) || [],
      });
    }

    return res.status(200).json({
      extracted: out.json,
      source: out.provider,
      provider: out.provider,
      model: out.model,
      attempts: out.attempts,
      warning:
        out.provider === 'groq'
          ? undefined
          : `Extracted using the free-tier fallback provider “${out.provider}”. Verify every field before publishing.`,
    });
  } catch (e) {
    if (e && e.noProvider) {
      return res.status(503).json({
        error: e.message,
        attempts: [],
        setup: 'Add at least one free key in Vercel → Settings → Environment Variables (GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY, GITHUB_MODELS_TOKEN, TOGETHER_API_KEY, HF_TOKEN, DEEPSEEK_API_KEY, CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, COHERE_API_KEY).',
      });
    }

    console.error('AI extraction failed on every configured provider:', e && e.message);

    return res.status(502).json({
      error: (e && e.message) || 'AI extraction failed.',
      attempts: (e && e.attempts) || [],
    });
  }
};
