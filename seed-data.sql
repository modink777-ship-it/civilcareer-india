-- ============================================================
-- CivilCareer India — Supabase Seed Data
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. JOBS  (12 records — mix of Private, Government, MNC)
-- ─────────────────────────────────────────────────────────────

INSERT INTO jobs (
  role, company, location, description, qualification, experience_level,
  employment_type, salary, sector, source_url, application_method,
  deadline, status, published, posted_at
) VALUES

-- Private jobs
(
  'Site Engineer – Civil',
  'Shapoorji Pallonji & Co.',
  'Bengaluru, Karnataka',
  'Responsible for day-to-day site execution of residential and commercial construction. Coordinate with subcontractors, maintain quality standards, prepare daily progress reports and ensure work is completed on schedule.',
  'B.E. / B.Tech Civil Engineering',
  '1–3 years',
  'Full-time',
  '₹3.5 – 5 LPA',
  'Private',
  'https://www.shapoorji.in/careers',
  'Apply via company careers page',
  (CURRENT_DATE + INTERVAL '25 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Quantity Surveyor',
  'L&T Construction',
  'Mumbai, Maharashtra',
  'Prepare BOQ, estimate quantities, verify sub-contractor bills, reconcile materials and support the commercial team in cost control for large infrastructure projects.',
  'B.E. Civil / Diploma Civil with strong BOQ experience',
  '3–6 years',
  'Full-time',
  '₹6 – 9 LPA',
  'Private',
  'https://www.larsentoubro.com/careers',
  'Apply via L&T careers portal',
  (CURRENT_DATE + INTERVAL '18 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Planning Engineer',
  'Tata Projects Ltd.',
  'Hyderabad, Telangana',
  'Develop and maintain project schedules using Primavera P6, track progress against baseline, identify delays and prepare MIS reports for senior management.',
  'B.E. Civil Engineering; Primavera P6 or MS Project proficiency required',
  '4–8 years',
  'Full-time',
  '₹8 – 12 LPA',
  'Private',
  'https://www.tataprojects.com/careers',
  'Apply via Tata Projects careers portal',
  (CURRENT_DATE + INTERVAL '30 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Structural Engineer – Design',
  'STUP Consultants Pvt. Ltd.',
  'Pune, Maharashtra',
  'Design and analyse RCC and steel structures using STAAD.Pro and ETABS. Prepare structural drawings, detail bar bending schedules and liaise with site teams for technical queries.',
  'B.E. / M.E. Civil / Structural Engineering',
  '2–5 years',
  'Full-time',
  '₹5 – 8 LPA',
  'Private',
  'https://www.stup.co.in',
  'Send CV to careers@stup.co.in with subject: Structural Engineer',
  (CURRENT_DATE + INTERVAL '21 days')::text,
  'Active',
  true,
  NOW()
),

(
  'QA/QC Engineer',
  'NCC Ltd.',
  'Chennai, Tamil Nadu',
  'Implement and maintain quality management systems on a metro rail project. Conduct inspections, raise NCRs, maintain testing records and co-ordinate with client's quality team.',
  'B.E. Civil Engineering; knowledge of IS codes and quality standards',
  '3–7 years',
  'Full-time',
  '₹5 – 7 LPA',
  'Private',
  'https://www.ncc.co.in/careers',
  'Apply via NCC careers page',
  (CURRENT_DATE + INTERVAL '15 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Highway / Road Engineer',
  'GMR Group',
  'Delhi, NCR',
  'Design and supervise highway and road projects. Responsible for geometric design, pavement design, drainage and coordination with NHAI/PWD officials on a four-lane road widening project.',
  'B.E. Civil Engineering; experience in road/highway projects preferred',
  '5–10 years',
  'Full-time',
  '₹9 – 14 LPA',
  'Private',
  'https://www.gmrgroup.in/careers',
  'Apply via GMR careers portal',
  (CURRENT_DATE + INTERVAL '20 days')::text,
  'Active',
  true,
  NOW()
),

-- Government jobs
(
  'Junior Engineer (Civil)',
  'Karnataka Public Works Department',
  'Karnataka (Various Districts)',
  'Recruitment of Junior Engineers (Civil) for PWD Karnataka. Duties include supervision of construction, maintenance of roads, bridges and government buildings across the state.',
  'Diploma / B.E. in Civil Engineering; Karnataka state domicile required',
  'Fresher / 0–2 years',
  'Full-time',
  '₹35,400 – 1,12,400 (Level 6)',
  'Government',
  'https://kpsc.kar.nic.in',
  'Apply online at KPSC official portal',
  (CURRENT_DATE + INTERVAL '35 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Assistant Engineer (Civil)',
  'Telangana State Public Service Commission',
  'Telangana (All Districts)',
  'TSPSC recruitment for Assistant Engineers (Civil) in various government departments including Irrigation, Roads & Buildings, HMWSSB. Role involves design, execution and supervision of public infrastructure projects.',
  'B.E. / B.Tech Civil Engineering',
  'Fresher / up to 5 years',
  'Full-time',
  '₹53,500 – 1,35,100 (Level 10)',
  'Government',
  'https://tspsc.gov.in',
  'Apply online at TSPSC official portal',
  (CURRENT_DATE + INTERVAL '40 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Junior Engineer – Civil (SSC JE)',
  'Staff Selection Commission',
  'Pan India (Central Government)',
  'SSC JE recruitment for Central Water Commission, CPWD, Border Roads Organisation (BRO), Central Public Works Department and MES. Junior Engineers handle field surveys, site supervision and reporting.',
  'Diploma or B.E. in Civil Engineering',
  'Fresher / 0–3 years',
  'Full-time',
  '₹35,400 – 1,12,400 (Pay Matrix Level 6)',
  'Government',
  'https://ssc.nic.in',
  'Apply online at ssc.nic.in',
  (CURRENT_DATE + INTERVAL '28 days')::text,
  'Active',
  true,
  NOW()
),

-- MNC jobs
(
  'Civil Project Engineer',
  'Aecom India Pvt. Ltd.',
  'Gurgaon, Haryana',
  'Support delivery of infrastructure projects (roads, bridges, metro) for central and state government clients. Perform design coordination, quality reviews, prepare engineering reports and liaise with local authorities.',
  'B.E. Civil Engineering; experience in infra consulting preferred',
  '3–6 years',
  'Full-time',
  '₹10 – 16 LPA',
  'MNC',
  'https://aecom.com/careers',
  'Apply via AECOM global careers portal',
  (CURRENT_DATE + INTERVAL '22 days')::text,
  'Active',
  true,
  NOW()
),

(
  'BIM Coordinator – Civil',
  'WSP Global Inc. (India)',
  'Bengaluru, Karnataka',
  'Develop 3D civil BIM models using Revit and Civil 3D, coordinate clash detection with MEP and structural teams, produce BIM Execution Plans and manage model quality on large urban transport projects.',
  'B.E. Civil Engineering; Autodesk Revit / Civil 3D certification preferred',
  '2–5 years',
  'Full-time',
  '₹8 – 13 LPA',
  'MNC',
  'https://www.wsp.com/en-in/careers',
  'Apply via WSP India careers portal',
  (CURRENT_DATE + INTERVAL '17 days')::text,
  'Active',
  true,
  NOW()
),

(
  'Geotechnical Engineer',
  'Fugro India Marine',
  'Mumbai / Offshore Projects',
  'Conduct and interpret geotechnical site investigations for offshore and onshore infrastructure. Prepare borehole logs, laboratory testing programmes, geotechnical reports and foundation recommendations.',
  'M.E. / M.Tech Geotechnical Engineering; B.E. Civil with 5+ years geotechnical experience also considered',
  '3–7 years',
  'Full-time',
  '₹9 – 15 LPA',
  'MNC',
  'https://www.fugro.com/careers',
  'Apply via Fugro global careers page',
  (CURRENT_DATE + INTERVAL '26 days')::text,
  'Active',
  true,
  NOW()
);


-- ─────────────────────────────────────────────────────────────
-- 2. EXAMS  (6 records)
-- ─────────────────────────────────────────────────────────────

INSERT INTO exams (
  code, title_en, authority, overview, eligibility_en,
  status, published, notification_date,
  application_start, application_end, exam_date,
  vacancy_count, pay_scale, selection_process, job_location,
  apply_url, official_website_url
) VALUES

(
  'GATE',
  'GATE 2026 — Civil Engineering (CE)',
  'IIT Roorkee (Organising Institute 2026)',
  'Graduate Aptitude Test in Engineering (GATE) 2026 for Civil Engineering (CE paper). GATE score is valid for 3 years and is required for M.Tech/Ph.D. admissions and recruitment in PSUs such as BHEL, GAIL, HPCL, NHAI, and state engineering services.',
  'B.E. / B.Tech / M.Sc. or equivalent in Civil Engineering or related discipline. Final-year students may also apply.',
  'Open',
  true,
  '2025-09-01',
  '2025-09-01',
  '2025-10-05',
  '2026-02-08',
  NULL,
  'GATE score used for M.Tech admissions and PSU recruitment. PSU salary varies: typically ₹50,000–1,00,000/month.',
  'Online exam: General Aptitude (15 marks) + Engineering Mathematics (13 marks) + Civil Engineering Core (72 marks). Total: 100 marks, 3 hours.',
  'All India',
  'https://gate2026.iitr.ac.in',
  'https://gate2026.iitr.ac.in'
),

(
  'ESE',
  'Engineering Services Examination (ESE) 2026 — Civil Engineering',
  'Union Public Service Commission (UPSC)',
  'UPSC Engineering Services Examination (ESE/IES) 2026 for Civil Engineering branch. Successful candidates are appointed as Class I officers in Central Engineering Services such as CPWD, CWC, BRO, Railways and Ordnance Factories.',
  'B.E. / B.Tech Civil Engineering from a recognised university. Age: 21–30 years (relaxation for SC/ST/OBC as per rules).',
  'Open',
  true,
  '2025-10-18',
  '2025-10-18',
  '2025-11-14',
  '2026-02-22',
  '250 (approx. across all engineering branches)',
  'Level 10 (₹56,100–1,77,500) on joining as Assistant Executive Engineer. Higher grades on promotion.',
  'Preliminary (Objective) → Main (Conventional/Descriptive) → Personality Test (Interview).',
  'Pan India',
  'https://upsconline.nic.in',
  'https://upsc.gov.in/examinations/active-examinations'
),

(
  'SSC JE',
  'SSC Junior Engineer (Civil & Structural) 2025',
  'Staff Selection Commission (SSC)',
  'SSC Junior Engineer Paper-I and Paper-II for Civil and Structural Engineering. Selected candidates are posted to Central departments including CPWD, CWC, MES, BRO and Central Water Power Research Station.',
  'Diploma or Degree in Civil Engineering from a recognised institution. Age: 18–32 years.',
  'Open',
  true,
  '2025-08-15',
  '2025-08-15',
  '2025-09-10',
  '2025-12-01',
  '1,765',
  'Pay Level 6 (₹35,400–1,12,400) in the Central Government Pay Matrix.',
  'Paper-I: Objective (General Intelligence, General Awareness, Civil/Structural Engineering). Paper-II: Conventional/Descriptive (Civil Engineering). Document verification.',
  'Pan India — Central Government Departments',
  'https://ssc.nic.in',
  'https://ssc.nic.in'
),

(
  'RRB JE',
  'RRB Junior Engineer (Civil) — CEN 03/2024',
  'Railway Recruitment Board (RRB)',
  'RRB Junior Engineer recruitment (Civil) for Indian Railways including bridges, tracks, civil maintenance, construction and drainage. Appointed to Railway zones across India.',
  'Diploma / B.E. / B.Tech in Civil Engineering. Age: 18–33 years.',
  'Open',
  true,
  '2024-12-01',
  '2024-12-05',
  '2025-01-31',
  '2025-06-10',
  '7,951 (Civil category)',
  'Level 6 (₹35,400–1,12,400) plus Railway allowances.',
  'CBT-1 (screening) → CBT-2 (technical) → Document Verification → Medical Examination.',
  'All India — Various Railway Zones',
  'https://rrbcdg.gov.in',
  'https://indianrailways.gov.in'
),

(
  'KPSC AE',
  'KPSC Assistant Executive Engineer (Civil) 2025',
  'Karnataka Public Service Commission (KPSC)',
  'KPSC recruitment for Assistant Executive Engineers (Civil) in Karnataka PWD, Irrigation, Water Resources and various state departments. This is a Group A Gazetted post.',
  'B.E. / B.Tech Civil Engineering. Karnataka state domicile required. Age: 21–35 years (relaxation for reserved categories).',
  'Open',
  true,
  '2025-07-10',
  '2025-07-15',
  '2025-08-20',
  '2025-11-15',
  '320',
  'Pay Level 12 (₹67,800–2,08,700) as per Karnataka Pay Revision.',
  'Written Examination (Technical + General Studies) → Viva Voce (Interview). Merit list based on written exam marks.',
  'Karnataka (Various Districts)',
  'https://kpsc.kar.nic.in',
  'https://kpsc.kar.nic.in'
),

(
  'TSPSC AEE',
  'TSPSC Assistant Executive Engineer (Civil) — Group-II Services 2025',
  'Telangana State Public Service Commission (TSPSC)',
  'TSPSC recruitment for Assistant Executive Engineers (Civil) in Telangana departments: Roads & Buildings, Irrigation & CAD, HMWSSB, TSGENCO, TSNPDCL, and Panchayat Raj Engineering. Direct recruitment under Group-II engineering services.',
  'B.E. / B.Tech Civil Engineering recognised by AICTE. Telangana domicile (Integrated AP domicile also eligible). Age: 18–44 years.',
  'Open',
  true,
  '2025-09-05',
  '2025-09-10',
  '2025-10-10',
  '2025-12-20',
  '1,012',
  'Pay Level 10 (₹53,500–1,35,100) plus other allowances as per Telangana GO.',
  'Computer Based Test (CBT) — Civil Engineering subject paper + General Studies → Document Verification.',
  'Telangana (All Districts)',
  'https://tspsc.gov.in',
  'https://tspsc.gov.in'
);


-- ─────────────────────────────────────────────────────────────
-- 3. MATERIALS  (6 records — free study resources)
-- ─────────────────────────────────────────────────────────────

INSERT INTO materials (
  title_en, description_en, category, access_type,
  file_url, author, published
) VALUES

(
  'GATE Civil Engineering — Complete Syllabus & Topic Weightage Guide',
  'Topic-wise weightage analysis from the last 10 years of GATE CE papers. Covers Structural Analysis, Concrete Structures, Soil Mechanics, Fluid Mechanics, Environmental Engineering, Transportation and Surveying. Use this to prioritise your revision.',
  'Competitive Exams',
  'Free',
  'https://gate.iitb.ac.in/2025/downloads/GATE2025_CE_syllabus.pdf',
  'IIT Bombay (GATE 2025)',
  true
),

(
  'SSC JE Civil Engineering — Previous Year Papers (2018–2024)',
  'Collection of SSC JE Paper-I and Paper-II (Civil & Structural) questions from 2018 to 2024 with answer keys. Ideal for practice, understanding question patterns and identifying recurring topics.',
  'Competitive Exams',
  'Free',
  'https://ssc.nic.in/Portal/QuestionPapers',
  'Staff Selection Commission (Official)',
  true
),

(
  'Structural Analysis — Beams, Frames and Trusses (NPTEL)',
  'Free NPTEL course on Structural Analysis covering determinate and indeterminate structures, stiffness method, force method, slope-deflection equations, moment distribution and influence lines. 40 hours of video lectures by IIT faculty.',
  'Civil Engineering',
  'Free',
  'https://nptel.ac.in/courses/105101114',
  'NPTEL — IIT Madras',
  true
),

(
  'AutoCAD for Civil Engineers — Drawing & Detailing Basics',
  'Beginner-to-intermediate AutoCAD tutorial series covering 2D drafting, layering, dimensioning, plot setup, civil drawing templates and typical site plan details. Hosted on YouTube playlist — no installation required to start learning.',
  'Software & Tools',
  'Free',
  'https://www.youtube.com/playlist?list=PLWlEhbciGKo0OM3hL8X5m8dEsP7DPUFUA',
  'CivilEngineeringAcademy (YouTube)',
  true
),

(
  'Soil Mechanics & Foundation Engineering — IS Code Reference',
  'Quick-reference guide to the most important IS codes used in Geotechnical Engineering: IS 1893, IS 6403, IS 8009, IS 2911 and IS 1888. Includes scope summary, key clauses and worked examples for site engineers and exam preparation.',
  'Civil Engineering',
  'Free',
  'https://www.bis.gov.in/standards-and-codes/free-downloads/',
  'Bureau of Indian Standards (BIS)',
  true
),

(
  'Civil Engineering Interview Questions — Top 100 Technical Questions',
  'Most commonly asked civil engineering technical interview questions for campus placements and lateral hiring, organised by subject: Structures, Geotechnical, Fluid Mechanics, Surveying, Transportation, Construction Management and General Civil.',
  'Interview & Career',
  'Free',
  'https://civilengineeringacademy.com/civil-engineering-interview-questions/',
  'Civil Engineering Academy',
  true
);
