-- CivilCareer — government source repair (phase 28)
--
-- Data fix, not a schema fix. Two rows in public.govt_sources are enabled and
-- therefore crawled every run, but can never yield a lead:
--
--   1. "Employment News" — HTTP 404. config/govt-sources.json was repointed to
--      https://employmentnews.gov.in/NewEmp/AllJobs.aspx?k=All, but
--      scripts/crawl-govt-pipeline.js upserts by url, so it INSERTED the new
--      row ("Employment News All Jobs") and left this old one behind, still
--      enabled. Because url is UNIQUE, repointing this row would collide with
--      the working one — so disable the orphan instead; its content is already
--      covered by "Employment News All Jobs".
--
--   2. "UPSC Recruitment Advertisements" — HTTP 403. upsc.gov.in answers 200 to
--      a browser user agent and 403 to the crawler's declared
--      "CivilCareerBot/1.0 (...)" string, i.e. the WAF is deliberately
--      refusing this bot. Spoofing a browser UA to get around that is not
--      something the pipeline should do, so the source is disabled and the
--      reason recorded. Re-enable it from Admin -> Government Jobs -> Sources
--      if a non-blocked endpoint is found.
--
-- UPSC is ALSO seeded from config/govt-sources.json, and the seeder writes
-- enabled back on every run — so the config entry must be disabled too or the
-- next 2-hourly crawl would switch this row back on. That change ships in the
-- same commit as this file.
--
-- Idempotent: re-running is a no-op, and every statement is a no-op if the row
-- is absent or already repaired.

-- 1. Disable the retired Employment News row, but never the working one.
update public.govt_sources
   set enabled = false,
       last_status = 'dead: HTTP 404 (retired path; superseded by Employment News All Jobs)',
       last_error = 'HTTP 404'
 where name = 'Employment News'
   and url <> 'https://employmentnews.gov.in/NewEmp/AllJobs.aspx?k=All';

-- 2. Disable UPSC: 403 to the declared bot user agent.
update public.govt_sources
   set enabled = false,
       last_status = 'blocked: HTTP 403 to declared bot user agent (read manually)',
       last_error = 'HTTP 403 (WAF: bot user agent)'
 where name = 'UPSC Recruitment Advertisements';

-- Verification: expect zero rows. Any row returned is an enabled source whose
-- most recent run never produced a lead and whose failure is a hard one.
select name, url, last_status
  from public.govt_sources
 where enabled
   and last_status is not null
   and (last_status like 'dead:%' or last_status like 'blocked:%')
 order by name;
