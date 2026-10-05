-- CivilCareer — aggregator-only crawl (phase 29)
--
-- Data fix, not a schema fix. The crawl now reads exactly six engineering
-- aggregator feeds (config/govt-sources.json), which already republish the
-- official notices they collect. Every other row in public.govt_sources is
-- retired and DELETED here:
--
--   * the 11 official govt/PSU sources (CPWD, NHAI, RITES, IRCON x2, NTPC,
--     BHEL, AAI, RRB Chandigarh, Employment News, Rozgar Samachar),
--   * the four early lead-only feeds (govtjobguru, mysarkarinaukri,
--     karnatakagovtjobs, indgovtjobs home pages),
--   * the four state PSC sources already retired by phases 19/28
--     (KPSC, TSPSC, TNPSC, APPSC) and the orphaned "Employment News" row.
--
-- The same 20 entries are removed from config/govt-sources.json in this commit.
-- That half is mandatory, not cosmetic: scripts/crawl-govt-pipeline.js upserts
-- EVERY config source on every run, so a source left in the config would be
-- re-INSERTED here on the next crawl and the delete would silently undo itself.
--
-- What this deletes, and what it does not:
--   * public.govt_job_leads.source_id references public.govt_sources(id)
--     ON DELETE CASCADE, so the raw lead rows those sources produced go with
--     them. They are a discovery log — every one of them has already been
--     classified into public.govt_job_staging, and staging rows reference the
--     lead with ON DELETE SET NULL, so the REVIEW QUEUE IS UNAFFECTED.
--   * public.govt_jobs (published postings) has no source foreign key at all,
--     so nothing published is touched.
--   * public.govt_field_provenance.source_id is a plain uuid with no FK
--     constraint; its rows are detached first so no dangling id is left behind.
--
-- Idempotent: re-running is a no-op (the rows are gone). The `where enabled`
-- clause is deliberately NOT used — a retired row that was already switched off
-- by phase 28 must still be removed.
--
-- To go back: re-add the source to config/govt-sources.json and run the
-- crawler once; it inserts the row and crawls it. Nothing here needs a rollback.

-- Detach provenance written against a retired source (no FK, so the delete
-- below would otherwise leave a dangling uuid).
update public.govt_field_provenance
   set source_id = null
 where source_id in (
   select id from public.govt_sources
    where url not in (
      'https://govtjobguru.in/jobs-by-post/engineering-jobs/',
      'https://www.karnatakacareers.org/qualification/civil-engineering-jobs/',
      'https://linkingsky.com/government-exams/Engineers_Jobs.html',
      'https://allgovernmentjobs.in/civil-engineering-jobs',
      'https://www.freejobalert.com/engineering-jobs/',
      'https://ka.indgovtjobs.net/qualifications/engineering-government-jobs-karnataka/'
    )
 );

-- Remove the retired sources. Leads cascade with them; staging rows survive
-- because their lead_id is nullable and ON DELETE SET NULL.
delete from public.govt_sources
 where url not in (
   'https://govtjobguru.in/jobs-by-post/engineering-jobs/',
   'https://www.karnatakacareers.org/qualification/civil-engineering-jobs/',
   'https://linkingsky.com/government-exams/Engineers_Jobs.html',
   'https://allgovernmentjobs.in/civil-engineering-jobs',
   'https://www.freejobalert.com/engineering-jobs/',
   'https://ka.indgovtjobs.net/qualifications/engineering-government-jobs-karnataka/'
 );

-- Verification: expect exactly the six aggregator feeds and nothing else.
-- Any other row means a source is still configured somewhere.
select name, url, enabled, last_status
  from public.govt_sources
 order by name;
