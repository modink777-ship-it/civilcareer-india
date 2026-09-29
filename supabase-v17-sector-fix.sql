-- supabase-v17-sector-fix.sql  (30 Sep 2026 overhaul)
-- WHAT IT CHANGES: reclassifies existing jobs rows that are labeled
-- sector='Government' but were ingested from job-board aggregators (adzuna /
-- naukri / linkedin) with private staffing or company names. These rows break
-- the trust promise that government listings point at official sources.
-- It NEVER deletes anything: rows are moved to sector='Private' (quasi-
-- government LinkedIn rows included, flagged for owner review via review_notes).
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
    review_notes = COALESCE(review_notes, '')
                   || ' [30 Sep 2026] Reclassified from Government: job-board source with private company. Owner review pending.',
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

-- 4) Optional hygiene (owner decision): make duplicate subscribes harmless by
--    adding the missing unique constraint discovered on 30 Sep.
--    Check for existing duplicates FIRST; resolve them manually if any exist.
-- SELECT lower(email), count(*) FROM subscribers GROUP BY 1 HAVING count(*) > 1;
-- ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_key UNIQUE (email);
