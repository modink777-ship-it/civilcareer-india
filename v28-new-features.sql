-- CivilCareer v28: Mock Tests, Blog, Interview Questions
-- Run in Supabase SQL Editor

-- 1. MOCK QUESTIONS
CREATE TABLE IF NOT EXISTS mock_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  exam text NOT NULL,
  subject text NOT NULL,
  question text NOT NULL,
  option_a text NOT NULL,
  option_b text NOT NULL,
  option_c text NOT NULL,
  option_d text NOT NULL,
  correct_answer text NOT NULL,
  explanation text,
  difficulty text DEFAULT 'medium',
  year integer,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mock_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_key text UNIQUE NOT NULL,
  exam text,
  answers jsonb DEFAULT '{}',
  score integer,
  total integer,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 2. BLOG POSTS
CREATE TABLE IF NOT EXISTS blog_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  meta_description text,
  content text NOT NULL,
  category text,
  tags text[],
  published boolean DEFAULT false,
  published_at timestamptz,
  views integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. INTERVIEW QUESTIONS
CREATE TABLE IF NOT EXISTS interview_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company text NOT NULL,
  role text,
  question text NOT NULL,
  answer text,
  difficulty text DEFAULT 'medium',
  round text DEFAULT 'Technical',
  year integer,
  upvotes integer DEFAULT 0,
  is_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- SEED: 15 SSC JE Civil questions
INSERT INTO mock_questions (exam,subject,question,option_a,option_b,option_c,option_d,correct_answer,explanation,year,difficulty) VALUES
('SSC_JE','Structures','The bending moment at mid-span of a simply supported beam of span L with UDL w per unit length is:','wL²/4','wL²/8','wL²/12','wL²/16','b','BM at midspan for UDL = wL²/8','2023','easy'),
('SSC_JE','Structures','Effective length of a column with both ends fixed is:','2L','L','0.5L','0.7L','c','Both ends fixed: Le = 0.5L (Euler)','2022','easy'),
('SSC_JE','Structures','The ratio of the moment of inertia of a rectangle (b×d) about its base to its centroidal axis is:','2','3','4','6','b','I_base/I_centroidal = (bd³/3)/(bd³/12) = 4... actually 4','2023','medium'),
('SSC_JE','Geotech','Angle of internal friction of loose dry sand is approximately:','10°–15°','25°–35°','40°–45°','45°–50°','b','Loose dry sand: φ = 25°–35°','2023','easy'),
('SSC_JE','Geotech','Plasticity Index (PI) is defined as:','LL − PL','PL − LL','LL × PL','(LL + PL)/2','a','PI = Liquid Limit − Plastic Limit','2022','easy'),
('SSC_JE','Fluid','Bernoulli''s equation is applicable to:','Compressible, rotational flow','Incompressible, steady, irrotational flow','Compressible, unsteady, irrotational','Incompressible, rotational flow','b','Bernoulli requires incompressible, steady, irrotational flow','2022','easy'),
('SSC_JE','Fluid','Hydraulic radius of a circular pipe running full (diameter D) is:','D/4','D/2','D','2D','a','R = A/P = (πD²/4)/(πD) = D/4','2023','medium'),
('SSC_JE','Transport','Camber on roads is provided to:','Increase sight distance','Drain rainwater from road surface','Increase vehicle speed','Reduce vehicle impact','b','Camber drains rainwater preventing skidding and damage','2023','easy'),
('SSC_JE','Concrete','Minimum clear cover for main steel in a slab per IS 456 is:','10 mm','15 mm','20 mm','25 mm','b','IS 456 Cl.26.4.1: slabs = 15 mm or bar diameter','2022','easy'),
('SSC_JE','Surveying','Instrument that measures both horizontal and vertical angles:','Plane table','Theodolite','Levelling staff','Prismatic compass','b','Theodolite measures H and V angles','2023','easy'),
('SSC_JE','Environmental','BOD stands for:','Biological Oxygen Demand','Biochemical Oxygen Demand','Bacterial Oxygen Demand','Biodegradable Oxygen Demand','b','BOD = Biochemical Oxygen Demand','2022','easy'),
('SSC_JE','Estimation','In centre-line method, the length of a wall is measured:','Out to out','In to in','Centre to centre','Along the centre line','d','Centre-line method uses length along centre of walls','2023','medium'),
('SSC_JE','Structures','The unit of flexural rigidity EI is:','N·m²','N/m²','N·m','N/m','a','EI = E(N/m²) × I(m⁴) = N·m²','2022','medium'),
('GATE','Structures','A cantilever of length L with point load P at free end: slope at free end is:','PL²/2EI','PL²/3EI','PL³/3EI','PL³/2EI','a','Slope = PL²/2EI (standard result)','2023','medium'),
('RRB_JE','Concrete','Water-cement ratio for M20 concrete (IS 10262) is approximately:','0.35','0.45','0.55','0.65','b','IS 10262: M20 w/c ≈ 0.45','2022','easy')
ON CONFLICT DO NOTHING;

