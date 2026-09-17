# CivilCareer AI Extraction — Free Fallback Chain

The admin job importer now uses a resilient chain:

1. Groq (`GROQ_API_KEY`)
2. Gemini (`GEMINI_API_KEY`)
3. OpenRouter Free Models Router (`OPENROUTER_API_KEY`)
4. Hugging Face Inference Providers (`HF_TOKEN`)
5. Local rule-based extraction (no API key)

A provider that is missing, times out, or returns an error is skipped. The next configured provider is attempted automatically. The system never switches to a paid provider automatically.

## Environment variables

Keep these in Vercel Environment Variables only; never commit keys:

- `OWNER_KEY` — existing admin owner key (required)
- `GROQ_API_KEY` — optional
- `GEMINI_API_KEY` — optional
- `OPENROUTER_API_KEY` — optional; use only the free router/model
- `HF_TOKEN` — optional
- `GROQ_MODEL` — optional, defaults to `openai/gpt-oss-20b`
- `GEMINI_MODEL` — optional, defaults to `gemini-3.7-flash`
- `OPENROUTER_MODEL` — optional, defaults to `openrouter/free`
- `HF_MODEL` — optional, defaults to `openai/gpt-oss-20b:groq`

## Important ₹0 rule

Free tiers and model availability can change. This build does not add billing credentials, payment methods, or paid-provider fallback. If every AI provider is unavailable, the local extractor still attempts basic fields from the pasted vacancy text.

Always verify extracted job details against the original source before publishing.
