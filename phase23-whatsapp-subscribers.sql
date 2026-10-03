-- ═══════════════════════════════════════════════════════════════
-- CivilCareer — v23: WHATSAPP ALERT SUBSCRIBERS (Feature 9)
-- Run ONCE in Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS whatsapp_subscribers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp text UNIQUE NOT NULL,          -- +91XXXXXXXXXX (E.164), upsert key
  name text,
  city text,
  preferred_roles text[],
  preferred_sectors text[],
  language text DEFAULT 'en',             -- en | hi | te | kn | ta | mr
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Indexes for admin filters and future alert-batch queries
CREATE INDEX IF NOT EXISTS wa_subs_city_idx    ON whatsapp_subscribers (city);
CREATE INDEX IF NOT EXISTS wa_subs_active_idx  ON whatsapp_subscribers (is_active);
CREATE INDEX IF NOT EXISTS wa_subs_created_idx ON whatsapp_subscribers (created_at DESC);
CREATE INDEX IF NOT EXISTS wa_subs_roles_idx   ON whatsapp_subscribers USING GIN (preferred_roles);
CREATE INDEX IF NOT EXISTS wa_subs_sectors_idx ON whatsapp_subscribers USING GIN (preferred_sectors);

-- 3. Row Level Security
ALTER TABLE whatsapp_subscribers ENABLE ROW LEVEL SECURITY;

-- NO public policies at all: subscriber data (phone numbers) is personal
-- data under DPDP. Reads happen only via /api/whatsapp-subscribe with the
-- owner key (service-role bypasses RLS); writes go through the same
-- rate-limited, validated API with upsert-on-number semantics.

-- 4. Optional: three sample rows for the admin Subscribers tab demo.
--    DELETE this section if you don't want samples.
INSERT INTO whatsapp_subscribers (whatsapp, name, city, preferred_roles, preferred_sectors, language) VALUES
('+919876543201', 'Sample Subscriber A', 'Bengaluru', '{Site Engineer}', '{Private,PSU}', 'en'),
('+919876543202', 'Sample Subscriber B', 'Mumbai', '{Planning Engineer}', '{MNC}', 'en'),
('+919876543203', 'नमूना सदस्य C', 'Jaipur', '{Junior Engineer}', '{Government}', 'hi')
ON CONFLICT (whatsapp) DO NOTHING;