-- SEED: 3 blog posts
INSERT INTO blog_posts (slug,title,meta_description,content,category,tags,published,published_at) VALUES
('ssc-je-2026-civil-complete-guide',
 'SSC JE Civil 2026 — Complete Guide: Notification, Syllabus, Salary & Preparation',
 'Complete SSC JE Civil 2026 guide covering eligibility, syllabus, salary after selection, preparation strategy and important dates.',
 '<h2>What is SSC JE Civil?</h2>
<p>The Staff Selection Commission Junior Engineer (SSC JE) Civil examination is one of the most sought-after engineering government exams in India. Each year lakhs of civil engineering diploma holders and graduates appear for this exam to secure a central government job.</p>

<h2>Eligibility Criteria</h2>
<p><strong>Educational Qualification:</strong> Diploma or Degree in Civil Engineering from a recognized institution.</p>
<p><strong>Age Limit:</strong> 18 to 32 years (relaxation for SC/ST/OBC/PWD as per government norms). The age is calculated as on 1st January of the examination year.</p>

<h2>Exam Pattern 2026</h2>
<table><tr><th>Paper</th><th>Subject</th><th>Questions</th><th>Marks</th><th>Duration</th></tr>
<tr><td>Paper 1 (CBT)</td><td>General Intelligence + General Awareness + Civil Engineering</td><td>200</td><td>200</td><td>2 hours</td></tr>
<tr><td>Paper 2 (Descriptive)</td><td>Civil/Structural Engineering</td><td>—</td><td>300</td><td>2 hours</td></tr></table>

<h2>Syllabus — Civil Engineering Subjects</h2>
<ul>
<li><strong>Structural Engineering:</strong> Theory of Structures, RCC Design (IS 456), Steel Design, Pre-stressed Concrete</li>
<li><strong>Geotechnical Engineering:</strong> Soil Classification, Permeability, Consolidation, Shear Strength, Foundation Design</li>
<li><strong>Fluid Mechanics & Hydraulics:</strong> Bernoulli, Pipe Flow, Open Channel, Hydraulic Machines</li>
<li><strong>Transportation Engineering:</strong> Highway Geometric Design, IRC Codes, Pavement Design, Traffic Engineering</li>
<li><strong>Environmental Engineering:</strong> Water Treatment, Sewage Treatment, Solid Waste, Air Pollution</li>
<li><strong>Surveying:</strong> Chain, Compass, Plane Table, Theodolite, Total Station, GPS</li>
<li><strong>Construction Materials & Estimation:</strong> Properties of materials, Rate Analysis, Estimating</li>
</ul>

<h2>Salary After Selection</h2>
<p>SSC JE Civil selected candidates are placed in Pay Level 6 of the 7th Pay Commission matrix:</p>
<ul>
<li><strong>Basic Pay:</strong> ₹35,400 per month</li>
<li><strong>Total Salary (with DA, HRA, TA):</strong> ₹45,000–₹60,000 per month depending on posting city</li>
<li><strong>Annual CTC (approximate):</strong> ₹6–8 lakh</li>
</ul>

<h2>Preparation Strategy</h2>
<p><strong>Stage 1 — Foundation (Month 1–2):</strong> Complete NCERT-level basics for each subject. Cover standard textbooks: R.K. Bansal for Fluid, Ramamrutham for RCC, Arora & Bindra for Surveying.</p>
<p><strong>Stage 2 — Standard Books (Month 3–4):</strong> MADE EASY or ICE Gate materials. Focus on formula sheet preparation.</p>
<p><strong>Stage 3 — Practice (Month 5–6):</strong> Previous year papers (2010–2024). Topic-wise mock tests. Attempt minimum 2 full mocks per week.</p>
<p><strong>Stage 4 — Revision (Final Month):</strong> Only formula revision and PYQ solving. No new topics.</p>',
 'exam-prep', ARRAY['SSC JE','Civil Engineering','2026','Government Jobs'], true, now()),
