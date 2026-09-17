# CivilCareer Web Discovery

The Admin → Discovery tab now searches public web results and lets the admin fetch an original vacancy page and run the existing free-first extraction chain.

## Free-first path

1. Search public web result pages through Jina Reader's basic URL reader.
2. Use Google News RSS as an additional free fallback.
3. Fetch the original vacancy page through Jina Reader.
4. Run the existing extraction provider chain (Groq → Gemini → OpenRouter Free → Hugging Face → local fallback, when configured/available).
5. Open the structured draft in the existing job editor.
6. Nothing is published automatically.

Jina documents its basic Reader URL-fetching tier as free and documents `r.jina.ai` for URL reading. Search/SERP via `s.jina.ai` is a separate service and may require a key, so this implementation does not depend on it.

## Important

- Search results are leads, not verified jobs.
- Always open the original source and verify employer, dates, eligibility and application URL before publishing.
- The automated GitHub scraper now uses the same free-first web-discovery approach instead of depending on Indeed RSS alone.
- No paid API is automatically enabled.

## Verification note
Discovery uses a free-first chain: Jina Reader for search-page rendering, then direct server-side Google/Bing/DuckDuckGo HTML fetching if Jina cannot return useful links, plus Google News RSS as a final discovery source. A discovered result is only a lead; the original vacancy page must be opened and verified before publishing.
