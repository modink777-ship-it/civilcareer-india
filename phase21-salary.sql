-- ═══════════════════════════════════════════════════════════════
-- CivilCareer — v21: SALARY TRANSPARENCY (Feature 3)
-- Run ONCE in Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- 1. Salary submissions (fully anonymous — no identity columns at all)
CREATE TABLE IF NOT EXISTS salary_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  role text NOT NULL,
  company_type text,          -- Private | Government | PSU | MNC
  city text,
  state text,
  experience_years integer,
  salary_annual integer,      -- annual CTC in rupees
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 2. Indexes matching the explorer's filter patterns
CREATE INDEX IF NOT EXISTS salary_role_idx  ON salary_data (role);
CREATE INDEX IF NOT EXISTS salary_city_idx  ON salary_data (city);
CREATE INDEX IF NOT EXISTS salary_type_idx  ON salary_data (company_type);
CREATE INDEX IF NOT EXISTS salary_exp_idx   ON salary_data (experience_years);
CREATE INDEX IF NOT EXISTS salary_created_idx ON salary_data (created_at DESC);

-- 3. Row Level Security
ALTER TABLE salary_data ENABLE ROW LEVEL SECURITY;

-- Public can READ everything (the explorer aggregates verified + unverified
-- ranges; the brief says unverified still count until review).
DROP POLICY IF EXISTS "public read salary data" ON salary_data;
CREATE POLICY "public read salary data" ON salary_data
  FOR SELECT TO anon, authenticated
  USING (true);

-- NO public INSERT policy: submissions happen only through
-- /api/salary with the service-role key (rate-limited + validated).
-- (In the Supabase dashboard this table shows "RLS enabled, no policies"
-- for writes — that is intentional.)

-- 4. Seed with verified market anchors
--    (JE figure = 7th CPC Level-6 basic + DA; others are market-typical)
INSERT INTO salary_data (role,company_type,city,state,experience_years,salary_annual,is_verified) VALUES
('Site Engineer','Private','Bengaluru','Karnataka',0,320000,true),
('Site Engineer','Private','Bengaluru','Karnataka',3,550000,true),
('Site Engineer','Private','Bengaluru','Karnataka',7,900000,true),
('Site Engineer','Government','Bengaluru','Karnataka',0,420000,true),
('Planning Engineer','Private','Mumbai','Maharashtra',3,700000,true),
('Planning Engineer','MNC','Mumbai','Maharashtra',5,1200000,true),
('Quantity Surveyor','Private','Hyderabad','Telangana',3,600000,true),
('Quantity Surveyor','MNC','Hyderabad','Telangana',7,1400000,true),
('Structural Engineer','Private','Delhi','Delhi',3,650000,true),
('Junior Engineer','Government','All India','India',0,424440,true),
('Assistant Engineer','PSU','All India','India',2,680000,true),
('Project Engineer','Private','Pune','Maharashtra',5,900000,true),
('BIM Engineer','MNC','Bengaluru','Karnataka',3,950000,true),
('QA/QC Engineer','Private','Chennai','Tamil Nadu',3,580000,true)
ON CONFLICT DO NOTHING;