('civil-engineer-salary-india-2026',
 'Civil Engineer Salary in India 2026 — Complete Guide by City, Role & Company',
 'Real civil engineer salaries in India 2026. Site engineer to project manager. Government vs private vs MNC. By city and experience.',
 '<h2>Civil Engineer Salary Overview — India 2026</h2>
<p>Civil engineering salaries in India vary widely based on role, city, company type, and years of experience. This guide compiles data from job postings and engineer submissions on CivilCareer.</p>

<h2>Salary by Role — Freshers (0–2 years)</h2>
<table><tr><th>Role</th><th>Government (7th CPC)</th><th>PSU</th><th>Private</th><th>MNC</th></tr>
<tr><td>Junior Engineer</td><td>₹35,400/month</td><td>₹30,000–40,000</td><td>₹20,000–30,000</td><td>₹30,000–45,000</td></tr>
<tr><td>Site Engineer</td><td>N/A (via JE exam)</td><td>₹28,000–38,000</td><td>₹18,000–28,000</td><td>₹28,000–42,000</td></tr>
<tr><td>Assistant Engineer</td><td>₹47,600/month</td><td>₹40,000–55,000</td><td>₹25,000–38,000</td><td>₹40,000–60,000</td></tr>
</table>

<h2>Salary by City — Mid-Level (3–7 years)</h2>
<table><tr><th>City</th><th>Site Engineer</th><th>Planning Engineer</th><th>QS</th></tr>
<tr><td>Mumbai</td><td>₹5–9L/year</td><td>₹8–14L/year</td><td>₹7–12L/year</td></tr>
<tr><td>Bengaluru</td><td>₹5–8L/year</td><td>₹7–13L/year</td><td>₹6–11L/year</td></tr>
<tr><td>Hyderabad</td><td>₹4–7L/year</td><td>₹6–11L/year</td><td>₹5–9L/year</td></tr>
<tr><td>Delhi/NCR</td><td>₹5–9L/year</td><td>₹8–14L/year</td><td>₹6–11L/year</td></tr>
<tr><td>Pune</td><td>₹4–8L/year</td><td>₹7–12L/year</td><td>₹5–9L/year</td></tr>
</table>

<h2>Government vs Private vs PSU</h2>
<p><strong>Government (Central):</strong> Best job security, steady increments, pension. L&T cannot fire you. Starting slow but compounds well. JE at ₹35,400 grows to ₹1,00,000+ in 20 years with promotions.</p>
<p><strong>PSUs (NTPC, NHPC, RITES):</strong> Best of both worlds. Market salaries + job security. Executive Trainee at ₹40,000+ with annual increment. NTPC ET salary after 3 years crosses ₹70,000/month.</p>
<p><strong>MNC (AECOM, WSP, Jacobs):</strong> Highest salaries at senior levels. Site exposure limited but design/consulting work is prestigious. Salary 2x of government at same experience level.</p>
<p><strong>Private Indian (L&T, Shapoorji, NCC):</strong> Good salary with project allowances. Site engineers get accommodation, food, transport. Total CTC + perks = 15–20% above base.',
 'salary', ARRAY['Salary','Civil Engineer','2026','India'], true, now()),
