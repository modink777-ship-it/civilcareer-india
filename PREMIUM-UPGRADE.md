# CivilCareer Premium Ecosystem Upgrade

This upgrade preserves the existing static HTML + CSS + JavaScript + Vercel Functions + Supabase architecture. It adds the premium experience as an additive layer rather than replacing the existing application.

## New files

- `premium-experience.css` — premium visual system, responsive UI, glass cards, roadmap, specialization map, simulator, saved-job UI.
- `premium-experience.js` — Three.js hero, GSAP/ScrollTrigger motion, roadmap explorer, specialization map, career simulator, saved-job synchronization.
- `api/saved-jobs.js` — server-side Supabase saved-job API keyed to the existing anonymous visitor UUID.
- `api/alerts.js` — public job-alert subscription endpoint plus owner-only alert listing.
- `supabase-v10.sql` — `saved_jobs` table and index/RLS setup.
- `PREMIUM-UPGRADE.md` — deployment and verification notes.

## Modified files

- `index.html` — premium stylesheet/scripts, Organization structured data, existing hero enhanced at runtime.
- `app.js` — `/saved-jobs` route metadata and exposure of the loaded job collection to the premium layer.
- `job-alerts.html` — server-backed alert subscription while retaining local matching utility.
- `vercel.json` — `/saved-jobs` rewrite to the existing SPA shell.

## Supabase migration

Run `supabase-v10.sql` after the existing CivilCareer migrations. The API uses the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY`; no browser secret is introduced.

## Vercel

Existing environment variables remain the source of truth:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred) or `SUPABASE_SERVICE_KEY`
- `OWNER_KEY`
- Existing AI/provider variables already used by the repository, if configured.

No new secret is required for Three.js or GSAP because the pinned public CDN builds are loaded client-side.

Deploy normally with the existing Vercel project. After deployment, verify:

1. `/` loads the new 3D hero and retains the original job/exam/resource data.
2. `/saved-jobs` loads and can save/remove a job.
3. `/job-alerts.html` can create an alert and check current jobs.
4. `/api/saved-jobs` and `/api/alerts` return database errors only when Supabase configuration is absent.
5. Existing `/private-jobs`, `/government-jobs`, `/exams`, `/study-materials`, `/for-you`, `/post-a-job`, `/submit-resource`, `/report`, and `/admin` routes continue to work.
6. Job detail routes continue to be served by the existing jobs API/server-rendering logic.
7. The homepage contains both WebSite and Organization JSON-LD; existing job detail JobPosting generation remains in `api/jobs.js`.

## Performance behavior

- Three.js uses a capped device pixel ratio and a small procedural scene with no external 3D models.
- The hero is disabled for `prefers-reduced-motion` users.
- GSAP/ScrollTrigger is used only for section entrances and counters.
- Existing job/resource images continue to use the application's existing lazy-loading behavior.
- No frontend npm dependency or bundler is introduced.
