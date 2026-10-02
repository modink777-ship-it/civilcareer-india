-- ═══════════════════════════════════════════════════════════════
-- CivilCareer — v25: PORTFOLIO (F4) + COMPANY REVIEWS (F5) + JOBS
-- FEATURED COLUMNS (F8 completion). Run ONCE in Supabase SQL
-- Editor. Safe to re-run (IF NOT EXISTS everywhere).
-- ═══════════════════════════════════════════════════════════════

-- ── F4: Civil engineer portfolio profiles ──────────────────────
CREATE TABLE IF NOT EXISTS engineer_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  current_role text,
  years_experience integer,
  city text,
  state text,
  email text,
  whatsapp text,
  bio text,
  skills text[],
  target_roles text[],
  work_type text,
  sector_preference text[],
  linkedin_url text,
  edit_token text UNIQUE,
  is_public boolean DEFAULT true,
  profile_views integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid REFERENCES engineer_profiles(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  project_type text,
  role_played text,
  duration_months integer,
  location text,
  client text,
  contractor text,
  project_value text,
  description text,
  software_used text[],
  photo_url text,
  completion_year integer,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ── F5: Company reviews (moderated) ────────────────────────────
CREATE TABLE IF NOT EXISTS company_reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL,
  company_slug text,
  reviewer_role text,
  reviewer_experience text,
  reviewer_city text,
  rating_overall integer CHECK (rating_overall BETWEEN 1 AND 5),
  rating_salary integer CHECK (rating_salary BETWEEN 1 AND 5),
  rating_growth integer CHECK (rating_growth BETWEEN 1 AND 5),
  rating_worklife integer CHECK (rating_worklife BETWEEN 1 AND 5),
  rating_management integer CHECK (rating_management BETWEEN 1 AND 5),
  salary_paid_on_time boolean,
  pros text,
  cons text,
  advice text,
  would_recommend boolean,
  is_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_reviews_slug_idx
  ON company_reviews (company_slug, is_approved);

-- ── F8 completion: featured columns on jobs ────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS featured_until date;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_utr text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_views integer DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS walk_in boolean DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- Done.
--  F4 tables power /create-profile, /profile/[slug], /talent,
--     /edit-profile?token=...
--  F5 table powers /companies and the admin Reviews tab
--  jobs.is_featured + featured_until let the admin mark a paid
--     listing as Featured after verifying the UTR
-- ═══════════════════════════════════════════════════════════════

-- Keep all profile and review data server-only. Public pages use API handlers.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'engineer_profiles',
    'profile_projects',
    'company_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      table_name
    );

    FOR policy_name IN
      SELECT p.policyname
      FROM pg_policies AS p
      WHERE p.schemaname = 'public' AND p.tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY service_role_only ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$$;
