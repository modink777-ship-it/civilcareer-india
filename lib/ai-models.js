/**
 * CivilCareer — free-tier AI failover chain
 *
 * Goal: never hard-fail because ONE free tier ran out. Every provider below has a
 * genuinely free tier, and the chain is tried in order:
 *
 *   Groq → Google AI Studio (Gemini) → Cerebras → OpenRouter → Mistral →
 *   GitHub Models → Together → Hugging Face → DeepSeek → Cloudflare → Cohere
 *
 * Behaviour:
 *   • A provider whose key is missing is skipped silently (never fatal).
 *   • A provider that returns quota/rate-limit or auth errors is put on a short
 *     cooldown and skipped until it expires, so a dead tier is not retried on
 *     every single call.
 *   • MULTIPLE KEYS per provider are supported: put several keys in the same
 *     environment variable separated by commas — when key #1 runs out, key #2 is
 *     used. This is the practical way to keep going on free tiers.
 *   • The starting point rotates between calls, so load is spread across the free
 *     tiers instead of hammering the first one.
 *   • Throws ONLY when every configured provider has failed, and the error
 *     carries a per-provider attempt log for the admin UI.
 *
 * No dependencies: uses global fetch (Node 18+ / Vercel).
 *
 * Environment variables (add whichever ones you create — all are optional):
 *   GROQ_API_KEY            console.groq.com
 *   GEMINI_API_KEY          aistudio.google.com   (Google AI Studio, free)
 *   CEREBRAS_API_KEY        cloud.cerebras.ai     (free tier)
 *   OPENROUTER_API_KEY      openrouter.ai         (":free" models)
 *   MISTRAL_API_KEY         console.mistral.ai    (free tier)
 *   GITHUB_MODELS_TOKEN     GitHub Models (free for GitHub accounts)
 *   TOGETHER_API_KEY        api.together.xyz     (free Llama endpoints)
 *   HF_TOKEN                huggingface.co       (Inference Providers, free credits)
 *   DEEPSEEK_API_KEY        platform.deepseek.com
 *   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN   (Workers AI free daily neurons)
 *   COHERE_API_KEY          dashboard.cohere.com (trial key)
 */

'use strict';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);

