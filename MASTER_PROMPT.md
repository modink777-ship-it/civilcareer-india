MISSION
Complete the CivilCareer overhaul end to end in one continuous run (Phase 0 to Phase 6), working autonomously for as long as it takes, up to a full day. Do not wait for my approval between phases. Do not ask questions you can answer by reading the code, testing, or checking current documentation. Give me one final report at the end.

PROJECT
CivilCareer (https://civilcareer-india-two.vercel.app/): India-only, civil-engineering-only platform for private/MNC jobs, government civil recruitment (SSC JE, RRB JE, State PSC AE/JE, PWD, CPWD, NHAI, MES, metro, irrigation, PSUs), exams and free prep. Goal: the first place an Indian civil engineer opens to find a verified job, never miss a government civil vacancy, and prepare for it. We win on civil-only relevance, provable trust, structured government data, civil-specific tools and a premium look, against Naukri, LinkedIn, Indeed, foundit, Shine, Apna, Freshersworld, Sarkari Result, FreeJobAlert and NCS.

HARD CONSTRAINTS (always)
- ZERO COST. Free tiers and open-source only. Before relying on any free tier, check its current limits and terms and record them in docs/01-free-tier-limits.md. Design so that hitting a limit degrades gracefully.
- India-only, civil-only. Nothing auto-publishes. Never charge candidates. Never invent data, counts, testimonials or revenue. Government listings link only to official domains (.gov.in, .nic.in, official PSU/board sites).
- TRUTHFUL CLAIMS. Every claim on the site must be true and provable. If a claim cannot be proven, reword it or remove it (see Phase 4).
- Never commit secrets. Use environment variables. Add a secret scan (for example gitleaks in GitHub Actions).
- Do not delete existing jobs or data. Hide or mark instead. The 513 LinkedIn-sourced rows stay for now; new ingestion prefers official government sources and company career pages.
- If something cannot be verified, say so. Do not guess. Do not report a fix as done unless you have tested it and can show the evidence.

CURRENT STATE (verified by me; do not redo, but re-check that it still holds)
Database (Supabase, project ref tnjegaqheyaukyqqighz): the lockdown is complete.
- RLS is on for all 25 public tables. Your earlier list of 14 was incomplete; it missed candidate_profiles, candidate_saved_jobs, candidate_job_events, candidate_job_applications, saved_jobs, job_events, career_profiles, company_sources, job_sources, source_snapshots and employer_verifications. Update docs/00-audit-findings.md with the full list.
- All policies were dropped except owner-scoped policies on candidate_*, job_alerts and job_alert_deliveries.
- anon and authenticated have NO table privileges on any table (verified with has_table_privilege / has_any_column_privilege: all false).
- civilcareer_analytics_summary (SECURITY DEFINER) is executable by service_role only. No views. No storage policies.
Accounts: my account modink777@gmail.com (id 5d66d269-0499-40ed-9981-c71d95bd919b) was manually confirmed in auth.users and I can sign in. Supabase's built-in email allows about 2 emails per hour to team addresses only, so confirmation emails to real users will not arrive until custom SMTP is configured.
Tested by me on the live site after the lockdown: sign-in works; alert preferences save and display; saved jobs persist after refresh. NOT verified: profile sync; whether the subscribe.js service-key fix is deployed.
Findings from me: (a) the account page says "Use Apply on a job and mark it as applied" but I cannot find any "Mark as applied" control on job pages; (b) Chrome DevTools reports an ignored @import at styles.css line 222; (c) 16 form fields share duplicate id values within the same form.

WHAT THE PUBLIC SITE STILL SHOWS (checked by me just now; production is unchanged from the start)
- The whole admin UI (owner-key gate, AI importer, web discovery, notification reader, monetization tab) is in the public HTML on EVERY route.
- A personal Gmail in the footer Contact link; a WhatsApp channel link that looks like a placeholder; a PDF upload field on Submit Resource.
- Counters show "..." and lists show "Loading..." because content loads by JavaScript.
- Nine main-nav items, with separate "Government" and "Govt Jobs Table" pages; Job Alerts is missing from the homepage nav (only on /govt-jobs).
- /private-jobs serves the homepage title and a canonical tag pointing to the homepage "/". Only /govt-jobs has its own title, description and canonical. Check every section route for the same problem.
- /govt-jobs says "Only official notifications", "Updated daily" and that entries are pulled automatically from official sources (NCS, Employment News, state notifications). Your audit found zero .gov.in sources in the jobs table and only 13 government rows, all from aggregators. These claims are not currently supported.
- The footer links /career-guides.html, /career-tools.html and /legal.html use a different URL style from the rest of the site.

WORKING METHOD
- Work on a branch. Use preview deployments for testing. One commit per logical change so each can be reverted alone.
- WITHIN THE FIRST HOUR: give me a working preview URL and create docs/PROGRESS.md. I will check them. Keep PROGRESS.md updated after every completed task with time, what changed, commit hash, test evidence and open blockers.
- Start by re-checking production yourself: fetch the live HTML of /, /private-jobs and /govt-jobs and search it for admin strings, "owner key", the Gmail address and the WhatsApp link. Record the results as your baseline. Do not rely on earlier reports.
- After each phase, test it yourself: curl/HTTP tests, Lighthouse mobile, bundle and HTML searches, screenshots at 360px in light and dark mode, second-account denial tests. Save the evidence in docs/. If tests fail, fix or revert before moving on.
- Merge to production only after that phase's tests pass. Never leave production broken. Write a rollback note for each merge. After each production deploy, re-fetch the live pages and confirm the change is really live.
- BLOCKER RULE: if something needs my accounts, secrets, DNS, SQL editor access or money, add it to the "Waiting on owner" list in docs/PROGRESS.md with exact steps, prepare everything around it (code, config, tests against mocks or preview), and continue with the next task. Never sit idle waiting for me.
- ORDER OF WORK: Phase 2 first (the admin exposure is still live), then Phase 3, 4, 5, 6.

PHASE 0 - BASELINE
Re-run the Lighthouse mobile audit and the checks listed above, and save the "before" numbers (homepage was 56 Performance, LCP 9.7s; server-rendered job pages scored 100). Update docs 00 to 05 with the corrected facts. Do not redo the database work.

PHASE 1 - DATABASE (DONE; verify only)
Confirm nothing has regressed: anon and authenticated still have no table privileges, RLS is on for all 25 tables, and the analytics function is still service_role-only. Re-run an external probe with the anon key for SELECT, INSERT, UPDATE and DELETE on every public table, including published=eq.false reads, and record the results.

PHASE 2 - MOVE WRITES AND ADMIN SERVER-SIDE (ship this first)
1. Admin access is an ALLOWLIST: only my account (email in a server-side ADMIN_EMAIL variable, or user id) may reach the admin route or any admin/AI endpoint. Being logged in is not enough. Check it on the server for every admin request. Prove it by signing up a throwaway second account and showing it is denied.
2. Build the new protected admin (Supabase Auth, 2FA if available) alongside the old owner-key gate. Confirm I can get in. Only then remove the old gate and the whole admin UI from the public bundle and from the HTML of every route. Prove it by searching the built JS and the live HTML for admin strings, "owner key" and key material, and show the empty results. The service_role key lives only in environment variables.
3. civilcareer_analytics_summary: find where it is called. If from the browser, move the call to an admin-only server handler.
4. Post a Job, Report, Submit Resource: route through server functions with Cloudflare Turnstile, per-IP rate limiting, honeypot, validation and length limits. Remove PDF uploads (links only). Submissions land as unpublished drafts.
5. Deploy or finish the subscribe.js service-key fix and confirm newsletter signups work.
6. Harden the AI importer against prompt injection from pasted or scraped text. AI output never publishes automatically. Handle Gemini free-tier rate limits with caching, batching and a manual-entry fallback.
7. Replace the personal Gmail in the footer with a contact form. Fix or remove the placeholder WhatsApp link; verify Telegram.
8. Application tracker: (a) find any code that writes to candidate_job_applications and whether it runs in the browser (user JWT) or on the server (service key); (b) if the lockdown broke it, show the failing request and write a minimal GRANT to authenticated only as a script for my review; (c) if it was never built, build it: record the click on an external Apply link, and when the user returns show "Did you apply to <job>? Yes / Not yet", writing through a server function. Also verify profile sync end to end with a test account.
9. Email: prepare custom SMTP for Supabase Auth (free Brevo plan or similar) with exact setup steps; list the credentials I must provide under "Waiting on owner".

PHASE 3 - PERFORMANCE AND INDEXING
1. Pre-render or server-render the homepage and all listing, role, city, state, organisation and exam pages, INCLUDING the government jobs table (it currently shows only "Loading..." without JavaScript). Replace "..." counters with cached values and skeletons. Code-split so admin and forms never load on public pages.
2. Fix canonicals and metadata: every section route (/private-jobs, /government-jobs, /govt-jobs, /exams, /study-materials, /career-paths, /for-you, /job-alerts and so on) needs its own title, meta description, canonical, and OG tags. No route may canonicalise to the homepage unless it truly is the homepage. Unify the URL style: convert the /legal.html, /career-guides.html and /career-tools.html pages to clean paths with 301 redirects, and make sure they follow the same design and safety fixes.
3. Fix indexing: a sitemap matching real live pages (only about 2 pages appeared indexed against a 758-URL sitemap; treat that as an estimate to verify), robots.txt, JobPosting (with validThrough), FAQ, Breadcrumb and Organization schema, and proper expired-job handling. A nonexistent job slug must return a real 404, not a 500.
4. Remove @import from CSS. Load fonts through <link rel="preconnect"> and <link rel="stylesheet"> in the HTML head (or self-host font files). Confirm the intended fonts render.
5. Give me Search Console verification steps. Report Lighthouse mobile before and after (target 90+ on Performance, Accessibility, SEO and Best Practices).

PHASE 4 - DATA QUALITY, TRUTHFUL CLAIMS AND THE GOVERNMENT DIFFERENTIATOR
1. Truthful claims first. Until official-source ingestion is working, reword the government page and homepage claims to match reality (for example: remove "Only official notifications", "Updated daily" and "pulled automatically from NCS/Employment News/state notifications" unless they are true). Every government row must show its official source domain and last-verified date. Show a "Verified" badge only after human review. Re-check the claims "Human-reviewed", "Source-first", "Updated daily" and "auto-refreshed from official sources" everywhere they appear, and make each one either provable or removed.
2. Expose salary, deadline, vacancies, qualification, source URL and last-verified date in the public API and on every listing. Show "not disclosed" instead of blank.
3. Deduplicate (about 5% duplicates). Auto-hide expired listings.
4. Government jobs are 13 versus 723 private. Build free, official-source ingestion for SSC, RRB, State PSCs, state PWDs, CPWD, NHAI, MES, metro and PSUs. Each entry lands as an unpublished draft for my review. Run it on a scheduled GitHub Action inside free minutes. Respect robots.txt and each site's terms.
5. Build government notification detail pages (organisation, post, level, vacancies, pay level, age limit and relaxation, fee by category, key dates, selection stages, syllabus, official PDF and apply links, "what changed vs last time"), the Eligibility Checker, a government civil calendar with .ics export, and state and organisation pages.
6. Report new counts and show three sample entries for my review.

PHASE 5 - DESIGN SYSTEM AND EXPERIENCE
1. Apply the "Blueprint Navy and Brass" design system from docs/03-design-system.md everywhere via CSS variables: light bg #F7F8FA, surface #FFFFFF, surface-2 #EEF2F7, border #E3E7EE, ink #0B1F3A, ink-muted #4A5A70, primary #0B1F3A (hover #14315A), accent #D4A72C (fills only, never text), on-accent #0B1F3A, accent-text #7A5F00, govt #0B6F79 on #E3F3F4, private #1C5AA0 on #E6EEF8, success #0C6E55 on #E2F4EE, warn #9A4506 on #FDF0E1, danger #B42318 on #FDE9E7, link #1D4ED8; dark bg #071426, surface #0E2138, surface-2 #14304F, border #23405F, ink #EAF0F8, ink-muted #9FB0C6, primary/accent #E6BC4B with on-primary #071426, govt #5CD0DB, private #7FB2F0, success #3FCF9F, warn #F5A524, danger #FF7A6B. Fonts: Plus Jakarta Sans (headings), Inter (body), Noto Sans Devanagari (Hindi). Keep all text at WCAG AA (4.5:1) or better in both themes and re-check any colour you change. Light and dark mode with a toggle that respects the system setting. Reduced-motion support. Mobile-first at 360px with 44px tap targets. Govt jobs are always teal and private jobs always steel blue.
2. Fix the 16 duplicate form field ids: give every field a unique id and point each label's for at it. Verify autofill and confirm axe/Lighthouse show no duplicate-id errors.
3. Merge "Government" (cards) and "Govt Jobs Table" into one page with a Table/Card toggle and a 301 redirect. Cut the main nav to about six items (Jobs, Govt Jobs, Exams, Prepare, For You, Alerts). Move Post a Job, Submit Resource and Report to the footer or an employer area. Put Job Alerts in the main nav.
4. Private jobs: filters for role, experience, state/city, employer type, project type, salary, posted date, work type and fresher-friendly; sort by relevance, newest and closing soon; save job, similar jobs; company pages; Report and WhatsApp Share buttons on every listing.
5. Alerts: email digest via the free SMTP plan, web push (VAPID) and Telegram, filtered by role, state and job type, with one-click unsubscribe. Signup above the fold on the homepage.
6. For You: 30-second onboarding with immediate matches and "why this matches" explanation. Browsing works without login.
7. Screenshots of each key page at 360px in light and dark mode.

PHASE 6 - HOSTING, LEGAL AND GROWTH
1. Vercel Hobby forbids commercial use. Prepare the move to Cloudflare Pages (or Netlify free): deploy on a preview URL, test everything, write exact switch steps and a rollback plan. Do NOT change DNS or switch production without my confirmation.
2. Complete Terms, Privacy (DPDP Act: consent, data deletion), Disclaimer and a Copyright/takedown process. State how data is collected and sourced.
3. Programmatic SEO pages with unique content, FAQ and internal links (for example "Site Engineer jobs in Pune", "QS jobs in Hyderabad", "SSC JE Civil 2026 syllabus", "UP PWD JE recruitment"). No thin or duplicate pages.
4. Weekly email digest, state-wise Telegram channels, and free analytics (Cloudflare Web Analytics) with a simple KPI report: weekly active users, alert subscribers, apply-click rate, percent of listings verified in the last 7 days, scam reports per 1,000 views, organic traffic, profile-completion rate.
5. Study hub, career guides, resume/ATS checker and salary explorer: build what fits inside the day, ranked by user value; list the rest as next steps.

STOP AND ASK ME ONLY FOR
Turnstile keys; SMTP credentials; Cloudflare and GitHub secrets; Search Console verification; buying a domain; DNS and the final hosting switch; any destructive or irreversible action (deleting data, key rotation); any SQL that must run in the Supabase SQL editor (give the exact script, what it changes and how to verify, and never assume it ran); anything that could cost money.

FINAL REPORT (one message when finished)
1. Per phase: done, partly done or pending on me, with evidence (commit hashes, before/after Lighthouse scores, test outputs, screenshots, and a fresh fetch of the live pages showing the change is deployed).
2. Updated docs 00 to 05 and docs/PROGRESS.md.
3. "Things only you can do" with exact steps for each.
4. Live counts of government vs private jobs and three sample government entries.
5. Everything skipped, with reasons.