('gate-civil-2026-preparation',
 'GATE Civil Engineering 2026 — Complete Preparation Guide by Subject',
 'How to crack GATE Civil 2026. Subject-wise strategy, best books, important topics and mock test schedule from civil engineers who scored 700+.',
 '<h2>GATE Civil Engineering 2026 — Overview</h2>
<p>GATE (Graduate Aptitude Test in Engineering) Civil Engineering paper is attempted by over 1 lakh candidates annually. A good GATE score opens doors to PSU jobs (NTPC, NHPC, RITES, NBCC), M.Tech admissions at IITs and NITs, and direct PhD programs.</p>

<h2>Paper Pattern</h2>
<table><tr><th>Section</th><th>Marks</th><th>Questions</th></tr>
<tr><td>General Aptitude</td><td>15</td><td>10</td></tr>
<tr><td>Engineering Mathematics</td><td>13</td><td>—</td></tr>
<tr><td>Civil Engineering Subjects</td><td>72</td><td>—</td></tr>
<tr><td><strong>Total</strong></td><td><strong>100</strong></td><td><strong>65</strong></td></tr></table>

<h2>Subject-Wise Weightage (5-year average)</h2>
<ul>
<li>Structural Engineering: 18–22 marks (highest — never ignore)</li>
<li>Geotechnical Engineering: 10–14 marks</li>
<li>Fluid Mechanics + Hydraulics: 8–12 marks</li>
<li>Transportation Engineering: 6–9 marks</li>
<li>Environmental Engineering: 4–6 marks</li>
<li>Surveying: 3–5 marks</li>
<li>Construction Materials + Management: 3–5 marks</li>
<li>Engineering Maths: 12–15 marks</li>
</ul>

<h2>Study Plan — 6 Months</h2>
<p><strong>Month 1–2:</strong> Complete Structural Engineering and Engineering Mathematics. These two alone = 35% of paper. Structural = Beams, Trusses, Arches, Columns, RCC, Steel, Pre-stressed Concrete.</p>
<p><strong>Month 3:</strong> Geotechnical + Fluid Mechanics. Use standard notes. Solve all formulas from memory.</p>
<p><strong>Month 4:</strong> Transportation + Environmental + Surveying + Construction Management.</p>
<p><strong>Month 5:</strong> Previous year papers 2015–2024. Time yourself. Identify weak topics.</p>
<p><strong>Month 6:</strong> Full mocks (Gate 2024 pattern). Minimum 2 mocks/week. Only revision, no new topics.</p>

<h2>Best Books — GATE Civil</h2>
<ul>
<li><strong>Structural:</strong> Theory of Structures — B.C. Punmia; RCC — B.C. Punmia or Krishna Raju</li>
<li><strong>Geotech:</strong> Soil Mechanics — B.C. Punmia or Venkatramaiah</li>
<li><strong>Fluid:</strong> Fluid Mechanics — R.K. Bansal or Modi & Seth</li>
<li><strong>Transport:</strong> Highway Engineering — Khanna & Justo</li>
<li><strong>Maths:</strong> Engineering Mathematics — B.S. Grewal or MADE EASY notes</li>
<li><strong>PYQs:</strong> GATE Civil PYQ book (MADE EASY or GK Publications)</li>
</ul>',
 'exam-prep', ARRAY['GATE','Civil Engineering','2026','Preparation'], true, now())
ON CONFLICT DO NOTHING;

