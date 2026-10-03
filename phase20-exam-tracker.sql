-- ═══════════════════════════════════════════════════════════════
-- CivilCareer — v20: EXAM TRACKER (Feature 2)
-- Run ONCE in Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- 1. Exam tracker table
CREATE TABLE IF NOT EXISTS exam_tracker (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  short_name text,
  authority text,
  category text,                -- GATE | SSC | RRB | UPSC | STATE_PSC | PSU
  status text DEFAULT 'upcoming',
  -- upcoming | notification_out | application_open | application_closed |
  -- admit_card | exam_scheduled | result_out
  notification_date date,
  application_start date,
  application_end date,
  exam_date text,               -- text: sometimes "Feb 1-16, 2026"
  result_date date,
  official_url text,
  eligibility_summary text,
  vacancy_count integer,
  exam_fee text,
  age_limit text,
  qualification text,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Exam alert subscribers (no public read — service-role API only)
CREATE TABLE IF NOT EXISTS exam_alert_subscribers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp text,
  email text,
  name text,
  exam_ids uuid[],              -- which exams they follow
  city text,
  created_at timestamptz DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS exam_tracker_active_idx   ON exam_tracker (is_active, category);
CREATE INDEX IF NOT EXISTS exam_tracker_status_idx   ON exam_tracker (status);
CREATE INDEX IF NOT EXISTS exam_subs_created_idx     ON exam_alert_subscribers (created_at DESC);

-- Unique name keeps the seed below idempotent (re-running never duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS exam_tracker_name_key ON exam_tracker (name);

-- 4. Row Level Security
ALTER TABLE exam_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_alert_subscribers ENABLE ROW LEVEL SECURITY;

-- Public reads only ACTIVE exams (service-role key in _api/ bypasses RLS).
DROP POLICY IF EXISTS "public read active exams" ON exam_tracker;
CREATE POLICY "public read active exams" ON exam_tracker
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Subscribers: no anon policies at all — inserts happen only through
-- /api/exam-alert-subscribe using the service-role key.

-- 5. Seed with real civil engineering exams (idempotent)
INSERT INTO exam_tracker (name,short_name,authority,category,official_url,eligibility_summary) VALUES
('SSC Junior Engineer Civil','SSC JE','Staff Selection Commission','SSC','https://ssc.gov.in','Diploma/Degree Civil Engineering, Age 18-32'),
('GATE Civil Engineering','GATE CE','IITs/IISc','GATE','https://gate2026.iitr.ac.in','BE/BTech Civil Engineering or final year'),
('UPSC Engineering Services','UPSC ESE','UPSC','UPSC','https://upsc.gov.in','BE/BTech Civil Engineering, Age 21-30'),
('RRB Junior Engineer Civil','RRB JE','Railway Recruitment Board','RRB','https://rrbapply.gov.in','Diploma/Degree Civil Engineering, Age 18-33'),
('KPSC Assistant Engineer','KPSC AE','Karnataka PSC','STATE_PSC','https://kpsc.kar.nic.in','BE/BTech Civil Engineering, Age 18-35'),
('TSPSC Assistant Engineer','TSPSC AE','Telangana PSC','STATE_PSC','https://tspsc.gov.in','BE/BTech Civil Engineering, Age 18-44'),
('NHPC Junior Engineer','NHPC JE','NHPC Limited','PSU','https://nhpcindia.com','BE/BTech Civil 60% marks'),
('NTPC Executive Trainee','NTPC ET','NTPC Limited','PSU','https://ntpccareers.net','GATE qualified BE/BTech Civil'),
('MPSC Assistant Engineer','MPSC AE','Maharashtra PSC','STATE_PSC','https://mpsc.gov.in','BE/BTech Civil Engineering, Age 19-38'),
('UPPSC Assistant Engineer','UPPSC AE','UP PSC','STATE_PSC','https://uppsc.up.nic.in','Degree Civil Engineering, Age 21-40')
ON CONFLICT (name) DO NOTHING;
