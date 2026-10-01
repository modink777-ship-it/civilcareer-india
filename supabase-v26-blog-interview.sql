-- ═══════════════════════════════════════════════════════════════
-- CivilCareer v26 — Blog (Feature C) + Interview Questions (Feature E)
-- Run ONCE in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────── BLOG POSTS ──────────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  excerpt text,
  content text,
  category text DEFAULT 'Career',
  author text DEFAULT 'CivilCareer Team',
  tags text[],
  is_published boolean DEFAULT false,
  views integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON blog_posts (is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category
  ON blog_posts (category);

-- Public: read published posts only. Admin service-role key bypasses RLS.
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published blog posts" ON blog_posts;
CREATE POLICY "Public read published blog posts" ON blog_posts
  FOR SELECT USING (is_published = true);

-- ────────────────────── INTERVIEW QUESTIONS ─────────────────────
CREATE TABLE IF NOT EXISTS interview_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company text NOT NULL,
  role text NOT NULL,
  question text NOT NULL,
  answer text,
  difficulty text DEFAULT 'medium',
  round text,
  year integer,
  upvotes integer DEFAULT 0,
  is_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_questions_company
  ON interview_questions (company);
CREATE INDEX IF NOT EXISTS idx_interview_questions_approved
  ON interview_questions (is_approved, upvotes DESC);

ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read approved interview questions" ON interview_questions;
CREATE POLICY "Public read approved interview questions" ON interview_questions
  FOR SELECT USING (is_approved = true);

-- ══════════════════════════ SEED DATA ══════════════════════════
-- (INSERT … SELECT … WHERE NOT EXISTS → idempotent, no duplicates on re-run)

INSERT INTO blog_posts (title, slug, excerpt, content, category, author, tags, is_published)
SELECT
  'How to Get a Site Engineer Job in India (2026 Guide)',
  'site-engineer-job-guide-2026',
  'Degrees, skills, salary expectations and the exact hiring route — from campus placements to walk-in interviews — for landing a site engineer job in India.',
  E'Fresh civil engineering graduates often ask one question: how do I actually get my first site engineer job in India? This guide walks through the full route.\n\n**1. Make your degree count.** Recruiters for site roles shortlist BE/BTech or Diploma (Civil) candidates. If your aggregates are average, offset it with software skills: AutoCAD is assumed, learn at least one of STAAD Pro, ETABS, Revit or Primavera P6.\n\n**2. Pick your sector early.** Private EPC contractors (L&T, NCC, Dilip Buildcon, Gawar) hire in volume through walk-in interviews. PSUs (NTPC, NBCC, RITES) recruit through GATE or their own exams. Government departments hire via SSC JE and State PSC AE/JE exams.\n\n**3. Use walk-in interviews.** Most site engineer hiring in India is still walk-in driven: carry 6+ resume copies, marksheets, photos and an ID proof. Check the CivilCareer walk-in board daily — drives are posted for Bengaluru, Hyderabad, Pune, NCR and Mumbai.\n\n**4. Expect a realistic first salary.** Diploma freshers start around ₹1.8–2.4 LPA; BE/BTech freshers around ₹2.4–3.6 LPA at private contractors, higher at PSUs and MNC consultancies. See the CivilCareer salary guide for live, city-wise numbers.\n\n**5. Never pay to get a job.** No genuine contractor charges a "registration fee" or "security deposit". That is always a scam.\n\nStart with a site role even if your dream is design or planning — two years on site makes every later interview easier.',
  'Career',
  'CivilCareer Team',
  ARRAY['site engineer','fresher','walk-in','career guide'],
  true
WHERE NOT EXISTS (SELECT 1 FROM blog_posts WHERE slug = 'site-engineer-job-guide-2026');

-- ── 20 real-style interview questions: L&T Construction (8) ──
INSERT INTO interview_questions (company, role, question, answer, difficulty, round, year, upvotes, is_approved)
SELECT * FROM (VALUES
  ('L&T Construction','Site Engineer','What is the minimum curing period for RCC as per IS 456, and why is curing critical in hot weather?', 'IS 456 recommends a minimum 7 days for ordinary Portland cement and 10 days for blended cements; 14 days for blended in hot/dry weather. Curing keeps moisture for hydration — skipping it in 40°C+ heat cuts strength by up to 30% and causes plastic shrinkage cracks.', 'medium','Technical',2025,42,true),
  ('L&T Construction','Site Engineer','How do you calculate the number of cement bags needed for 1 m³ of M20 concrete?', 'M20 = 1:1.5:3. Dry volume ≈ 1.54 m³. Cement = 1.54 × (1/5.5) = 0.28 m³; at 0.035 m³/bag ≈ 8 bags. L&T interviews expect the dry-volume factor logic, not just the memorised answer.', 'medium','Technical',2025,35,true),
  ('L&T Construction','QS / Billing','Explain the RA bill cycle you would follow on a large project.', 'Measure executed work monthly → prepare abstract of items per BOQ → certify with the planning team → submit RA bill with measurement sheets → client′s engineer verifies → payment certified less retention (5–10%) and mobilisation advance recovery. Track cumulative vs this-bill quantities carefully.', 'hard','Technical',2024,28,true),
  ('L&T Construction','Site Engineer','A concrete cube fails at 7 days. Walk me through your actions.', 'Do not panic at 7-day results (expect ~65–70% of characteristic strength). Check cube handling/testing errors first, verify mix records and batching plant calibration, then assess in-situ strength (Rebound Hammer / core tests if needed). Report honestly — L&T values process discipline over hiding failures.', 'hard','Technical',2025,31,true),
  ('L&T Construction','Planning Engineer','Which planning software have you used, and how do you build a baseline programme?', 'Primavera P6 or MS Project. Baseline: WBS → activity list from method statements → durations from productivity norms → logical sequence (FS mostly, SS/FF where practical) → resource/cost load → critical path → freeze as baseline. Progress is then tracked against it weekly.', 'medium','Manager',2024,19,true),
  ('L&T Construction','QA/QC Engineer','What checks do you perform before concreting a slab?', 'Formwork line/level/de-shuttering support, reinforcement dia/spacing/cover/laps as per drawing, bar bending schedule vs placement, conduit/embedments fixed, cover blocks, cleaning and water sprinkling, tremie/pump line ready, pour card signed off by client engineer.', 'medium','Technical',2025,26,true),
  ('L&T Construction','Site Engineer','Explain compaction factor and slump — which do you trust on site?', 'Slump test is fast and catches water adulteration at the truck; compaction factor is lab-based and more precise for low workability mixes. On site, slump at the point of placement is what you trust and record — reject trucks outside specified range, never add water to make it ''fix'' itself.', 'medium','Technical',2024,22,true),
  ('L&T Construction','Graduate Engineer Trainee','Why do you want to work in construction when most of your classmates took IT jobs?', 'No single right answer — interviewers want honesty plus evidence of interest: site visits, internships, projects, software skills. Avoid both "salary" and overly emotional answers; connect your strengths (field stamina, maths, coordination) to the role.', 'easy','HR',2025,17,true)
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM interview_questions WHERE company = 'L&T Construction');

-- ── AECOM India (6) ──
INSERT INTO interview_questions (company, role, question, answer, difficulty, round, year, upvotes, is_approved)
SELECT * FROM (VALUES
  ('AECOM India','Structural Engineer','How do you decide between a flat slab and a beam-slab system for a commercial building?', 'Flat slab wins on storey height, formwork speed and services routing; beam-slab wins on long spans, heavy loads and vibration control. Compare per-floor cycle time, concrete/steel quantities and HVAC coordination — AECOM expects a quantity-and-programme based justification, not a textbook one.', 'hard','Technical',2025,24,true),
  ('AECOM India','Design Engineer','Walk me through your load combinations for an RCC frame as per IS 875 and IS 1893.', '1.5(DL+LL), 1.2(DL+LL+EL), 1.5(DL+EL), 0.9DL+1.5EL for overturning check; serviceability 1.0(DL+LL) for deflection. For seismic, importance factor and response reduction factor depend on the structure′s use and ductility detailing.', 'hard','Technical',2024,21,true),
  ('AECOM India','Design Engineer','Which international codes have you worked with, and how do they differ from IS codes for concrete design?', 'ACI 318 / BS 8110 / Eurocode 2. Key differences: load factors and material partial safeties, detailing rules (ACI′s 90° hooks and development length approach), and fire/duarability exposure classes. Be honest about depth — claim only what you can defend.', 'medium','Technical',2025,14,true),
  ('AECOM India','BIM Engineer','What is your LOD discipline in a Revit civil model, and how do you handle clash detection?', 'Model to agreed LOD (typically 300–350 in design development). Run Navisworks clash detection with discipline-priority rulesets, batch clashes by element type, assign to owners weekly, and track clearance metrics. Clashes between structure and MEP usually dominate.', 'medium','Technical',2025,12,true),
  ('AECOM India','Transport Planner','How would you justify a rotary versus signalised junction in an DPR traffic study?', 'Compare saturation flow, PCU capacity, delay (Webster for rotary, HCM for signals), land availability and safety record. Rotaries suit balanced multi-arm flows and lower speeds; signals suit heavy uneven flows and pedestrian-heavy corridors.', 'hard','Technical',2024,9,true),
  ('AECOM India','Graduate Engineer','Tell me about a design mistake you made and what you changed afterwards.', 'Structured honesty: situation → the error → how you caught it (self-check, senior review) → the system you now use (checklists, second-person review of calcs). AECOM′s culture prizes quality-check discipline over fake perfection.', 'easy','HR',2025,11,true)
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM interview_questions WHERE company = 'AECOM India');

-- ── NCC Limited (6) ──
INSERT INTO interview_questions (company, role, question, answer, difficulty, round, year, upvotes, is_approved)
SELECT * FROM (VALUES
  ('NCC Limited','Site Engineer','You are pouring a footing and the cement truck is delayed 2 hours. What do you do?', 'Hold the pour if a cold joint would form — apply retarder/cover rebar if delay extends, keep vibrators and gang ready, inform the client engineer, document the delay for the RA bill. Never "start anyway and patch later".', 'medium','Manager',2025,23,true),
  ('NCC Limited','Site Engineer','How do you control wastage of steel on site?', 'Cutting-list based cutting to minimise offcuts, proper storage on sleepers with covers, rebar detailing reconciliation against BBS before ordering, reuse of offcuts for chairs/spacers, monthly reconciliation of steel issued vs consumed vs drawings.', 'medium','Technical',2025,18,true),
  ('NCC Limited','QS','What is the difference between earned value and percentage completion in billing?', 'Percentage completion is physical (quantity done / total); earned value multiplies the budgeted cost by that completion to give value earned. EV enables SPI/CPI schedule-cost tracking; billing percentages feed the RA bill directly.', 'hard','Technical',2024,15,true),
  ('NCC Limited','Site Engineer','Explain how you would set out a curved road alignment on site.', 'Work from the control points: compute chord offsets or use total station coordinates from the design model, establish transit points on the curve (deflection angle method), verify with peg tests, protect control points, log as-built coordinates for the final survey.', 'hard','Technical',2025,13,true),
  ('NCC Limited','Safety Officer','What is your procedure after a near-miss on site?', 'Secure the area, treat/report injuries, record the near-miss in the register same shift, investigate root cause (not blame), issue corrective action with a deadline, toolbox-talk the lesson to all gangs, and trend the reports monthly.', 'medium','HR',2024,10,true),
  ('NCC Limited','Graduate Engineer Trainee','Are you willing to relocate to a remote project site for 2–3 years?', 'Be honest. If yes, say so plainly and ask which regions. If not fully, say where you can go — flexible candidates with one constraint ("South India preferred") are treated better than those who later back out.', 'easy','HR',2025,20,true)
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM interview_questions WHERE company = 'NCC Limited');

-- Done. Verify with:
--   SELECT company, count(*) FROM interview_questions WHERE is_approved GROUP BY company;
--   SELECT count(*) FROM blog_posts;