/* Cooldowns per provider+key after a failure class. */
const COOLDOWN_MS = {
  quota: 10 * 60 * 1000, // rate limited / free quota used up → back off 10 min
  auth: 60 * 60 * 1000,  // bad key → don't keep hammering for an hour
  unavailable: 3 * 60 * 1000, // 5xx / timeout → short back-off
};
const cooldownUntil = new Map();

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Read a comma/space separated list of keys from one env var. */
function envKeys(name) {
  if (!name) return [];
  return String(process.env[name] || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(k => k.length > 8);
}

function jsonMode(likely) {
  return likely === true;
}

/** Classify a failure so the right cooldown is applied. */
function classify(status, bodyText) {
  const body = String(bodyText || '').toLowerCase();
  if (status === 429 || /quota|rate limit|rate_limit|too many requests|exceeded|resource_exhausted|insufficient/.test(body)) {
    return 'quota';
  }
  if (status === 401 || status === 403 || /invalid api key|unauthor|forbidden|api key not valid|authentication/.test(body)) {
    return 'auth';
  }
  if (status === 400 || status === 422) {
    // Often a request-shape problem (e.g. response_format unsupported) — retryable
    // without JSON mode rather than a dead provider.
    return /response_format|json/.test(body) ? 'shape' : 'bad_request';
  }
  if (status >= 500 || status === 408 || status === 0) return 'unavailable';
  return 'unavailable';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ── provider definitions ────────────────────────────────────────────── */

/** Generic OpenAI-compatible chat provider. */
function openAICompatible({ id, label, keys, base, model, json, extraHeaders }) {
  return {
    id, label, keys, model, json, kind: 'openai',
    async run(key, ctx) {
      const body = {
        model,
        messages: [{ role: 'user', content: ctx.prompt }],
        temperature: ctx.temperature,
        max_tokens: ctx.maxTokens,
      };
      if (json && ctx.allowJsonMode !== false) body.response_format = { type: 'json_object' };
      const res = await fetch(base, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(extraHeaders || {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text };
      let data;
      try { data = JSON.parse(text); } catch { return { ok: false, status: 502, text }; }
      const content =
        data.choices?.[0]?.message?.content ||
        data.choices?.[0]?.text ||
        '';
      return content ? { ok: true, content } : { ok: false, status: 502, text };
    },
  };
}

const PROVIDERS = [
  openAICompatible({
    id: 'groq',
    label: 'Groq',
    keys: envKeys('GROQ_API_KEY'),
    base: 'https://api.groq.com/openai/v1/chat/completions',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    json: true,
  }),
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini)',
    keys: envKeys('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    kind: 'gemini',
    async run(key, ctx) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent` +
        `?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ctx.prompt }] }],
          generationConfig: {
            temperature: ctx.temperature,
            maxOutputTokens: ctx.maxTokens,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text };
      let data;
      try { data = JSON.parse(text); } catch { return { ok: false, status: 502, text }; }
      const content =
        data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
      return content ? { ok: true, content } : { ok: false, status: 502, text };
    },
  },
  openAICompatible({
    id: 'cerebras',
    label: 'Cerebras',
    keys: envKeys('CEREBRAS_API_KEY'),
    base: 'https://api.cerebras.ai/v1/chat/completions',
    model: process.env.CEREBRAS_MODEL || 'llama3.3-70b',
    json: true,
  }),
  openAICompatible({
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    keys: envKeys('OPENROUTER_API_KEY'),
    base: 'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    json: true,
    extraHeaders: { 'HTTP-Referer': 'https://civilcareer-india-two.vercel.app', 'X-Title': 'CivilCareer' },
  }),
  openAICompatible({
    id: 'mistral',
    label: 'Mistral',
    keys: envKeys('MISTRAL_API_KEY'),
    base: 'https://api.mistral.ai/v1/chat/completions',
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    json: true,
  }),
  openAICompatible({
    id: 'github_models',
    label: 'GitHub Models',
    keys: envKeys('GITHUB_MODELS_TOKEN'),
    base: 'https://models.inference.ai.azure.com/chat/completions',
    model: process.env.GITHUB_MODELS_MODEL || 'gpt-4o-mini',
    json: true,
  }),
  openAICompatible({
    id: 'together',
    label: 'Together AI (free endpoints)',
    keys: envKeys('TOGETHER_API_KEY'),
    base: 'https://api.together.xyz/v1/chat/completions',
    model: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    json: true,
  }),
  openAICompatible({
    id: 'huggingface',
    label: 'Hugging Face Inference',
    keys: envKeys('HF_TOKEN'),
    base: 'https://router.huggingface.co/v1/chat/completions',
    model: process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct',
    json: true,
  }),
  openAICompatible({
    id: 'deepseek',
    label: 'DeepSeek',
    keys: envKeys('DEEPSEEK_API_KEY'),
    base: 'https://api.deepseek.com/chat/completions',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    json: true,
  }),
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    /* Two-value credential: ACCOUNT_ID + API_TOKEN. The token list drives retries;
       an empty account id simply disables the provider. */
    keys: envKeys('CLOUDFLARE_API_TOKEN').filter(() => !!String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()),
    model: process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    kind: 'cloudflare',
    async run(key, ctx) {
      const acct = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acct)}/ai/run/${this.model}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: ctx.prompt }],
          max_tokens: ctx.maxTokens,
          temperature: ctx.temperature,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text };
      let data;
      try { data = JSON.parse(text); } catch { return { ok: false, status: 502, text }; }
      const content = data.result?.response || '';
      return content ? { ok: true, content } : { ok: false, status: 502, text };
    },
  },
  {
    id: 'cohere',
    label: 'Cohere (trial)',
    keys: envKeys('COHERE_API_KEY'),
    model: process.env.COHERE_MODEL || 'command-r-08-2024',
    kind: 'cohere',
    async run(key, ctx) {
      const res = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: ctx.prompt }],
          temperature: ctx.temperature,
          max_tokens: ctx.maxTokens,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text };
      let data;
      try { data = JSON.parse(text); } catch { return { ok: false, status: 502, text }; }
      const content =
        data.message?.content?.map(c => c.text).filter(Boolean).join('') ||
        data.message?.content?.[0]?.text || '';
      return content ? { ok: true, content } : { ok: false, status: 502, text };
    },
  },
].filter(p => p && typeof p.run === 'function');

