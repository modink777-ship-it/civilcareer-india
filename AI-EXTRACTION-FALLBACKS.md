# CivilCareer AI Job Extraction — Fixed + Free Fallback Chain

## What was fixed

The admin page was receiving the extraction response as `extracted`, while the front-end importer was reading `job`. That mismatch made the button appear to work but opened an empty editor. The importer now accepts both response shapes and the API returns both for compatibility.

The URL reader was also too strict/short-lived. It now tries the public page directly and then uses Jina Reader as a free URL-reading fallback before sending the content to AI.

## Extraction chain

1. Groq — `GROQ_API_KEY`
2. Gemini — `GEMINI_API_KEY`
3. OpenRouter Free Models Router — `OPENROUTER_API_KEY`
4. Hugging Face Inference Providers — `HF_TOKEN`
5. Local rule-based extraction — no AI key required

Missing, rate-limited, timed-out, or failed providers are skipped. The API never enables a paid provider automatically. OpenRouter's `openrouter/free` router is itself designed to select currently available free models.

## Free URL reading

When a vacancy URL cannot be read directly, CivilCareer tries `https://r.jina.ai/<original-url>`. Jina documents a basic no-key Reader tier; higher limits require a key.

## Vercel environment variables

Required:
- `OWNER_KEY`

Optional free-provider keys:
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `HF_TOKEN`

Optional models:
- `GROQ_MODEL` (default `openai/gpt-oss-20b`)
- `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `OPENROUTER_MODEL` (default `openrouter/free`)
- `HF_MODEL` (default `openai/gpt-oss-20b:groq`)
- `AI_PROVIDER_ORDER` (default `groq,gemini,openrouter-free,huggingface`)

Do not put API keys into HTML/JS files or commit them to GitHub.

## Important ₹0 rule

This build contains no paid fallback and no billing credentials. Free tiers, model availability, and quotas can change, so no system can honestly guarantee that every external free provider will remain free forever. If all configured AI providers fail, the local extractor still attempts to fill the basic vacancy fields.

Always verify title, employer, location, qualification, dates, salary, vacancies, and application link against the original source before publishing.
