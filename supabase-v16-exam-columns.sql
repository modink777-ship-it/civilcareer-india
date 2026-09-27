-- v16: columns the exam scanner writes (run in Supabase SQL editor)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS auto_discovered boolean DEFAULT false;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS official_website_url text;