/* ── cooldown bookkeeping ────────────────────────────────────────────── */

function slotId(providerId, keyIndex) {
  return `${providerId}#${keyIndex}`;
}
function cooling(providerId, keyIndex) {
  const until = cooldownUntil.get(slotId(providerId, keyIndex)) || 0;
  return until > Date.now();
}
function cool(providerId, keyIndex, kind) {
  const ms = COOLDOWN_MS[kind] || COOLDOWN_MS.unavailable;
  cooldownUntil.set(slotId(providerId, keyIndex), Date.now() + ms);
}

/* ── response parsing ───────────────────────────────────────────────── */

/** Pull a JSON object out of a model reply (handles code fences and prose). */
function parseJsonLoose(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

/* ── public API ─────────────────────────────────────────────────────── */

/** Which providers have at least one key configured (for admin diagnostics). */
function providerStatus() {
  return PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    model: p.model,
    keys: p.keys.length,
    configured: p.keys.length > 0,
    onCooldown: p.keys.length > 0 && p.keys.every((_, i) => cooling(p.id, i)),
  }));
}

/**
 * Ask the free-tier chain for a JSON object.
 * @param {{prompt:string, maxTokens?:number, temperature?:number, rotate?:boolean}} opts
 * @returns {Promise<{json:object, provider:string, model:string, attempts:Array}>}
 */
async function chatJSON({ prompt, maxTokens = 1200, temperature = 0.1, rotate = true } = {}) {
  const configured = PROVIDERS.filter(p => p.keys.length);
  if (!configured.length) {
    const err = new Error(
      'No AI provider is configured. Add at least one free key (for example GROQ_API_KEY or GEMINI_API_KEY) in your environment variables.'
    );
    err.noProvider = true;
    err.attempts = [];
    throw err;
  }

  /* Rotate the starting provider so free tiers share the load. */
  let order = configured;
  if (rotate && configured.length > 1) {
    const offset = Math.floor(Date.now() / 1000) % configured.length;
    order = [...configured.slice(offset), ...configured.slice(0, offset)];
  }

  const attempts = [];

  for (const provider of order) {
    for (let i = 0; i < provider.keys.length; i++) {
      if (cooling(provider.id, i)) {
        attempts.push({ provider: provider.id, key: i + 1, result: 'cooling', ms: (cooldownUntil.get(slotId(provider.id, i)) - Date.now()) });
        continue;
      }

      let out;
      try {
        out = await provider.run(provider.keys[i], { prompt, maxTokens, temperature });
      } catch (e) {
        const kind = /abort|timeout/i.test(String(e && e.name) + String(e && e.message)) ? 'unavailable' : 'unavailable';
        cool(provider.id, i, kind);
        attempts.push({ provider: provider.id, key: i + 1, result: 'error', detail: String((e && e.message) || e).slice(0, 160) });
        continue;
      }

      /* Some providers reject response_format. Retry the SAME key once without
         JSON mode instead of burning the whole provider. */
      if (
        !out.ok &&
        provider.kind === 'openai' &&
        (out.status === 400 || out.status === 422) &&
        /response_format|json_object|json mode/i.test(out.text || '')
      ) {
        try {
          out = await provider.run(provider.keys[i], {
            prompt, maxTokens, temperature, allowJsonMode: false,
          });
        } catch (e) {
          attempts.push({ provider: provider.id, key: i + 1, result: 'error', detail: String((e && e.message) || e).slice(0, 160) });
          continue;
        }
      }

      if (!out.ok) {
        const kind = classify(out.status, out.text);
        cool(provider.id, i, kind);
        attempts.push({ provider: provider.id, key: i + 1, result: kind, status: out.status });
        continue;
      }

      const parsed = parseJsonLoose(out.content);
      if (!parsed) {
        attempts.push({ provider: provider.id, key: i + 1, result: 'invalid-json' });
        continue;
      }

      attempts.push({ provider: provider.id, key: i + 1, result: 'ok' });
      return { json: parsed, provider: provider.id, model: provider.model, attempts };
    }
  }

  const err = new Error(
    'Every configured AI provider failed or is on cooldown. Add another free key, or retry in a few minutes.'
  );
  err.attempts = attempts;
  err.allFailed = true;
  throw err;
}

module.exports = { chatJSON, providerStatus, parseJsonLoose, PROVIDERS };
