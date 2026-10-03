-- ══════════════════════════════════════════════════════════════════════
-- supabase-v18 — Sector reclass round 2 (30 Sep 2026)
-- Context: within ~2 days of the round-1 reclass (13 rows), the discovery
-- pipeline re-mislabeled private ads as Government because the classifier
-- (a) never saw the company name and (b) matched the bare token
-- 'department' against JD section headers like "Department: Projects".
-- Code fix shipped in the same commit as this file (lib/discovery-core.js,
-- _api/jobs.js, tests/phase12-sector-quality.test.js): future drafts are
-- classified employer-aware, so this reclass should be the LAST one needed.
--
-- Run steps 1 and 2 in the Supabase SQL editor, in order.
-- Every statement is idempotent; nothing is deleted.
-- ══════════════════════════════════════════════════════════════════════

-- ── STEP 1: preview what will move (run first, eyeball the list) ──────
-- Expect ~11 rows. Rows whose company name is genuinely a government
-- body (Quality Council of India, Live Connections) stay Government.
SELECT id, role, company, sector, source, created_at
FROM jobs
WHERE published = true
  AND lower(sector) LIKE '%government%'
  AND lower(coalesce(company, '') || ' ' || coalesce(role, '') || ' ' || coalesce(description, ''))
      ~* '(private limited|pvt\.?\s*ltd|manpower|staffing|consultancy|lifecare|phoenix mills|adani|ace money|sj group|foundation svkm|j&f)'
ORDER BY created_at DESC;

-- ── STEP 2: apply the reclass (same predicate, UPDATE instead of SELECT)
UPDATE jobs
SET sector        = 'Private',
    updated_at    = now()
WHERE published = true
  AND lower(sector) LIKE '%government%'
  AND lower(coalesce(company, '') || ' ' || coalesce(role, '') || ' ' || coalesce(description, ''))
      ~* '(private limited|pvt\.?\s*ltd|manpower|staffing|consultancy|lifecare|phoenix mills|adani|ace money|sj group|foundation svkm|j&f)';

-- Report how many rows moved (should match the STEP 1 count, ~11):
SELECT count(*) AS still_mislabeled
FROM jobs
WHERE published = true
  AND lower(sector) LIKE '%government%'
  AND lower(coalesce(company, '') || ' ' || coalesce(role, '') || ' ' || coalesce(description, ''))
      ~* '(private limited|pvt\.?\s*ltd|manpower|staffing|consultancy|lifecare|phoenix mills|adani|ace money|sj group|foundation svkm|j&f)';

-- ── STEP 3 (from the previous session, still pending if not yet run):
-- Subscriber dedupe + unique constraint — deletes only the 2 known
-- duplicate test rows, keeps min(id), then adds the constraint.
DELETE FROM subscribers a
USING subscribers b
WHERE a.email = b.email
  AND a.ctid <> b.ctid
  AND a.email = 'cc-overhaul-test-30sep@example.com';

ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_key UNIQUE (email);
