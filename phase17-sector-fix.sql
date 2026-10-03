-- supabase-v17-sector-fix.sql  (30 Sep 2026 overhaul)
-- WHAT IT CHANGES: reclassifies existing jobs rows that are labeled
-- sector='Government' but were ingested from job-board aggregators (adzuna /
-- naukri / linkedin) with private staffing or company names. These rows break
-- the trust promise that government listings point at official sources.
-- It NEVER deletes anything: rows are moved to sector='Private' (quasi-
-- government LinkedIn rows included).
-- HOW TO RUN: Supabase SQL editor, as owner, after reviewing the SELECT below.
-- HOW TO VERIFY: re-run the SELECT; it must return 0 rows afterwards. The public
-- government page/API must then show only rows with official or board sources.

-- 1) Preview the affected rows (no changes).
SELECT id, role, company, sector, source_url, review_state
FROM jobs
WHERE sector = 'Government'
  AND (source_url ILIKE '%adzuna.in%'
       OR source_url ILIKE '%naukri.com%'
       OR source_url ILIKE '%linkedin.com%'
       OR company ILIKE '%private limited%'
       OR company ILIKE '%manpower%'
       OR company ILIKE '%staffing%'
       OR company ILIKE '%consultancy%'
       OR company ILIKE '%lifecare%');

-- 2) Reclassify the aggregator-sourced rows to Private (keeps them public,
--    marks them for human review; nothing is deleted).
UPDATE jobs
SET sector = 'Private',
    updated_at = now()
WHERE sector = 'Government'
  AND (source_url ILIKE '%adzuna.in%'
       OR source_url ILIKE '%naukri.com%'
       OR source_url ILIKE '%linkedin.com%'
       OR company ILIKE '%private limited%'
       OR company ILIKE '%manpower%'
       OR company ILIKE '%staffing%'
       OR company ILIKE '%consultancy%'
       OR company ILIKE '%lifecare%');

-- 3) Verify: must return 0 rows.
SELECT count(*) AS remaining_mislabeled
FROM jobs
WHERE sector = 'Government'
  AND (source_url ILIKE '%adzuna.in%'
       OR source_url ILIKE '%naukri.com%'
       OR source_url ILIKE '%linkedin.com%'
       OR company ILIKE '%private limited%'
       OR company ILIKE '%manpower%'
       OR company ILIKE '%staffing%'
       OR company ILIKE '%consultancy%'
       OR company ILIKE '%lifecare%');

-- 4) Subscriber dedupe + unique constraint (run the check first).
--    Duplicates found on 30 Sep: 'cc-overhaul-test-30sep@example.com' x2
--    (agent test rows; safe to remove). NULL emails do not conflict.
-- SELECT lower(email), count(*) FROM subscribers GROUP BY 1 HAVING count(*) > 1;
-- DELETE FROM subscribers
--  WHERE lower(email) = 'cc-overhaul-test-30sep@example.com'
--    AND id NOT IN (SELECT min(id) FROM subscribers
--                    WHERE lower(email) = 'cc-overhaul-test-30sep@example.com');
-- ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_key UNIQUE (email);
