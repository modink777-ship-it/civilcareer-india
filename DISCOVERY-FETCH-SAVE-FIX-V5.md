# Discovery Fetch/Save Fix V5

## Root causes fixed
1. Manual discovery was doing AI enrichment inside a Vercel request capped at 15 seconds, so the multi-source fetch could time out before saving.
2. Discovery candidates contained metadata fields (`source_name`, `source_trust`, `extraction_method`) that were not guaranteed database columns, causing Supabase inserts to fail.
3. HTML-only parsing could not understand Jina Reader's Markdown/plain-text fallback for official sources.

## New behavior
- Manual Admin discovery is fast and deterministic: fetch + relevance filter + normalization + duplicate check + save.
- AI enrichment is reserved for the scheduled GitHub Actions discovery path, where it has more execution time.
- Every saved discovery is explicitly `published=false` and `status=Pending Review`.
- Only schema-safe job fields are sent to Supabase, with a minimal fallback for older schemas.
- Jina Reader Markdown is parsed for official pages when direct HTML parsing produces no candidates.
- Discovery UI displays source failures and exact save errors instead of a generic failure message.

## Sources
The configured source list remains public/official feeds/pages. LinkedIn and Naukri are external search destinations, not unauthorized scrapers.