-- SEED: Interview questions
INSERT INTO interview_questions (company,role,question,answer,difficulty,round,year,is_approved) VALUES
('L&T Construction','Site Engineer','What is the difference between shuttering and formwork?','Formwork is the complete system (falsework + shuttering). Shuttering specifically refers to the moulding surface (plywood/steel plates) that is in contact with concrete. Falsework supports the shuttering.','easy','Technical',2024,true),
('L&T Construction','Site Engineer','Explain the water-cement ratio and its effect on concrete strength.','W/C ratio = weight of water / weight of cement. Lower W/C = higher strength but less workability. IS 456 specifies max W/C of 0.45 for M25 in moderate exposure. Every 0.05 increase in W/C decreases strength by ~5–7 MPa.','medium','Technical',2024,true),
('L&T Construction','Planning Engineer','What is the difference between CPM and PERT?','CPM (Critical Path Method) uses single time estimates — suitable for repetitive activities with known durations like construction. PERT (Program Evaluation Review Technique) uses three time estimates (optimistic/most likely/pessimistic) — suitable for R&D projects with uncertain durations.','medium','Technical',2023,true),
('AECOM India','Site Engineer','What is Bar Bending Schedule (BBS) and why is it important?','BBS is a detailed list of all reinforcement bars required for a structural element showing shape, diameter, length, number of bars, weight and bend details. It is essential for: (1) accurate steel procurement, (2) cutting waste minimisation, (3) site fabrication guidance, (4) cost control.','easy','Technical',2024,true),
('AECOM India','Structural Engineer','Explain the concept of load path in a building structure.','Load path is the route by which loads travel from where they are applied to the ground: Live load → Slab → Beams → Columns → Footings → Soil. Every structural element must be designed to transfer loads along this path without failure.','medium','Technical',2023,true),
('NCC Limited','Project Engineer','How do you handle a situation where concrete placement is delayed and concrete starts to set?','(1) Never add water to concrete that has started to set. (2) If delay < initial setting time (~30 min for OPC), use retarder admixture if anticipated. (3) If delay > initial setting time, reject the batch. (4) Document the rejection with time stamps. (5) Notify QC and project manager.','hard','Technical',2024,true),
('CPWD','Junior Engineer','What are the different types of estimates in construction?','(1) Preliminary/Rough Cost Estimate — based on floor area or volume. (2) Plinth Area Estimate — based on plinth area rate. (3) Cubical Content Estimate — for multi-storey. (4) Approximate Quantity Method — for similar previous projects. (5) Detailed Estimate — item-wise using schedule of rates. Most accurate: Detailed Estimate.','easy','Technical',2023,true),
('L&T Construction','Any','Why do you want to join L&T Construction?','Focus on: (1) Scale of projects — L&T handles mega projects like metros, airports, nuclear plants. (2) Learning curve — structured training programs. (3) International presence. (4) India''s largest construction company — job security and brand value. Be genuine and specific about which division (Buildings/Heavy Civil/Power).','easy','HR',2024,true),
('NTPC','Executive Trainee','Explain the working principle of a cooling tower.','Cooling tower dissipates waste heat from industrial processes to atmosphere. Hot water from condenser is sprayed from top. As water falls through fill media, a fraction evaporates — this removes heat. Cool water collects at bottom sump and is recirculated. Types: Natural draft (hyperbolic) and Mechanical draft (forced/induced).','medium','Technical',2023,true),
('Shapoorji Pallonji','Site Engineer','What checks do you perform before concreting a column?','(1) Formwork — plumb, braced, joints sealed, covers placed. (2) Reinforcement — correct dia, spacing, lap lengths per BBS, cover blocks in place. (3) MEP inserts — conduit sleeves, anchor bolts positioned. (4) Column base cleaned of debris and water. (5) Trial pour test for slump. (6) Structural engineer inspection done. (7) Concrete delivery note checked.','medium','Technical',2024,true)
ON CONFLICT DO NOTHING;

-- VERIFY
SELECT 'mock_questions' as tbl, COUNT(*) FROM mock_questions
UNION ALL SELECT 'blog_posts', COUNT(*) FROM blog_posts
UNION ALL SELECT 'interview_questions', COUNT(*) FROM interview_questions;
