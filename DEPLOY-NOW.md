# Deploy this version

This version contains two independent fixes:

1. `/api/admin-auth` authenticates the owner key without loading Supabase or discovery.
2. `/api/jobs` no longer imports the optional discovery module at startup.

After deployment:
- `GET /api/admin-auth` with the owner key must return 200.
- `GET /api/jobs?health=1` should return 200.
- `GET /api/jobs` should return `{ "jobs": [...] }` when Supabase is configured.

Required Production environment variables:
- OWNER_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_SERVICE_KEY

Do not paste these secret values into chat.
