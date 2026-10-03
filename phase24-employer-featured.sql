-- ═══════════════════════════════════════════════════════════════
-- CivilCareer — v24: EMPLOYER FEATURED LISTINGS (Feature 8)
-- Run ONCE in Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE employer_submissions
  ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;

ALTER TABLE employer_submissions
  ADD COLUMN IF NOT EXISTS payment_utr text;

-- ═══════════════════════════════════════════════════════════════
-- Done. New employer submissions can now carry:
--   is_featured  = true  (employer paid ₹499 for Featured Listing)
--   payment_utr  = '12-digit UPI transaction id'
--
-- Admin workflow: open dashboard → Submissions → verify the UTR
-- in your UPI app statement → publish the job → add ⭐ Featured.
-- ═══════════════════════════════════════════════════════════════
