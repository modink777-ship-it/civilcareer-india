# Discovery + Mobile Navigation Fix

## Discovery
- Admin Discovery search now uses bounded free-web sources: Google Search via Jina Reader, DuckDuckGo via Jina/direct fallback, and Google News RSS.
- Search requests are intentionally limited so the Vercel serverless function is less likely to time out.
- Search results show the source URL and a **Create draft & review** action.
- Create draft fetches the original vacancy through the existing extraction pipeline and opens the job editor with extracted fields.
- Nothing is published automatically.
- The UI reports which discovery sources returned results.

## Mobile navigation
- At <=1050px, the hamburger navigation opens as a contained two-column panel instead of one long vertical stack.
- Links have fixed touch-friendly heights, no wrapping overlap, and bounded scrolling.
- The panel stays below the safety notice/header and above hero content.

## Cache
- Service-worker cache bumped to `civilcareer-v8-web-discovery-mobile-fixed` so the updated JavaScript/CSS is picked up after deployment.
