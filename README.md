# civilcareer.jobs — India

A deploy-ready India-only civil engineering jobs board. As the owner, paste an original public vacancy URL and the server extracts available structured details (role, company, location, description, employment type, salary and dates) and publishes the listing.

## Free public setup

You need free accounts on **GitHub**, **Vercel**, and **Supabase**. Free plans have usage limits, but are suitable for an early MVP with modest traffic.

### 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase.sql`.
3. In Supabase project settings, copy:
   - Project URL
   - `service_role` key (keep this secret; never add it to browser code)

### 2. Put the project on GitHub

Create a repository and upload all files from this folder, preserving the `api` folder.

### 3. Deploy on Vercel

1. Import the GitHub repository in Vercel.
2. Add these Environment Variables:
   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service-role key
   - `OWNER_KEY` = a long private password only you know
3. Deploy. Vercel gives you a public HTTPS address.
4. Optional: connect a custom domain later. The Vercel address works without buying a domain.

## Owner workflow

1. Open the public website.
2. Select **Add vacancy**.
3. Paste the original public vacancy URL and enter your owner key (saved locally on your device).
4. Select **Detect & publish vacancy**.

## What works automatically

The importer reads JobPosting JSON-LD and public page metadata. It works best with an original public job-detail URL from a company career page or job board.

## Important limitations

- LinkedIn and some other sites may block automated reading or require sign-in. No free parser can guarantee every LinkedIn link will work reliably.
- A WhatsApp group/invite link does not contain vacancy details. Paste the original job URL shared inside WhatsApp.
- If a shared message contains only text or an image and no public job URL, link-only extraction is impossible; a later version can add a text/image paste fallback.
- Source sites can change their HTML at any time. The parser uses structured job data first and metadata as a fallback.
- Review copyright and source-site terms before republishing full descriptions. Linking to the original vacancy and showing a concise excerpt is the safer default.

## Local preview

Opening `index.html` directly shows sample listings. The import and shared database features work after deployment because they require the serverless `/api` routes and environment variables.

## Files

- `index.html` — responsive public site and owner import screen
- `api/extract.js` — secure public-page vacancy parser
- `api/jobs.js` — owner-protected publishing and public listing API
- `supabase.sql` — database schema
- `vercel.json` — deployment configuration
