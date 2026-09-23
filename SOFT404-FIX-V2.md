# CivilCareer — Soft 404 Fix V2

- Routes `/jobs/:slug` through a real Vercel dynamic function `/api/job/[slug].js`.
- Keeps the server-rendered job page and Supabase lookup.
- Accepts the slug from query parameters, Vercel dynamic route parameters, or the original path.
- Missing jobs still return genuine HTTP 404.
- No paid services or database migration.
