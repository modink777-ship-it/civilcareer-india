# CivilCareer audit findings — 29 Sep 2026

## Production verification limitation
A live fetch of the Vercel site was attempted during this run, but this execution environment could not resolve the public hostname. Therefore this document records source/package verification and does not claim the live deployment has changed.

## Database lockdown facts supplied by the owner and retained as requirements
The owner reports RLS enabled on all 25 public tables and no table privileges for `anon`/`authenticated`. The complete table list supplied for the lockdown is:

1. candidate_profiles
2. candidate_saved_jobs
3. candidate_job_events
4. candidate_job_applications
5. saved_jobs
6. job_events
7. career_profiles
8. company_sources
9. job_sources
10. source_snapshots
11. employer_verifications
12. job_alerts
13. job_alert_deliveries
14. jobs
15. exams
16. materials
17. employer_profiles
18. employer_submissions
19. resource_submissions
20. content_reports
21. analytics_events
22. job_role_master
23. qualification_master
24. subscribers
25. contact_messages

This run did not execute production SQL, so those live facts were not independently re-probed here.

## Source/package findings fixed in this run
- Public SPA HTML contained the complete admin dashboard and owner-key gate. Removed it; admin is now standalone at `/admin` → `admin.html`.
- Public JS contained stale admin/importer code and owner-key references. Removed the stale public admin code/bundle references.
- Candidate account UI used OTP/magic-link login in the supplied source. Replaced with password authentication.
- Public resource form accepted PDF upload. Removed it; links only.
- Personal Gmail and placeholder WhatsApp link removed from the public footer.
- Newsletter endpoint used the anon key after the reported database lockdown. Changed to server-side service role.
- Application tracker lacked an explicit `I applied` action. Added one in the job detail panel and account API hook.
- CSS contained a late `@import`; removed and moved font loading to HTML head.
- Public candidate location/work preferences contained Gulf/overseas options; removed.
- Stale `next-phase.js` admin probing code was removed from the public bundle.
- Exam-alert source URLs and timeout strategy were updated; see `docs/04-data-quality.md`.

## Unverified / owner actions
- Live Vercel HTML after deployment.
- Actual production Supabase privileges/RLS state.
- Production SMTP/Turnstile/DNS/hosting switch.
- Production application tracker write path against a real second test account.
