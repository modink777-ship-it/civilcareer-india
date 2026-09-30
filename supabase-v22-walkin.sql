-- ═══════════════════════════════════════════════════════════════
-- CivilCareer — v22: WALK-IN INTERVIEW BOARD (Feature 6)
-- Run ONCE in Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS walkin_interviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company text NOT NULL,
  roles text NOT NULL,
  date date NOT NULL,
  time_start text,
  time_end text,
  venue text NOT NULL,
  city text,
  state text,
  experience_required text,
  qualification text,
  salary_offered text,
  documents_required text,
  contact text,
  source_url text,
  published boolean DEFAULT false,
  expires_at date,
  created_at timestamptz DEFAULT now()
);

-- 2. Indexes for the board's queries
CREATE INDEX IF NOT EXISTS walkin_date_idx      ON walkin_interviews (date);
CREATE INDEX IF NOT EXISTS walkin_city_idx      ON walkin_interviews (city);
CREATE INDEX IF NOT EXISTS walkin_pub_date_idx  ON walkin_interviews (published, date);

-- 3. Row Level Security
ALTER TABLE walkin_interviews ENABLE ROW LEVEL SECURITY;

-- Public reads only published rows (service-role API bypasses RLS).
DROP POLICY IF EXISTS "public read published walkins" ON walkin_interviews;
CREATE POLICY "public read published walkins" ON walkin_interviews
  FOR SELECT TO anon, authenticated
  USING (published = true);

-- No public write policies — admin creates happen only through
-- /api/walkin with the OWNER_KEY (service-role key server-side).

-- 4. Optional sample rows (NOT pre-published — you review then publish
--    from the admin Walk-Ins tab). Dates auto-anchor to today so the
--    samples always show as upcoming when you first run this file.
--    Delete this section if you don't want samples.
INSERT INTO walkin_interviews (company, roles, date, time_start, time_end, venue, city, state, experience_required, qualification, documents_required, contact, published)
VALUES
('L&T Construction', 'Site Engineer, QS', (CURRENT_DATE + 2)::date, '09:00', '16:00', 'OMR Navalur Campus', 'Chennai', 'Tamil Nadu', '2-8 years', 'BE/BTech/Diploma Civil', 'Resume, marksheets, photos, experience letters', 'hr@lt-example.in', false),
('Shapoorji Pallonji', 'Site Engineer, Billing Engineer', (CURRENT_DATE + 4)::date, '10:00', '15:00', 'BKC Training Centre', 'Mumbai', 'Maharashtra', '1-6 years', 'BE Civil', 'Resume, certificates, photo', 'walkin@sp-example.in', false),
('Dilip Buildcon', 'Highway Engineer, Site Engineer', (CURRENT_DATE + 6)::date, '09:30', '14:00', 'DBL Project Office, Hosur Road', 'Bengaluru', 'Karnataka', '2-10 years', 'BE/Diploma Civil', 'Resume, marksheets, ID proof', 'hr@dbl-example.in', false)
ON CONFLICT DO NOTHING;
